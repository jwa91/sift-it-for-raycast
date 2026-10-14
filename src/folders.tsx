import {
  Action,
  ActionPanel,
  Alert,
  Color,
  Form,
  Icon,
  Keyboard,
  List,
  Toast,
  confirmAlert,
  showToast,
  useNavigation,
} from "@raycast/api";
import { showFailureToast, useCachedPromise, usePromise } from "@raycast/utils";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { bytes, shortPath } from "./lib/format";
import {
  IndexerStatus,
  Status,
  describeDuration,
  estimate,
  getStatus,
  runSift,
  siftBinary,
  startDetached,
} from "./lib/sift";

export default function Folders() {
  const { data: status, isLoading, revalidate, error } = usePromise(getStatus);

  if (error) {
    return (
      <List>
        <List.EmptyView icon={Icon.Warning} title="Can't reach the Sift engine" description={error.message} />
      </List>
    );
  }

  const config = status?.config;
  const { data: estimates } = useCachedPromise(estimate, [config?.folders ?? []], { execute: !!config });
  const estimateOf = (folder: string) => estimates?.find((e) => e.folder === folder);
  return (
    <List isLoading={isLoading} navigationTitle="Manage Folders" searchBarPlaceholder="Filter folders">
      <List.Section title="Folders to Search" subtitle={config ? `${config.folders.length}` : undefined}>
        {config?.folders.map((folder) => (
          <List.Item
            key={folder}
            title={shortPath(folder)}
            subtitle={describeFolder(estimateOf(folder))}
            icon={{ fileIcon: folder }}
            accessories={excludedUnder(folder, config.excluded)}
            actions={
              <ActionPanel>
                <Action.Push
                  title="Add Folders"
                  icon={Icon.Plus}
                  target={<AddFolders onDone={revalidate} />}
                  shortcut={Keyboard.Shortcut.Common.New}
                />
                <Action.Push
                  title="Skip a Folder Inside"
                  icon={Icon.EyeDisabled}
                  target={<AddFolders exclude onDone={revalidate} />}
                />
                <Action.ShowInFinder path={folder} />
                <Action
                  title="Stop Searching This Folder"
                  icon={Icon.Trash}
                  style={Action.Style.Destructive}
                  shortcut={Keyboard.Shortcut.Common.Remove}
                  onAction={() => removeFolder(folder, revalidate)}
                />
              </ActionPanel>
            }
          />
        ))}
        <List.Item
          title="Add Folders…"
          icon={{ source: Icon.Plus, tintColor: Color.Blue }}
          actions={
            <ActionPanel>
              <Action.Push title="Add Folders" icon={Icon.Plus} target={<AddFolders onDone={revalidate} />} />
            </ActionPanel>
          }
        />
      </List.Section>

      {config && config.excluded.length > 0 && (
        <List.Section title="Skipped Folders">
          {config.excluded.map((folder) => (
            <List.Item
              key={folder}
              title={shortPath(folder)}
              icon={{ source: Icon.EyeDisabled, tintColor: Color.SecondaryText }}
              actions={
                <ActionPanel>
                  <Action
                    title="Search This Folder Again"
                    icon={Icon.Eye}
                    onAction={() => run(["folders", "include", folder], "Folder searched again", revalidate)}
                  />
                </ActionPanel>
              }
            />
          ))}
        </List.Section>
      )}

      {status && <IndexSection status={status} revalidate={revalidate} />}

      {config && (
        <List.Section title="Options">
          <Toggle
            title="Read Source Code"
            subtitle="Index code files too, also inside code projects"
            value={config.include_code}
            onChange={(value) => run(["config", "include-code", String(value)], "Saved", revalidate)}
          />
          <Toggle
            title="Index on Battery"
            subtitle="Otherwise the first pass waits for a charger"
            value={config.index_on_battery}
            onChange={(value) => run(["config", "index-on-battery", String(value)], "Saved", revalidate)}
          />
        </List.Section>
      )}
    </List>
  );
}

function describeFolder(e?: { files: number; seconds: number; unreadable: boolean }): string | undefined {
  if (!e) return undefined;
  if (e.unreadable) return "Can't be read: is it there, and may Sift read it?";
  return `${e.files.toLocaleString()} files · ${describeDuration(e.seconds)} to index from scratch`;
}

