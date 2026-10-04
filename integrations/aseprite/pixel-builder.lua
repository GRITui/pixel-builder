-- pixel-builder for Aseprite: bridge the running Aseprite sprite to the local
-- pixel-builder MCP server (HTTP), so the art you are editing comes from one
-- style kit and can be generated, re-rendered and region-edited in place.
--
-- Install: copy this file and `init.lua` from this folder into your Aseprite
-- scripts folder (see README.md), then restart Aseprite.
--
-- Everything talks to the MCP endpoint with plain JSON-RPC over HTTP:
--   POST http://127.0.0.1:8788/mcp   {"jsonrpc":"2.0","id":N,"method":"tools/call", ...}
-- The server is stateless, so every call is one request/response pair.

local M = {}

-- ---------- config ----------

local config = {
  url = "http://127.0.0.1:8788/mcp",
  -- Workspace is a folder on the same machine as the server (the default).
  workspace = nil, -- e.g. "pixel-assets"; nil uses the server's own default
}

local nextId = 0

-- pixel-builder's palette legend: index 0 is '.', then a fixed 90-char ASCII
-- alphabet in palette order. Sending pixels back to `paint_asset` means
-- encoding with exactly this alphabet, so it is duplicated here rather than
-- guessed. (See src/core/legend.ts; it must not drift.)
local LEGEND_ALPHABET =
  "abcdefghijklmnopqrstuvwxyz" ..
  "ABCDEFGHIJKLMNOPQRSTUVWXYZ" ..
  "0123456789" ..
  "!#$%&()*+,-/:;<=>?@[]^_`{|}~"

