-- Exercises the JSON encode/decode in pixel-builder.lua plus the palette-legend
-- parser -- the two places this extension could silently be wrong.
--
-- Runs under stock Lua (tested on 5.4.6); needs neither Aseprite nor a running
-- MCP server, because every payload it parses is embedded below as captured
-- from the real server.
--
--   lua integrations/aseprite/pixel-builder-json.test.lua

local self = debug.getinfo(1, "S").source:sub(2)
local folder = self:match("(.*)[/\\][^/\\]*$") or "."
local modulePath = folder .. "/pixel-builder.lua"

local fh = io.open(modulePath, "r")
if not fh then
  print("FAIL cannot open " .. modulePath)
  os.exit(1)
end
local src = fh:read("*a")
fh:close()

-- Extract just the pure-string helpers. The module's Aseprite-facing code needs
-- a live `app`, so we never load it; we re-evaluate only these three functions
-- and hand them back with an explicit return.
local function slice(from, to)
  local a = src:find(from, 1, true)
  local b = src:find(to, a or 1, true)
  if not a or not b then
    print("FAIL cannot slice " .. from .. " .. " .. to)
    os.exit(1)
  end
  return src:sub(a, b - 1)
end

-- The alphabet literal in pixel-builder.lua: take from the assignment up to the
-- blank line that ends it. (Slice the MODULE source, not this file.)
local legend = slice("local LEGEND_ALPHABET", "\n\n")
local helpers = slice("local function jsonEncode", "-- ---------- MCP client ----------")
local legendParse = slice("local function parseLegend", "function M.applyKitPalette")

local source = legend .. "\n" .. helpers .. "\n" .. legendParse
  .. "\nreturn jsonEncode, jsonDecode, parseLegend\n"

local chunk
if _VERSION == "Lua 5.4" then
  chunk = assert(load(source, "pb-helpers", nil))
else
  chunk = assert(loadstring(source, "pb-helpers"))
end
local jsonEncode, jsonDecode, parseLegend = chunk()

local fails = 0
local function check(name, cond, detail)
  if cond then
    print("ok   " .. name)
  else
    fails = fails + 1
    print("FAIL " .. name .. (detail and ("  -- " .. tostring(detail)) or ""))
  end
end

-- ---------------------------------------------------------------- encoding --

check("encode string", jsonEncode("hi") == '"hi"', jsonEncode("hi"))
check("escape quote", jsonEncode('a"b') == '"a\\"b"', jsonEncode('a"b'))
check("escape newline", jsonEncode("a\nb") == '"a\\nb"', jsonEncode("a\nb"))
check("escape backslash", jsonEncode("a\\b") == '"a\\\\b"', jsonEncode("a\\b"))
check("encode int", jsonEncode(7) == "7", jsonEncode(7))
check("encode float", jsonEncode(1.5) == "1.5", jsonEncode(1.5))
check("encode bool", jsonEncode(true) == "true")
check("encode nil", jsonEncode(nil) == "null")
check("encode empty table as array", jsonEncode({}) == "[]", jsonEncode({}))
check("encode array", jsonEncode({ 1, 2 }) == "[1,2]", jsonEncode({ 1, 2 }))
check("encode object", jsonEncode({ a = 1 }) == '{"a":1}', jsonEncode({ a = 1 }))
check("encode nested object", jsonEncode({ name = "x", args = { id = "hero", rect = { x = 1, y = 2 } } })
  == '{"args":{"id":"hero","rect":{"x":1,"y":2}},"name":"x"}',
  jsonEncode({ name = "x", args = { id = "hero", rect = { x = 1, y = 2 } } }))

-- ---------------------------------------------------------------- decoding --

