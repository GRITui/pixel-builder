// Agent eval harness: drives pixel-builder's in-process tools with an
// OpenAI-compatible tool-calling loop (or a recorded transcript) and scores
// the resulting workspace. No network code outside `openAiChat`.
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_KIT, resolveRamps } from "../../src/core/kit";
import { PALETTE_SIZE_ALL, flattenPalette, hexToRgb } from "../../src/core/palette";
import { styleDistance, type RefImage } from "../../src/core/refstyle";
import type { Asset, Sprite, StyleKit } from "../../src/core/types";
import { spriteImage } from "../../src/node/png";
import { loadReferenceImage } from "../../src/node/refs";
import * as toolsModule from "../../src/node/tools";
import { TOOLS, callToolAsync, inputJsonSchema, type ToolDef, type ToolResult } from "../../src/node/tools";
import { Workspace, kitOf } from "../../src/node/workspace";

export const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = join(HERE, "..", "..");

// ---------- tasks ----------

export interface Check {
  id: string;
  type: string;
  [k: string]: unknown;
}
export interface Task {
  id: string;
  title: string;
  prompt: string;
  setup?: { tool: string; input: unknown }[];
  checks: Check[];
}

export function loadTasks(file = join(HERE, "tasks.json")): Task[] {
  return JSON.parse(readFileSync(file, "utf8")).tasks as Task[];
}

export const taskPrompt = (t: Task) => t.prompt.replaceAll("{fixtures}", join(HERE, "fixtures"));

// ---------- tools as OpenAI functions ----------

/** The small set a first-time agent actually needs; used when TOOLS has no profile support of its own. */
const LOCAL_CORE_TOOLS = [
  "get_style_guide", "list_generators", "generate_asset", "generate_variations", "generate_pack", "paint_asset", "edit_asset",
  "list_assets", "get_asset", "delete_asset", "list_kits", "create_kit", "update_kit", "set_active_kit", "rerender_assets",
  "add_reference", "list_references", "kit_from_reference", "compare_to_reference",
];

export function toolsForProfile(profile: string): ToolDef[] {
  if (profile === "all") return TOOLS;
  if (profile !== "core") throw new Error(`--tools must be 'core' or 'all', got '${profile}'`);
  // Prefer a profile exported by src/node/tools.ts if another lane adds one.
  const m = toolsModule as unknown as Record<string, unknown>;
  const names = [m.CORE_TOOLS, m.CORE_TOOL_NAMES, m.coreToolNames].find((v) => Array.isArray(v)) as unknown[] | undefined;
  const wanted = new Set((names ?? LOCAL_CORE_TOOLS).map((n) => (typeof n === "string" ? n : (n as ToolDef).name)));
  return TOOLS.filter((t) => wanted.has(t.name));
}

export interface OpenAiTool {
  type: "function";
  function: { name: string; description: string; parameters: unknown };
}

export function toOpenAiTools(tools: ToolDef[]): OpenAiTool[] {
  return tools.map((t) => {
    const schema = inputJsonSchema(t) as Record<string, unknown>;
    delete schema.$schema;
    return { type: "function", function: { name: t.name, description: t.description, parameters: { type: "object", ...schema } } };
  });
}

// ---------- chat transport ----------

export interface ToolCall {
  id?: string;
  type?: "function";
  function: { name: string; arguments: string };
}
export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | null | unknown[];
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}
export interface Usage {
  prompt_tokens?: number;
  completion_tokens?: number;
}
export type ChatFn = (messages: ChatMessage[]) => Promise<{ message: ChatMessage; usage?: Usage }>;

export interface ApiOptions {
  model: string;
  baseUrl: string;
  apiKey: string;
  tools: OpenAiTool[];
  temperature?: number;
  /** Extra JSON merged into the request body (provider switches such as DashScope enable_thinking). */
  extraBody?: Record<string, unknown>;
}

