// CLI adapter: commands are tool names (kebab-case), flags are input names (kebab-case).
//   pixel-builder pixelize <image> --era 16 --json      pixel-builder mcp [--http --port 8788]
import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DEFAULT_HTTP_PORT, VERSION, parseHostList, startHttp, startStdio } from "./mcp";
import { TOOLS, ToolError, callTool, inputJsonSchema, nearest, type ToolDef } from "./registry";
import "./tools";

class UsageError extends Error {}
const kebab = (s: string) => s.replace(/_/g, "-");
const snake = (s: string) => s.replace(/-/g, "_");

export interface CliIO { out(t: string): void; err(t: string): void }
const stdio: CliIO = { out: (t) => process.stdout.write(t + "\n"), err: (t) => process.stderr.write(t + "\n") };

type Prop = { type?: string; enum?: unknown[]; anyOf?: Prop[]; description?: string; default?: unknown };
const isBool = (p?: Prop) => p?.type === "boolean";

function scalar(v: string, p?: Prop): unknown {
  if (p?.type === "string") return v;
  if (v === "true") return true;
  if (v === "false") return false;
  return v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : v;
}

function buildInput(tool: ToolDef, tokens: string[]): { input: Record<string, unknown>; json: boolean; help: boolean } {
  const props = (inputJsonSchema(tool).properties ?? {}) as Record<string, Prop>;
  const input: Record<string, unknown> = {};
  let json = false, help = false;
  const pos: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === "--json") { json = true; continue; }
    if (t === "--help" || t === "-h") { help = true; continue; }
    if (t === "--input") { Object.assign(input, JSON.parse(readValue(tokens[++i] ?? ""))); continue; }
    if (!t.startsWith("--")) { pos.push(t); continue; }
    const eq = t.indexOf("=");
    const name = eq < 0 ? t.slice(2) : t.slice(2, eq);
    let key = snake(name), neg = false;
    if (!(key in props) && key.startsWith("no_") && key.slice(3) in props) { key = key.slice(3); neg = true; }
    const p = props[key];
    if (!p) {
      const near = nearest(key, Object.keys(props), 2).map((k) => `--${kebab(k)}`);
      throw new UsageError(`Unknown option --${name} for ${kebab(tool.name)}.${near.length ? ` Did you mean ${near.join(" or ")}?` : ""} Run \`pixel-builder ${kebab(tool.name)} --help\`.`);
    }
    if (isBool(p)) {
      let v = !neg;
      if (eq >= 0) v = t.slice(eq + 1) !== "false";
      else if (tokens[i + 1] === "true" || tokens[i + 1] === "false") v = tokens[++i] === "true" ? !neg : neg;
      input[key] = v;
    } else {
      const raw = eq >= 0 ? t.slice(eq + 1) : tokens[++i];
      if (raw === undefined) throw new UsageError(`--${name} needs a value`);
      input[key] = scalar(raw, p);
    }
  }
  if (pos.length > 1) throw new UsageError(`Unexpected argument '${pos[1]}'.`);
  if (pos[0] !== undefined) {
    if (!tool.positional) throw new UsageError(`${kebab(tool.name)} takes no positional argument (got '${pos[0]}').`);
    input[tool.positional] ??= pos[0];
  }
  return { input, json, help };
}

const readValue = (raw: string) => (raw.startsWith("@") ? readFileSync(raw.slice(1), "utf8") : raw);

function toolHelp(tool: ToolDef): string {
  const schema = inputJsonSchema(tool);
  const req = new Set(schema.required ?? []);
  const rows = Object.entries((schema.properties ?? {}) as Record<string, Prop>).map(([k, p]) => {
    const flag = `--${kebab(k)}${isBool(p) ? "" : p.enum ? ` <${p.enum.join("|")}>` : " <v>"}`;
    return `  ${flag.padEnd(34)}${p.description ?? ""}${req.has(k) ? " (required)" : ""}${p.default !== undefined ? ` (default ${JSON.stringify(p.default)})` : ""}`;
  });
  return [`pixel-builder ${kebab(tool.name)} - ${tool.title}`, "", tool.description, "", `Usage: pixel-builder ${kebab(tool.name)}${tool.positional ? ` <${tool.positional}>` : ""} [options] [--json]`, "", "Options:", ...rows].join("\n");
}

