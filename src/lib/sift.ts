import { getPreferenceValues } from "@raycast/api";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type Kind = "plaintext" | "document" | "image" | "screenshot" | "audio" | "video" | "code";
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

/** PDFs are documents shown page by page. */
export function isPdf(hit: Hit): boolean {
  return hit.path.toLowerCase().endsWith(".pdf");
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
