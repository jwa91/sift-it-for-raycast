import { Icon, getPreferenceValues, open, showHUD } from "@raycast/api";
import { runAppleScript } from "@raycast/utils";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import type { Hit } from "./sift";
import { locationLabel, timestamp } from "./format";

/** AppleScript string literal. */
function quoted(text: string): string {
  return `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** What the primary action says for this result. */
export function openTitle(hit: Hit): { title: string; icon: Icon } {
  const at = hit.loc != null ? locationLabel(hit) : undefined;
  if ((hit.kind === "video" || hit.kind === "audio") && hit.loc != null) {
    return { title: `Play from ${timestamp(hit.loc)}`, icon: Icon.Play };
  }
  if (hit.kind === "pdf" && at) return { title: `Open at ${at}`, icon: Icon.Document };
  if ((hit.kind === "code" || hit.kind === "text") && at?.startsWith("Line"))
    return { title: `Open at ${at}`, icon: Icon.Code };
  return { title: "Open", icon: Icon.ArrowNe };
}

/** Opens a result where it matched: a recording or video at its moment, a PDF at its page, code at its line. */
export async function openHit(hit: Hit): Promise<void> {
  if ((hit.kind === "video" || hit.kind === "audio") && hit.loc != null) {
    return playAt(hit.path, hit.loc);
  }
  if (hit.kind === "pdf" && hit.loc != null && hit.loc > 1) {
    return openPdfAt(hit.path, hit.loc);
  }
  const lines = (hit.kind === "code" || hit.kind === "text") && !hit.path.endsWith(".ipynb");
  if (lines && hit.loc != null && (await openInEditor(hit.path, hit.loc))) {
    return;
  }
  await open(hit.path);
}

/** QuickTime Player, at the moment (asks once for permission to control QuickTime). */
async function playAt(path: string, seconds: number): Promise<void> {
  const start = Math.max(0, seconds);
  try {
    await runAppleScript(`
      tell application "QuickTime Player"
        activate
        set theDocument to open POSIX file ${quoted(path)}
        delay 0.3
        set current time of theDocument to ${start}
        play theDocument
      end tell`);
  } catch {
    await open(path);
    await showHUD(`Opened; the match is at ${timestamp(start)}`);
  }
}

/** Preview, then its Go to Page (⌥⌘G). Needs Raycast to be allowed to control the computer (Accessibility). */
async function openPdfAt(path: string, page: number): Promise<void> {
  try {
    await runAppleScript(`
      tell application "Preview"
        activate
        open POSIX file ${quoted(path)}
      end tell
      delay 0.6
      tell application "System Events" to tell process "Preview"
        keystroke "g" using {option down, command down}
        delay 0.3
        keystroke "${Math.round(page)}"
        key code 36
      end tell`);
  } catch {
    await open(path, "com.apple.Preview");
    await showHUD(`Opened; the match is on page ${page}`);
  }
}

const EDITORS: Record<string, { app: string; cli: string[]; args: (path: string, line: number) => string[] }> = {
  vscode: {
    app: "/Applications/Visual Studio Code.app",
    cli: [
      "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code",
      "/opt/homebrew/bin/code",
      "/usr/local/bin/code",
    ],
    args: (path, line) => ["-g", `${path}:${line}`],
  },
  cursor: {
    app: "/Applications/Cursor.app",
    cli: [
      "/Applications/Cursor.app/Contents/Resources/app/bin/cursor",
      "/opt/homebrew/bin/cursor",
      "/usr/local/bin/cursor",
    ],
    args: (path, line) => ["-g", `${path}:${line}`],
  },
  zed: {
    app: "/Applications/Zed.app",
    cli: ["/Applications/Zed.app/Contents/MacOS/cli", "/opt/homebrew/bin/zed", "/usr/local/bin/zed"],
    args: (path, line) => [`${path}:${line}`],
  },
  sublime: {
    app: "/Applications/Sublime Text.app",
    cli: ["/Applications/Sublime Text.app/Contents/SharedSupport/bin/subl", "/opt/homebrew/bin/subl"],
    args: (path, line) => [`${path}:${line}`],
  },
};

/** Opens a file at a line in the editor chosen in preferences; false when there's none. */
async function openInEditor(path: string, line: number): Promise<boolean> {
  const { editor } = getPreferenceValues<Preferences>();
  const choice = EDITORS[editor ?? ""];
  if (!choice) return false;
  const cli = choice.cli.find((candidate) => existsSync(candidate));
  if (!cli) return false;
  return new Promise((resolve) => {
    execFile(cli, choice.args(path, Math.max(1, Math.round(line))), (error) => resolve(!error));
  });
}