function excludedUnder(folder: string, excluded: string[]): List.Item.Accessory[] {
  const count = excluded.filter((path) => path.startsWith(folder + "/")).length;
  return count > 0 ? [{ text: `${count} skipped`, icon: Icon.EyeDisabled }] : [];
}

function Toggle(props: { title: string; subtitle: string; value: boolean; onChange: (value: boolean) => void }) {
  return (
    <List.Item
      title={props.title}
      subtitle={props.subtitle}
      icon={props.value ? { source: Icon.CheckCircle, tintColor: Color.Green } : Icon.Circle}
      accessories={[{ text: props.value ? "On" : "Off" }]}
      actions={
        <ActionPanel>
          {props.value ? (
            <Action title="Disable" icon={Icon.Switch} onAction={() => props.onChange(false)} />
          ) : (
            <Action title="Enable" icon={Icon.Switch} onAction={() => props.onChange(true)} />
          )}
        </ActionPanel>
      }
    />
  );
}

function IndexSection({ status, revalidate }: { status: Status; revalidate: () => void }) {
  const { stats, models, indexer } = status;
  const modelReady = models.text && models.media;
  const kinds = Object.entries(stats.by_kind)
    .sort((a, b) => b[1] - a[1])
    .map(([kind, count]) => `${count} ${kind}`)
    .join(", ");
  return (
    <List.Section title="Index">
      <List.Item
        title="Model"
        subtitle={modelReady ? "EmbeddingGemma 2, on this Mac" : `${bytes(models.bytes)} to download, once`}
        icon={
          modelReady
            ? { source: Icon.CheckCircle, tintColor: Color.Green }
            : { source: Icon.Download, tintColor: Color.Orange }
        }
        accessories={[{ text: modelReady ? "Ready" : models.text ? "Text only" : "Not downloaded" }]}
        actions={
          <ActionPanel>
            {!modelReady && (
              <Action title="Download Model" icon={Icon.Download} onAction={() => downloadModel(revalidate)} />
            )}
            <Action.ShowInFinder title="Show Model Files" path={models.folder} />
          </ActionPanel>
        }
      />
      <List.Item
        title="Files"
        subtitle={kinds || "Nothing indexed yet"}
        icon={Icon.Document}
        accessories={[
          ...(stats.pending > 0 ? [{ tag: { value: `${stats.pending} waiting`, color: Color.Orange } }] : []),
          ...(stats.failed > 0 ? [{ tag: { value: `${stats.failed} unreadable`, color: Color.Red } }] : []),
          { text: `${stats.done} indexed` },
        ]}
        actions={
          <ActionPanel>
            <Action title="Index Now" icon={Icon.ArrowClockwise} onAction={() => indexNow(indexer, revalidate)} />
            <Action
              title="Refresh"
              icon={Icon.RotateClockwise}
              shortcut={Keyboard.Shortcut.Common.Refresh}
              onAction={revalidate}
            />
          </ActionPanel>
        }
      />
      <List.Item
        title="Background Indexer"
        subtitle={describeIndexer(indexer)}
        icon={
          indexer && indexer.state !== "stopped"
            ? { source: Icon.CircleProgress, tintColor: Color.Green }
            : { source: Icon.Circle, tintColor: Color.SecondaryText }
        }
        accessories={[{ text: indexer && indexer.state !== "stopped" ? "Running" : "Not running" }]}
        actions={
          <ActionPanel>
            <Action
              title="Install Background Indexer"
              icon={Icon.Play}
              onAction={() => run(["service", "install"], "Background indexer started", revalidate)}
            />
            <Action
              title="Remove Background Indexer"
              icon={Icon.Stop}
              style={Action.Style.Destructive}
              onAction={() => run(["service", "uninstall"], "Background indexer removed", revalidate)}
            />
            <Action
              title="Refresh"
              icon={Icon.RotateClockwise}
              shortcut={Keyboard.Shortcut.Common.Refresh}
              onAction={revalidate}
            />
          </ActionPanel>
        }
      />
    </List.Section>
  );
}

export function describeIndexer(indexer?: IndexerStatus | null): string {
  if (!indexer || indexer.state === "stopped") return "Indexes new and changed files as they appear";
  switch (indexer.state) {
    case "indexing":
      return `Indexing ${indexer.done} of ${indexer.total}${indexer.current ? `: ${indexer.current.split("/").pop()}` : ""}`;
    case "syncing":
      return "Looking for new and changed files…";
    case "paused":
      return indexer.detail ?? "Paused";
    case "waiting":
      return indexer.detail ?? "Waiting";
    default:
      return "Up to date, watching for changes";
  }
}

