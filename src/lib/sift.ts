import { getPreferenceValues } from "@raycast/api";
import { execFile, spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Where the engine keeps its files (see engine/src/config.rs). */
export const SIFT_HOME = join(homedir(), "Library/Application Support/Sift It");

export type Kind = "text" | "doc" | "pdf" | "image" | "screenshot" | "audio" | "video" | "code";
export type Segment = "passage" | "page" | "picture" | "ocr" | "sound" | "frame";

export interface Hit {
  path: string;
  name: string;
  kind: Kind;
  segment: Segment;
  segment_id: number;
  loc?: number | null;
  loc_end?: number | null;
  score: number;
  /** How far the meaning match stands above the query's median. */
  lift?: number | null;
  cosine?: number | null;
  /** Matched by meaning. */
  meaning: boolean;
  /** Has all of the query's words. */
  words: boolean;
  strong: boolean;
  excerpt?: string | null;
  modified: number;
  size: number;
  info?: Record<string, unknown> | null;
}

export interface SearchResponse {
  hits: Hit[];
  meaning: boolean;
  ms: number;
}

export interface Config {
  folders: string[];
  excluded: string[];
  excluded_extensions: string[];
  include_code: boolean;
  index_on_battery: boolean;
}

export interface Stats {
  files: number;
  done: number;
  pending: number;
  failed: number;
  segments: number;
  vectors: number;
  by_kind: Record<string, number>;
  bytes: number;
}

export interface Status {
  index: string;
  stats: Stats;
  config: Config;
  models: { folder: string; text: boolean; media: boolean; bytes: number };
  indexer?: IndexerStatus | null;
}

/** What the background indexer writes to status.json. */
export interface IndexerStatus {
  pid: number;
  state: "starting" | "syncing" | "indexing" | "idle" | "paused" | "waiting" | "stopped";
  detail?: string | null;
  done: number;
  total: number;
  current?: string | null;
  updated: number;
  last_error?: string | null;
}

/** What indexing a folder means (`sift-it estimate`). */
export interface Estimate {
  folder: string;
  files: number;
  bytes: number;
  by_kind: Record<string, number>;
  seconds: number;
  unreadable: boolean;
}

export async function estimate(folders: string[]): Promise<Estimate[]> {
  if (folders.length === 0) return [];
  return JSON.parse(await runSift(["estimate", "--json", ...folders], 300_000)) as Estimate[];
}

/** "about 12 minutes", as the engine says it. */
export function describeDuration(seconds: number): string {
  if (seconds < 60) return "under a minute";
  if (seconds < 90 * 60) return `about ${Math.max(1, Math.round(seconds / 60))} minutes`;
  return `about ${Math.max(1, Math.round(seconds / 3600))} hours`;
}

/** The sift-it binary: the one set in preferences, else Homebrew's (brew install jwa91/tap/sift-it), else `make install`'s. */
export function siftBinary(): string | undefined {
  const { siftPath } = getPreferenceValues<Preferences>();
  const candidates = [
    siftPath?.trim().replace(/^~(?=\/)/, homedir()),
    "/opt/homebrew/bin/sift-it",
    join(homedir(), ".local/bin/sift-it"),
    "/usr/local/bin/sift-it",
    // Where development builds used to be installed.
    join(SIFT_HOME, "bin/sift-it"),
  ];
  return candidates.find((path): path is string => !!path && existsSync(path));
}

export class MissingEngineError extends Error {
  constructor() {
    super(
      "sift-it isn't installed. Install it with Homebrew (brew install jwa91/tap/sift-it), or set its path in preferences.",
    );
  }
}

/** Runs `sift-it <args>` and returns its stdout. */
export function runSift(args: string[], timeout = 60_000): Promise<string> {
  const binary = siftBinary();
  if (!binary) return Promise.reject(new MissingEngineError());
  return new Promise((resolve, reject) => {
    execFile(binary, args, { timeout, maxBuffer: 64 << 20 }, (error, stdout, stderr) => {
      if (error) reject(new Error(stderr.trim().replace(/^sift-it: /, "") || error.message));
      else resolve(stdout);
    });
  });
}

export async function getStatus(): Promise<Status> {
  const status = JSON.parse(await runSift(["status", "--json"])) as Status;
  status.indexer = readIndexerStatus();
  return status;
}

/** The background indexer's status file, when it's running (a file older than a few minutes is from a dead one). */
export function readIndexerStatus(): IndexerStatus | null {
  try {
    const status = JSON.parse(readFileSync(join(SIFT_HOME, "status.json"), "utf8")) as IndexerStatus;
    const alive = (() => {
      try {
        process.kill(status.pid, 0);
        return true;
      } catch {
        return false;
      }
    })();
    return alive ? status : { ...status, state: "stopped" };
  } catch {
    return null;
  }
}

/** Starts a sift-it command that outlives Raycast's window (indexing, the model download). */
export function startDetached(args: string[]): void {
  const binary = siftBinary();
  if (!binary) throw new MissingEngineError();
  const child = spawn(binary, args, { detached: true, stdio: "ignore" });
  child.unref();
}
