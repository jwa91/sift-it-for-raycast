import {
  Action,
  ActionPanel,
  Color,
  Icon,
  Keyboard,
  List,
  getPreferenceValues,
  openExtensionPreferences,
} from "@raycast/api";
import { useEffect, useMemo, useState } from "react";
import { Engine, useEngine } from "./lib/engine";
import { FILTERS, KIND_ICONS, KIND_LABELS, bytes, folderOf, highlight, locationLabel, timestamp } from "./lib/format";
import { openHit, openTitle } from "./lib/open";
import type { Hit, SearchResponse } from "./lib/sift";
import Folders from "./folders";

/** Picture formats Raycast shows as they are; the rest get a JPEG preview from the engine. */
const SHOWN_AS_IS = /\.(jpe?g|png|gif|webp)$/i;

export default function Command() {
  const { engine, ready, meaning, error, missing } = useEngine();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [response, setResponse] = useState<SearchResponse>();
  const [loading, setLoading] = useState(true);
  const [showingDetail, setShowingDetail] = useState(getPreferenceValues<Preferences>().showDetail ?? true);
  const [selected, setSelected] = useState<string | null>(null);
  const previews = usePreviews(engine, response?.hits ?? [], selected, showingDetail);

  useEffect(() => {
    if (!engine || !ready) return;
    let current = true;
    setLoading(true);
    const kinds = FILTERS.find((f) => f.id === filter)?.kinds ?? [];
    engine
      .request<SearchResponse>("search", { q: query, kinds, limit: 50, prefix_last: true })
      .then((result) => current && setResponse(result))
      .catch(() => current && setResponse(undefined))
      .finally(() => current && setLoading(false));
    return () => {
      current = false;
    };
    // `meaning` turning true re-runs the search with the model.
  }, [engine, ready, meaning, query, filter]);

  const hits = response?.hits ?? [];
  const strong = hits.filter((hit) => hit.strong);
  const weak = hits.filter((hit) => !hit.strong);
  const searching = query.trim().length > 0;

  if (missing) {
    return (
      <List>
        <List.EmptyView
          icon={Icon.Warning}
          title="The Sift engine isn't installed"
          description="Run scripts/install.sh in the Sift repository, or set the engine's path in preferences."
          actions={
            <ActionPanel>
              <Action title="Open Extension Preferences" icon={Icon.Gear} onAction={openExtensionPreferences} />
            </ActionPanel>
          }
        />
      </List>
    );
  }

  const status = !searching
    ? "Recently changed"
    : meaning
      ? `${hits.length} ${hits.length === 1 ? "match" : "matches"}`
      : "Exact words only while the model loads…";

  return (
    <List
      isLoading={loading || !ready}
      filtering={false}
      throttle
      onSearchTextChange={setQuery}
      searchBarPlaceholder="Describe what you're looking for…"
      isShowingDetail={showingDetail && hits.length > 0}
      onSelectionChange={setSelected}
      searchBarAccessory={
        <List.Dropdown tooltip="Kind of file" value={filter} onChange={setFilter} storeValue>
          {FILTERS.map((f) => (
            <List.Dropdown.Item key={f.id} value={f.id} title={f.title} icon={f.icon} />
          ))}
        </List.Dropdown>
      }
    >
      {error && !ready ? (
        <List.EmptyView icon={Icon.Warning} title="The engine stopped" description={error} />
      ) : (
        <List.EmptyView
          icon={searching ? Icon.MagnifyingGlass : Icon.Folder}
          title={searching ? "Nothing stands out" : "Nothing indexed yet"}
          description={
            searching
              ? "No file matches that closely. Try other words, or describe it differently."
              : "Add folders to search in Manage Folders."
          }
          actions={
            <ActionPanel>
              <Action.Push title="Manage Folders" icon={Icon.Folder} target={<Folders />} />
            </ActionPanel>
          }
        />
      )}
      <List.Section title={searching ? "Best Matches" : "Recent"} subtitle={status}>
        {strong.map((hit) => (
          <Result
            key={hit.path}
            hit={hit}
            query={query}
            preview={previews[previewKey(hit)]}
            showingDetail={showingDetail}
            onToggleDetail={() => setShowingDetail((v) => !v)}
          />
        ))}
      </List.Section>
      <List.Section title="Weaker Matches">
        {weak.map((hit) => (
          <Result
            key={hit.path}
            hit={hit}
            query={query}
            preview={previews[previewKey(hit)]}
            showingDetail={showingDetail}
            onToggleDetail={() => setShowingDetail((v) => !v)}
          />
        ))}
      </List.Section>
    </List>
  );
}

function previewKey(hit: Hit): string {
  return `${hit.path}|${hit.loc ?? ""}`;
}

function needsPreview(hit: Hit): boolean {
  if (hit.kind === "pdf" || hit.kind === "video") return true;
  return (hit.kind === "image" || hit.kind === "screenshot") && !SHOWN_AS_IS.test(hit.path);
}

