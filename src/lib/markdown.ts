import { extname } from "node:path";
import { agentName, escapeMarkdown, highlight, timestamp, when, wordsOf } from "./format";
import type { Preview } from "./preview";
import { type Hit, conversationOf, isPdf } from "./sift";

/** A local picture in the detail pane, `height` points tall. */
function picture(path: string, height: number): string {
  return `![](${encodeURI(`file://${path}`)}?raycast-height=${height})`;
}

/** Up to `length` characters of the text, around the first of the query's words in it. */
export function textWindow(text: string, query: string, length = 1400): string {
  const clean = text.trim();
  if (clean.length <= length) return clean;
  const lower = clean.toLowerCase();
  const positions = wordsOf(query)
    .map((word) => lower.indexOf(word))
    .filter((position) => position >= 0);
  const first = positions.length ? Math.min(...positions) : 0;
  const start = Math.max(0, Math.min(first - length / 4, clean.length - length));
  const end = Math.min(clean.length, start + length);
  return `${start > 0 ? "…" : ""}${clean.slice(start, end).trim()}${end < clean.length ? "…" : ""}`;
}

/** Code fence languages by extension, where the extension itself isn't the name. */
const LANGUAGES: Record<string, string> = {
  ts: "typescript",
  tsx: "tsx",
  js: "javascript",
  jsx: "jsx",
  mjs: "javascript",
  py: "python",
  rs: "rust",
  rb: "ruby",
  kt: "kotlin",
  sh: "bash",
  zsh: "bash",
  md: "markdown",
  ipynb: "python",
  h: "c",
  hpp: "cpp",
  cc: "cpp",
  mm: "objectivec",
  m: "objectivec",
  cs: "csharp",
};

/**
 * The code that matched, numbered, from a little above its first line with the query's words, as `sift-it` shows it in
 * the terminal. The result's line is that line (search moves it there); a notebook's is its cell, so it isn't numbered.
 */
function numberedCode(text: string, hit: Hit, query: string): string {
  const lines = text.replace(/\s+$/, "").split("\n");
  const telling = wordsOf(query).filter((word) => word.length > 3 || /\d/.test(word));
  const focus = Math.max(
    0,
    lines.findIndex((line) => telling.some((word) => line.toLowerCase().includes(word))),
  );
  const start = Math.max(0, focus - 2);
  const shown = lines.slice(start, start + 60);
  if (hit.loc == null || hit.path.endsWith(".ipynb")) return shown.join("\n");
  const first = Math.round(hit.loc) - focus + start;
  const width = String(first + shown.length).length;
  return shown.map((line, i) => `${String(first + i).padStart(width)} │ ${line}`).join("\n");
}

function codeBlock(text: string, path: string): string {
  const extension = extname(path).slice(1).toLowerCase();
  const language = LANGUAGES[extension] ?? extension;
  const fence = text.includes("```") ? "~~~" : "```";
  return `${fence}${language}\n${text.replace(/\s+$/, "")}\n${fence}`;
}

/**
 * A conversation's exchange, its lines kept: who speaks in bold where the speaker changes (User, Claude, Codex), each
 * turn its own paragraph, the query's words in bold.
 */
function exchange(text: string, query: string): string {
  const turns: string[][] = [[]];
  for (const line of text.split("\n")) {
    const speaker = /^(User|Claude|Codex):\s*/.exec(line);
    if (speaker || !line.trim()) turns.push([]);
    if (!speaker && !line.trim()) continue;
    // A line of dashes or equals signs would make the one above it a heading.
    const words = highlight(speaker ? line.slice(speaker[0].length) : line, query).replace(/^([-=])/, "\\$1");
    turns[turns.length - 1].push(speaker ? `**${speaker[1]}:** ${words}` : words);
  }
  return turns
    .filter((turn) => turn.length > 0)
    .map((turn) => turn.join("  \n"))
    .join("\n\n");
}

/** What a sound's match was: what's said (speech, written down) or what's heard. */
function heard(hit: Hit): string {
  return hit.segment === "speech" ? "Said" : "Heard";
}

function span(hit: Hit): string {
  if (hit.loc == null) return "";
  return hit.loc_end != null ? `${timestamp(hit.loc)}–${timestamp(hit.loc_end)}` : timestamp(hit.loc);
}

/** The detail pane for a result: what fits its kind, with the query's words in bold where there's text. */
export function detailMarkdown(hit: Hit, preview: Preview | undefined, query: string): string {
  const parts: string[] = [];
  const text = preview?.text ?? hit.excerpt ?? undefined;
  const words = (body: string) => highlight(textWindow(body, query), query);
  switch (isPdf(hit) ? "pdf" : hit.kind) {
    case "image":
      if (preview?.image) parts.push(picture(preview.image, 320));
      if (hit.excerpt) parts.push(words(hit.excerpt));
      break;
    case "screenshot":
      if (preview?.image) parts.push(picture(preview.image, 260));
      if (text) parts.push(`**Text on it**\n\n${words(text)}`);
      break;
    case "pdf":
      if (preview?.image) parts.push(picture(preview.image, 300));
      if (text) parts.push(words(text));
      break;
    case "video":
      if (preview?.image) parts.push(picture(preview.image, 240));
      if (hit.segment === "sound" || hit.segment === "speech") {
        if (preview?.waveform) parts.push(picture(preview.waveform, 70));
        parts.push(`**${heard(hit)} at ${span(hit)}**`);
      } else if (hit.loc != null) {
        parts.push(`**Seen at ${timestamp(hit.loc)}**`);
      }
      break;
    case "audio":
      if (preview?.waveform) parts.push(picture(preview.waveform, 80));
      parts.push(
        `**${heard(hit)} at ${span(hit)}**${typeof hit.info?.duration === "number" ? ` of ${timestamp(hit.info.duration)}` : ""}`,
      );
      break;
    case "code":
      if (text) parts.push(codeBlock(numberedCode(text, hit, query), hit.path));
      break;
    case "conversation": {
      // Who it was with and when it was said: "Codex · 2 Jun at 14:00".
      const said = [agentName(conversationOf(hit)?.agent), hit.loc != null ? when(hit.loc) : undefined];
      const heading = said.filter((part) => part).join(" · ");
      if (heading) parts.push(`**${escapeMarkdown(heading)}**`);
      if (text) parts.push(exchange(textWindow(text, query, 4000), query));
      break;
    }
    default:
      if (text) parts.push(words(text));
  }
  return parts.join("\n\n");
}