async function indexNow(indexer: IndexerStatus | null | undefined, revalidate: () => void) {
  try {
    if (indexer && indexer.state !== "stopped") {
      process.kill(indexer.pid, "SIGUSR1");
      await showToast({ style: Toast.Style.Success, title: "Looking for changes" });
    } else {
      startDetached(["index"]);
      await showToast({ style: Toast.Style.Success, title: "Indexing in the background" });
    }
    setTimeout(revalidate, 1500);
  } catch (error) {
    await showFailureToast(error, { title: "Couldn't start indexing" });
  }
}

async function run(args: string[], success: string, revalidate: () => void) {
  try {
    await runSift(args);
    await showToast({ style: Toast.Style.Success, title: success });
    revalidate();
  } catch (error) {
    await showFailureToast(error, { title: "That didn't work" });
  }
}

async function removeFolder(folder: string, revalidate: () => void) {
  const confirmed = await confirmAlert({
    title: `Stop searching ${shortPath(folder)}?`,
    message: "What was indexed from it leaves the index. The files themselves aren't touched.",
    primaryAction: { title: "Stop Searching", style: Alert.ActionStyle.Destructive },
  });
  if (confirmed) await run(["folders", "remove", folder], "Folder removed", revalidate);
}

function downloadModel(revalidate: () => void) {
  const binary = siftBinary();
  if (!binary) return;
  const toast = showToast({ style: Toast.Style.Animated, title: "Downloading the model…" });
  const child = spawn(binary, ["model", "download", "--json"], { stdio: ["ignore", "pipe", "pipe"] });
  let stderr = "";
  child.stderr.on("data", (data: Buffer) => (stderr += data.toString()));
  createInterface({ input: child.stdout }).on("line", async (line) => {
    try {
      const event = JSON.parse(line) as { event: string; file: string; done?: number; total?: number };
      const t = await toast;
      if (event.event === "downloading" && event.total) {
        t.message = `${event.file.includes("mmproj") ? "Image and audio encoders" : "Text model"}: ${Math.round(
          ((event.done ?? 0) / event.total) * 100,
        )}%`;
      } else if (event.event === "verifying") {
        t.message = "Checking…";
      }
    } catch {
      // not a progress line
    }
  });
  child.on("exit", async (code) => {
    const t = await toast;
    if (code === 0) {
      t.style = Toast.Style.Success;
      t.title = "Model ready";
      t.message = undefined;
    } else {
      t.style = Toast.Style.Failure;
      t.title = "Download failed";
      t.message = stderr.trim().split("\n").pop();
    }
    revalidate();
  });
}

function AddFolders(props: { onDone: () => void; exclude?: boolean }) {
  const { pop } = useNavigation();
  return (
    <Form
      navigationTitle={props.exclude ? "Skip a Folder" : "Add Folders"}
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title={props.exclude ? "Skip Folders" : "Add Folders"}
            icon={props.exclude ? Icon.EyeDisabled : Icon.Plus}
            onSubmit={async (values: { folders: string[] }) => {
              if (!values.folders?.length) return;
              await run(
                ["folders", props.exclude ? "exclude" : "add", ...values.folders],
                props.exclude ? "Skipped" : "Added",
                props.onDone,
              );
              pop();
              if (!props.exclude) {
                const toast = await showToast({ style: Toast.Style.Animated, title: "Counting the files…" });
                try {
                  const estimates = await estimate(values.folders);
                  const files = estimates.reduce((sum, e) => sum + e.files, 0);
                  const seconds = estimates.reduce((sum, e) => sum + e.seconds, 0);
                  toast.style = Toast.Style.Success;
                  toast.title = `${files.toLocaleString()} files to index`;
                  toast.message = `${describeDuration(seconds)} for the first pass`;
                } catch {
                  await toast.hide();
                }
              }
            }}
          />
        </ActionPanel>
      }
    >
      <Form.Description
        text={
          props.exclude
            ? "Folders inside a searched folder to leave out."
            : "Sift reads the documents, PDFs, pictures, recordings and videos in these folders. It never changes, moves or uploads them."
        }
      />
      <Form.FilePicker
        id="folders"
        title="Folders"
        allowMultipleSelection
        canChooseDirectories
        canChooseFiles={false}
      />
    </Form>
  );
}
