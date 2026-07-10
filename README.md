# Geoguessr Note

Notes for identifying GeoGuessr regions by their *metas* (recurring visual clues).

📖 **Read the guide:** <https://dingyiyi0226.github.io/geoguessr-note/>

## Contribute

All documentation files live under `content/docs`. You can

1. Edit directly on GitHub, or
2. Edit locally and preview your changes (see [Local Development](#local-development) below).

## Local Development

This site is built with [Hugo](https://gohugo.io/) using the [hugo-book](https://github.com/alex-shpak/hugo-book) theme (included as a git submodule).

### Prerequisites

- **Hugo (Extended edition)** — the Extended edition is required because the site processes SCSS.
  - Windows: `winget install Hugo.Hugo.Extended`
  - macOS: `brew install hugo`
  - Others: see the [Hugo install guide](https://gohugo.io/installation/)
- **Git** (to clone the repo and fetch the theme submodule)

### Setup

1. Clone the repository **with the theme submodule**:

   ```sh
   git clone --recurse-submodules https://github.com/dingyiyi0226/geoguessr-note.git
   ```

   If you already cloned without submodules, fetch the theme afterwards:

   ```sh
   git submodule update --init --recursive
   ```

2. Start the local dev server:

   ```sh
   hugo server --minify
   ```

   Then open <http://localhost:1313/> in your browser. Edits under `content/docs` are reloaded automatically.

> **Note:** If `hugo` is "not recognized" right after installing it, your terminal still holds the old `PATH`;
> restart your terminal (or IDE, e.g. VS Code) and try again.
