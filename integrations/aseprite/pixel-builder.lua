-- Pixel Builder for Aseprite (>= 1.2.10).
--
-- Transport: Aseprite's Lua has no HTTP client (only WebSocket), so this extension drives
-- the pixel-builder CLI (`pixel-builder <command> --json`) through io.popen. The MCP
-- server (`pixel-builder mcp --http`) is NOT needed; both use the same tool layer and the
-- same workspace, so an agent can run the MCP server on that workspace at the same time.
--
-- Commands (File > Scripts):
--   Pixel Builder: Generate...            generator + params JSON -> generate_asset -> open the .aseprite
--   Pixel Builder: Re-render with current kit   rerender_assets for the open file's asset, then reload it
--   Pixel Builder: Pull kit palette       set the sprite palette from get_style_guide
--   Pixel Builder: Send selection to edit_region   stub until the edit_region tool (#18) is merged

local IS_WIN = package.config:sub(1, 1) == "\\"

local function prefs(plugin)
  local p = plugin.preferences
  p.cli = p.cli or "pixel-builder"
  p.workspace = p.workspace or ""
  p.generator = p.generator or "environment"
  p.params = p.params or "{}"
  p.name = p.name or ""
  return p
end

local function q(s) -- shell-quote one argument
  if IS_WIN then return '"' .. s:gsub('"', '\\"') .. '"' end
  return "'" .. s:gsub("'", "'\\''") .. "'"
end

local function jstr(s) -- JSON string literal
  return '"' .. s:gsub('[%c"\\]', function(c)
    local m = { ['"'] = '\\"', ["\\"] = "\\\\", ["\n"] = "\\n", ["\r"] = "\\r", ["\t"] = "\\t" }
    return m[c] or string.format("\\u%04x", c:byte())
  end) .. '"'
end

local function unjson(s) return (s:gsub("\\\\", "\\"):gsub("\\/", "/")) end

-- Run `<cli> [--workspace W] --json <args>` and return stdout (or nil, message).
local function run(p, args)
  local cmd = p.cli .. (p.workspace ~= "" and (" --workspace " .. q(p.workspace)) or "") .. " --json " .. args
  if IS_WIN then cmd = '"' .. cmd .. '"' end
  local h = io.popen(cmd .. " 2>&1", "r")
  if not h then return nil, "Could not start: " .. p.cli end
  local out = h:read("*a")
  h:close()
  if not out:find('"ok"%s*:%s*true') then
    local err = out:match('"error"%s*:%s*"(.-)"%s*[,}]') or out
    return nil, err:sub(1, 400)
  end
  return out
end

local function inputFile(json)
  local path = os.tmpname()
  local f = assert(io.open(path, "wb"))
  f:write(json)
  f:close()
  return path
end

local function fail(msg) app.alert { title = "Pixel Builder", text = msg } end

local function openFile(path)
  local s = app.open(path)
  if s then app.activeSprite = s end
  return s
end

-- Ask for CLI / workspace (shared by all commands).
local function connectionFields(dlg, p)
  dlg:entry { id = "cli", label = "CLI command", text = p.cli }
  dlg:file { id = "workspace", label = "Workspace", filename = p.workspace, open = false, save = false, entry = true }
end

local function generate(plugin)
  local p = prefs(plugin)
  local dlg = Dialog("Pixel Builder: Generate")
  connectionFields(dlg, p)
  dlg:separator()
  dlg:entry { id = "generator", label = "Generator", text = p.generator }
  dlg:entry { id = "params", label = "Params (JSON)", text = p.params }
  dlg:entry { id = "name", label = "Name", text = p.name }
  dlg:number { id = "seed", label = "Seed (0 = random)", text = "0", decimals = 0 }
  dlg:button { id = "ok", text = "Generate", focus = true }
  dlg:button { id = "cancel", text = "Cancel" }
  dlg:show()
  local d = dlg.data
  if not d.ok then return end
  p.cli, p.workspace, p.generator, p.params, p.name = d.cli, d.workspace or "", d.generator, d.params, d.name
  local input = '{"generator":' .. jstr(d.generator) .. ',"params":' .. (d.params ~= "" and d.params or "{}")
  if d.name ~= "" then input = input .. ',"name":' .. jstr(d.name) end
  if d.seed and d.seed > 0 then input = input .. ',"seed":' .. string.format("%d", d.seed) end
  input = input .. "}"
  local tmp = inputFile(input)
  local out, err = run(p, "generate-asset --input @" .. q(tmp))
  os.remove(tmp)
  if not out then return fail(err) end
  local id = out:match('"asset"%s*:%s*{%s*"id"%s*:%s*"(.-)"')
  if not id then return fail("generate_asset returned no asset id.") end
  local ex, err2 = run(p, "export-asset " .. q(id) .. " --format aseprite")
  if not ex then return fail(err2) end
  local path = ex:match('"path"%s*:%s*"([^"]-%.aseprite)"')
  if not path then return fail("export_asset returned no .aseprite path.") end
  if not openFile(unjson(path)) then fail("Could not open " .. path) end
end

local function rerender(plugin)
  local p = prefs(plugin)
  local spr = app.activeSprite
  if not spr or spr.filename == "" then return fail("Open an exported .aseprite file first.") end
  local file = spr.filename
  local stem = file:match("([^/\\]+)%.aseprite$")
  if not stem then return fail("The active sprite is not an .aseprite file.") end
  local dlg = Dialog("Pixel Builder: Re-render")
  connectionFields(dlg, p)
  dlg:entry { id = "asset", label = "Asset name or id", text = stem }
  dlg:button { id = "ok", text = "Re-render", focus = true }
  dlg:button { id = "cancel", text = "Cancel" }
  dlg:show()
  local d = dlg.data
  if not d.ok then return end
  p.cli, p.workspace = d.cli, d.workspace or ""
  local out, err = run(p, "rerender-assets --ids " .. q(d.asset))
  if not out then return fail(err) end
  -- rerender_assets rewrites an existing .aseprite next to the PNG; export again to be sure
  local ex, err2 = run(p, "export-asset " .. q(d.asset) .. " --format aseprite")
  if not ex then return fail(err2) end
  local path = ex:match('"path"%s*:%s*"([^"]-%.aseprite)"')
  if spr.isModified then
    local r = app.alert { title = "Pixel Builder", text = "Discard unsaved changes in " .. stem .. " and reload?", buttons = { "Reload", "Cancel" } }
    if r ~= 1 then return end
  end
  spr:close()
  openFile(unjson(path or file))
end

local function pullPalette(plugin)
  local p = prefs(plugin)
  local spr = app.activeSprite
  if not spr then return fail("Open a sprite first.") end
  local dlg = Dialog("Pixel Builder: Pull kit palette")
  connectionFields(dlg, p)
  dlg:entry { id = "kit", label = "Kit id (blank = active)", text = "" }
  dlg:button { id = "ok", text = "Pull", focus = true }
  dlg:button { id = "cancel", text = "Cancel" }
  dlg:show()
  local d = dlg.data
  if not d.ok then return end
  p.cli, p.workspace = d.cli, d.workspace or ""
  local out, err = run(p, "get-style-guide" .. (d.kit ~= "" and (" --kit-id " .. q(d.kit)) or ""))
  if not out then return fail(err) end
  local entries = out:match('"legend_entries"%s*:%s*(%b[])')
  local hexes = {}
  for hex in (entries or ""):gmatch('"hex"%s*:%s*"(#%x%x%x%x%x%x)"') do hexes[#hexes + 1] = hex end
  if #hexes == 0 then return fail("get_style_guide returned no palette.") end
  if spr.colorMode ~= ColorMode.INDEXED and spr.colorMode ~= ColorMode.RGB then return fail("Convert the sprite to RGB or Indexed first.") end
  -- Entry 0 is transparent; entries 1.. follow the kit's material x level order,
  -- the same indices the .aseprite export and the sprite data use.
  app.transaction(function()
    local pal = Palette(#hexes + 1)
    pal:setColor(0, Color { r = 0, g = 0, b = 0, a = 0 })
    for i, hex in ipairs(hexes) do
      pal:setColor(i, Color { r = tonumber(hex:sub(2, 3), 16), g = tonumber(hex:sub(4, 5), 16), b = tonumber(hex:sub(6, 7), 16), a = 255 })
    end
    spr:setPalette(pal)
  end)
  app.refresh()
end

local function sendSelection(plugin)
  local spr = app.activeSprite
  if not spr or spr.selection.isEmpty then return fail("Select a region first.") end
  local b = spr.selection.bounds
  -- The edit_region tool (#18) is built in a parallel lane. Until it is merged this only
  -- reports the region; call the tool yourself with x=%d y=%d w=%d h=%d.
  fail(string.format("edit_region is not available in this build yet (issue #18).\nSelection: x=%d y=%d w=%d h=%d (frame %d).\nWhen the tool lands this command will send these bounds to it.",
    b.x, b.y, b.width, b.height, app.activeFrame and app.activeFrame.frameNumber or 1))
end

function init(plugin)
  prefs(plugin)
  plugin:newCommand { id = "PixelBuilderGenerate", title = "Pixel Builder: Generate...", group = "file_scripts", onclick = function() generate(plugin) end }
  plugin:newCommand { id = "PixelBuilderRerender", title = "Pixel Builder: Re-render with current kit", group = "file_scripts", onclick = function() rerender(plugin) end,
    onenabled = function() return app.activeSprite ~= nil end }
  plugin:newCommand { id = "PixelBuilderPullPalette", title = "Pixel Builder: Pull kit palette", group = "file_scripts", onclick = function() pullPalette(plugin) end,
    onenabled = function() return app.activeSprite ~= nil end }
  plugin:newCommand { id = "PixelBuilderEditRegion", title = "Pixel Builder: Send selection to edit_region", group = "file_scripts", onclick = function() sendSelection(plugin) end,
    onenabled = function() return app.activeSprite ~= nil end }
end

function exit(plugin) end
