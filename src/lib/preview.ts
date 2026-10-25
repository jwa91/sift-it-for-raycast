import { useEffect, useRef, useState } from "react";
import type { Engine } from "./engine";
import { type Hit, isPdf } from "./sift";

/** What a result's preview shows: a picture (the photo, the PDF page, the video frame), a waveform, its text. */
export interface Preview {
  image?: string;
  waveform?: string;
  text?: string;
}

/** Picture formats Raycast shows from the file itself; the rest (HEIC, RAW, TIFF…) get a JPEG from the engine. */
export const SHOWN_AS_IS = /\.(jpe?g|png|gif|webp)$/i;

export function previewKey(hit: Hit): string {
  return `${hit.path}|${hit.segment_id}`;
}

/** Fetches what a result's preview needs, by kind. Parts that fail are left out. */
async function load(engine: Engine, hit: Hit): Promise<Preview> {
  const preview: Preview = {};
  const render = (params: Record<string, unknown>) =>
    engine.request<{ image: string }>("preview", { path: hit.path, ...params }).then(({ image }) => image);
  const text = (params: Record<string, unknown>) =>
    engine.request<{ text: string | null }>("text", params).then(({ text }) => text ?? undefined);
  const parts: Promise<unknown>[] = [];

  switch (isPdf(hit) ? "pdf" : hit.kind) {
    case "image":
    case "screenshot":
      if (SHOWN_AS_IS.test(hit.path)) preview.image = hit.path;
      else parts.push(render({ kind: "image", size: 1024 }).then((image) => (preview.image = image)));
      // A screenshot's text: the passage that matched, or all that was read from it.
      if (hit.kind === "screenshot") {
        const params = hit.segment === "ocr" ? { segment_id: hit.segment_id } : { path: hit.path };
        parts.push(text(params).then((t) => (preview.text = t)));
      }
      break;
    case "pdf":
      parts.push(render({ kind: "pdf", loc: hit.loc ?? 1, size: 1024 }).then((image) => (preview.image = image)));
      parts.push(text({ segment_id: hit.segment_id }).then((t) => (preview.text = t)));
      break;
    case "video":
      parts.push(render({ kind: "video", loc: hit.loc ?? 0, size: 1024 }).then((image) => (preview.image = image)));
      if (hit.segment === "sound" || hit.segment === "speech") {
        parts.push(waveform(render, hit).then((image) => (preview.waveform = image)));
      }
      break;
    case "audio":
      parts.push(waveform(render, hit).then((image) => (preview.waveform = image)));
      break;
    default:
      parts.push(text({ segment_id: hit.segment_id }).then((t) => (preview.text = t)));
  }
  await Promise.allSettled(parts);
  return preview;
}

function waveform(render: (params: Record<string, unknown>) => Promise<string>, hit: Hit): Promise<string> {
  const start = hit.loc ?? 0;
  return render({ kind: "waveform", loc: start, loc_end: hit.loc_end ?? start + 30, size: 900 });
}

/**
 * Small pictures for the list, by previewKey: a video's frame at the moment it matched, and pictures Raycast can't show
 * from the file itself (HEIC, RAW…). Each is fetched once.
 */
export function useThumbnails(engine: Engine | undefined, hits: Hit[]): Record<string, string> {
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({});
  const requested = useRef(new Set<string>());
  useEffect(() => {
    if (!engine) return;
    for (const hit of hits) {
      const picture = (hit.kind === "image" || hit.kind === "screenshot") && !SHOWN_AS_IS.test(hit.path);
      if (hit.kind !== "video" && !picture) continue;
      const key = previewKey(hit);
      if (requested.current.has(key)) continue;
      requested.current.add(key);
      const params = hit.kind === "video" ? { kind: "video", loc: hit.loc ?? 0 } : { kind: "image" };
      engine
        .request<{ image: string }>("preview", { path: hit.path, ...params, size: 256 })
        .then(({ image }) => setThumbnails((current) => ({ ...current, [key]: image })))
        .catch(() => undefined);
    }
  }, [engine, hits]);
  return thumbnails;
}

/**
 * Previews for the selected result and the first few (so moving down the list finds them ready), each fetched once.
 * Returns them by previewKey.
 */
export function usePreviews(engine: Engine | undefined, hits: Hit[], selected: string | null): Record<string, Preview> {
  const [previews, setPreviews] = useState<Record<string, Preview>>({});
  const requested = useRef(new Set<string>());
  useEffect(() => {
    if (!engine) return;
    const wanted = hits.filter((hit, index) => index < 3 || hit.path === selected);
    for (const hit of wanted) {
      const key = previewKey(hit);
      if (requested.current.has(key)) continue;
      requested.current.add(key);
      load(engine, hit).then((preview) => setPreviews((current) => ({ ...current, [key]: preview })));
    }
  }, [engine, hits, selected]);
  return previews;
}
