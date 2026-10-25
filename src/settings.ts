import { Clipboard } from "@raycast/api";
import { showFailureToast } from "@raycast/utils";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const INSTALL = "brew install jwa91/tap/sift-it";

/** Opens the Sift It app's settings: the folders to search, the models, indexing. */
export async function openSettings() {
  try {
    // `open` fails when no app handles the URL, which means the app isn't installed.
    await promisify(execFile)("/usr/bin/open", ["sift-it://settings"]);
  } catch {
    await showFailureToast(`Install it with ${INSTALL}`, {
      title: "Sift It isn't installed",
      primaryAction: { title: "Copy Install Command", onAction: () => Clipboard.copy(INSTALL) },
    });
  }
}

export default async function Command() {
  await openSettings();
}