function mainHelp(): string {
  return [
    `pixel-builder ${VERSION} - realistic image -> true pixel art, drivable by AI agents`,
    "",
    "Usage: pixel-builder <command> [args] [options] [--json]",
    "",
    "Commands:",
    ...TOOLS.map((t) => `  ${kebab(t.name).padEnd(12)}${t.title}`),
    `  ${"mcp".padEnd(12)}MCP server (stdio; --http [--port ${DEFAULT_HTTP_PORT}] [--allowed-host h] [--token t])`,
    "",
    "Global: --out-dir <dir> (default ./pixel-out), --json, --help, --version. `pixel-builder <command> --help` lists options.",
  ].join("\n");
}

export async function main(argv: string[], io: CliIO = stdio): Promise<number> {
  let json = argv.includes("--json");
  try {
    let outDir = process.env.PIXEL_BUILDER_OUT ?? "./pixel-out";
    let command: string | undefined;
    const rest: string[] = [];
    for (let i = 0; i < argv.length; i++) {
      const t = argv[i];
      if (command === undefined) {
        if (t === "--json") continue;
        if (t === "--version" || t === "-v") { io.out(VERSION); return 0; }
        if (t === "--help" || t === "-h") { io.out(mainHelp()); return 0; }
        if (t.startsWith("-")) throw new UsageError(`Unknown option ${t}. Run \`pixel-builder --help\`.`);
        command = t;
      } else rest.push(t);
    }
    if (!command || command === "help") {
      const tool = command === "help" && rest[0] ? TOOLS.find((t) => kebab(t.name) === rest[0]) : undefined;
      io.out(tool ? toolHelp(tool) : mainHelp());
      return 0;
    }
    if (command === "mcp") {
      let http = false, port = DEFAULT_HTTP_PORT, host = "127.0.0.1", token = process.env.PIXEL_BUILDER_TOKEN || undefined;
      const allowed: string[] = [process.env.PIXEL_BUILDER_ALLOWED_HOSTS ?? ""];
      for (let i = 0; i < rest.length; i++) {
        const [n, inline] = rest[i].includes("=") ? [rest[i].slice(0, rest[i].indexOf("=")), rest[i].slice(rest[i].indexOf("=") + 1)] : [rest[i], undefined];
        const val = () => inline ?? rest[++i] ?? (() => { throw new UsageError(`${n} needs a value`); })();
        if (n === "--http") http = true;
        else if (n === "--stdio" || n === "--json") http = n === "--json" ? http : false;
        else if (n === "--port") { port = Number(val()); if (!Number.isInteger(port) || port < 0 || port > 65535) throw new UsageError("--port expects 0..65535"); }
        else if (n === "--host") host = val();
        else if (n === "--allowed-host") allowed.push(val());
        else if (n === "--token") token = val() || undefined;
        else if (n === "--out-dir") outDir = val();
        else throw new UsageError(`Unknown option ${rest[i]} for mcp.`);
      }
      if (http) {
        const h = await startHttp({ outDir }, { port, host, allowedHosts: parseHostList(...allowed), token });
        const stop = () => void h.close().then(() => process.exit(0));
        process.once("SIGINT", stop);
        process.once("SIGTERM", stop);
      } else {
        await startStdio({ outDir });
        process.once("SIGINT", () => process.exit(0));
      }
      return 0;
    }
    const tool = TOOLS.find((t) => kebab(t.name) === command || t.name === command);
    if (!tool) {
      const near = nearest(command, [...TOOLS.map((t) => kebab(t.name)), "mcp"], 3);
      throw new UsageError(`Unknown command '${command}'.${near.length ? ` Did you mean ${near.join(", ")}?` : ""} Run \`pixel-builder --help\`.`);
    }
    // global --out-dir is also the tool's out_dir when the tool has one
    const oi = rest.indexOf("--out-dir");
    if (oi >= 0 && "out_dir" in tool.shape) rest[oi] = "--out-dir";
    const { input, json: j, help } = buildInput(tool, rest);
    json = json || j;
    if (help) { io.out(toolHelp(tool)); return 0; }
    const r = await callTool({ outDir }, tool.name, input);
    const data = r.warnings.length ? { ...r.data, warnings: r.warnings } : r.data;
    io.out(json ? JSON.stringify({ ok: true, ...data }) : JSON.stringify(data, null, 2));
    return 0;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (!(e instanceof UsageError) && !(e instanceof ToolError)) io.err((e as Error)?.stack ?? message);
    if (json) io.out(JSON.stringify({ ok: false, error: message }));
    else io.err(`error: ${message}`);
    return e instanceof UsageError ? 2 : 1;
  }
}

function isEntry(): boolean {
  try { return !!process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
}
if (isEntry()) main(process.argv.slice(2)).then((c) => { process.exitCode = c; });
