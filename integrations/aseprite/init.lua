-- pixel-builder for Aseprite — script entry point.
--
-- Copy BOTH this file and pixel-builder.lua from this folder into your Aseprite
-- scripts folder, then restart Aseprite. You will see a "pixel-builder"
-- submenu under File.
--
-- What it does: bridges the sprite you have open to a running pixel-builder
-- MCP server, so the art is generated from one style kit, re-renderable when the
-- kit changes, and region-editable with AI -- without leaving Aseprite.

local d = debug.getinfo(1, "S").source:sub(2)
local folder = d:match("(.*)[/\\][^/\\]*$") or "."

-- pixel-builder.lua must be required relative to this file, since Aseprite's
-- package.path does not include the scripts folder.
package.path = folder .. "/?.lua;" .. package.path

local ok, pb = pcall(require, "pixel-builder")
if not ok then
  app.alert("pixel-builder: could not load pixel-builder.lua\n\n" .. tostring(pb))
  return
end

if not app.registerCommand then
  app.alert("pixel-builder: this Aseprite build has no registerCommand (needs Aseprite 1.3.10+).")
  return
end

app.registerCommand("Generate asset", function() pb.cmd_generate() end)
app.registerCommand("Re-render with current kit", function() pb.cmd_rerender() end)
app.registerCommand("Edit selection (AI)", function() pb.cmd_sendSelection() end)
app.registerCommand("Apply kit palette", function() pb.cmd_pullPalette() end)
app.registerCommand("Push sprite back to workspace", function() pb.cmd_pushSprite() end)