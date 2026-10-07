// Looks: a saved era + palette + preset/bloom/dither/outline, stored as JSON in <out_dir>/looks (or $PIXEL_LOOKS_DIR).
// Passing a look to pixelize forces its palette and settings so every asset in a project matches.
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { hexToRgb } from "../color/oklab";
import { BLOOMS, DITHERS, ERAS, PRESETS, type Era, type Look } from "../pixel/types";
import { z } from "zod";
import { registerTool, ToolError } from "./registry";

export const looksDir = (outDir: string): string => resolve(process.env.PIXEL_LOOKS_DIR || join(outDir, "looks"));
export const lookId = (name: string): string => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);

/** Throws ToolError unless `v` is a well-formed Look. */
export function parseLook(v: any, fallbackName = "look"): Look {
  const bad = (m: string): never => { throw new ToolError(`Invalid look: ${m}`); };
  if (!v || typeof v !== "object") bad("not an object");
  if (!(Number(v.era) in ERAS)) bad("era must be 8, 16, 32 or 64");
  if (!Array.isArray(v.palette) || !v.palette.length) bad("palette must be a non-empty list of #rrggbb");
  try { v.palette.forEach((h: string) => hexToRgb(h)); } catch (e) { bad((e as Error).message); }
  if (!PRESETS.includes(v.preset)) bad(`preset must be one of ${PRESETS.join(", ")}`);
  if (!BLOOMS.includes(v.bloom)) bad(`bloom must be one of ${BLOOMS.join(", ")}`);
  if (!DITHERS.includes(v.dither)) bad(`dither must be one of ${DITHERS.join(", ")}`);
  const name = String(v.name ?? fallbackName);
  return { id: lookId(String(v.id ?? name)) || "look", name, era: Number(v.era) as Era, palette: v.palette.map((h: string) => h.toLowerCase()), preset: v.preset, bloom: v.bloom, dither: v.dither, outline: !!v.outline };
}

export function saveLook(dir: string, look: Look): string {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${look.id}.json`);
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(look, null, 2));
  renameSync(tmp, path);
  return path;
}

export function listLooks(dir: string): Look[] {
  if (!existsSync(dir)) return [];
  const out: Look[] = [];
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
    try { out.push(parseLook(JSON.parse(readFileSync(join(dir, f), "utf8")), f.replace(/\.json$/, ""))); } catch { /* skip foreign files */ }
  }
  return out;
}

/** By id or name. */
export function loadLook(dir: string, idOrName: string): Look {
  const id = lookId(idOrName), path = join(dir, `${id}.json`);
  if (!id || !existsSync(path)) {
    const have = listLooks(dir).map((l) => l.id);
    throw new ToolError(`No look '${idOrName}' in ${dir}.${have.length ? ` Available: ${have.join(", ")}` : " Save one with the looks tool (action save)."}`);
  }
  return parseLook(JSON.parse(readFileSync(path, "utf8")), id);
}

export function deleteLook(dir: string, idOrName: string): void {
  loadLook(dir, idOrName);
  rmSync(join(dir, `${lookId(idOrName)}.json`));
}

registerTool({
  name: "looks",
  title: "Manage project looks",
  description:
    "Save, list or delete a Look: a locked era + palette + preset/bloom/dither/outline kept in <out_dir>/looks (or $PIXEL_LOOKS_DIR). Pass its name to pixelize as `look` and every image is forced onto the same palette and settings. action=save needs `name` and `from` (the <name>.json meta file that pixelize wrote, or a look/meta JSON path). Example: looks action=save name=arcade from=pixel-out/photo-scene-16bit.json.",
  positional: "action",
  shape: {
    action: z.enum(["save", "list", "delete"]).describe("save | list | delete"),
    name: z.string().optional().describe("Look name (save, delete)."),
    from: z.string().optional().describe("Path to a pixelize result .json (meta with palette) to save the look from."),
    out_dir: z.string().optional().describe("Output folder; looks live in <out_dir>/looks (default ./pixel-out)."),
  },
  async run(ctx, i) {
    const dir = looksDir(i.out_dir ?? ctx.outDir);
    if (i.action === "list") return { data: { dir, looks: listLooks(dir).map((l) => ({ id: l.id, name: l.name, era: l.era, colours: l.palette.length, preset: l.preset, bloom: l.bloom, dither: l.dither, outline: l.outline })) } };
    if (!i.name) throw new ToolError(`looks ${i.action} needs 'name'.`);
    if (i.action === "delete") { deleteLook(dir, i.name); return { data: { deleted: lookId(i.name), dir } }; }
    if (!i.from) throw new ToolError("looks save needs 'from': the .json meta file written by pixelize.");
    let raw: any;
    try { raw = JSON.parse(readFileSync(resolve(i.from), "utf8")); } catch (e) { throw new ToolError(`Cannot read '${i.from}': ${(e as Error).message}`); }
    const look = parseLook({ ...raw, id: i.name, name: i.name });
    return { data: { saved: saveLook(dir, look), id: look.id, era: look.era, colours: look.palette.length } };
  },
});