export function openAiChat(o: ApiOptions): ChatFn {
  return async (messages) => {
    const body = JSON.stringify({ model: o.model, messages, tools: o.tools, tool_choice: "auto", temperature: o.temperature ?? 0.2, ...o.extraBody });
    let lastErr = "";
    for (let attempt = 0; attempt < 4; attempt++) {
      if (attempt) await new Promise((r) => setTimeout(r, 1500 * 2 ** attempt));
      let res: Response;
      try {
        res = await fetch(`${o.baseUrl.replace(/\/$/, "")}/chat/completions`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${o.apiKey}` },
          body,
        });
      } catch (e) {
        lastErr = (e as Error).message;
        continue;
      }
      if (res.status === 429 || res.status >= 500) {
        lastErr = `HTTP ${res.status}`;
        continue;
      }
      const json = (await res.json().catch(() => ({}))) as { choices?: { message?: ChatMessage }[]; usage?: Usage; error?: { message?: string } };
      if (!res.ok || !json.choices?.[0]?.message) throw new Error(`Chat API error (HTTP ${res.status}): ${json.error?.message ?? JSON.stringify(json).slice(0, 300)}`);
      return { message: json.choices[0].message, usage: json.usage };
    }
    throw new Error(`Chat API unreachable after retries: ${lastErr}`);
  };
}

/** Replays the assistant messages of a recorded transcript in order; no network. */
export function replayChat(recorded: ChatMessage[]): ChatFn {
  const assistant = recorded.filter((m) => m.role === "assistant");
  let i = 0;
  return async () => ({ message: assistant[i++] ?? { role: "assistant", content: "Done." } });
}

export const stripThink = (s: string) => s.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/^[\s\S]*?<\/think>/i, "").trim();

/** A model that wrote its tool call as text instead of using the function-calling channel. */
const TEXT_TOOL_CALL = /<tool_call>|<function=|<\|tool|"(?:name|tool)"\s*:\s*"[a-z_]+"\s*,\s*"(?:arguments|input|parameters)"|^\s*```(?:json)?\s*\{\s*"(?:name|tool)"/im;

// ---------- the loop ----------

export interface ToolRecord {
  name: string;
  args: unknown;
  ok: boolean;
  error?: string;
}
export interface TaskTranscript {
  id: string;
  messages: ChatMessage[];
  toolCalls: ToolRecord[];
  turns: number;
  failedTurns: number;
  finished: boolean;
  usage: { prompt: number; completion: number; reported: boolean };
}

export function resultText(r: ToolResult, vision: boolean): string {
  let t = r.text ?? JSON.stringify(r.data);
  if (t.length > 8000) t = `${t.slice(0, 8000)}\n...[truncated ${t.length - 8000} chars]`;
  if (r.images?.length && !vision) t += `\n[${r.images.length} preview image(s) not shown to this text-only run (${r.images.map((i) => i.label).join(", ")}); the exported file paths are listed above.]`;
  return t;
}

export interface LoopOptions {
  system: string;
  maxTurns: number;
  vision?: boolean;
  tools: ToolDef[];
}

export async function runLoop(chat: ChatFn, ws: Workspace, task: Task, o: LoopOptions): Promise<TaskTranscript> {
  const allowed = new Set(o.tools.map((t) => t.name));
  const messages: ChatMessage[] = [{ role: "system", content: o.system }, { role: "user", content: taskPrompt(task) }];
  const tr: TaskTranscript = { id: task.id, messages, toolCalls: [], turns: 0, failedTurns: 0, finished: false, usage: { prompt: 0, completion: 0, reported: false } };
  let n = 0;
  while (tr.turns < o.maxTurns) {
    tr.turns++;
    const { message, usage } = await chat(messages);
    if (usage) {
      tr.usage.reported = true;
      tr.usage.prompt += usage.prompt_tokens ?? 0;
      tr.usage.completion += usage.completion_tokens ?? 0;
    }
    const content = typeof message.content === "string" ? stripThink(message.content) : "";
    const calls = (message.tool_calls ?? []).map((c) => ({ ...c, id: c.id ?? `call_${++n}`, type: "function" as const }));
    messages.push({ role: "assistant", content, ...(calls.length ? { tool_calls: calls } : {}) });
    if (!calls.length) {
      if (TEXT_TOOL_CALL.test(message.content as string ?? "")) {
        tr.failedTurns++;
        messages.push({ role: "user", content: "That looks like a tool call written as text. It was not executed. Use the function-calling interface to call tools." });
        continue;
      }
      tr.finished = true;
      break;
    }
    const images: string[] = [];
    for (const c of calls) {
      const name = c.function.name;
      let args: unknown, text: string;
      const rec: ToolRecord = { name, args: undefined, ok: true };
      try {
        args = c.function.arguments?.trim() ? JSON.parse(c.function.arguments) : {};
        rec.args = args;
        if (!allowed.has(name)) throw new Error(`Unknown tool '${name}'. Tools: ${[...allowed].join(", ")}`);
        const r = await callToolAsync(ws, name, args);
        text = resultText(r, !!o.vision);
        if (o.vision) for (const im of r.images ?? []) images.push(`data:image/png;base64,${im.png.toString("base64")}`);
      } catch (e) {
        rec.ok = false;
        rec.error = e instanceof SyntaxError ? `Tool arguments are not valid JSON: ${e.message}` : (e as Error).message;
        text = `Error: ${rec.error}`;
      }
      tr.toolCalls.push(rec);
      messages.push({ role: "tool", tool_call_id: c.id, content: text });
    }
    if (images.length) messages.push({ role: "user", content: [{ type: "text", text: "Preview images from the last tool calls:" }, ...images.map((url) => ({ type: "image_url", image_url: { url } }))] });
  }
  return tr;
}

// ---------- scoring ----------

export interface CheckResult {
  id: string;
  pass: boolean;
  detail: string;
}
export interface Consistency {
  assets: number;
  paletteValid: number;
  outlined: number;
  /** Mean pairwise style agreement (palette, shades, outline, light) 0..100; 100 when fewer than two sprites. */
  styleMean: number;
  styleMin: number;
  /** max - min of the pairwise style scores. */
  styleSpread: number;
}
export interface TaskScore {
  id: string;
  score: number;
  checks: CheckResult[];
  checkRate: number;
  turns: number;
  toolCalls: number;
  toolErrors: number;
  failedTurns: number;
  errorRate: number;
  tokens?: number;
  finished: boolean;
  consistency: Consistency;
}

const hay = (a: Asset) => {
  const p = (a.source.params ?? {}) as Record<string, unknown>;
  return [a.source.generator, p.kind, p.species, p.style, a.name, ...a.tags].filter(Boolean).join(" ").toLowerCase();
};
const isTile = (a: Asset) => /tile/.test(`${a.source.generator ?? ""} ${(a.source.params as Record<string, unknown> | undefined)?.kind ?? ""}`.toLowerCase()) || (a.category === "environment" && /(^|[^a-z])tile($|[^a-z])|grass tile/.test(a.name.toLowerCase()) && a.rows[0].frames[0].w === a.rows[0].frames[0].h);
const sprite0 = (a: Asset): Sprite => a.rows[0].frames[0];
const opaqueCount = (s: Sprite) => s.data.reduce((n, v) => n + (v > 0 ? 1 : 0), 0);

function matches(a: Asset, m: { category?: string; re?: string; source?: string }, excluding?: string): boolean {
  if (m.category && a.category !== m.category) return false;
  if (m.source && a.source.kind !== m.source) return false;
  if (m.re && !new RegExp(m.re, "i").test(hay(a))) return false;
  if (excluding && new RegExp(excluding, "i").test(hay(a))) return false;
  return true;
}

/** Palette validity of every sprite (all frames, tile sets included) against the asset's kit. */
function paletteValid(a: Asset, kit: StyleKit): boolean {
  const pal = flattenPalette(resolveRamps(kit));
  const size = Math.min(PALETTE_SIZE_ALL, pal.length);
  const sprites = [...a.rows.flatMap((r) => r.frames), ...(a.tilemap?.tiles.map((t) => t.sprite) ?? [])];
  return sprites.every((s) => s.data.length === s.w * s.h && s.data.every((v) => Number.isInteger(v) && v >= 0 && v < size && (v === 0 || pal[v] != null)));
}

const lum = (hex: string) => {
  const [r, g, b] = hexToRgb(hex);
  return 0.299 * r + 0.587 * g + 0.114 * b;
};

/** Approximate finalize check: the silhouette's edge pixels are darker, on average, than the interior. */
function hasOutlineRing(s: Sprite, kit: StyleKit): boolean {
  if (kit.outline === "none") return true;
  const pal = flattenPalette(resolveRamps(kit));
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= s.w || y >= s.h ? 0 : s.data[y * s.w + x]);
  let edge = 0, edgeN = 0, inner = 0, innerN = 0;
  for (let y = 0; y < s.h; y++)
    for (let x = 0; x < s.w; x++) {
      const v = at(x, y);
      if (v <= 0 || !pal[v]) continue;
      const border = !at(x + 1, y) || !at(x - 1, y) || !at(x, y + 1) || !at(x, y - 1);
      if (border) { edge += lum(pal[v]!); edgeN++; } else { inner += lum(pal[v]!); innerN++; }
    }
  if (!edgeN) return false;
  return innerN === 0 || edge / edgeN < inner / innerN;
}

const toRef = (img: { width: number; height: number; rgba: Uint8Array }): RefImage => ({ w: img.width, h: img.height, data: img.rgba });
const STYLE_W = { palette: 0.5, shades: 0.15, outline: 0.2, light: 0.15 };

function consistency(ws: Workspace, assets: Asset[]): Consistency {
  const project = ws.load();
  const flat = assets.filter((a) => a.category !== "map");
  const pv = assets.filter((a) => paletteValid(a, kitOf(project, a))).length;
  const outlinable = flat.filter((a) => !isTile(a) && a.meta?.outline !== false);
  const ol = outlinable.filter((a) => hasOutlineRing(sprite0(a), kitOf(project, a))).length;
  const imgs = flat.slice(0, 10).map((a) => toRef(spriteImage(sprite0(a), kitOf(project, a), 1)));
  const scores: number[] = [];
  for (let i = 0; i < imgs.length; i++)
    for (let j = i + 1; j < imgs.length; j++) {
      const c = styleDistance(imgs[i], imgs[j]).components;
      scores.push(100 * (c.palette * STYLE_W.palette + c.shades * STYLE_W.shades + c.outline * STYLE_W.outline + c.light * STYLE_W.light));
    }
  const r1 = (n: number) => Math.round(n * 10) / 10;
  return {
    assets: assets.length,
    paletteValid: assets.length ? pv / assets.length : 0,
    outlined: outlinable.length ? ol / outlinable.length : 1,
    styleMean: scores.length ? r1(scores.reduce((a, b) => a + b, 0) / scores.length) : 100,
    styleMin: scores.length ? r1(Math.min(...scores)) : 100,
    styleSpread: scores.length ? r1(Math.max(...scores) - Math.min(...scores)) : 0,
  };
}

function runCheck(c: Check, ws: Workspace, tr: TaskTranscript): CheckResult {
  const project = ws.load();
  const assets = project.assets;
  const ok = (pass: boolean, detail: string): CheckResult => ({ id: c.id, pass, detail });
  const n = (k: string, d = 0) => (typeof c[k] === "number" ? (c[k] as number) : d);
  switch (c.type) {
    case "count": {
      const found = assets.filter((a) => matches(a, (c.match ?? {}) as never, c.excluding as string | undefined));
      return ok(found.length >= n("min", 1), `${found.length} matching asset(s), need ${n("min", 1)}${found.length ? `: ${found.map((a) => a.name).join(", ")}` : ""}`);
    }
    case "distinctParams": {
      const chars = assets.filter((a) => a.category === c.category);
      const keys = new Set(chars.map((a) => (a.source.kind === "procedural" ? JSON.stringify(a.source.params) : a.id)));
      return ok(keys.size >= n("min", 1), `${keys.size} distinct look(s) among ${chars.length} ${c.category} asset(s), need ${n("min", 1)}`);
    }
    case "sizesMatchKit": {
      const bad: string[] = [];
      let checked = 0;
      for (const a of assets) {
        if (a.category === "map" || /iso/.test(a.source.generator ?? "")) continue;
        const kit = kitOf(project, a);
        const s = sprite0(a);
        checked++;
        if (isTile(a)) {
          if (s.w !== kit.sizes.tile || s.h !== kit.sizes.tile) bad.push(`${a.name} ${s.w}x${s.h} (tile ${kit.sizes.tile})`);
        } else {
          const want = kit.sizes[a.category as "character"], big = Math.max(s.w, s.h), small = Math.min(s.w, s.h);
          if (big < want / 2 || small > want * 4) bad.push(`${a.name} ${s.w}x${s.h} (${a.category} ${want})`);
        }
      }
      return ok(checked > 0 && !bad.length, checked ? (bad.length ? `off-size: ${bad.join("; ")}` : `${checked} sprite(s) fit the kit sizes`) : "no sprite assets to check");
    }
    case "map": {
      const m = assets.find((a) => a.tilemap);
      if (!m?.tilemap) return ok(false, "no map asset");
      const t = m.tilemap;
      const cover = t.ground.filter((g) => g >= 0).length / Math.max(1, t.ground.length);
      return ok(t.cols >= n("minCols") && t.rows >= n("minRows") && cover >= n("minGroundCoverage"), `${m.name}: ${t.cols}x${t.rows} tiles, ground ${Math.round(cover * 100)}% filled`);
    }
    case "mapDeco": {
      const m = assets.find((a) => a.tilemap)?.tilemap;
      const deco = m ? m.deco.filter((d) => d >= 0).length : 0;
      return ok(deco >= n("min"), `${deco} decoration cell(s), need ${n("min")}`);
    }
    case "reference": {
      const k = project.references?.length ?? 0;
      return ok(k >= n("min", 1), `${k} reference(s) in the library`);
    }
    case "fromReference": {
      const a = assets.find((x) => x.meta?.referenceId);
      return ok(!!a, a ? `${a.name} generated from reference ${String(a.meta?.referenceId)}` : "no asset was generated with reference_id");
    }
    case "styleVsReference": {
      let best = -1, name = "";
      for (const a of assets.filter((x) => x.meta?.referenceId)) {
        try {
          const ref = loadReferenceImage(ws, String(a.meta!.referenceId));
          const sc = styleDistance(toRef(spriteImage(sprite0(a), kitOf(project, a), 1)), ref).score;
          if (sc > best) { best = sc; name = a.name; }
        } catch { /* reference file missing: stays unscored */ }
      }
      return ok(best >= n("min"), best < 0 ? "no asset to compare against a reference" : `${name} style score ${best} vs reference, need ${n("min")}`);
    }
    case "paintedNotEmpty": {
      const a = assets.filter((x) => x.source.kind === "ai-pixels").map((x) => opaqueCount(sprite0(x)));
      return ok(a.some((v) => v >= n("minOpaque")), `painted assets have ${a.join(", ") || "no"} opaque pixel(s), need ${n("minOpaque")}`);
    }
    case "kitChanged": {
      const a = assets[0];
      if (!a) return ok(false, "no assets");
      const kit = kitOf(project, a);
      const rampKeys = Object.keys(kit.rampOverrides ?? {}).length;
      const pass = kit.vibe !== DEFAULT_KIT.vibe && (kit.paletteId !== DEFAULT_KIT.paletteId || rampKeys > 0 || kit.ambient !== DEFAULT_KIT.ambient);
      return ok(pass, `assets use kit '${kit.id}': vibe ${kit.vibe !== DEFAULT_KIT.vibe ? "changed" : "unchanged"}, palette ${kit.paletteId}${rampKeys ? ` + ${rampKeys} ramp override(s)` : ""}`);
    }
    case "noStale": {
      const stale = assets.filter((a) => {
        const k = project.kits.find((x) => x.id === a.kitId);
        return !!k && (a.kitVersion ?? 1) < (k.version ?? 1);
      });
      return ok(assets.length > 0 && !stale.length, stale.length ? `stale: ${stale.map((a) => a.name).join(", ")}` : "every asset is on its kit's current version");
    }
    case "toolUsed": {
      const used = tr.toolCalls.filter((t) => t.name === c.name && t.ok).length;
      return ok(used > 0, `${c.name} succeeded ${used} time(s)`);
    }
    default:
      return ok(false, `unknown check type '${c.type}'`);
  }
}

export function scoreTask(task: Task, ws: Workspace, tr: TaskTranscript): TaskScore {
  const checks = task.checks.map((c) => {
    try {
      return runCheck(c, ws, tr);
    } catch (e) {
      return { id: c.id, pass: false, detail: `check crashed: ${(e as Error).message}` };
    }
  });
  const checkRate = checks.filter((c) => c.pass).length / Math.max(1, checks.length);
  const toolErrors = tr.toolCalls.filter((t) => !t.ok).length;
  const attempts = tr.toolCalls.length + tr.failedTurns;
  const errorRate = attempts ? (toolErrors + tr.failedTurns) / attempts : 0;
  let cons: Consistency;
  try {
    cons = consistency(ws, ws.load().assets);
  } catch {
    cons = { assets: 0, paletteValid: 0, outlined: 0, styleMean: 0, styleMin: 0, styleSpread: 0 };
  }
  const consScore = cons.assets ? 0.4 * cons.paletteValid + 0.3 * cons.outlined + 0.3 * (cons.styleMean / 100) : 0;
  const score = Math.round(100 * (0.6 * checkRate + 0.1 * (1 - errorRate) + 0.3 * consScore));
  return {
    id: task.id, score, checks, checkRate: Math.round(checkRate * 100) / 100, turns: tr.turns, toolCalls: tr.toolCalls.length, toolErrors,
    failedTurns: tr.failedTurns, errorRate: Math.round(errorRate * 100) / 100, ...(tr.usage.reported ? { tokens: tr.usage.prompt + tr.usage.completion } : {}),
    finished: tr.finished, consistency: cons,
  };
}

export const overallScore = (s: TaskScore[]) => (s.length ? Math.round(s.reduce((a, b) => a + b.score, 0) / s.length) : 0);

// ---------- one task end to end ----------

export function systemPrompt(): string {
  const skill = readFileSync(join(REPO, "skills", "pixel-builder", "SKILL.md"), "utf8").replace(/^---[\s\S]*?---\s*/, "");
  return `You are making pixel art for the user with the pixel-builder tools (call them through function calling). When the task is done, reply with a short summary and stop.\n\n${skill}`;
}

export async function runTask(task: Task, chat: ChatFn, o: { maxTurns: number; vision?: boolean; tools: ToolDef[]; system?: string }): Promise<{ score: TaskScore; transcript: TaskTranscript }> {
  const dir = mkdtempSync(join(tmpdir(), `pb-agent-${task.id}-`));
  try {
    const ws = new Workspace(join(dir, "ws"));
    for (const s of task.setup ?? []) await callToolAsync(ws, s.tool, s.input);
    const transcript = await runLoop(chat, ws, task, { system: o.system ?? systemPrompt(), maxTurns: o.maxTurns, vision: o.vision, tools: o.tools });
    return { score: scoreTask(task, ws, transcript), transcript };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export interface RecordedRun {
  model: string;
  tasks: { id: string; messages: ChatMessage[] }[];
}

export const loadRecorded = (file: string): RecordedRun => {
  if (!existsSync(file)) throw new Error(`Replay file not found: ${file}`);
  return JSON.parse(readFileSync(file, "utf8")) as RecordedRun;
};

export async function replayFile(file: string, tasks: Task[], o: { maxTurns?: number; tools?: ToolDef[] } = {}) {
  const rec = loadRecorded(file);
  const out: { score: TaskScore; transcript: TaskTranscript }[] = [];
  for (const r of rec.tasks) {
    const task = tasks.find((t) => t.id === r.id);
    if (!task) continue;
    out.push(await runTask(task, replayChat(r.messages), { maxTurns: o.maxTurns ?? 30, tools: o.tools ?? TOOLS, system: "(replay)" }));
  }
  return { model: rec.model, results: out };
}