/** Preview images for the selected result (and the first few), rendered by the engine once each. */
function usePreviews(engine: Engine | undefined, hits: Hit[], selected: string | null, showing: boolean) {
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const wanted = useMemo(() => {
    const chosen = hits.filter((hit) => hit.path === selected || hits.indexOf(hit) < 3);
    return chosen.filter(needsPreview);
  }, [hits, selected]);
  useEffect(() => {
    if (!engine || !showing) return;
    for (const hit of wanted) {
      const key = previewKey(hit);
      if (key in previews) continue;
      setPreviews((current) => ({ ...current, [key]: "" }));
      engine
        .request<{ image: string }>("preview", { path: hit.path, kind: hit.kind, loc: hit.loc ?? undefined, size: 720 })
        .then(({ image }) => setPreviews((current) => ({ ...current, [key]: image })))
        .catch(() => undefined);
    }
  }, [engine, wanted, showing]);
  return previews;
}

function Result(props: {
  hit: Hit;
  query: string;
  preview?: string;
  showingDetail: boolean;
  onToggleDetail: () => void;
}) {
  const { hit, query, preview, showingDetail, onToggleDetail } = props;
  const where = locationLabel(hit);
  const open = openTitle(hit);
  const accessories: List.Item.Accessory[] = showingDetail
    ? [{ icon: KIND_ICONS[hit.kind], tooltip: KIND_LABELS[hit.kind] }]
    : [
        ...(hit.words ? [{ tag: { value: "words", color: Color.Green }, tooltip: "Has all of your words" }] : []),
        { text: KIND_LABELS[hit.kind] },
        { date: new Date(hit.modified * 1000), tooltip: "Modified" },
      ];
  return (
    <List.Item
      id={hit.path}
      title={hit.name}
      subtitle={showingDetail ? where : [where, folderOf(hit.path)].filter(Boolean).join("  ·  ")}
      icon={{ fileIcon: hit.path }}
      accessories={accessories}
      quickLook={{ path: hit.path, name: hit.name }}
      detail={<ResultDetail hit={hit} query={query} preview={preview} />}
      actions={
        <ActionPanel>
          <ActionPanel.Section>
            <Action title={open.title} icon={open.icon} onAction={() => openHit(hit)} />
            <Action.ShowInFinder path={hit.path} />
            <Action.ToggleQuickLook shortcut={Keyboard.Shortcut.Common.ToggleQuickLook} />
            <Action.OpenWith path={hit.path} shortcut={Keyboard.Shortcut.Common.OpenWith} />
          </ActionPanel.Section>
          <ActionPanel.Section>
            <Action.CopyToClipboard
              title="Copy File"
              content={{ file: hit.path }}
              shortcut={Keyboard.Shortcut.Common.Copy}
            />
            <Action.CopyToClipboard title="Copy Path" content={hit.path} shortcut={Keyboard.Shortcut.Common.CopyPath} />
            <Action
              title={showingDetail ? "Hide Details" : "Show Details"}
              icon={Icon.Sidebar}
              shortcut={{ modifiers: ["cmd"], key: "d" }}
              onAction={onToggleDetail}
            />
          </ActionPanel.Section>
          <ActionPanel.Section>
            <Action.Push
              title="Manage Folders"
              icon={Icon.Folder}
              target={<Folders />}
              shortcut={{ modifiers: ["cmd", "shift"], key: "m" }}
            />
          </ActionPanel.Section>
        </ActionPanel>
      }
    />
  );
}

function ResultDetail({ hit, query, preview }: { hit: Hit; query: string; preview?: string }) {
  const image = preview || (needsPreview(hit) ? undefined : hit.path);
  const parts: string[] = [];
  if (image) parts.push(`![](${encodeURI(`file://${image}`)}?raycast-height=260)`);
  if (hit.excerpt) parts.push(highlight(hit.excerpt, query));
  else if (hit.kind === "audio" && hit.loc != null) parts.push(`*Matched the sound at ${timestamp(hit.loc)}*`);
  const info = hit.info ?? {};
  const where = locationLabel(hit);
  return (
    <List.Item.Detail
      markdown={parts.join("\n\n")}
      metadata={
        <List.Item.Detail.Metadata>
          <List.Item.Detail.Metadata.Label title="Kind" text={KIND_LABELS[hit.kind]} icon={KIND_ICONS[hit.kind]} />
          {where && <List.Item.Detail.Metadata.Label title="Match" text={where} />}
          <List.Item.Detail.Metadata.TagList title="Matched by">
            {hit.z != null && hit.z >= 2 && (
              <List.Item.Detail.Metadata.TagList.Item text="meaning" color={Color.Blue} />
            )}
            {hit.words && <List.Item.Detail.Metadata.TagList.Item text="exact words" color={Color.Green} />}
          </List.Item.Detail.Metadata.TagList>
          {typeof info.pages === "number" && (
            <List.Item.Detail.Metadata.Label title="Pages" text={String(info.pages)} />
          )}
          {typeof info.duration === "number" && (
            <List.Item.Detail.Metadata.Label title="Length" text={timestamp(info.duration)} />
          )}
          {typeof info.width === "number" && typeof info.height === "number" && (
            <List.Item.Detail.Metadata.Label title="Size" text={`${info.width} × ${info.height}`} />
          )}
          <List.Item.Detail.Metadata.Separator />
          <List.Item.Detail.Metadata.Label title="Folder" text={folderOf(hit.path)} />
          <List.Item.Detail.Metadata.Label title="Modified" text={new Date(hit.modified * 1000).toLocaleString()} />
          <List.Item.Detail.Metadata.Label title="File Size" text={bytes(hit.size)} />
        </List.Item.Detail.Metadata>
      }
    />
  );
}
