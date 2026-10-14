import {
  Action,
  ActionPanel,
  Color,
  Icon,
  Image,
  Keyboard,
  List,
  getPreferenceValues,
  openExtensionPreferences,
} from "@raycast/api";
import { useEffect, useState } from "react";
import { useEngine } from "./lib/engine";
import { FILTERS, KIND_ICONS, KIND_LABELS, bytes, folderOf, locationLabel, timestamp } from "./lib/format";
import { detailMarkdown } from "./lib/markdown";
import { openHit, openTitle } from "./lib/open";
import { Preview, SHOWN_AS_IS, previewKey, usePreviews } from "./lib/preview";
import type { Hit, SearchResponse } from "./lib/sift";
import Folders from "./folders";

/**
 * One search for every kind of file. Describe what you're looking for or type exact words (in quotes to insist on
 * them); the list holds documents, PDF pages, pictures, screenshots, and moments in recordings and videos together, and
 * each result's preview is made for its kind.
 */
export default function Command() {
  const { engine, ready, meaning, error, missing } = useEngine();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [response, setResponse] = useState<SearchResponse>();
  const [loading, setLoading] = useState(true);
  const [showingDetail, setShowingDetail] = useState(getPreferenceValues<Preferences>().showDetail ?? true);
  const [selected, setSelected] = useState<string | null>(null);
  const hits = response?.hits ?? [];
  const previews = usePreviews(showingDetail ? engine : undefined, hits, selected);

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

  if (missing) {
    return (
      <List>
        <List.EmptyView
          icon={Icon.Warning}
          title="sift-it isn't installed"
          description="Install it with Homebrew: brew install jwa91/tap/sift-it. Or set its path in preferences."
          actions={
            <ActionPanel>
              <Action.CopyToClipboard title="Copy Install Command" content="brew install jwa91/tap/sift-it" />
              <Action title="Open Extension Preferences" icon={Icon.Gear} onAction={openExtensionPreferences} />
            </ActionPanel>
          }
        />
      </List>
    );
  }

  const searching = query.trim().length > 0;
  const strong = hits.filter((hit) => hit.strong);
  const weak = hits.filter((hit) => !hit.strong);
  const status = !searching
    ? "Recently changed"
    : meaning
      ? `${hits.length} ${hits.length === 1 ? "match" : "matches"}`
      : "Exact words only, while the model loads…";
  const toggleDetail = () => setShowingDetail((value) => !value);
  const result = (hit: Hit) => (
    <Result
      key={hit.path}
      hit={hit}
      query={query}
      preview={previews[previewKey(hit)]}
      showingDetail={showingDetail}
      onToggleDetail={toggleDetail}
    />
  );

  return (
    <List
      isLoading={loading || !ready}
      filtering={false}
      throttle
      onSearchTextChange={setQuery}
      searchBarPlaceholder={'Describe it, or type exact words ("in quotes" to insist)…'}
      isShowingDetail={showingDetail && hits.length > 0}
      onSelectionChange={setSelected}
      searchBarAccessory={
        <List.Dropdown tooltip="Kind of file" value={filter} onChange={setFilter}>
          {FILTERS.map((f) => (
            <List.Dropdown.Item key={f.id} value={f.id} title={f.title} icon={f.icon} />
          ))}
        </List.Dropdown>
      }
    >
      {error && !ready ? (
        <List.EmptyView icon={Icon.Warning} title="sift-it stopped" description={error} />
      ) : (
        <List.EmptyView
          icon={searching ? Icon.MagnifyingGlass : Icon.Folder}
          title={searching ? "Nothing stands out" : "Nothing indexed yet"}
          description={
            searching
              ? "No file matches that closely. Describe it differently, or check the words in quotes."
              : "Choose the folders to search in Manage Folders."
          }
          actions={
            <ActionPanel>
              <Action.Push title="Manage Folders" icon={Icon.Folder} target={<Folders />} />
            </ActionPanel>
          }
        />
      )}
      <List.Section title={searching ? "Best Matches" : "Recent"} subtitle={status}>
        {strong.map(result)}
      </List.Section>
      <List.Section title="Weaker Matches">{weak.map(result)}</List.Section>
    </List>
  );
}

