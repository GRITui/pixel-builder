# pixel-builder for Aseprite

Two independent things live here:

1. **`.aseprite` export** — pixel-builder writes native Aseprite files
   (indexed 8-bit pixels, one layer per rig part, animation tags). Available
   from the CLI, the MCP `export_asset` tool and the web export menu. You do
   not need this folder to use it.
2. **The Lua extension in this folder** — bridges the sprite you have open in
   Aseprite to a running pixel-builder MCP server.

## Install the extension

Start the server, then copy the two Lua files into your Aseprite scripts
folder and restart Aseprite.

```bash
# 1. Start the MCP server (it must be the SAME machine as Aseprite).
npx pixel-builder mcp --http --workspace ~/pixel-assets

# 2. Install the extension.
mkdir -p ~/Library/Application\ Support/Aseprite/scripts
cp integrations/aseprite/init.lua ~/Library/Application\ Support/Aseprite/scripts/
cp integrations/aseprite/pixel-builder.lua ~/Library/Application\ Support/Aseprite/scripts/

# 3. Restart Aseprite. The commands land under File ▸ pixel-builder.
```

Aseprite 1.3.10+ is required (`app.registerCommand`).

If the server is not on the default port, edit `config.url` at the top of
`pixel-builder.lua`.

## What each command does

| Command | What it does |
| --- | --- |
| **Generate asset** | Asks pixel-builder for a rigged character (or a named generator) and opens it as a new sprite, palette already applied. |
| **Apply kit palette** | Loads the workspace kit's palette into the current sprite, indexed exactly as pixel-builder indexes it. |
| **Re-render with current kit** | Re-renders the workspace's exports with the current kit colours. |
| **Edit selection (AI)** | Sends your selection to `edit_region` as an AI inpaint of that region. |
| **Push sprite back to workspace** | Imports the current layer's pixels as a new asset in the workspace. |

## Palette indices are the contract

pixel-builder colours are a fixed 91-entry palette: index `0` is transparent
and indices `1..90` follow a fixed ASCII alphabet. The extension uses that
same order, so:

- **Generate asset** and **Apply kit palette** give you a sprite whose pixel
  indices mean the same colours they do in pixel-builder.
- **Push sprite back** encodes pixels with that alphabet, so a round trip is
  lossless.
- Editing by hand is fine, but *re-ordering or padding the palette* breaks the
  link. Keep entry `i` as the colour **Apply kit palette** gave it.

## Requirements and limits

- The extension speaks plain JSON-RPC over HTTP, so the server must be
  reachable over plain `http://` on localhost. It does not do TLS.
- **Edit selection (AI)** needs pixel-builder's own API key path, so it works
  exactly where the MCP `edit_region` tool works. Re-run the export (or
  re-import the PNG it reports) to see the change in Aseprite.
- **Push sprite back** pushes a single layer. A multi-layer sprite pushes only
  the active layer.
- The `.aseprite` **exporter** and the Lua **extension** are separate. The
  exporter needs nothing installed; only the extension does.

## Tests

`pixel-builder-json.test.lua` covers the JSON codec and the palette-legend
parser — the two places this could silently be wrong. It runs under stock Lua
and reads captured MCP responses, so it needs no Aseprite and no server:

```bash
lua integrations/aseprite/pixel-builder-json.test.lua
```