# Testing agents with pixel-builder

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
