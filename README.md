# Sift for Raycast

Search the files on your Mac by what's in them, from Raycast. Describe what you're looking for: a clause on page 3 of
a PDF, a dog in a photo, the minute of a podcast where they talk about sleep, the error in a screenshot, a function in
your code. It runs on your Mac, with Google DeepMind's EmbeddingGemma 2.

This extension is a thin front end. The work happens in [sift](https://github.com/jwa91/sift), a command-line tool
and background indexer.

## Setup

```sh
brew install jwa91/tap/sift
npm install && npm run dev        # adds the extension to Raycast
```

Then, in Raycast:

1. **Manage Folders** → Model → Download Model (865 MB, once).
2. **Manage Folders** → Add Folders. Each folder shows how many files it has and about how long the first pass takes.
3. **Manage Folders** → Background Indexer → Install. It indexes everything once, then keeps up as files change, from
   login on.
4. **Search Files**: give it a hotkey in Raycast's settings.

## Commands

| Command | |
|---|---|
| Search Files | Results as you type: exact words at once, meaning a moment later. ↩ opens a result where it matched: a recording or video at its moment (QuickTime), a PDF at its page (Preview), text and code at the line (in the editor chosen in preferences). ⌘↩ shows it in Finder, ⌘Y Quick Look, ⌘C copies the file, ⌘D the details pane. The dropdown narrows to documents, pictures, recordings, videos or code; `code:` searches code. |
| Search Pictures | The same search in a grid of photos, screenshots and video moments. |
| Manage Folders | Folders to search and skip, the model, the background indexer, options. |
| Sift Status | The menu bar: what's being indexed, pause and resume. |

## How it talks to sift

Search Files and Search Pictures start `sift serve` while they're open: it keeps the index's vectors in memory and the
query encoder loaded, and answers JSON requests on stdin (search, recent files, preview images). Manage Folders and
the menu bar run `sift` commands (`status --json`, `folders`, `estimate --json`, `model download --json`,
`service install`) and read the background indexer's `status.json`. The extension finds sift in `/opt/homebrew/bin`,
or wherever its preference points.

## Development

```sh
npm run dev         # Raycast picks up changes as you save
npm run lint
npm run build
swift scripts/make-icons.swift   # redraws assets/
```

Before publishing to the Raycast Store, set `author` in `package.json` to your Raycast username.