-- Captured from `tools/list` on a real server (abridged to the fields we read).
-- Uses a level-1 long bracket because the payload contains "]]".
local toolsList = [=[
{"jsonrpc":"2.0","id":1,"result":{"tools":[{"name":"export_asset","title":"Export asset","description":"Write game-ready files for an asset. 'png' = image (animated assets become a spritesheet + .json metadata; maps also get .tiled.json + tilesets); 'spritesheet' = always sheet + .json; 'tiled' = map only; 'svg' = layered vector (a layer per material, per part for rigged assets, plus a locked 'guides' layer with pixel/tile grid, ground line, frame labels, joints) that opens in Inkscape/Figma and comes back with import_svg; 'aseprite' = native .aseprite binary for Aseprite (indexed pixels locked to the kit palette, one layer per rig part, one tag per animation row, frame duration from fps). Autotile assets (generator 'tileset') also export 'tiled-tileset' (.tsj with a wangset), 'godot' (.tres TileSet with terrain + peering bits), 'unity' (PNG + .rules.json slice rects and neighbour rules) and 'atlas' (PNG + .atlas.json index); each writes <slug>.png beside it. Default folder: <workspace>/<category>s/ (characters/, buildings/, environments/, objects/, maps/ - and ui/ for UI assets, not uis/).","inputSchema":{"$schema":"http://json-schema.org/draft-07/schema#","type":"object","properties":{"id":{"type":"string","description":"Asset id (or exact name)."},"format":{"default":"png","type":"string","enum":["png","spritesheet","tiled","svg","aseprite","tiled-tileset","godot","unity","atlas"]},"scale":{"default":1,"description":"Integer upscale of the PNG (nearest neighbour); ignored for svg, applied to .aseprite cels.","type":"integer","minimum":1,"maximum":16},"out_dir":{"description":"Output folder (relative to the current directory). Default: <workspace>/<category>s/ (ui/ for UI assets).","type":"string"}},"required":["id"]},"annotations":{"title":"Export asset","readOnlyHint":false,"destructiveHint":false,"openWorldHint":false},"execution":{"taskSupport":"forbidden"}},{"name":"get_style_guide","title":"Get style guide","description":"Get a kit's style guide. Read it before hand-painting: it has the kit summary (vibe, light, outline, shade steps, sizes), the palette legend (one char per palette colour, used in paint_asset / edit_asset rows) and the painting rules that keep hand-painted art on-kit.","inputSchema":{"$schema":"http://json-schema.org/draft-07/schema#","type":"object","properties":{"kit_id":{"description":"Style kit id (see list_kits). Default: the active kit.","type":"string"},"materials":{"description":"Only list these materials in the legend (default: all). Chars never change.","type":"array","items":{"type":"string","enum":["ink","skin","hair","cloth","cloth2","leather","metal","gold","wood","stone","roof","foliage","grass","dirt","sand","water","accent","ui"]}}}},"annotations":{"title":"Get style guide","readOnlyHint":true,"destructiveHint":false,"openWorldHint":false},"execution":{"taskSupport":"forbidden"}},{"name":"paint_asset","title":"Paint asset","description":"Create an asset from legend-char rows you paint yourself (read get_style_guide first). `frames` is one entry per frame, each an array of `height` strings of `width` chars. Runs the same finishing pass as generators (outline per the kit, orphan cleanup), saves and exports it. Maps are not paintable; use generate_asset for those.","inputSchema":{"$schema":"http://json-schema.org/draft-07/schema#","type":"object","properties":{"name":{"type":"string","minLength":1,"maxLength":80},"category":{"type":"string","enum":["character","building","environment","object","ui","map"]},"width":{"type":"integer","minimum":1,"maximum":256},"height":{"type":"integer","minimum":1,"maximum":256},"frames":{"minItems":1,"maxItems":64,"type":"array","items":{"type":"array","items":{"type":"string"}},"description":"string[][]: one inner array of legend rows per frame."},"row_names":{"description":"Animation row names (e.g. ['walk-down','walk-up']). Frames are split evenly across them in order. Default: one row 'idle'.","type":"array","items":{"type":"string","minLength":1,"maxLength":40}},"fps":{"type":"number","minimum":1,"maximum":60},"outline":{"default":true,"description":"Add the kit's outline around the silhouette (leave a 1px transparent margin).","type":"boolean"},"cleanup":{"default":true,"description":"Remove stray single pixels.","type":"boolean"},"kit_id":{"description":"Style kit id (see list_kits). Default: the active kit.","type":"string"}},"required":["name","category","width","height","frames"]},"annotations":{"title":"Paint asset","readOnlyHint":false,"destructiveHint":false,"openWorldHint":false},"execution":{"taskSupport":"forbidden"}},{"name":"rerender_assets","title":"Rerender assets","description":"Re-run the generator (or rig recipe, for rigged assets) of procedural/rigged assets with the current kit settings (after update_kit) so everything stays consistent, and re-export their files. Default: all procedural assets, each with its own kit; pass kit_id to move them to another kit. Hand-painted/imported assets are skipped.","inputSchema":{"$schema":"http://json-schema.org/draft-07/schema#","type":"object","properties":{"ids":{"description":"Asset ids or names. Default: every procedural asset.","type":"array","items":{"type":"string"}},"kit_id":{"description":"Re-render with this kit and move the assets to it. Default: each asset's own kit.","type":"string"}}},"annotations":{"title":"Rerender assets","readOnlyHint":false,"destructiveHint":false,"openWorldHint":false},"execution":{"taskSupport":"forbidden"}},{"name":"edit_region","title":"Edit a region (inpaint)","description":"AI region edit on a saved sprite: change part of a frame from plain words (prompt, e.g. 'add a red scarf') while every pixel outside the region stays byte-identical. Pass `rows` instead of `prompt` to paint the region yourself (works with no API key). On a rigged asset the edit is applied through the rig so every clip and direction follows; `all_frames` applies it to every frame of the row otherwise. Pixels outside the region never change.","inputSchema":{"$schema":"http://json-schema.org/draft-07/schema#","type":"object","properties":{"id":{"type":"string","description":"Asset id (or exact name)."},"row":{"description":"Animation row name or index. Default 0.","anyOf":[{"type":"string"},{"type":"integer","minimum":0,"maximum":9007199254740991}]},"frame":{"default":0,"description":"Frame index within the row.","type":"integer","minimum":0,"maximum":9007199254740991},"rect":{"description":"Rectangular region in pixels: {x,y,w,h}.","type":"object","properties":{"x":{"type":"number"},"y":{"type":"number"},"w":{"type":"number","minimum":1},"h":{"type":"number","minimum":1}},"required":["x","y","w","h"]},"mask":{"description":"Lasso region as a 2D boolean grid (one row per pixel row).","type":"array","items":{"type":"array","items":{"type":"boolean"}}},"prompt":{"description":"What to change in the region. Needs ANTHROPIC_API_KEY.","type":"string","minLength":1,"maxLength":1000},"rows":{"description":"Your own replacement legend rows for the region, sized to the region's bounding box.","type":"array","items":{"type":"string"}},"all_frames":{"default":false,"description":"Apply the same edit to every frame of the row.","type":"boolean"},"attachment_name":{"description":"On a rigged asset, name the attachment this edit is stored as (so attach can remove it).","type":"string","minLength":1,"maxLength":80}},"required":["id"]},"annotations":{"title":"Edit a region (inpaint)","readOnlyHint":false,"destructiveHint":false,"openWorldHint":false},"execution":{"taskSupport":"forbidden"}},{"name":"list_kits","title":"List kits","description":"List style kits (id, name, active) with their key style settings.","inputSchema":{"$schema":"http://json-schema.org/draft-07/schema#","type":"object","properties":{}},"annotations":{"title":"List kits","readOnlyHint":true,"destructiveHint":false,"openWorldHint":false},"execution":{"taskSupport":"forbidden"}},{"name":"generate_rigged","title":"Generate rigged character","description":"Render a rigged character: one skeleton, material slots, optional attachments, and animation clips x 4 directions (rows '<clip>-<dir>'). Lit by the kit like every generator. Saves (as a character) and exports a spritesheet + .json, with a preview. Re-render later with rerender_assets; change accessories with attach.","inputSchema":{"$schema":"http://json-schema.org/draft-07/schema#","type":"object","properties":{"rig":{"type":"string","description":"Rig id (see list_rigs), e.g. a humanoid."},"slots":{"description":"Material per slot, e.g. {\"top\":\"cloth\",\"bottom\":\"leather\"}. Missing slots use the rig's defaults (see list_rigs).","type":"object","propertyNames":{"type":"string"},"additionalProperties":{"type":"string","enum":["ink","skin","hair","cloth","cloth2","leather","metal","gold","wood","stone","roof","foliage","grass","dirt","sand","water","accent","ui"]}},"attachments":{"description":"Attachment ids (see list_attachments).","type":"array","items":{"type":"string"}},"clips":{"description":"Clip ids (see list_clips). Default: walk and idle when available.","type":"array","items":{"type":"string"}},"name":{"type":"string","minLength":1,"maxLength":80},"kit_id":{"description":"Style kit id (see list_kits). Default: the active kit.","type":"string"},"save":{"default":true,"type":"boolean"}},"required":["rig"]},"annotations":{"title":"Generate rigged character","readOnlyHint":false,"destructiveHint":false,"openWorldHint":false},"execution":{"taskSupport":"forbidden"}},{"name":"get_asset","title":"Get asset","description":"Show one asset: summary, a preview image, and (include_pixels=true) its pixels as legend rows per animation row/frame so you can read and edit them.","inputSchema":{"$schema":"http://json-schema.org/draft-07/schema#","type":"object","properties":{"id":{"type":"string","description":"Asset id (or exact name)."},"include_pixels":{"default":false,"type":"boolean"}},"required":["id"]},"annotations":{"title":"Get asset","readOnlyHint":true,"destructiveHint":false,"openWorldHint":false},"execution":{"taskSupport":"forbidden"}}]}}
]=]

