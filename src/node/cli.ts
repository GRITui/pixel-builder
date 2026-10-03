// CLI adapter over the tool layer. Commands are the tool names in kebab-case
// (`generate-asset`, `paint-asset`, ...), flags are the input names in kebab-case.
//   pixel-builder <command> [<arg>] [--flag value ...] [--json] [--workspace dir]
//   pixel-builder mcp [--http] [--port 8788]
import { mkdirSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_HTTP_PORT, VERSION, startHttp, startStdio } from "./mcp";
import { TOOLS, ToolError, callTool, inputJsonSchema, nearest, type ToolDef, type ToolResult } from "./tools";
import { DEFAULT_WORKSPACE, Workspace, atomicWrite, slugify } from "./workspace";

class UsageError extends Error {}

const kebab = (s: string) => s.replace(/_/g, "-");
const snake = (s: string) => s.replace(/-/g, "_");
const firstSentence = (s: string) => {
  const safe = s.replace(/\b(e\.g|i\.e)\./g, "$1\u0000");
  const sentence = (safe.match(/^.*?[.!?](\s|$)/)?.[0] ?? safe).trim().replace(/\u0000/g, ".");
  return sentence.length > 90 ? sentence.slice(0, sentence.lastIndexOf(" ", 87)) + "..." : sentence;
};

// ---------- schema-driven flag coercion ----------

type Prop = { type?: string; anyOf?: Prop[]; enum?: unknown[]; items?: Prop; description?: string; default?: unknown };

function propType(p: Prop): string {
  if (p.type) return p.type;
  if (p.anyOf) return "union";
  return "string";
}

function inferScalar(v: string): string | number | boolean {
  if (v === "true") return true;
  if (v === "false") return false;
  return v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : v;
}

function readValue(raw: string): string {
  if (!raw.startsWith("@")) return raw;
  const file = raw.slice(1);
  try {
    return readFileSync(file, "utf8");
  } catch (e) {
    throw new UsageError(`Cannot read '${file}': ${(e as Error).message}`);
  }
}

function parseJson(flag: string, text: string): unknown {
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new UsageError(`--${kebab(flag)} expects JSON (or @file.json): ${(e as Error).message}`);
  }
}

function coerce(key: string, prop: Prop, raws: string[]): unknown {
  const type = propType(prop);
  const last = raws[raws.length - 1];
  if (type === "number" || type === "integer") {
    const n = Number(last);
    if (last.trim() === "" || !Number.isFinite(n)) throw new UsageError(`--${kebab(key)} expects a number, got '${last}'`);
    return n;
  }
  if (type === "array") {
    const item = prop.items ? propType(prop.items) : "string";
    const jsonOnly = item === "array" || item === "object";
    if (raws.length === 1 && (raws[0].startsWith("[") || raws[0].startsWith("@"))) return parseJson(key, readValue(raws[0]));
    if (jsonOnly) throw new UsageError(`--${kebab(key)} expects a JSON array (or @file.json)`);
    const parts = raws.flatMap((r) => r.split(",")).map((s) => s.trim()).filter(Boolean);
    return item === "number" || item === "integer" ? parts.map(Number) : parts;
  }
  if (type === "object") {
    if (last.startsWith("{") || last.startsWith("@")) return parseJson(key, readValue(last));
    const out: Record<string, unknown> = {};
    for (const pair of raws.flatMap((r) => r.split(","))) {
      const i = pair.indexOf("=");
      if (i < 1) throw new UsageError(`--${kebab(key)} expects JSON or key=value pairs (e.g. kind=oak,roof=wood), got '${pair}'`);
      out[pair.slice(0, i).trim()] = inferScalar(pair.slice(i + 1).trim());
    }
    return out;
  }
  return last;
}

interface Parsed {
  positionals: string[];
  values: Map<string, string[]>;
  bools: Map<string, boolean>;
  json: boolean;
  help: boolean;
  workspace?: string;
  input?: string;
}

