# Sift

Search the files on your Mac by what's in them, from Raycast. Describe what you're looking for and Sift finds it,
whatever kind of file it is: a clause on page 3 of a PDF, a dog in a photo, the minute of a podcast where they talk about
sleep, the error in a screenshot, a function in your code. Everything runs on your Mac, with Google DeepMind's
[EmbeddingGemma 2](https://huggingface.co/google/embeddinggemma-2), a model that puts text, pictures and sound in one
shared space.

Sift is a Rust engine (`engine/`) and a Raycast extension (`extension/`). It was inspired by
[DigUp](https://github.com/ARahim3/DigUp), and built from scratch.

## Setup

You need an Apple Silicon Mac with macOS 14 or later, Xcode's command line tools, Rust, CMake (`brew install cmake`),
Node 22+ and Raycast.

```sh
scripts/build-llama.sh          # llama.cpp at a pinned release, static, with Metal (a minute or two)
scripts/install.sh --link       # builds the engine → ~/Library/Application Support/Sift/bin/sift (+ ~/.local/bin/sift)
sift model download             # the model, 865 MB, once (or from Raycast: Manage Folders → Model)
sift selftest                   # checks this build makes the reference vectors

cd extension && npm install && npm run dev    # adds the extension to Raycast
```

Then, in Raycast:

1. **Manage Folders** → Add Folders: pick the folders to search.
2. **Manage Folders** → Background Indexer → Install. It indexes everything once, then keeps up as files change (a new
   file is searchable a second or two after it lands). It starts at login.
3. **Search Files**: describe what you're looking for. Give it a hotkey in Raycast's settings.

macOS asks before a program reads Documents, Desktop or Downloads. The background indexer is the `sift` binary
itself, so allow it there, or give it Full Disk Access in System Settings → Privacy & Security. A rebuilt binary has a
new signature, and macOS may ask again.

## Using it

| Command | |
|---|---|
| Search Files | Results as you type: exact words at once, meaning a moment later. ↩ opens a result where it matched: a recording or video at its moment (QuickTime), a PDF at its page (Preview), text and code at the line (in the editor chosen in preferences). ⌘↩ shows it in Finder, ⌘Y Quick Look, ⌘C copies the file, ⌘D the details pane. The dropdown narrows to documents, pictures, recordings, videos or code. |
| Search Pictures | The same search in a grid of photos, screenshots and video moments. |
| Manage Folders | Folders to search and skip, the model, the background indexer, options. |
| Sift Status | The menu bar: what's being indexed, pause and resume. |

Start a search with `code:` to search code instead, by what it does or by name (`code: retry with backoff`,
`code: refreshAccessToken`). Code is only read with **Read Source Code** on, and never shows up in other searches.

## What it reads

Only the folders you choose, and only reads them: it never changes, moves or uploads a file.

- **Documents**: txt, md, rtf, doc, docx, odt, html (macOS's `textutil`), in passages of about 1,200 characters.
  Text that's mostly numbers is matched by its exact words only.
- **PDFs**: page by page (PDFKit). Scanned pages are read by Apple's text recognition (Vision); a scanned page with
  no text is embedded as a picture.
- **Pictures**: every format macOS can open, HEIC and RAW included (ImageIO), at 140 tokens.
- **Screenshots**: as pictures (280 tokens), and the text on them is read too, so both what they show and what they
  say can be found.
- **Recordings**: any length, in 30-second windows that overlap by 10 seconds; a match points to its moment. Silence
  is skipped.
- **Videos**: one frame per shot (and every 30 seconds within a long one), plus the sound like a recording.
- **Code** (optional): source files and notebooks, in stretches of about 600 characters, titled with their path in
  the project.

It skips hidden folders, `~/Library`, app bundles and packages, dependency and build folders, keys and other secrets,
and iCloud files that are only in the cloud (reading those would download them). Inside a code project (a folder with
`.git`, `package.json` and the like) it reads only pictures, PDFs and recordings, unless code reading is on.

## How it works

```
your folders ─► readers (textutil, PDFKit, ImageIO, Vision, AVFoundation — through objc2)
             ─► EmbeddingGemma 2 (Q8_0) on llama.cpp with Metal: text directly, pictures and sound through
                the model's own encoders (mtmd), each input one 768-dimensional vector
             ─► one SQLite file: files, segments with their vectors, and an FTS5 index of their words
your words   ─► the same model's text part ─► every vector scored (one Accelerate matrix-vector product)
                + the FTS5 index for exact words ─► one result per file, at its best page, moment or line
```

**Ranking.** A segment's cosine similarity with the query ranks it. Whether it's shown depends on its *lift*, how far
it stands above the median segment for this query: queries differ in how close they land to everything, and the lift
takes that out. A strong match lifts at least 0.13, a weaker one 0.09, and below that nothing is shown, so a search
with no answer says so. A segment that has all of the query's words gets a bonus, because no vector holds an invoice
number exactly. Between segments of one file that score about the same, words choose where it opens.

**Indexing.** Readers run on a few worker threads and stream their pieces to the one thread that owns the model.
Each worker has its own small channel and the model thread takes from them in turn, so a long video can't hold up a
short note. A file is written in one transaction once all of it is in, and only if it hasn't changed meanwhile. The
background indexer (`sift daemon`) watches the folders with FSEvents, handles changed paths a moment after they go
quiet, and lets the model go after a minute with nothing to do. It can wait for a charger, and always waits in Low Power
Mode.

**Correctness.** `sift selftest` embeds fixed texts, a screenshot, a photo and a speech clip, and checks the vectors
against reference vectors from a known-good pipeline (cosine ≥ 0.999; texts, the screenshot and the speech match to
1.0000). The index records which pipeline made its vectors. A different model or llama.cpp release re-embeds
everything, and until it has, search uses exact words only, never mixing vectors from two pipelines.

## Measured

On an M5 with 24 GB:

| | |
|---|---|
| Text | about 10,000 tokens/s (50 passages of prose a second) |
| A photo / a screenshot | 140 ms / 360 ms (plus OCR, in parallel) |
| 30 s of sound | 250 ms: an hour-long recording in about 50 s |
| 514 mixed files (300 photos, 100 ten-page PDFs, 30 screenshots, notes, 20 min of recordings and video) | 3 minutes |
| A search over 200,000 vectors | 9 ms (after 0.8 s to load them when the command opens) |
| A new file, searchable | 2 s after it lands, even while a long video is being indexed |

On the testbed (`scripts/make-testbed.sh`, 39 files of every kind, with names that give nothing away), all 43 queries
in `scripts/evals.json` put the right file first, and all 9 that check the place land on the right page, moment, line
or cell. That includes queries in another language than the file, a moment in a podcast, a shot in a video, and text
in screenshots and scans.

## The engine's CLI

```
sift folders [add|remove|exclude|include] <folder>...   the folders to index
sift config [include-code|index-on-battery|exclude-ext] <value>
sift index [--reindex]          bring the index up to date, then exit (asks the daemon when it runs)
sift daemon                     keep it up to date in the background
sift service install|uninstall|status|plist   the daemon as a LaunchAgent
sift search <words> [--kind pdf,image] [-n 10] [--json]
sift serve                      JSON lines on stdin/stdout, for the extension (see engine/src/serve.rs)
sift status [--json]
sift model status|download
sift read <file> [--tokens]     what Sift reads from a file
sift selftest                   the reference vectors
sift eval scripts/evals.json    search quality on the testbed
```

Its files live in `~/Library/Application Support/Sift` (or `$SIFT_HOME`): `config.json`, `index.sqlite`,
`status.json`, `indexer.log`, `models/` and `previews/`. To remove Sift, run `sift service uninstall`, delete that
folder, and remove the extension in Raycast.

## Development

```sh
scripts/make-testbed.sh                         # testbed/: documents, pictures, screenshots, a scan, recordings, a video, code
export SIFT_HOME=/tmp/sift-test                 # a separate index for testing
sift folders add testbed && sift config include-code true && sift index
sift eval scripts/evals.json -v                 # per query: rank, lift, cosine
cd engine && cargo test --release
cd extension && npm run lint && npm run build
```

Before publishing the extension, set `author` in `extension/package.json` to your Raycast username.

## Credits

[EmbeddingGemma 2](https://huggingface.co/google/embeddinggemma-2) by Google DeepMind (Apache 2.0), in
[ggml-org's GGUF conversion](https://huggingface.co/ggml-org/embeddinggemma-2-GGUF);
[llama.cpp](https://github.com/ggml-org/llama.cpp) (MIT). The reference vectors in `engine/tests/reference` and the idea
come from [DigUp](https://github.com/ARahim3/DigUp) (MIT). Gemma is a trademark of Google LLC.