local ok1, tools = pcall(jsonDecode, toolsList)
check("decode tools/list", ok1 and type(tools) == "table", ok1 and nil or tools)
if ok1 and tools.result then
  check("tools list has the 8 tools we call", #tools.result.tools == 8, #tools.result.tools)
  local export = tools.result.tools[1]
  local fmts = export.inputSchema.properties.format.enum
  local hasAseprite = false
  for _, f in ipairs(fmts) do
    if f == "aseprite" then hasAseprite = true end
  end
  check("export_asset enum includes aseprite", hasAseprite, table.concat(fmts, ","))
  check("export_asset is first in the abridged list", export.name == "export_asset", export.name)
  -- Every tool the extension calls must be present with its required args.
  local byName = {}
  for _, t in ipairs(tools.result.tools) do byName[t.name] = t end
  local required = {
    get_style_guide = {},
    paint_asset = { "name", "category", "width", "height", "frames" },
    rerender_assets = {},
    edit_region = { "id" },
    list_kits = {},
    generate_rigged = { "rig" },
    get_asset = { "id" },
  }
  for name, req in pairs(required) do
    local t = byName[name]
    if not t then
      check("tool '" .. name .. "' present", false, "missing")
    else
      local have = {}
      for _, r in ipairs(t.inputSchema.required or {}) do have[r] = true end
      local missing = {}
      for _, r in ipairs(req) do
        if not have[r] then missing[#missing + 1] = r end
      end
      check("tool '" .. name .. "' required args", #missing == 0, table.concat(missing, ","))
    end
  end
end

-- Captured from a real `export_asset` tool call, aseprite kind.
local callResult = [[
{"jsonrpc":"2.0","id":2,"result":{"content":[{"type":"text",
"text":"{\"files\":[{\"path\":\"/w/characters/hero.aseprite\",\"kind\":\"aseprite\"}],\"id\":\"hero\"}"}]}}]]

local ok2, call = pcall(jsonDecode, callResult)
check("decode tools/call envelope", ok2 and type(call) == "table")
if ok2 and call.result then
  local inner = jsonDecode(call.result.content[1].text)
  check("decode nested tool payload", type(inner) == "table")
  check("nested path is .aseprite", inner.files[1].path:match("%.aseprite$") ~= nil, inner.files[1].path)
  check("nested kind is aseprite", inner.files[1].kind == "aseprite", inner.files[1].kind)
end

-- Captured from a real `get_asset` call: NOTE asset.rows[].frames is a COUNT and
-- the pixels arrive separately in `pixels`, as legend text rows.
local getAsset = [=[
{"jsonrpc":"2.0","id":3,"result":{"content":[{"type":"text",
"text":"{\"asset\":{\"id\":\"a1\",\"kit_id\":\"kit-default\",\"width\":4,\"height\":3,
\"rows\":[{\"name\":\"idle\",\"frames\":1}]},
\"pixels\":[{\"row\":\"idle\",\"frames\":[[\"abac\",\"abac\",\"aa.a\"]]}]}"}]}}]
]=]

local ok3, ga = pcall(jsonDecode, getAsset)
check("decode get_asset", ok3 and type(ga) == "table")
if ok3 then
  local inner = jsonDecode(ga.result.content[1].text)
  check("asset.rows[].frames is a count", type(inner.asset.rows[1].frames) == "number",
    type(inner.asset.rows[1].frames))
  local text = inner.pixels[1].frames[1]
  check("pixels[0].frames[0] is legend text rows", type(text) == "table", type(text))
  check("legend rows rectangular", #text[1] == 4 and #text[2] == 4 and #text[3] == 4,
    table.concat({ #text[1], #text[2], #text[3] }, ","))
end

-- ------------------------------------------------------------ style guide --

-- Abridged from a real `get_style_guide` reply: the legend block format is
-- "<char> = <material> level <n> (#rrggbb)", and '.' (transparent) has no hex.
-- The full reply has 90 coloured rows; the sample keeps the tricky ones:
-- 'a' (first), '=' (the char is the separator too), '-' (also a list marker),
-- '~' (last).
local styleGuide = [[
# Kit: kit-neon

## Palette legend

```
. = transparent
a = ink level 0 (#020205)
e = ink level 4 (#6c5d82)
= = water level 2 (#2d0daa)
- = stone level 1 (#3a3a44)
~ = ui level 4 (#f8edf6)
```

## Rules

- Keep the outline on ink level 0.
]]

-- The style guide is markdown, so it is NOT parsed as JSON; parseLegend reads
-- the hex out of it directly.
local byChar = parseLegend(styleGuide)
local parsedCount = 0
for _ in pairs(byChar) do parsedCount = parsedCount + 1 end
check("parseLegend found the 5 sample rows", parsedCount == 5, parsedCount)
check("ink level 0", byChar["a"] == "020205", byChar["a"])
check("hex captured without the '#'", byChar["e"] == "6c5d82", byChar["e"])
check("'=' char parsed (char is its own separator)", byChar["="] == "2d0daa", byChar["="])
check("'-' char parsed (also a markdown list marker)", byChar["-"] == "3a3a44", byChar["-"])
check("last char parsed", byChar["~"] == "f8edf6", byChar["~"])
check("'.' is not a colour (transparent)", byChar["."] == nil, byChar["."])
check("headings/rules ignored", byChar["#"] == nil and byChar["K"] == nil)

-- ------------------------------------------------------------- round trip --

local args = { name = "hero", rect = { x = 3, y = 4, w = 5, h = 6 }, ids = { "a", "b" }, flag = true }
local ok5, back = pcall(jsonDecode, jsonEncode(args))
check("round-trip an args table", ok5 and back.name == "hero" and back.rect.w == 5
  and back.ids[2] == "b" and back.flag == true)

-- -------------------------------------------------------------- alphabet ---

local literals = {}
for piece in legend:gmatch('"([^"]*)"') do literals[#literals + 1] = piece end
local alphabet = table.concat(literals)
local seen, dup = {}, 0
for i = 1, #alphabet do
  local c = alphabet:sub(i, i)
  if seen[c] then dup = dup + 1 end
  seen[c] = true
end
check("alphabet has 90 chars", #alphabet == 90, #alphabet)
check("alphabet chars unique", dup == 0, dup)
check("alphabet has no '.' (that is index 0)", alphabet:find(".", 1, true) == nil)
check("alphabet starts a-z", alphabet:sub(1, 1) == "a" and alphabet:sub(26, 26) == "z")
check("alphabet ends ~", alphabet:sub(90, 90) == "~", alphabet:sub(90, 90))

-- Every legend char the style guide used must exist in the alphabet, and the
-- sample pixel rows must only use alphabet chars or '.'.
for _, c in ipairs({ "a", "e", "=", "-", "~" }) do
  check("alphabet contains '" .. c .. "'", alphabet:find(c, 1, true) ~= nil)
end
for _, row in ipairs({ "abac", "aa.a" }) do
  -- A pixel row is legal when every char is '.' (transparent) or in the
  -- alphabet. Walk it directly rather than with a pattern, so '.' cannot be
  -- confused with "any char".
  local bad = {}
  for i = 1, #row do
    local c = row:sub(i, i)
    if c ~= "." and alphabet:find(c, 1, true) == nil then
      bad[#bad + 1] = ("[%d]=%q"):format(i, c)
    end
  end
  check("pixel row '" .. row .. "' uses only alphabet + '.'", #bad == 0, table.concat(bad, " "))
end

print("")
if fails == 0 then
  print("ALL LUA JSON TESTS PASSED")
else
  print(fails .. " FAILURE(S)")
end
os.exit(fails == 0 and 0 or 1)