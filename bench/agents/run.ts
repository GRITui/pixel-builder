// Agent eval runner. See docs/agent-testing.md and bench/agents/RESULTS.md.
//   npx tsx bench/agents/run.ts --model qwen-max [--base-url URL] [--api-key-env NAME]
//        [--tools core|all] [--task id] [--max-turns 30] [--vision] [--replay file] [--extra-body JSON]
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { HERE, loadTasks, openAiChat, overallScore, replayFile, runTask, toOpenAiTools, toolsForProfile, type TaskScore, type TaskTranscript } from "./harness";

const FLAGS_WITH_VALUE = new Set(["model", "base-url", "api-key-env", "tools", "task", "max-turns", "replay", "extra-body"]);

function parseArgs(argv: string[]): Record<string, string | true> {
  const out: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) throw new Error(`Unexpected argument '${a}'`);
    const [k, inline] = a.slice(2).split(/=(.*)/s);
    if (!FLAGS_WITH_VALUE.has(k) && k !== "vision") throw new Error(`Unknown flag --${k}`);
    out[k] = FLAGS_WITH_VALUE.has(k) ? (inline ?? argv[++i] ?? (() => { throw new Error(`--${k} needs a value`); })()) : true;
  }
  return out;
}

const RESULTS_HEADER = `# Agent eval results

Does a given model drive pixel-builder well? \`bench/agents/run.ts\` gives it 7 briefs (see \`tasks.json\`), runs a tool-calling loop over the in-process tools in a fresh workspace per brief, and scores what is left in the workspace.

## Method

Per task, 0-100: **60%** machine checks passed (right assets, categories, counts, sizes, map, reference used, kit changed...), **10%** tool reliability (1 - (failed tool calls + turns where the tool call was written as text) / attempts), **30%** consistency: 0.4 x every sprite's palette indices valid for its kit, 0.3 x non-tile sprites have an outline ring (approximate: edge pixels darker than the interior), 0.3 x mean pairwise style agreement of the set (\`styleDistance\` components palette/shades/outline/light, 0-100). The overall score is the mean over the tasks run. Turns and tokens are reported, not scored. Runs are not deterministic; compare models on the same day with the same \`--tools\` and \`--max-turns\`.

Columns: \`style\` = mean pairwise style score over all tasks. \`errs\` = tool error rate. Per-task scores in brief order: forest-pack, farm-npcs, ui-kit, village-map, match-reference, paint-sign, retheme-kit. Full transcripts: \`bench/agents/runs/\` (git-ignored).

| Date | Model | Tools | Overall | Per task | Turns | Tokens | errs | style |
|---|---|---|---:|---|---:|---:|---:|---:|
`;

function appendResults(row: string): void {
  const file = join(HERE, "RESULTS.md");
  if (!existsSync(file)) writeFileSync(file, RESULTS_HEADER);
  appendFileSync(file, `${row}\n`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const tasks = loadTasks().filter((t) => !args.task || t.id === args.task);
  if (!tasks.length) throw new Error(`No task '${args.task}'. Tasks: ${loadTasks().map((t) => t.id).join(", ")}`);
  const maxTurns = Number(args["max-turns"] ?? 30);
  const profile = String(args.tools ?? "all");
  const tools = toolsForProfile(profile);

  let model: string;
  const results: { score: TaskScore; transcript: TaskTranscript }[] = [];
  if (args.replay) {
    const r = await replayFile(String(args.replay), tasks, { maxTurns, tools });
    model = `replay:${r.model}`;
    results.push(...r.results);
  } else {
    if (!args.model) throw new Error("--model is required (or --replay <file>)");
    model = String(args.model);
    const baseUrl = String(args["base-url"] ?? process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1");
    const keyEnv = String(args["api-key-env"] ?? "OPENAI_API_KEY");
    const apiKey = process.env[keyEnv];
    if (!apiKey && !/localhost|127\.0\.0\.1/.test(baseUrl)) throw new Error(`Set ${keyEnv} (or pass --api-key-env NAME); local servers such as Ollama need no key.`);
    const chat = openAiChat({ model, baseUrl, apiKey: apiKey ?? "none", tools: toOpenAiTools(tools), extraBody: args["extra-body"] ? JSON.parse(String(args["extra-body"])) : undefined });
    for (const task of tasks) {
      process.stdout.write(`${task.id} ... `);
      try {
        const r = await runTask(task, chat, { maxTurns, vision: !!args.vision, tools });
        results.push(r);
        console.log(`${r.score.score} (${r.score.turns} turns, ${r.score.toolErrors} tool errors)`);
      } catch (e) {
        console.log(`aborted: ${(e as Error).message}`);
        break;
      }
    }
  }

  for (const { score: s } of results) {
    console.log(`\n${s.id}: ${s.score}/100  checks ${Math.round(s.checkRate * 100)}%  turns ${s.turns}  tool errors ${s.toolErrors}/${s.toolCalls}  failed turns ${s.failedTurns}${s.finished ? "" : "  (hit max turns)"}`);
    for (const c of s.checks) console.log(`  ${c.pass ? "pass" : "FAIL"} ${c.id}: ${c.detail}`);
    const k = s.consistency;
    console.log(`  consistency: palette ${Math.round(k.paletteValid * 100)}%, outlined ${Math.round(k.outlined * 100)}%, style mean ${k.styleMean} (min ${k.styleMin}, spread ${k.styleSpread})`);
  }
  const scores = results.map((r) => r.score);
  const overall = overallScore(scores);
  console.log(`\nOverall: ${overall}/100 over ${scores.length} task(s)`);
  if (args.replay || !scores.length) return;

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const slug = model.replace(/[^a-zA-Z0-9._-]+/g, "-");
  const dir = join(HERE, "runs");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${stamp}-${slug}.json`);
  writeFileSync(file, JSON.stringify({ model, tools: profile, maxTurns, date: stamp, overall, tasks: results.map((r) => ({ id: r.score.id, score: r.score, messages: r.transcript.messages, toolCalls: r.transcript.toolCalls })) }, null, 2));
  const turns = scores.reduce((a, s) => a + s.turns, 0);
  const tokens = scores.some((s) => s.tokens !== undefined) ? String(scores.reduce((a, s) => a + (s.tokens ?? 0), 0)) : "n/a";
  const calls = scores.reduce((a, s) => a + s.toolCalls + s.failedTurns, 0);
  const errs = scores.reduce((a, s) => a + s.toolErrors + s.failedTurns, 0);
  const style = Math.round((scores.reduce((a, s) => a + s.consistency.styleMean, 0) / scores.length) * 10) / 10;
  appendResults(`| ${stamp.slice(0, 10)} | ${model} | ${profile} | ${overall} | ${scores.map((s) => s.score).join(" / ")} | ${turns} | ${tokens} | ${calls ? Math.round((100 * errs) / calls) : 0}% | ${style} |`);
  console.log(`Transcript: ${file}\nRow appended to bench/agents/RESULTS.md`);
}

main().catch((e) => {
  console.error(`error: ${(e as Error).message}`);
  process.exit(1);
});