function parseArgs(tokens: string[], props: Record<string, Prop>, label: string): Parsed {
  const out: Parsed = { positionals: [], values: new Map(), bools: new Map(), json: false, help: false };
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok === "--") {
      out.positionals.push(...tokens.slice(i + 1));
      break;
    }
    if (tok === "-h") { out.help = true; continue; }
    if (tok === "-w") {
      if (i + 1 >= tokens.length) throw new UsageError("-w needs a directory");
      out.workspace = tokens[++i];
      continue;
    }
    if (!tok.startsWith("--")) {
      out.positionals.push(tok);
      continue;
    }
    const eq = tok.indexOf("=");
    const name = tok.slice(2, eq < 0 ? undefined : eq);
    const inline = eq < 0 ? undefined : tok.slice(eq + 1);
    if (name === "json") { out.json = inline !== "false"; continue; }
    if (name === "help") { out.help = true; continue; }
    const takeValue = (flag: string) => {
      if (inline !== undefined) return inline;
      if (i + 1 >= tokens.length) throw new UsageError(`--${flag} needs a value`);
      return tokens[++i];
    };
    if (name === "workspace") { out.workspace = takeValue(name); continue; }
    if (name === "input") { out.input = takeValue(name); continue; }
    let key = snake(name);
    let negate = false;
    if (!(key in props) && key.startsWith("no_") && propType(props[key.slice(3)] ?? {}) === "boolean" && key.slice(3) in props) {
      key = key.slice(3);
      negate = true;
    }
    const prop = props[key];
    if (!prop) {
      const near = nearest(key, Object.keys(props), 2).map((k) => `--${kebab(k)}`);
      throw new UsageError(`Unknown option --${name} for ${label}.` + (near.length ? ` Did you mean ${near.join(" or ")}?` : "") + ` Run \`pixel-builder ${label} --help\`.`);
    }
    if (propType(prop) === "boolean") {
      let v = !negate;
      if (inline !== undefined) v = inline === "true" ? !negate : inline === "false" ? negate : (() => { throw new UsageError(`--${name} is a flag (true/false), got '${inline}'`); })();
      else if (tokens[i + 1] === "true" || tokens[i + 1] === "false") v = tokens[++i] === "true" ? !negate : negate;
      out.bools.set(key, v);
    } else {
      const list = out.values.get(key) ?? [];
      list.push(takeValue(name));
      out.values.set(key, list);
    }
  }
  return out;
}

function buildInput(tool: ToolDef, parsed: Parsed): Record<string, unknown> {
  const schema = inputJsonSchema(tool);
  const props = (schema.properties ?? {}) as Record<string, Prop>;
  let input: Record<string, unknown> = {};
  if (parsed.input !== undefined) {
    const base = parseJson("input", readValue(parsed.input));
    if (!base || typeof base !== "object" || Array.isArray(base)) throw new UsageError("--input must be a JSON object");
    input = { ...(base as Record<string, unknown>) };
  }
  for (const [k, raws] of parsed.values) input[k] = coerce(k, props[k], raws);
  for (const [k, v] of parsed.bools) input[k] = v;
  const [first, ...extra] = parsed.positionals;
  if (extra.length) throw new UsageError(`Unexpected argument '${extra[0]}' for ${kebab(tool.name)}. Run \`pixel-builder ${kebab(tool.name)} --help\`.`);
  if (first !== undefined) {
    if (!tool.positional) throw new UsageError(`${kebab(tool.name)} takes no positional argument (got '${first}'). Run \`pixel-builder ${kebab(tool.name)} --help\`.`);
    if (!(tool.positional in input)) input[tool.positional] = coerce(tool.positional, props[tool.positional], [first]);
  }
  return input;
}

// ---------- help ----------

function typeLabel(p: Prop): string {
  if (p.enum) return `<${p.enum.join("|")}>`;
  switch (propType(p)) {
    case "number": return "<n>";
    case "integer": return "<int>";
    case "boolean": return "";
    case "array": return p.items && ["array", "object"].includes(propType(p.items)) ? "<json|@file>" : "<a,b,...>";
    case "object": return "<json|k=v,...>";
    case "union": return "<value>";
    default: return "<text>";
  }
}

function usageLine(tool: ToolDef): string {
  const required = (inputJsonSchema(tool).required ?? []).filter((k) => k !== tool.positional);
  const pos = tool.positional ? `<${tool.positional}> ` : "";
  return `pixel-builder ${kebab(tool.name)} ${pos}[options]${required.length ? `   (also required: ${required.map((k) => `--${kebab(k)}`).join(", ")})` : ""}`;
}

