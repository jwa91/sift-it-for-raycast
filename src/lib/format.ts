import { Icon } from "@raycast/api";
import { execFileSync } from "node:child_process";
import { dirname } from "node:path";
import { homedir } from "node:os";
import { type Hit, type Kind, conversationOf, isPdf } from "./sift";

const KIND_LABELS: Record<Kind, string> = {
  plaintext: "Text",
  document: "Document",
  structured: "Data",
  image: "Picture",
  screenshot: "Screenshot",
  audio: "Audio",
  video: "Video",
  code: "Code",
  conversation: "Conversation",
};

const KIND_ICONS: Record<Kind, Icon> = {
  plaintext: Icon.Text,
  document: Icon.Document,
  structured: Icon.BarChart,
  image: Icon.Image,
  screenshot: Icon.Desktop,
  audio: Icon.Microphone,
  video: Icon.FilmStrip,
  code: Icon.Code,
  conversation: Icon.SpeechBubble,
};

/** A kind's name: "Picture", "Data", "Conversation". A kind this extension doesn't know is called what the engine calls it. */
export function kindLabel(kind: string): string {
  return (KIND_LABELS as Record<string, string | undefined>)[kind] ?? kind.charAt(0).toUpperCase() + kind.slice(1);
}

export function kindIcon(kind: string): Icon {
  return (KIND_ICONS as Record<string, Icon | undefined>)[kind] ?? Icon.Document;
}

/** The kind filters in the search bar's dropdown. */
export const FILTERS: { id: string; title: string; kinds: Kind[]; icon: Icon }[] = [
  { id: "all", title: "Everything", kinds: [], icon: Icon.MagnifyingGlass },
  { id: "documents", title: "Documents and PDFs", kinds: ["plaintext", "document"], icon: Icon.Document },
  { id: "pictures", title: "Pictures and Screenshots", kinds: ["image", "screenshot"], icon: Icon.Image },
  { id: "audio", title: "Audio", kinds: ["audio"], icon: Icon.Microphone },
  { id: "videos", title: "Videos", kinds: ["video"], icon: Icon.FilmStrip },
  { id: "code", title: "Code", kinds: ["code"], icon: Icon.Code },
  { id: "data", title: "Data", kinds: ["structured"], icon: Icon.BarChart },
  { id: "conversations", title: "Conversations", kinds: ["conversation"], icon: Icon.SpeechBubble },
];

let locale: string | undefined | null = null;

/**
 * The Mac's locale, for dates and times, as System Settings has it (Raycast's Node doesn't follow it): a region chosen
 * apart from the language counts, so `en_US@rg=nlzzzz` is en-NL. undefined when it can't be read.
 */
export function macLocale(): string | undefined {
  if (locale !== null) return locale;
  locale = undefined;
  try {
    const apple = execFileSync("/usr/bin/defaults", ["read", "-g", "AppleLocale"], { encoding: "utf8", timeout: 2000 });
    const [base, keywords = ""] = apple.trim().split("@");
    const region = /(?:^|;)rg=([a-z]{2})/i.exec(keywords)?.[1]?.toUpperCase();
    const tag = new Intl.Locale(base.replace(/_/g, "-"), region ? { region } : {}).toString();
    locale = Intl.DateTimeFormat.supportedLocalesOf(tag).length > 0 ? tag : undefined;
  } catch {
    // The runtime's own locale, then.
  }
  return locale;
}

let dates: { day: Intl.DateTimeFormat; time: Intl.DateTimeFormat; at: string } | undefined;

/** The formats `when` uses, made once. */
function dateFormats() {
  if (dates) return dates;
  const language = macLocale();
  // How the locale joins a date and a time, where the date comes first: " at ", " om ", " um ".
  const now = new Date();
  const date = now.toLocaleDateString(language, { dateStyle: "long" });
  const time = now.toLocaleTimeString(language, { timeStyle: "short" });
  const both = now.toLocaleString(language, { dateStyle: "long", timeStyle: "short" });
  const joined = both.length >= date.length + time.length && both.startsWith(date) && both.endsWith(time);
  dates = {
    day: new Intl.DateTimeFormat(language, { day: "numeric", month: "short" }),
    time: new Intl.DateTimeFormat(language, { hour: "numeric", minute: "2-digit" }),
    at: joined ? both.slice(date.length, both.length - time.length) : ", ",
  };
  return dates;
}

/** When something was said, to the minute, "2 Jun at 14:00", or the day, "2 Jun", as the Mac's locale writes them. */
export function when(seconds: number, time = true): string {
  const date = new Date(seconds * 1000);
  const { day, time: clock, at } = dateFormats();
  return time ? `${day.format(date)}${at}${clock.format(date)}` : day.format(date);
}

/** A date and time in full, as the Mac's locale writes them. */
export function dateTime(seconds: number): string {
  return new Date(seconds * 1000).toLocaleString(macLocale());
}

/** A conversation's agent, by its name: "Claude Code", "Codex". */
export function agentName(agent: string | undefined): string | undefined {
  switch (agent) {
    case "claude":
      return "Claude Code";
    case "codex":
      return "Codex";
    default:
      return agent;
  }
}

/** A word as a shell reads it back the same: as it is when it's safe, else in single quotes. As the app quotes it. */
export function shellQuoted(word: string): string {
  if (/^[\w@%+=:,./-]+$/.test(word)) return word;
  return `'${word.replace(/'/g, "'\\''")}'`;
}

/**
 * The command that resumes a conversation in the folder it started in, for a shell:
 * `cd /Users/me/bakery && codex resume 019a…`. undefined for anything but a conversation that says how.
 */
export function resumeCommand(hit: Hit): string | undefined {
  const conversation = conversationOf(hit);
  if (!conversation?.cwd || !conversation.resume) return undefined;
  return `cd ${shellQuoted(conversation.cwd)} && ${conversation.resume.map(shellQuoted).join(" ")}`;
}

export function timestamp(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const rest = String(s % 60).padStart(2, "0");
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${rest}` : `${minutes}:${rest}`;
}

/**
 * Where in the file the match is: "Page 3", "1:24", "Line 12", and in a conversation when it was said,
 * "2 Jun at 14:00".
 */
export function locationLabel(hit: Hit): string | undefined {
  if (hit.loc == null) return undefined;
  switch (hit.segment) {
    case "exchange":
      return when(hit.loc);
    case "page":
      return `Page ${hit.loc}`;
    case "sound":
    case "frame":
    case "speech":
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

/** The folder a result is shown in: a conversation's is the one it started in, not its log's. */
export function folderShown(hit: Hit): string {
  const cwd = conversationOf(hit)?.cwd;
  return cwd ? shortPath(cwd) : folderOf(hit.path);
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

export function escapeMarkdown(text: string): string {
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
