import { getPreferenceValues } from "@raycast/api";
import { execFile, spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Where the engine keeps its files (see engine/src/config.rs). */
export const SIFT_HOME = join(homedir(), "Library/Application Support/Sift");

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
  z?: number | null;
  cosine?: number | null;
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

/** The sift binary: the one set in preferences, else where scripts/install.sh puts it, else on the usual paths. */
export function siftBinary(): string | undefined {
  const { siftPath } = getPreferenceValues<Preferences>();
  const candidates = [
    siftPath?.trim().replace(/^~(?=\/)/, homedir()),
    join(SIFT_HOME, "bin/sift"),
    join(homedir(), ".local/bin/sift"),
    "/opt/homebrew/bin/sift",
    "/usr/local/bin/sift",
  ];
  return candidates.find((path): path is string => !!path && existsSync(path));
}

export class MissingEngineError extends Error {
  constructor() {
    super("The sift engine isn't installed. Run scripts/install.sh in the repository, or set its path in preferences.");
  }
}

/** Runs `sift <args>` and returns its stdout. */
export function runSift(args: string[], timeout = 60_000): Promise<string> {
  const binary = siftBinary();
  if (!binary) return Promise.reject(new MissingEngineError());
  return new Promise((resolve, reject) => {
    execFile(binary, args, { timeout, maxBuffer: 64 << 20 }, (error, stdout, stderr) => {
      if (error) reject(new Error(stderr.trim().replace(/^sift: /, "") || error.message));
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

/** Starts a sift command that outlives Raycast's window (indexing, the model download). */
export function startDetached(args: string[]): void {
  const binary = siftBinary();
  if (!binary) throw new MissingEngineError();
  const child = spawn(binary, args, { detached: true, stdio: "ignore" });
  child.unref();
}