function toolHelp(tool: ToolDef): string {
  const schema = inputJsonSchema(tool);
  const props = (schema.properties ?? {}) as Record<string, Prop>;
  const required = new Set(schema.required ?? []);
  const rows = Object.entries(props).map(([k, p]) => {
    const flag = `${p.default === true ? "--no-" : "--"}${kebab(k)} ${typeLabel(p)}`.trim();
    const bits = [p.description ?? "", required.has(k) ? "(required)" : "", p.default !== undefined ? `(default ${JSON.stringify(p.default)})` : ""].filter(Boolean);
    return [flag, bits.join(" ")] as const;
  });
  const w = Math.max(0, ...rows.map((r) => r[0].length)) + 2;
  return [
    `pixel-builder ${kebab(tool.name)} - ${tool.title}`,
    "",
    tool.description,
    "",
    `Usage: ${usageLine(tool)}`,
    "",
    rows.length ? "Options:" : "Options: (none)",
    ...rows.map(([f, d]) => `  ${f.padEnd(w)}${d}`),
    "",
    "Common options:",
    `  ${"--json".padEnd(w)}Print machine-readable JSON (also lists saved preview image paths).`,
    `  ${"--workspace <dir>".padEnd(w)}Workspace folder (default: $PIXEL_BUILDER_WORKSPACE or ./${DEFAULT_WORKSPACE}).`,
    `  ${"--input <json|@file>".padEnd(w)}Whole input as one JSON object; explicit flags override it.`,
    "",
    "Values: arrays and objects take JSON or a shorthand; prefix a file path with @ to read the value from it (e.g. --frames @art.json).",
  ].join("\n");
}

const EXAMPLES = [
  "pixel-builder get-style-guide",
  "pixel-builder generate-variations environment --count 6 --vary params",
  'pixel-builder generate-asset environment --params kind=oak --seed 42 --name "oak tree"',
  "pixel-builder paint-asset --name gem --category object --width 8 --height 8 --frames @gem.json",
  "pixel-builder export-asset <id> --format spritesheet --scale 4 --out-dir ./game/art",
  "pixel-builder mcp                 # MCP server on stdio",
  "pixel-builder mcp --http          # MCP over Streamable HTTP on 127.0.0.1:8788",
];

function mainHelp(): string {
  const w = Math.max(...TOOLS.map((t) => kebab(t.name).length)) + 2;
  return [
    `pixel-builder ${VERSION} - consistent pixel-art assets for games, drivable by AI agents and scripts`,
    "",
    "Usage: pixel-builder [--workspace <dir>] [--json] <command> [args] [options]",
    "",
    "Commands (same names as the MCP tools, kebab-case):",
    ...TOOLS.map((t) => `  ${kebab(t.name).padEnd(w)}${firstSentence(t.description)}`),
    `  ${"mcp".padEnd(w)}Run the MCP server (stdio; --http [--port ${DEFAULT_HTTP_PORT}] [--host 127.0.0.1] for Streamable HTTP).`,
    "",
    "Global options:",
    "  --workspace, -w <dir>  Workspace folder (default: $PIXEL_BUILDER_WORKSPACE, else ./" + DEFAULT_WORKSPACE + ").",
    "                         It holds pixel-builder.json (the project) and exports in <category>s/ folders.",
    "  --json                 Machine-readable output ({ok, ...result, previews}); errors as {ok:false,error}.",
    "  --help, -h             Help; `pixel-builder <command> --help` lists a command's options.",
    "  --version              Print the version.",
    "",
    "Examples:",
    ...EXAMPLES.map((e) => `  ${e}`),
    "",
    "Preview images of results are saved to <workspace>/.previews/ and their paths printed, so an agent can open them.",
  ].join("\n");
}

// ---------- output ----------

function savePreviews(ws: Workspace, r: ToolResult): string[] {
  if (!r.images?.length) return [];
  const dir = join(ws.dir, ".previews");
  mkdirSync(dir, { recursive: true });
  return r.images.map((img) => {
    const path = join(dir, `${slugify(img.label)}.png`);
    atomicWrite(path, img.png);
    return path;
  });
}

