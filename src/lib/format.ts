import { Icon } from "@raycast/api";
import { basename, dirname } from "node:path";
import { homedir } from "node:os";
import { type Hit, type Kind, isPdf } from "./sift";

export const KIND_LABELS: Record<Kind, string> = {
  plaintext: "Text",
  document: "Document",
  image: "Picture",
  screenshot: "Screenshot",
  audio: "Recording",
  video: "Video",
  code: "Code",
};

export const KIND_ICONS: Record<Kind, Icon> = {
  plaintext: Icon.Text,
  document: Icon.Document,
  image: Icon.Image,
  screenshot: Icon.Desktop,
  audio: Icon.Microphone,
  video: Icon.FilmStrip,
  code: Icon.Code,
};

/** The kind filters in the search bar's dropdown. */
export const FILTERS: { id: string; title: string; kinds: Kind[]; icon: Icon }[] = [
  { id: "all", title: "Everything", kinds: [], icon: Icon.MagnifyingGlass },
  { id: "documents", title: "Documents and PDFs", kinds: ["plaintext", "document"], icon: Icon.Document },
  { id: "pictures", title: "Pictures and Screenshots", kinds: ["image", "screenshot"], icon: Icon.Image },
  { id: "recordings", title: "Recordings", kinds: ["audio"], icon: Icon.Microphone },
  { id: "videos", title: "Videos", kinds: ["video"], icon: Icon.FilmStrip },
  { id: "code", title: "Code", kinds: ["code"], icon: Icon.Code },
];

export function timestamp(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const rest = String(s % 60).padStart(2, "0");
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${rest}` : `${minutes}:${rest}`;
}

/** Where in the file the match is: "Page 3", "1:24", "Line 12". */
export function locationLabel(hit: Hit): string | undefined {
  if (hit.loc == null) return undefined;
  switch (hit.segment) {
    case "page":
      return `Page ${hit.loc}`;
    case "sound":
    case "frame":
      return timestamp(hit.loc);
    case "passage":
      if (isPdf(hit)) return `Page ${hit.loc}`;
      if (hit.path.endsWith(".ipynb")) return `Cell ${hit.loc}`;
      return hit.loc > 1 ? `Line ${hit.loc}` : undefined;
    case "ocr":
      return isPdf(hit) ? `Page ${hit.loc}` : undefined;
    default:
      return undefined;
  }
}

export function shortPath(path: string): string {
  const home = homedir();
  return path.startsWith(home) ? "~" + path.slice(home.length) : path;
}

export function folderOf(path: string): string {
  return shortPath(dirname(path));
}

export function fileName(path: string): string {
  return basename(path);
}

export function bytes(size: number): string {
  if (size < 1024) return `${size} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = size / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}

/** The query's words, as the engine splits them (letters and digits). */
export function wordsOf(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length > 1);
}

function escapeMarkdown(text: string): string {
  return text.replace(/([\\`*_{}[\]()#+!|<>~])/g, "\\$1");
}

/** The excerpt as Markdown, with the query's words in bold. */
export function highlight(text: string, query: string): string {
  const words = wordsOf(query);
  const escaped = escapeMarkdown(text.replace(/\s+/g, " ").trim());
  if (words.length === 0) return escaped;
  const pattern = new RegExp(`(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "giu");
  return escaped.replace(pattern, "**$1**");
}
