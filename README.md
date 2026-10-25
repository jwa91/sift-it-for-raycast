# Sift It for Raycast

Search the files on your Mac by what's in them, from one search bar in Raycast. Describe what you're looking for, or
type the exact words: a clause on page 3 of a PDF, a dog in a photo, the minute of a podcast where they talk about
sleep, the error in a screenshot, a function in your code. It all comes back in one list, each result with a preview
made for its kind. Everything runs on your Mac, with Google DeepMind's EmbeddingGemma 2.

This extension is a thin front end. The work happens in [sift-it](https://github.com/jwa91/sift-it), the engine and
background indexer; the folders, the models and indexing are set in the
[Sift It app](https://github.com/jwa91/sift-it-mac).

## Setup

Apple silicon, macOS 14 or later. One install brings the app and the `sift-it` command:

```sh
brew install jwa91/tap/sift-it
```

Open Sift It from Applications. Its welcome window downloads the models, asks which folders to search, and starts
indexing. Then, in Raycast, give **Search Files** a hotkey.

## Searching

One search bar for everything:

- **Describe it**: "the clause about pets in the lease", "a dog on the beach", "where they talk about sleep". Matches
  by meaning, across languages too.
- **Type the words**: invoice numbers, error codes, names. Numbers and codes, which no model reads exactly, count
  heavily; ordinary words decide between results that mean about the same.
- **Quote them to insist**: `"INV-2024-0113" invoice` only shows files with that exact text, ranked by the rest.
- **`code:`** searches code, once it's turned on in Sift It's Settings → Folders → Kinds of files (the Code
  checkbox).

The dropdown can narrow it to documents, pictures, audio, videos, code or conversations, but it starts at everything.

Conversations are your sessions with Claude Code and Codex, found by what you and the agent said. They come from the
logs in `~/.claude/projects` and `~/.codex/sessions`: add those folders in Sift It's settings, which offer both.

Each result's preview fits its kind:

| Result | Preview | ↩ |
|---|---|---|
| Picture | the picture, with when it was taken and its size | opens it |
| Screenshot | the screenshot and the text read from it | opens it |
| PDF | the page that matched, and its text with your words in bold | opens Preview at that page |
| Document | the passage that matched, your words in bold | opens it |
| Audio | its waveform with the 30 seconds that matched highlighted | plays from that moment (QuickTime) |
| Video | the frame at the moment, also as its icon in the list (and the waveform, when it matched by sound) | plays from that moment |
| Code | the code that matched, numbered from its line | opens your editor at the line |
| Conversation | the exchange that matched, with the agent (Claude Code or Codex) and when it was said | resumes it in your terminal, in the folder it started in |

⌘↩ shows it in Finder, ⌘Y Quick Look, ⌘C copies the file (a conversation's resume command), ⇧⌘C the path, ⇧⌘T the
text on it, ⌘D hides the preview. A conversation whose folder is gone can't be resumed in it; Raycast says so and
offers the command to copy.

## Commands

| Command | |
|---|---|
| Search Files | The one search, described above. |
| Open Settings | The Sift It app's settings: the folders to search, the models, indexing. |

## How it talks to sift-it

Search Files starts `sift-it serve` while it's open: it keeps the index's vectors in memory and the query encoder
loaded, and answers JSON requests on stdin (search, recent files, previews: a picture, a PDF page, a video frame, a
waveform, a passage's text). It finds sift-it in `/opt/homebrew/bin`, or wherever its preference points. Open
Settings opens `sift-it://settings`, which the app handles.

Resuming a conversation works as in the app: a small `.command` file with the command, written to
`~/Library/Caches/sift-it/resume` and opened, so the terminal for those (Terminal, or the one you chose) runs it in a
login shell, where `claude` and `codex` are found.

## Development

```sh
npm install
npm run dev         # Raycast picks up changes as you save
npm run lint
npm run build
swift scripts/make-icons.swift   # redraws assets/icon.png
```