function assetLine(a: any): string {
  const frames = (a.rows as { frames: number }[]).reduce((n, r) => n + r.frames, 0);
  return `${a.name} [${a.id}] ${a.category} ${a.width}x${a.height}${frames > 1 ? `, ${frames} frames` : ""}`;
}

function human(tool: ToolDef, r: ToolResult, previews: string[]): string {
  const d = r.data as any;
  const lines: string[] = [];
  const files = (list: unknown[]) => list.map((f) => `  ${typeof f === "string" ? f : (f as { path: string }).path}`);
  if (r.text) lines.push(r.text);
  else if (tool.name === "list_assets") {
    lines.push(`${d.count} asset(s) in ${d.workspace}`);
    for (const a of d.assets) lines.push(`  ${assetLine(a)}${a.files.length ? `\n      ${a.files.join("\n      ")}` : ""}`);
  } else if (tool.name === "list_kits") {
    for (const k of d.kits) lines.push(`${k.active ? "*" : " "} ${k.id}  ${k.name}  (${k.palette}, ${k.outline} outline, light ${k.light}, ${k.shade_steps} shades)`);
  } else if (tool.name === "list_generators") {
    for (const g of d.generators) {
      lines.push(`${g.id} (${g.category}) - ${g.description}`);
      for (const p of g.params as any[]) lines.push(`    ${p.key}: ${p.type === "select" ? p.options.join(" | ") : p.type === "number" ? `${p.min}..${p.max}` : p.type === "material" ? "material" : "true | false"} (default ${p.default})`);
    }
  } else if (tool.name === "generate_variations") {
    lines.push(`${d.variations.length} variation(s) of ${d.generator} (numbered left-to-right, top-to-bottom; not saved):`);
    for (const v of d.variations) lines.push(`  ${v.n}: seed ${v.seed} ${JSON.stringify(v.params)}`);
  } else if (d?.asset?.rows) {
    lines.push(`${d.saved === false ? "Previewed (not saved)" : "OK"}: ${assetLine(d.asset)}`);
    if (d.asset.files.length) lines.push("files:", ...files(d.asset.files));
  } else if (tool.name === "export_asset") {
    lines.push(`Exported ${d.asset.name}:`, ...files(d.files));
  } else if (tool.name === "delete_asset") {
    lines.push(`Deleted ${d.deleted.name} [${d.deleted.id}]`, ...files(d.removed_files));
  } else if (tool.name === "rerender_assets") {
    lines.push(`Re-rendered ${d.rerendered} asset(s).`, ...(d.assets as any[]).map((a) => `  ${assetLine(a)}`));
    for (const s of d.skipped as any[]) lines.push(`  skipped ${s.name} [${s.id}]: ${s.reason}`);
  } else if (d?.kit && tool.name !== "get_style_guide") {
    lines.push(`Kit ${d.kit.name} [${d.kit.id}]`, ...(d.note ? [d.note] : []));
  } else lines.push(JSON.stringify(r.data, null, 2));
  if (Array.isArray(d?.notes)) lines.push("notes:", ...d.notes.map((n: string) => `  - ${n}`));
  if (previews.length) lines.push("preview:", ...previews.map((p) => `  ${p}`));
  return lines.join("\n");
}

// ---------- main ----------

export interface CliIO {
  out(text: string): void;
  err(text: string): void;
}

const stdio: CliIO = { out: (t) => process.stdout.write(t + "\n"), err: (t) => process.stderr.write(t + "\n") };

async function runMcp(tokens: string[], workspace: string | undefined, io: CliIO): Promise<number> {
  let http = false;
  let port = DEFAULT_HTTP_PORT;
  let host = "127.0.0.1";
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const [name, inline] = t.includes("=") ? [t.slice(0, t.indexOf("=")), t.slice(t.indexOf("=") + 1)] : [t, undefined];
    const value = () => inline ?? tokens[++i] ?? (() => { throw new UsageError(`${name} needs a value`); })();
    if (name === "--http") http = true;
    else if (name === "--stdio") http = false;
    else if (name === "--port") {
      port = Number(value());
      if (!Number.isInteger(port) || port < 0 || port > 65535) throw new UsageError("--port expects 0..65535");
    } else if (name === "--host") host = value();
    else if (name === "--workspace" || name === "-w") workspace = value();
    else throw new UsageError(`Unknown option ${t} for mcp. Usage: pixel-builder mcp [--http] [--port ${DEFAULT_HTTP_PORT}] [--host 127.0.0.1] [--workspace dir]`);
  }
  const ws = new Workspace(workspace);
  if (http) {
    const handle = await startHttp(ws, { port, host });
    const stop = () => void handle.close().then(() => process.exit(0));
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  } else {
    await startStdio(ws);
    process.once("SIGINT", () => process.exit(0));
    process.once("SIGTERM", () => process.exit(0));
  }
  void io;
  return 0;
}