/** The list icon: a picture result shows itself (once its preview is there), the rest their file's icon. */
function iconFor(hit: Hit, preview?: Preview): Image.ImageLike {
  const visual = hit.kind === "image" || hit.kind === "screenshot" || hit.kind === "video";
  if (visual && preview?.image) return { source: preview.image, mask: Image.Mask.RoundedRectangle };
  if ((hit.kind === "image" || hit.kind === "screenshot") && SHOWN_AS_IS.test(hit.path)) {
    return { source: hit.path, mask: Image.Mask.RoundedRectangle };
  }
  return { fileIcon: hit.path };
}

/** Where the match is, short, for the list: "p. 3", "1:24", "line 12". */
function shortLocation(hit: Hit): string | undefined {
  const label = locationLabel(hit);
  if (!label) return undefined;
  return label
    .replace(/^Page /, "p. ")
    .replace(/^Line /, "line ")
    .replace(/^Cell /, "cell ");
}

function Result(props: {
  hit: Hit;
  query: string;
  preview?: Preview;
  showingDetail: boolean;
  onToggleDetail: () => void;
}) {
  const { hit, query, preview, showingDetail, onToggleDetail } = props;
  const open = openTitle(hit);
  const where = shortLocation(hit);
  const accessories: List.Item.Accessory[] = showingDetail
    ? where
      ? [{ tag: where, tooltip: "Where it matched" }]
      : []
    : [
        ...(where ? [{ tag: where, tooltip: "Where it matched" }] : []),
        ...(hit.words
          ? [{ icon: { source: Icon.Text, tintColor: Color.Green }, tooltip: "Has your exact words" }]
          : []),
        { text: KIND_LABELS[hit.kind], icon: KIND_ICONS[hit.kind] },
        { date: new Date(hit.modified * 1000), tooltip: "Modified" },
      ];
  return (
    <List.Item
      id={hit.path}
      title={hit.name}
      subtitle={showingDetail ? undefined : folderOf(hit.path)}
      icon={iconFor(hit, preview)}
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
            {preview?.text && (
              <Action.CopyToClipboard
                title={hit.kind === "screenshot" ? "Copy Text on It" : "Copy Matching Text"}
                content={preview.text}
                shortcut={{ modifiers: ["cmd", "shift"], key: "t" }}
              />
            )}
            <Action
              title={showingDetail ? "Hide Preview" : "Show Preview"}
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

function ResultDetail({ hit, query, preview }: { hit: Hit; query: string; preview?: Preview }) {
  const info = hit.info ?? {};
  const where = locationLabel(hit);
  const span =
    (hit.segment === "sound" || hit.segment === "frame") && hit.loc != null
      ? hit.loc_end != null
        ? `${timestamp(hit.loc)}–${timestamp(hit.loc_end)}`
        : timestamp(hit.loc)
      : where;
  const length = typeof info.duration === "number" ? timestamp(info.duration) : undefined;
  return (
    <List.Item.Detail
      isLoading={!preview}
      markdown={detailMarkdown(hit, preview, query)}
      metadata={
        <List.Item.Detail.Metadata>
          <List.Item.Detail.Metadata.Label title="Kind" text={KIND_LABELS[hit.kind]} icon={KIND_ICONS[hit.kind]} />
          {span && <List.Item.Detail.Metadata.Label title="Match" text={span} />}
          {(hit.meaning || hit.words) && (
            <List.Item.Detail.Metadata.TagList title="Matched by">
              {hit.meaning && <List.Item.Detail.Metadata.TagList.Item text="meaning" color={Color.Blue} />}
              {hit.words && <List.Item.Detail.Metadata.TagList.Item text="exact words" color={Color.Green} />}
            </List.Item.Detail.Metadata.TagList>
          )}
          {typeof info.pages === "number" && (
            <List.Item.Detail.Metadata.Label title="Pages" text={String(info.pages)} />
          )}
          {length && <List.Item.Detail.Metadata.Label title="Length" text={length} />}
          {typeof info.width === "number" && typeof info.height === "number" && (
            <List.Item.Detail.Metadata.Label title="Dimensions" text={`${info.width} × ${info.height}`} />
          )}
          {typeof info.taken === "string" && (
            <List.Item.Detail.Metadata.Label
              title="Taken"
              text={info.taken.replace(/^(\d{4}):(\d{2}):(\d{2})/, "$1-$2-$3")}
            />
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
