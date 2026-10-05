import { createServer, type Server } from "node:http";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TOOLS } from "../../src/node/tools";
import { HERE, loadTasks, openAiChat, overallScore, replayFile, runTask, stripThink, toOpenAiTools, toolsForProfile } from "./harness";

const tasks = loadTasks();
const replay = (name: string) => replayFile(join(HERE, "replays", `${name}.json`), tasks);

describe("agent eval harness", () => {
  it("defines the 7 briefs with checks", () => {
    expect(tasks.map((t) => t.id)).toEqual(["forest-pack", "farm-npcs", "ui-kit", "village-map", "match-reference", "paint-sign", "retheme-kit"]);
    for (const t of tasks) expect(t.checks.length).toBeGreaterThan(0);
  });

  it("converts every tool to an OpenAI function and filters the core profile", () => {
    const fns = toOpenAiTools(TOOLS);
    expect(fns).toHaveLength(TOOLS.length);
    const gen = fns.find((f) => f.function.name === "generate_asset")!;
    expect(gen.function.parameters).toMatchObject({ type: "object", properties: { generator: expect.any(Object) } });
    const core = toolsForProfile("core").map((t) => t.name);
    expect(core).toContain("generate_asset");
    expect(core.length).toBeLessThan(TOOLS.length);
    expect(() => toolsForProfile("nope")).toThrow();
  });

  it("strips <think> blocks", () => {
    expect(stripThink("<think>hmm\nlong</think>Done.")).toBe("Done.");
    expect(stripThink("reasoning without opener</think>Done.")).toBe("Done.");
  });

  it("scores a good recorded run high on every task", async () => {
    const { results } = await replay("good");
    expect(results).toHaveLength(7);
    for (const { score } of results) {
      const failed = score.checks.filter((c) => !c.pass).map((c) => `${c.id}: ${c.detail}`);
      expect(failed, score.id).toEqual([]);
      expect(score.toolErrors).toBe(0);
      expect(score.consistency.paletteValid).toBe(1);
      expect(score.consistency.outlined).toBe(1);
      expect(score.score, score.id).toBeGreaterThanOrEqual(85);
    }
    expect(overallScore(results.map((r) => r.score))).toBeGreaterThanOrEqual(90);
  }, 180_000);

  it("scores a sloppy run low and counts its failures", async () => {
    const { results } = await replay("sloppy");
    const by = Object.fromEntries(results.map((r) => [r.score.id, r.score]));
    expect(by["forest-pack"].toolErrors).toBe(1);
    expect(by["forest-pack"].checks.filter((c) => !c.pass).map((c) => c.id)).toEqual(["trees", "rock", "grass-tile"]);
    expect(by["ui-kit"].failedTurns).toBe(1);
    expect(by["ui-kit"].checkRate).toBeLessThan(0.6);
    expect(by["paint-sign"].checks.find((c) => c.id === "not-empty")!.pass).toBe(false);
    const good = overallScore((await replay("good")).results.map((r) => r.score));
    const sloppyOverall = overallScore(results.map((r) => r.score));
    expect(sloppyOverall).toBeLessThan(75);
    expect(good - sloppyOverall).toBeGreaterThan(20);
  }, 180_000);
});

describe("chat loop against a mock OpenAI server", () => {
  let server: Server;
  let url = "";
  const seen: { n: number; sawToolResult: boolean } = { n: 0, sawToolResult: false };

  beforeAll(async () => {
    server = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        const { messages, tools } = JSON.parse(body);
        expect(tools.length).toBeGreaterThan(5);
        seen.n++;
        seen.sawToolResult ||= messages.some((m: { role: string }) => m.role === "tool");
        const tc = (name: string, args: unknown) => ({ id: `t${seen.n}`, type: "function", function: { name, arguments: JSON.stringify(args) } });
        const reply = (message: unknown) => res.setHeader("content-type", "application/json").end(JSON.stringify({ choices: [{ message }], usage: { prompt_tokens: 100, completion_tokens: 10 } }));
        if (seen.n === 1) return reply({ role: "assistant", content: "<think>plan</think>", tool_calls: [tc("generate_asset", { generator: "ui", params: { kind: "button" } })] });
        if (seen.n === 2) return reply({ role: "assistant", content: '<tool_call>{"name":"generate_asset","arguments":{}}</tool_call>' });
        reply({ role: "assistant", content: "<think>x</think>All done." });
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it("runs tool calls, flags text tool calls as failed turns, and reports tokens", async () => {
    const tools = TOOLS;
    const chat = openAiChat({ model: "mock", baseUrl: url, apiKey: "k", tools: toOpenAiTools(tools) });
    const task = tasks.find((t) => t.id === "ui-kit")!;
    const { score, transcript } = await runTask(task, chat, { maxTurns: 6, tools, system: "test" });
    expect(seen.sawToolResult).toBe(true);
    expect(transcript.toolCalls).toHaveLength(1);
    expect(score.failedTurns).toBe(1);
    expect(score.turns).toBe(3);
    expect(score.finished).toBe(true);
    expect(score.tokens).toBe(330);
    expect(transcript.messages.at(-1)).toMatchObject({ role: "assistant", content: "All done." });
  }, 60_000);
});
