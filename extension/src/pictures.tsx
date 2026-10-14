import { Action, ActionPanel, Grid, Icon, Keyboard, openExtensionPreferences } from "@raycast/api";
import { useEffect, useState } from "react";
import { Engine, useEngine } from "./lib/engine";
import { locationLabel, timestamp } from "./lib/format";
import { openHit, openTitle } from "./lib/open";
import type { Hit, Kind, SearchResponse } from "./lib/sift";

const FILTERS: { id: string; title: string; kinds: Kind[] }[] = [
  { id: "all", title: "Pictures and Videos", kinds: ["image", "screenshot", "video"] },
  { id: "photos", title: "Pictures", kinds: ["image"] },
  { id: "screenshots", title: "Screenshots", kinds: ["screenshot"] },
  { id: "videos", title: "Video Moments", kinds: ["video"] },
];

/** Formats a grid cell can show from the file itself. */
const SHOWN_AS_IS = /\.(jpe?g|png|gif|webp|heic|heif|tiff?)$/i;

export default function Command() {
  const { engine, ready, meaning, missing } = useEngine();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [hits, setHits] = useState<Hit[]>([]);
  const [loading, setLoading] = useState(true);
  const thumbnails = useThumbnails(engine, hits);

  useEffect(() => {
    if (!engine || !ready) return;
    let current = true;
    setLoading(true);
    const kinds = FILTERS.find((f) => f.id === filter)?.kinds ?? [];
    engine
      .request<SearchResponse>("search", { q: query, kinds, limit: 60, prefix_last: true })
      .then((response) => current && setHits(response.hits))
      .catch(() => current && setHits([]))
      .finally(() => current && setLoading(false));
    return () => {
      current = false;
    };
  }, [engine, ready, meaning, query, filter]);

  if (missing) {
    return (
      <Grid>
        <Grid.EmptyView
          icon={Icon.Warning}
          title="The Sift engine isn't installed"
          description="Run scripts/install.sh in the Sift repository, or set the engine's path in preferences."
          actions={
            <ActionPanel>
              <Action title="Open Extension Preferences" icon={Icon.Gear} onAction={openExtensionPreferences} />
            </ActionPanel>
          }
        />
      </Grid>
    );
  }

  return (
    <Grid
      columns={5}
      aspectRatio="4/3"
      fit={Grid.Fit.Fill}
      isLoading={loading || !ready}
      filtering={false}
      throttle
      onSearchTextChange={setQuery}
      searchBarPlaceholder="Describe the picture…"
      searchBarAccessory={
        <Grid.Dropdown tooltip="Kind" value={filter} onChange={setFilter} storeValue>
          {FILTERS.map((f) => (
            <Grid.Dropdown.Item key={f.id} value={f.id} title={f.title} />
          ))}
        </Grid.Dropdown>
      }
    >
      <Grid.EmptyView icon={Icon.Image} title={query ? "Nothing stands out" : "No pictures indexed yet"} />
      {hits.map((hit) => {
        const thumbnail =
          thumbnails[key(hit)] || (SHOWN_AS_IS.test(hit.path) && hit.kind !== "video" ? hit.path : undefined);
        const open = openTitle(hit);
        return (
          <Grid.Item
            key={key(hit)}
            content={thumbnail ? { source: thumbnail } : { fileIcon: hit.path }}
            title={hit.name}
            subtitle={hit.kind === "video" && hit.loc != null ? timestamp(hit.loc) : locationLabel(hit)}
            quickLook={{ path: hit.path, name: hit.name }}
            actions={
              <ActionPanel>
                <Action title={open.title} icon={open.icon} onAction={() => openHit(hit)} />
                <Action.ShowInFinder path={hit.path} />
                <Action.ToggleQuickLook shortcut={Keyboard.Shortcut.Common.ToggleQuickLook} />
                <Action.CopyToClipboard
                  title="Copy File"
                  content={{ file: hit.path }}
                  shortcut={Keyboard.Shortcut.Common.Copy}
                />
                <Action.CopyToClipboard
                  title="Copy Path"
                  content={hit.path}
                  shortcut={Keyboard.Shortcut.Common.CopyPath}
                />
              </ActionPanel>
            }
          />
        );
      })}
    </Grid>
  );
}

function key(hit: Hit): string {
  return `${hit.path}|${hit.loc ?? ""}`;
}

/** Thumbnails the engine renders: video frames at their moment, and pictures in formats a cell can't show. */
function useThumbnails(engine: Engine | undefined, hits: Hit[]) {
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!engine) return;
    for (const hit of hits) {
      const k = key(hit);
      if (k in thumbnails || (SHOWN_AS_IS.test(hit.path) && hit.kind !== "video")) continue;
      setThumbnails((current) => ({ ...current, [k]: "" }));
      engine
        .request<{ image: string }>("preview", { path: hit.path, kind: hit.kind, loc: hit.loc ?? undefined, size: 400 })
        .then(({ image }) => setThumbnails((current) => ({ ...current, [k]: image })))
        .catch(() => undefined);
    }
  }, [engine, hits]);
  return thumbnails;
}