/** Run the CLI; returns the process exit code (0 ok, 1 tool error, 2 usage error). `mcp` keeps running after it returns. */
export async function main(argv: string[], io: CliIO = stdio): Promise<number> {
  let json = argv.includes("--json");
  try {
    // find the command: first token that is not a flag (or a global flag's value)
    let workspace: string | undefined;
    let command: string | undefined;
    const rest: string[] = [];
    for (let i = 0; i < argv.length; i++) {
      const t = argv[i];
      if (command === undefined) {
        if (t === "--workspace" || t === "-w") { workspace = argv[++i]; continue; }
        if (t.startsWith("--workspace=")) { workspace = t.slice("--workspace=".length); continue; }
        if (t === "--json") continue;
        if (t === "--version" || t === "-v") { io.out(VERSION); return 0; }
        if (t === "--help" || t === "-h") { io.out(mainHelp()); return 0; }
        if (t.startsWith("-")) throw new UsageError(`Unknown option ${t}. Run \`pixel-builder --help\`.`);
        command = t;
        continue;
      }
      rest.push(t);
    }
    if (!command || command === "help") {
      const topic = command === "help" ? rest[0] : undefined;
      const tool = topic ? TOOLS.find((t) => kebab(t.name) === topic || t.name === topic) : undefined;
      io.out(tool ? toolHelp(tool) : mainHelp());
      return 0;
    }
    if (command === "mcp") {
      if (rest.includes("--help") || rest.includes("-h")) {
        io.out(`Usage: pixel-builder mcp [--http] [--port ${DEFAULT_HTTP_PORT}] [--host 127.0.0.1] [--workspace <dir>]\n\nRuns the MCP server. Default: stdio (for Claude Code, Cursor, Codex, Gemini CLI, Hermes...).\n--http serves Streamable HTTP at http://127.0.0.1:${DEFAULT_HTTP_PORT}/mcp (loopback only unless --host is given; no auth).`);
        return 0;
      }
      return await runMcp(rest.filter((t) => t !== "--json"), workspace, io);
    }
    const tool = TOOLS.find((t) => kebab(t.name) === command || t.name === command);
    if (!tool) {
      const near = nearest(command, [...TOOLS.map((t) => kebab(t.name)), "mcp"], 3);
      throw new UsageError(`Unknown command '${command}'.` + (near.length ? ` Did you mean ${near.join(", ")}?` : "") + " Run `pixel-builder --help` for the list.");
    }
    const props = (inputJsonSchema(tool).properties ?? {}) as Record<string, Prop>;
    const parsed = parseArgs(rest, props, kebab(tool.name));
    json = json || parsed.json;
    if (parsed.help) {
      io.out(toolHelp(tool));
      return 0;
    }
    const ws = new Workspace(parsed.workspace ?? workspace);
    const result = callTool(ws, tool.name, buildInput(tool, parsed));
    const previews = savePreviews(ws, result);
    if (json) {
      const data = result.data && typeof result.data === "object" && !Array.isArray(result.data) ? (result.data as object) : { result: result.data };
      io.out(JSON.stringify({ ok: true, ...data, ...(previews.length ? { previews } : {}) }));
    } else io.out(human(tool, result, previews));
    return 0;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const code = e instanceof UsageError ? 2 : 1;
    if (!(e instanceof UsageError) && !(e instanceof ToolError)) io.err((e as Error)?.stack ?? message);
    if (json) io.out(JSON.stringify({ ok: false, error: message }));
    else io.err(`error: ${message}`);
    return code;
  }
}

function isEntry(): boolean {
  try {
    return !!process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isEntry()) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
