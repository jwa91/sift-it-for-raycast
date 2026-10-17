import { Icon, LaunchType, MenuBarExtra, Toast, launchCommand, open, showInFinder, showToast } from "@raycast/api";
import { usePromise } from "@raycast/utils";
import { basename } from "node:path";
import { SIFT_HOME, describeDuration, getStatus, runSift, startDetached } from "./lib/sift";
import { describeIndexer } from "./folders";

/** Sift It in the menu bar: how indexing is going, and a way to pause it. */
export default function Command() {
  const { data: status, isLoading, revalidate } = usePromise(getStatus);
  const indexer = status?.indexer;
  const running = !!indexer && indexer.state !== "stopped";
  const busy = running && (indexer.state === "indexing" || indexer.state === "syncing");
  const title =
    busy && indexer.state === "indexing" && indexer.total > 0 ? `${indexer.done}/${indexer.total}` : undefined;
  // The files that take longest: what an ignore pattern or a lower depth could leave out.
  const heaviest = status?.queued.heaviest.filter((file) => file.seconds >= 60) ?? [];

  return (
    <MenuBarExtra
      icon={{ source: { light: "menubar.png", dark: "menubar@dark.png" } }}
      title={title}
      tooltip="Sift It"
      isLoading={isLoading}
    >
      <MenuBarExtra.Section>
        <MenuBarExtra.Item title={describeIndexer(indexer)} />
        {status && <MenuBarExtra.Item title={`${status.stats.done} files indexed`} />}
        {status && status.queued.files > 0 && (
          <MenuBarExtra.Item
            title={`${status.queued.files} waiting, ${describeDuration(status.queued.seconds)} of reading`}
          />
        )}
        {heaviest.length > 0 && (
          <MenuBarExtra.Submenu title="Taking Longest" icon={Icon.Hourglass}>
            {heaviest.map((file) => (
              <MenuBarExtra.Item
                key={file.path}
                title={basename(file.path)}
                subtitle={describeDuration(file.seconds)}
                tooltip={file.path}
                onAction={() => showInFinder(file.path)}
              />
            ))}
          </MenuBarExtra.Submenu>
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
