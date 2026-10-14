import { Icon, LaunchType, MenuBarExtra, Toast, launchCommand, open, showToast } from "@raycast/api";
import { usePromise } from "@raycast/utils";
import { SIFT_HOME, getStatus, runSift, startDetached } from "./lib/sift";
import { describeIndexer } from "./folders";

/** Sift It in the menu bar: how indexing is going, and a way to pause it. */
export default function Command() {
  const { data: status, isLoading, revalidate } = usePromise(getStatus);
  const indexer = status?.indexer;
  const running = !!indexer && indexer.state !== "stopped";
  const busy = running && (indexer.state === "indexing" || indexer.state === "syncing");
  const title =
    busy && indexer.state === "indexing" && indexer.total > 0 ? `${indexer.done}/${indexer.total}` : undefined;

  return (
    <MenuBarExtra
      icon={{ source: { light: "menubar.png", dark: "menubar@dark.png" } }}
      title={title}
      tooltip="Sift It"
      isLoading={isLoading}
    >
      <MenuBarExtra.Section>
        <MenuBarExtra.Item title={describeIndexer(indexer)} />
        {status && (
          <MenuBarExtra.Item
            title={`${status.stats.done} files indexed${status.stats.pending ? `, ${status.stats.pending} waiting` : ""}`}
          />
        )}
        {indexer?.last_error && <MenuBarExtra.Item title={`Last problem: ${indexer.last_error}`} />}
      </MenuBarExtra.Section>
      <MenuBarExtra.Section>
        <MenuBarExtra.Item
          title="Search Files"
          icon={Icon.MagnifyingGlass}
          onAction={() => launchCommand({ name: "search", type: LaunchType.UserInitiated })}
        />
        <MenuBarExtra.Item
          title="Manage Folders…"
          icon={Icon.Folder}
          onAction={() => launchCommand({ name: "folders", type: LaunchType.UserInitiated })}
        />
      </MenuBarExtra.Section>
      <MenuBarExtra.Section>
        {running && indexer.state !== "paused" && (
          <MenuBarExtra.Item
            title="Pause Indexing"
            icon={Icon.Pause}
            onAction={() => signal(indexer.pid, "SIGUSR2", revalidate)}
          />
        )}
        {running && indexer.state === "paused" && (
          <MenuBarExtra.Item
            title="Resume Indexing"
            icon={Icon.Play}
            onAction={() => signal(indexer.pid, "SIGUSR2", revalidate)}
          />
        )}
        <MenuBarExtra.Item
          title="Index Now"
          icon={Icon.ArrowClockwise}
          onAction={() => (running ? signal(indexer.pid, "SIGUSR1", revalidate) : startIndex(revalidate))}
        />
        {!running && (
          <MenuBarExtra.Item
            title="Start Background Indexer"
            icon={Icon.Play}
            onAction={async () => {
              await runSift(["service", "install"]);
              revalidate();
            }}
          />
        )}
        <MenuBarExtra.Item title="Open Log" icon={Icon.Terminal} onAction={() => open(`${SIFT_HOME}/indexer.log`)} />
      </MenuBarExtra.Section>
    </MenuBarExtra>
  );
}

function signal(pid: number, name: NodeJS.Signals, revalidate: () => void) {
  try {
    process.kill(pid, name);
  } catch {
    // it stopped meanwhile
  }
  setTimeout(revalidate, 500);
}

async function startIndex(revalidate: () => void) {
  startDetached(["index"]);
  await showToast({ style: Toast.Style.Success, title: "Indexing in the background" });
  setTimeout(revalidate, 1500);
}
