# Sift It for Raycast

Search the files on your Mac by what's in them, from one search bar in Raycast. Describe what you're looking for, or
type the exact words: a clause on page 3 of a PDF, a dog in a photo, the minute of a podcast where they talk about
sleep, the error in a screenshot, a function in your code. It all comes back in one list, each result with a preview
made for its kind. Everything runs on your Mac, with Google DeepMind's EmbeddingGemma 2.

This extension is a thin front end. The work happens in [sift-it](https://github.com/jwa91/sift-it), a command-line
tool and background indexer.

## Setup

Sift It needs [sift-it](https://github.com/jwa91/sift-it), the command-line tool that does the work (Apple silicon,
macOS 14 or later):

```sh
brew install jwa91/tap/sift-it
```

Then, in Raycast:

1. **Manage Folders** → Model → Download Model (865 MB, once).
2. **Manage Folders** → Add Folders. Each folder shows how many files it has and about how long the first pass takes.
3. **Manage Folders** → Background Indexer → Install. It indexes everything once, then keeps up as files change, from
   login on.
4. **Search Files**: give it a hotkey in Raycast's settings.

## Searching

One search bar for everything:

- **Describe it**: "the clause about pets in the lease", "a dog on the beach", "where they talk about sleep". Matches
  by meaning, across languages too.
- **Type the words**: invoice numbers, error codes, names. Numbers and codes, which no model reads exactly, count
  heavily; ordinary words decide between results that mean about the same.
- **Quote them to insist**: `"INV-2024-0113" invoice` only shows files with that exact text, ranked by the rest.
- **`code:`** searches code (when code reading is on in Manage Folders).

The dropdown can narrow it to documents, pictures, recordings, videos or code, but it starts at everything.

Each result's preview fits its kind:

| Result | Preview | ↩ |
|---|---|---|
| Picture | the picture, with when it was taken and its size | opens it |
| Screenshot | the screenshot and the text read from it | opens it |
| PDF | the page that matched, and its text with your words in bold | opens Preview at that page |
| Document | the passage that matched, your words in bold | opens it |
| Recording | its waveform with the 30 seconds that matched highlighted | plays from that moment (QuickTime) |
| Video | the frame at the moment, also as its icon in the list (and the waveform, when it matched by sound) | plays from that moment |
| Code | the code that matched, numbered from its line | opens your editor at the line |

⌘↩ shows it in Finder, ⌘Y Quick Look, ⌘C copies the file, ⇧⌘C the path, ⇧⌘T the text on it, ⌘D hides the preview.

## Commands

| Command | |
|---|---|
| Search Files | The one search, described above. |
| Manage Folders | Folders to search and skip, the model, the background indexer, options. |
| Indexing Status | The menu bar: what's being indexed, pause and resume. |

## How it talks to sift-it

Search Files starts `sift-it serve` while it's open: it keeps the index's vectors in memory and the query encoder
loaded, and answers JSON requests on stdin (search, recent files, previews: a picture, a PDF page, a video frame, a
waveform, a passage's text). Manage Folders and the menu bar run `sift-it` commands (`status --json`, `folders`,
`estimate --json`, `model download --json`, `service install`) and read the background indexer's `status.json`. The
extension finds sift-it in `/opt/homebrew/bin`, or wherever its preference points.

## Development

```sh
npm install
npm run dev         # Raycast picks up changes as you save
npm run lint
npm run build
swift scripts/make-icons.swift   # redraws assets/
```
