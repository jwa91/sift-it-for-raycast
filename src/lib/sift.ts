import { getPreferenceValues } from "@raycast/api";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** The kinds this extension knows. A newer engine can send others: a hit's kind is any name. */
export type Kind = "plaintext" | "document" | "image" | "screenshot" | "audio" | "video" | "code" | "conversation";
/** The segments this extension knows; a hit's segment is any name, like its kind. */
export type Segment = "passage" | "page" | "picture" | "ocr" | "sound" | "frame" | "exchange";

export interface Hit {
  /** The file, and what it's called: its name, or a conversation's title. */
  path: string;
  name: string;
  /** A Kind, or a newer engine's kind. */
  kind: string;
  /** A Segment, or a newer engine's segment. */
  segment: string;
  segment_id: number;
  /** Where in the file: a line, a page or a second, by the segment; for an exchange, when it was said (Unix seconds). */
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

/** PDFs are documents shown page by page. */
export function isPdf(hit: Hit): boolean {
  return hit.path.toLowerCase().endsWith(".pdf");
}

/**
 * What a conversation's info says, as far as it says it: its agent (`claude` or `codex`), its session, the folder it
 * started in, and the command that resumes it there, as words. undefined for anything but a conversation.
 */
export interface Conversation {
  agent?: string;
  session?: string;
  cwd?: string;
  resume?: string[];
}

export function conversationOf(hit: Hit): Conversation | undefined {
  if (hit.kind !== "conversation") return undefined;
  const info = hit.info ?? {};
  const text = (value: unknown) => (typeof value === "string" && value.length > 0 ? value : undefined);
  const words = info.resume;
  return {
    agent: text(info.agent),
    session: text(info.session),
    cwd: text(info.cwd),
    resume:
      Array.isArray(words) && words.length > 0 && words.every((word) => typeof word === "string") ? words : undefined,
  };
}

export interface SearchResponse {
  hits: Hit[];
  meaning: boolean;
  ms: number;
}

/** The sift-it binary: the one set in preferences, else Homebrew's (brew install jwa91/tap/sift-it), else `make install`'s. */
export function siftBinary(): string | undefined {
  const { siftPath } = getPreferenceValues<Preferences>();
  const candidates = [
    siftPath?.trim().replace(/^~(?=\/)/, homedir()),
    "/opt/homebrew/bin/sift-it",
    join(homedir(), ".local/bin/sift-it"),
    "/usr/local/bin/sift-it",
  ];
  return candidates.find((path): path is string => !!path && existsSync(path));
}