-- ---------- JSON + HTTP (Aseprite's Lua has no JSON library) ----------

-- Encode a Lua value as JSON. Tables with a `__jsontype` field are emitted as
-- that raw fragment, which is how we build `content` blobs for tool results.
local function jsonEncode(value)
  local t = type(value)
  if value == nil then
    return "null"
  elseif t == "boolean" then
    return tostring(value)
  elseif t == "number" then
    if value ~= value or value == math.huge or value == -math.huge then return "null" end
    if value == math.floor(value) and math.abs(value) < 1e15 then return string.format("%d", value) end
    return string.format("%.14g", value)
  elseif t == "string" then
    local s = value:gsub('[%c"\\]', function(c)
      if c == '"' then return '\\"' end
      if c == "\\" then return "\\\\" end
      if c == "\n" then return "\\n" end
      if c == "\r" then return "\\r" end
      if c == "\t" then return "\\t" end
      return string.format("\\u%04x", c:byte())
    end)
    return '"' .. s .. '"'
  elseif t == "table" then
    if rawget(value, "__raw") then return rawget(value, "__raw") end
    local parts = {}
    local n = #value
    -- A table is an array when it has a non-zero contiguous integer prefix;
    -- otherwise it is a JSON object. (An empty table is sent as an array,
    -- which is what our args want: `ids = {}`.)
    if n > 0 or next(value) == nil then
      for i = 1, n do
        parts[i] = jsonEncode(value[i])
      end
      return "[" .. table.concat(parts, ",") .. "]"
    end
    -- object; sort keys so the payload is stable and readable in logs
    local keys = {}
    for k in pairs(value) do keys[#keys + 1] = k end
    table.sort(keys, function(a, b) return tostring(a) < tostring(b) end)
    for i = 1, #keys do
      local k = keys[i]
      parts[i] = jsonEncode(tostring(k)) .. ":" .. jsonEncode(value[k])
    end
    return "{" .. table.concat(parts, ",") .. "}"
  end
  return "null"
end

-- Minimal JSON parser: enough to read pixel-builder's replies.
local function jsonDecode(str)
  local pos = 1
  local parseValue

  local function skipWs()
    while pos <= #str and str:sub(pos, pos):match("%s") do pos = pos + 1 end
  end

  local parseString = function()
    pos = pos + 1 -- opening quote
    local out = {}
    while pos <= #str do
      local c = str:sub(pos, pos)
      if c == '"' then
        pos = pos + 1
        return table.concat(out)
      elseif c == "\\" then
        local e = str:sub(pos + 1, pos + 1)
        if e == "n" then out[#out + 1] = "\n"
        elseif e == "t" then out[#out + 1] = "\t"
        elseif e == "r" then out[#out + 1] = "\r"
        elseif e == "b" then out[#out + 1] = "\b"
        elseif e == "f" then out[#out + 1] = "\f"
        elseif e == "u" then
          out[#out + 1] = string.char(tonumber(str:sub(pos + 2, pos + 5), 16) or 63)
          pos = pos + 4
        else out[#out + 1] = e end
        pos = pos + 2
      else
        out[#out + 1] = c
        pos = pos + 1
      end
    end
    error("unterminated string in JSON")
  end

  parseValue = function()
    skipWs()
    local c = str:sub(pos, pos)
    if c == "{" then
      pos = pos + 1
      local obj = {}
      skipWs()
      if str:sub(pos, pos) == "}" then pos = pos + 1 return obj end
      while true do
        skipWs()
        local key = parseString()
        skipWs()
        pos = pos + 1 -- ':'
        obj[key] = parseValue()
        skipWs()
        local d = str:sub(pos, pos)
        pos = pos + 1
        if d == "}" then return obj end
        if d ~= "," then error("expected , or } in JSON object") end
      end
    elseif c == "[" then
      pos = pos + 1
      local arr = {}
      skipWs()
      if str:sub(pos, pos) == "]" then pos = pos + 1 return arr end
      while true do
        arr[#arr + 1] = parseValue()
        skipWs()
        local d = str:sub(pos, pos)
        pos = pos + 1
        if d == "]" then return arr end
        if d ~= "," then error("expected , or ] in JSON array") end
      end
    elseif c == '"' then
      return parseString()
    elseif str:sub(pos, pos + 3) == "true" then
      pos = pos + 4
      return true
    elseif str:sub(pos, pos + 4) == "false" then
      pos = pos + 5
      return false
    elseif str:sub(pos, pos + 3) == "null" then
      pos = pos + 4
      return nil
    else
      local s, e = str:find("^-?%d+%.?%d*[eE]?[-+]?%d*", pos)
      if not s then error("unexpected character in JSON: " .. c) end
      pos = e + 1
      return tonumber(str:sub(s, e))
    end
  end

  local v = parseValue()
  return v
end

-- ---------- MCP client ----------

-- One JSON-RPC call. Returns the decoded `result`, or nil + message.
function M.call(toolName, args)
  nextId = nextId + 1
  local payload = jsonEncode({
    jsonrpc = "2.0",
    id = nextId,
    method = "tools/call",
    params = { name = toolName, arguments = args or {} },
  })

  local socket = socket or nil
  if not socket then
    app.alert("pixel-builder: no HTTP support in this Lua runtime.")
    return nil, "no socket library"
  end

  local host, port, path = config.url:match("^http://([^:/]+):(%d+)(.*)$")
  if not host then
    app.alert("pixel-builder: only http:// URLs are supported (got " .. config.url .. ").")
    return nil, "bad url"
  end

  local tcp = socket.tcp()
  tcp:settimeout(240000) -- a generation can take a while
  local ok, err = tcp:connect(host, tonumber(port))
  if not ok then
    app.alert("pixel-builder: cannot reach " .. config.url .. "\n\nStart it with:\n  pixel-builder mcp --http --workspace <dir>\n\n(" .. tostring(err) .. ")")
    return nil, tostring(err)
  end

  tcp:send(
    "POST " .. (path ~= "" and path or "/") .. " HTTP/1.1\r\n" ..
    "Host: " .. host .. ":" .. port .. "\r\n" ..
    "Content-Type: application/json\r\n" ..
    "Accept: application/json, text/event-stream\r\n" ..
    "Content-Length: " .. #payload .. "\r\n" ..
    "Connection: close\r\n\r\n" .. payload
  )

  local chunks = {}
  while true do
    local piece = tcp:receive("*l")
    if piece == nil then break end
    chunks[#chunks + 1] = piece
  end
  tcp:close()

  local raw = table.concat(chunks, "\n")
  local body = raw:match("\r\n\r\n(.*)$")
  if not body then return nil, "no response body from the server" end
  -- Skip SSE `event:`/`data:` framing if the transport used it.
  if body:sub(1, 5) == "event:" then
    local collected = {}
    for line in body:gmatch("[^\r\n]+") do
      if line:sub(1, 5) == "data:" then collected[#collected + 1] = line:sub(6) end
    end
    body = table.concat(collected, "")
  end

  local okParse, decoded = pcall(jsonDecode, body)
  if not okParse then return nil, "bad JSON from the server: " .. tostring(decoded) end
  if decoded.error then return nil, decoded.error.message or jsonEncode(decoded.error) end

  local result = decoded.result
  -- Tool errors arrive as isError + text content; surface them as failures.
  if result and result.isError then
    local text = ""
    for _, c in ipairs(result.content or {}) do
      if c.type == "text" then text = text .. (c.text or "") end
    end
    return nil, text ~= "" and text or "the tool reported an error"
  end
  -- Unwrap the tool's own JSON payload (the first text content block).
  if result and result.content then
    for _, c in ipairs(result.content) do
      if c.type == "text" then
        local okInner, inner = pcall(jsonDecode, c.text)
        if okInner and type(inner) == "table" then return inner end
        return { text = c.text }
      end
    end
  end
  return result
end

--- Call a tool, show any failure as an Aseprite dialog, return nil on error.
local function callOrAlert(toolName, args)
  local data, err = M.call(toolName, args)
  if not data then
    app.alert("pixel-builder: " .. tostring(err))
    return nil
  end
  return data
end

-- ---------- palette ----------

-- `get_style_guide` answers with markdown, not JSON. Its legend block is one
-- line per palette entry, always "<char> = <material> level <n> (#rrggbb)":
--     a = ink level 0 (#020205)
--     . = transparent          <- the transparent slot, carries no hex
-- The legend char can be any printable ASCII -- including "=", "-", "#" and
-- "[" -- so the pattern anchors on the trailing hex and takes the first
-- character as the char. Markdown headings ("# ...", "- ...") never carry a
-- "(#rrggbb)" suffix, so they cannot be mistaken for legend rows.
local function parseLegend(markdown)
  local byChar = {}
  for line in markdown:gmatch("[^\r\n]+") do
    local char, hex = line:match("^(.)%s*=%s.+%(%#(%x%x%x%x%x%x)%)")
    if char and hex then byChar[char] = hex end
  end
  return byChar
end

--- Load a kit's palette into the current sprite, indexed exactly as
--- pixel-builder indexes it (0 = transparent).
function M.applyKitPalette(kitId)
  local data = callOrAlert("get_style_guide", kitId and { kit_id = kitId } or {})
  if not data then return nil end
  local markdown = data.text or ""
  local byChar = parseLegend(markdown)
  if next(byChar) == nil then
    app.alert("pixel-builder: the style guide had no palette legend to read.")
    return nil
  end
  local sprite = app.sprite
  if not sprite then
    app.alert("pixel-builder: open a sprite first.")
    return nil
  end

  -- Rebuild the palette in palette-index order so entry i is the same colour
  -- pixel-builder's index i means.
  local pal = sprite.palettes[1]
  pal:resize(#LEGEND_ALPHABET + 1)
  pal:setColor(0, { r = 0, g = 0, b = 0, a = 0 }) -- transparent slot
  local n = 0
  for i = 1, #LEGEND_ALPHABET do
    local char = LEGEND_ALPHABET:sub(i, i)
    local hex = byChar[char]
    if hex then
      pal:setColor(i, {
        r = tonumber(hex:sub(1, 2), 16) or 0,
        g = tonumber(hex:sub(3, 4), 16) or 0,
        b = tonumber(hex:sub(5, 6), 16) or 0,
        a = 255,
      })
      n = n + 1
    else
      pal:setColor(i, { r = 0, g = 0, b = 0, a = 0 })
    end
  end
  app.refresh()
  return n
end

-- ---------- drawing helpers ----------

--- Create a sprite from a generated asset: apply the kit palette, then paint
--- the asset's first frame as palette indices. The indices mean the same
--- colours they do in pixel-builder, so the file re-exports unchanged.
---
--- get_asset answers with { asset, legend, pixels }: `asset.rows[].frames` is a
--- COUNT, and the actual pixels arrive in `pixels[].frames[1]` as legend text
--- rows (".abcd"), one string per pixel row.
function M.insertAsNewSprite(assetId)
  local data = callOrAlert("get_asset", { id = assetId, include_pixels = true })
  if not data then return nil end
  local asset = data.asset or {}

  -- Apply the palette first: the indices we are about to set only mean
  -- something once entry i is the right colour.
  M.applyKitPalette(asset.kit_id)

  local pixels = data.pixels or {}
  local firstRow = pixels[1]
  local rowsOfText = firstRow and firstRow.frames and firstRow.frames[1]
  if not rowsOfText or #rowsOfText == 0 then
    app.alert("pixel-builder: that asset has no frames.")
    return nil
  end
  local h = #rowsOfText
  local w = #rowsOfText[1]

  local sprite = Sprite(w, h)
  local layer = sprite.layers:add()
  layer.name = asset.name or "pixel-builder"
  -- A fresh Sprite ships with one palette entry; make sure there are enough
  -- for every index we are about to write.
  if #sprite.palettes[1] < #LEGEND_ALPHABET + 1 then
    sprite.palettes[1]:resize(#LEGEND_ALPHABET + 1)
  end

  -- "." is the transparent slot; every other legend char maps to its index.
  for y = 0, h - 1 do
    for x = 0, w - 1 do
      local c = rowsOfText[y + 1]:sub(x + 1, x + 1)
      local idx = 0
      if c ~= "." and c ~= "" then idx = LEGEND_ALPHABET:find(c, 1, true) or 0 end
      if idx > 0 then layer:setPixel(x, y, idx) end
    end
  end

  app.open(sprite)
  app.refresh()
  return sprite
end

-- ---------- commands ----------

function M.cmd_generate()
  local dialog = app.ui{ id = "pb_generate", type = "dialog", title = "pixel-builder: generate", texts = {
    { type = "label", label = "Create a new sprite from a generated asset." },
    { type = "label", label = "Name" }, { type = "entry", id = "name", text = "hero" },
    { type = "label", label = "Generator (blank = rigged character)" }, { type = "entry", id = "generator", text = "" },
    { type = "label", label = "Rig (for a rigged character)" }, { type = "entry", id = "rig", text = "" },
    { type = "button", id = "go", text = "Generate", onclick = function() app.ui:close() end },
  } }
  dialog:show()
  local d = dialog:wait()
  dialog:delete()
  if not d or not d.go then return end

  local name = d.name ~= "" and d.name or "hero"
  local created
  if d.rig ~= "" then
    created = callOrAlert("generate_rigged", { rig = d.rig, name = name, clips = { "walk" } })
  elseif d.generator ~= "" then
    created = callOrAlert("generate_asset", { generator = d.generator, name = name })
  else
    app.alert("pixel-builder: give a generator or a rig id (use list_generators / list_rigs).")
    return
  end
  if not created then return end
  local asset = created.asset
  M.insertAsNewSprite(asset.id)
end

--- Re-render the workspace's assets with the active kit's current colours, so
--- every export (PNG, .aseprite, ...) picks the new palette up.
function M.cmd_rerender()
  local sprite = app.sprite
  if not sprite then
    app.alert("pixel-builder: open a sprite first.")
    return
  end
  local idsField = nil
  if app.ui and app.ui.showDialogs then
    local d = app.ui{ id = "pb_rerender", type = "dialog", title = "pixel-builder: re-render", texts = {
      { type = "label", label = "Re-render every asset with the current kit colours." },
      { type = "label", label = "Asset id (blank = all assets)" }, { type = "entry", id = "id", text = "" },
      { type = "button", id = "go", text = "Re-render", onclick = function() app.ui:close() end },
    } }
    d:show()
    local r = d:wait()
    d:delete()
    if not r or not r.go then return end
    idsField = (r.id ~= "") and { r.id } or nil
  end

  -- rerender_assets takes `ids` (nil = every asset), not `all`.
  local args = idsField and { ids = idsField } or {}
  local data = callOrAlert("rerender_assets", args)
  if not data then return end
  local assets = data.assets or {}
  if #assets == 0 then
    app.alert("pixel-builder: nothing was re-rendered.")
    return
  end
  local first = assets[1].files and assets[1].files[1] or "(no file)"
  app.alert(
    "pixel-builder: re-rendered " .. #assets .. " asset(s) with the current kit.\n\n" ..
    tostring(first) .. "\n\nThe kit colours are also live in this sprite's palette (Palette ▸ pixel-builder)."
  )
end

--- Send the current selection to pixel-builder's edit_region as an AI inpaint.
function M.cmd_sendSelection()
  local sprite = app.sprite
  if not sprite then
    app.alert("pixel-builder: open a sprite first.")
    return
  end
  local sel = sprite.selection
  if not sel or sel.isEmpty then
    app.alert("pixel-builder: make a selection first (the region to change).")
    return
  end
  local dialog = app.ui{ id = "pb_inpaint", type = "dialog", title = "pixel-builder: edit selection", texts = {
    { type = "label", label = "Change the selection to:" },
    { type = "entry", id = "prompt", text = "" },
    { type = "label", label = "Asset id (blank = the re-rendered one)" }, { type = "entry", id = "asset", text = "" },
    { type = "button", id = "go", text = "Send", onclick = function() app.ui:close() end },
  } }
  dialog:show()
  local d = dialog:wait()
  dialog:delete()
  if not d or not d.go or d.prompt == "" then return end

  local data = callOrAlert("edit_region", {
    id = d.asset ~= "" and d.asset or (sprite.name or ""),
    rect = { x = sel.x, y = sel.y, w = sel.width, h = sel.height },
    prompt = d.prompt,
  })
  if not data then return end
  local region = data.region or {}
  local assets = data.asset or {}
  app.alert(
    "pixel-builder: region edited via " .. tostring(data.via) .. ".\n\n" ..
    "Re-run the export, or re-import " .. tostring((assets.files or {})[1] or "") .. " to see it here."
  )
end

--- Ask pixel-builder for a kit's palette and install it in the current sprite.
function M.cmd_pullPalette()
  local data = callOrAlert("list_kits", {})
  if not data then return end
  local kits = data.kits or {}
  if #kits == 0 then
    app.alert("pixel-builder: no kits in the workspace.")
    return
  end
  local items = {}
  for _, k in ipairs(kits) do items[#items + 1] = k.id .. (k.active and " (active)" or "") end
  local dialog = app.ui{ id = "pb_kit", type = "dialog", title = "pixel-builder: kit palette", texts = {
    { type = "label", label = "Kit" },
    { type = "entry", id = "kit", text = kits[1].id },
    { type = "label", label = "Available: " .. table.concat(items, ", ") },
    { type = "button", id = "go", text = "Apply", onclick = function() app.ui:close() end },
  } }
  dialog:show()
  local d = dialog:wait()
  dialog:delete()
  if not d or not d.go then return end
  local n = M.applyKitPalette(d.kit)
  if n then app.alert("pixel-builder: applied " .. n .. " kit colours (index 0 is transparent).") end
end

--- Export the current sprite's pixels back to pixel-builder as an asset.
function M.cmd_pushSprite()
  local sprite = app.sprite
  if not sprite then
    app.alert("pixel-builder: open a sprite first.")
    return
  end
  local layer = app.layer or sprite.layers[1]
  if not layer then
    app.alert("pixel-builder: the sprite has no layers.")
    return
  end
  local frame = {}
  for y = 0, sprite.height - 1 do
    local chars = {}
    for x = 0, sprite.width - 1 do
      local idx = layer:getPixel(x, y)
      if idx == 0 or idx > #LEGEND_ALPHABET + 1 then
        chars[#chars + 1] = "." -- transparent, or an index the legend lacks
      else
        chars[#chars + 1] = LEGEND_ALPHABET:sub(idx, idx)
      end
    end
    frame[#frame + 1] = table.concat(chars)
  end
  local data = callOrAlert("paint_asset", {
    name = (sprite.name or "sprite") .. "-aseprite",
    category = "object",
    width = sprite.width,
    height = sprite.height,
    frames = { frame },
  })
  if not data then return end
  local files = ((data.asset or {}).files) or {}
  app.alert("pixel-builder: imported as " .. tostring((data.asset or {}).id) .. "\n\n" .. tostring(files[1] or ""))
end

return M