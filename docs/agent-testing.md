# Testing agents with pixel-builder

## Test with Qwen (no coding needed)

Goal: see whether Qwen can make a consistent set of pixel art by itself. About 20 minutes.
You need Node 20+ ([nodejs.org](https://nodejs.org)) and this repo downloaded (`npm install` once).
Open a terminal in the repo folder for every step.

1. **Install Qwen Code**: `npm install -g @qwen-code/qwen-code@latest`, then run `qwen` once and sign in or enter an API key
   (see <https://github.com/QwenLM/qwen-code>). Type `/exit` to leave.
2. **Check this machine**: `npx tsx src/node/cli.ts doctor`. Every line should start with `PASS`.
   A `FAIL` line has a `fix:` hint; fix it and run `doctor` again. (The "Web app AI" lines at the end are optional.)
3. **Connect Qwen to pixel-builder**: `npx tsx src/node/cli.ts setup qwen-code --tools core --write`
   (writes `.qwen/settings.json` here, keeps your other settings). `--tools core` gives a smaller model fewer tools to juggle.
4. **Add the skill** (the instructions that teach the workflow): `mkdir -p .qwen/skills && cp -r skills/pixel-builder .qwen/skills/`
5. **Start Qwen in this folder**: `qwen`. Type `/mcp`: `pixel-builder` should show as connected.
6. **Paste these prompts one at a time**, waiting for each to finish:
   1. `Make a starter forest pack: 3 trees, bushes, rocks, a grass tile and a dirt path tile.`
   2. `Make 3 farm villagers: a farmer, a shopkeeper and a child, in the same style.`
   3. `Make a small UI kit: a button, a panel, a health bar and an inventory slot.`
   4. `Make a small village map with a few houses, a road and trees.`
   5. `Make a sign that says INN.`

**What good output looks like**

- It calls `get_style_guide` first, tries `generate_variations`, then `generate_asset`; it looks at the preview images
  (or says it saved them) and does not invent colours.
- The files are in `pixel-assets/` (`environments/`, `characters/`, `ui/`, `maps/`, `objects/`) as PNGs. Open a few: all
  assets share the same palette, the same dark outline and the same light direction (highlights on the same side).
- Few red "error" lines; when one appears, Qwen reads it and fixes the call.

**If something fails**

| What you see | Try |
|---|---|
| `doctor` says `FAIL node` | Install Node 20+, open a new terminal |
| `doctor` says `FAIL mcp` | `npm install`, then `npx tsx src/node/cli.ts mcp` by hand: it should sit silent (Ctrl+C to stop) |
| `/mcp` does not list `pixel-builder` | Start `qwen` from the repo folder; re-run step 3; check `.qwen/settings.json` exists |
| Qwen writes the tool call as text instead of running it | The model or endpoint has no tool calling: pick a Qwen3 / qwen-max model or a server that supports it |
| Qwen paints raw pixels or ignores the kit | Make sure step 4 was done; paste `skills/pixel-builder/SKILL.md` into the chat; say "use generate_asset, do not paint" |
| Many "invalid input" errors | Keep `--tools core`; try a bigger model |
| `add_reference` with a URL is refused (private address) | Only for a local test server: set `PIXEL_BUILDER_ALLOW_PRIVATE_URLS=1` in the `env` of the MCP config |
| Wrong folder for files | Pass `--workspace <absolute folder>` to `setup` |

**Report back**: paste the full `doctor` output, which prompts worked, and the row the eval adds (next section) from
`bench/agents/RESULTS.md`. Screenshots of the `pixel-assets/` PNGs help.

**Point the web app at Qwen too** (optional; this is only for the app's "Vibe" and "Freeform pixels" buttons, not for Qwen Code):
set `AI_PROVIDER=openai`, `OPENAI_BASE_URL=https://dashscope-intl.aliyuncs.com/compatible-mode/v1`, `OPENAI_API_KEY=<DashScope key>`,
`AI_MODEL=qwen-max` and `AI_VISION_MODEL=qwen-vl-max` in `.env`, then `npm run dev`. The AI pill in the top bar shows the provider and model it is using.
Full details and the Ollama variant: [`deploy.md`](deploy.md#ai-provider).

## Run the eval with Qwen

`bench/agents/run.ts` measures whether a model can drive pixel-builder: it gives
the model 7 briefs (forest pack, NPCs, UI kit, village map, match a reference,
paint a sign, change the kit vibe), lets it call the tools in-process in a fresh
temp workspace per brief, and scores the result (checks, tool error rate,
palette/outline/style consistency). Any OpenAI-compatible Chat Completions
endpoint with tool calling works; no new dependencies.

DashScope (Alibaba Cloud, international endpoint):

```bash
export OPENAI_BASE_URL=https://dashscope-intl.aliyuncs.com/compatible-mode/v1
export OPENAI_API_KEY=<your DashScope key>
npx tsx bench/agents/run.ts --model qwen-max            # all 7 briefs
npx tsx bench/agents/run.ts --model qwen3-235b-a22b --task ui-kit --max-turns 20
```

The open-source Qwen3 models on DashScope reject non-streaming calls unless
thinking is off: add `--extra-body '{"enable_thinking":false}'` (not needed for
`qwen-max` / `qwen-plus`).
Ollama, running locally (no key needed):

```bash
ollama pull qwen3:14b
OPENAI_BASE_URL=http://localhost:11434/v1 npx tsx bench/agents/run.ts --model qwen3:14b --tools core
```

Options: `--tools core|all` (core = the small tool set a first-time agent needs;
default all), `--task <id>`, `--max-turns 30`, `--api-key-env NAME` (read the key
from another variable), `--vision` (also send preview images to a multimodal
model), `--extra-body <json>` (merged into the request), `--replay <file>` (re-run a recorded transcript offline, no network).

Output: a row appended to `bench/agents/RESULTS.md` (scoring method is explained
at its top) and the full transcript in `bench/agents/runs/<time>-<model>.json`
(git-ignored). A model that writes its tool calls as plain text instead of using
function calling counts a failed turn each time; many of those means the model
or endpoint does not support tool calling.

Without a network: `npx vitest run bench/agents` replays two hand-written
transcripts (`bench/agents/replays/good.json`, `sloppy.json`) and asserts their
scores, and runs the chat loop against a mock server.
