import { useMemo, useState } from "react";
import { aiPixels, vibeParams, type AiStatus } from "../../ai/client";
import { createAsset } from "../../core/asset";
import { coerceParams, defaults, generatorById, generatorFor, GENERATORS, randomParams, type GenResult, type Generator, type ParamValue, type Params } from "../../core/generators";
import { rng, randomSeed } from "../../core/rng";
import type { Attachment, Clip, RigDef } from "../../core/rig";
import { CATEGORIES, type Asset, type Category, type Sprite, type StyleKit } from "../../core/types";
import type { FlatPalette } from "../render";
import { ExportMenu } from "./ExportMenu";
import { ParamForm } from "./ParamForm";
import { PromptBox, type AiBusy } from "./PromptBox";
import { LivePreview, type PreviewBg } from "./SpriteView";
import { Variations } from "./Variations";
import { initRigSel, RiggedWorkspace, type RigSel } from "./RiggedWorkspace";

/** Everything the generate workspace remembers per category. */
export interface WsState {
  params: Params;
  seed: number;
  prompt: string;
  name: string;
  notes: string;
  origin: { kind: "procedural" | "ai-vibe"; prompt?: string };
  /** A Freeform-pixels result shown instead of the procedural output until a param changes. */
  freeform: { sprite: Sprite; prompt: string } | null;
  /** Characters only: use the rig method instead of the procedural generator. */
  rigMode: boolean;
  rig: RigSel;
  /** Which generator of the category is active (categories like "character" have several). */
  generatorId?: string;
}

export function initWs(g: Generator): WsState {
  return { params: defaults(g), seed: randomSeed(), prompt: "", name: "", notes: "", origin: { kind: "procedural" }, freeform: null, rigMode: false, rig: initRigSel() };
}

const ZOOMS = [0, 1, 2, 3, 4, 6, 8, 12, 16];

function defaultName(g: Generator, params: Params): string {
  const k = params.kind ?? params.biome;
  return typeof k === "string" && k ? `${k.replace(/-/g, " ")}`.replace(/^./, (c) => c.toUpperCase()) : g.label;
}

export function Workspace(props: {
  category: Category;
  kit: StyleKit;
  pal: FlatPalette;
  ws: WsState;
  update: (category: Category, fn: (w: WsState) => WsState) => void;
  status: AiStatus | null;
  refs: Asset[];
  onRemoveRef: (id: string) => void;
  onSave: (a: Asset) => void;
  onOpenEditor: (a: Asset) => void;
  onImport: () => void;
  onError: (m: string) => void;
  customClips?: Clip[];
  customRigs?: RigDef[];
  customAttachments?: Attachment[];
  onSaveClip?: (c: Clip) => void;
  onAuthored?: (a: { rig?: RigDef; attachments?: Attachment[]; clips?: Clip[] }) => void;
}) {
  const { category, kit, pal, ws } = props;
  const g = (ws.generatorId && generatorById(ws.generatorId)?.category === category ? generatorById(ws.generatorId) : undefined) ?? generatorFor(category);
  const siblings = GENERATORS.filter((x) => x.category === category);
  const upd = (fn: (w: WsState) => WsState) => props.update(category, fn);
  const [zoom, setZoom] = useState(0);
  const [bg, setBg] = useState<PreviewBg>("checker");
  const [busy, setBusy] = useState<AiBusy>(null);
  const [error, setError] = useState<string | null>(null);

  const gen = useMemo<{ result: GenResult | null; error: string | null }>(() => {
    if (ws.freeform) return { result: { rows: [{ name: "idle", frames: [ws.freeform.sprite] }], fps: 1 }, error: null };
    try {
      return { result: g.generate(ws.params, kit, ws.seed), error: null };
    } catch (e) {
      return { result: null, error: e instanceof Error ? e.message : String(e) };
    }
  }, [g, ws.params, ws.seed, ws.freeform, kit]);

  const name = ws.name.trim() || defaultName(g, ws.params);
  const draft = useMemo<Asset | null>(() => {
    if (!gen.result) return null;
    return createAsset({
      name,
      category,
      kit,
      rows: gen.result.rows,
      fps: gen.result.fps,
      tilemap: gen.result.tilemap,
      meta: gen.result.meta,
      source: ws.freeform
        ? { kind: "ai-pixels", prompt: ws.freeform.prompt }
        : { kind: ws.origin.kind, generator: g.id, params: ws.params, seed: ws.seed, prompt: ws.origin.prompt },
    });
  }, [gen.result, name, category, kit, ws.freeform, ws.origin, ws.params, ws.seed, g.id]);

  const setParam = (key: string, v: ParamValue) => upd((w) => ({ ...w, params: { ...w.params, [key]: v }, freeform: null }));
  const randomize = () => {
    const seed = randomSeed();
    upd((w) => ({ ...w, seed, params: randomParams(g, rng(seed)), freeform: null, origin: { kind: "procedural" }, name: "" }));
  };

  const fail = (e: unknown) => setError(e instanceof Error ? e.message : String(e));
  const runVibe = async () => {
    setBusy("vibe");
    setError(null);
    const prompt = ws.prompt.trim();
    try {
      const r = await vibeParams({ prompt, generator: g, kit, current: ws.params });
      props.update(category, (w) => ({ ...w, params: coerceParams(g, r.params as Record<string, unknown>), name: r.name || w.name, notes: r.notes, origin: { kind: "ai-vibe", prompt }, freeform: null }));
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };
  const runFreeform = async () => {
    if (category === "map") return;
    setBusy("pixels");
    setError(null);
    const prompt = ws.prompt.trim();
    const size = kit.sizes[category];
    // `references` is a Lane C addition; passing a variable (not a literal) keeps
    // this compiling whether or not aiPixels' signature declares it yet.
    const args = { prompt, category, w: size, h: size, kit, references: props.refs.map((a) => a.rows[0].frames[0]) };
    try {
      const r = await aiPixels(args);
      props.update(category, (w) => ({ ...w, name: r.name || w.name, notes: "", freeform: { sprite: r.sprite, prompt } }));
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };

  const pickGenerator = (id: string) =>
    upd((w) => {
      const next = generatorById(id) ?? g;
      return next.id === g.id && !w.rigMode ? w : { ...w, rigMode: false, generatorId: next.id, params: next.id === g.id ? w.params : defaults(next), freeform: null, name: "" };
    });
  const modeToggle =
    siblings.length > 1 || category === "character" ? (
      <div className="seg" role="group" aria-label="Generator">
        {siblings.map((x) => (
          <button key={x.id} className={!ws.rigMode && x.id === g.id ? "on" : ""} onClick={() => pickGenerator(x.id)} title={x.description}>
            {x.label}
          </button>
        ))}
        {category === "character" && (
          <button className={ws.rigMode ? "on" : ""} onClick={() => upd((w) => ({ ...w, rigMode: true }))} title="Skeleton rigs with shared clips and attachments">Rigged</button>
        )}
      </div>
    ) : null;

  if (category === "character" && ws.rigMode)
    return (
      <div className="rigw-wrap">
        <div className="rigw-mode">{modeToggle}</div>
        <RiggedWorkspace
          kit={kit}
          pal={pal}
          sel={ws.rig}
          update={(fn) => upd((w) => ({ ...w, rig: fn(w.rig) }))}
          customClips={props.customClips ?? []}
          customRigs={props.customRigs ?? []}
          customAttachments={props.customAttachments ?? []}
          onSave={props.onSave}
          onSaveClip={props.onSaveClip ?? (() => {})}
          status={props.status}
          onAuthored={props.onAuthored ?? (() => {})}
          onError={props.onError}
        />
      </div>
    );

  const catLabel = CATEGORIES.find((c) => c.id === category)!.label;

  return (
    <div className="workspace">
      <div className="ws-left">
        <PromptBox
          prompt={ws.prompt}
          onPrompt={(prompt) => upd((w) => ({ ...w, prompt }))}
          status={props.status}
          busy={busy}
          error={error}
          notes={ws.notes}
          refs={props.refs}
          pal={pal}
          onRemoveRef={props.onRemoveRef}
          onVibe={runVibe}
          onFreeform={runFreeform}
          freeformDisabledReason={category === "map" ? "Freeform painting isn't available for maps — use Vibe, or paint in the map editor." : undefined}
        />
        <section className="card">
          <div className="card-head">
            {modeToggle}
            <h3 className="card-title">{g.label} parameters</h3>
            <button onClick={randomize} title="Random parameters and a new seed">
              🎲 Randomize
            </button>
          </div>
          <div className="seed-row">
            <label htmlFor="seed">Seed</label>
            <input
              id="seed"
              type="number"
              min={0}
              value={ws.seed}
              onChange={(e) => {
                const n = Math.floor(Number(e.target.value));
                if (Number.isFinite(n) && n >= 0) upd((w) => ({ ...w, seed: n, freeform: null }));
              }}
            />
            <button onClick={() => upd((w) => ({ ...w, seed: randomSeed(), freeform: null }))} title="New random seed, same parameters" aria-label="Roll a new seed">
              🎲
            </button>
          </div>
          <ParamForm generator={g} params={ws.params} kit={kit} onChange={setParam} />
        </section>
      </div>

      <div className="ws-right">
        <section className="card preview-card">
          <div className="card-head">
            <h3 className="card-title">{catLabel} preview</h3>
            <label className="inline">
              Zoom
              <select value={zoom} onChange={(e) => setZoom(Number(e.target.value))}>
                {ZOOMS.map((z) => (
                  <option key={z} value={z}>
                    {z === 0 ? "Auto" : `${z}x`}
                  </option>
                ))}
              </select>
            </label>
            <div className="seg" role="group" aria-label="Preview background">
              {(["checker", "dark", "light"] as PreviewBg[]).map((b) => (
                <button key={b} className={bg === b ? "on" : ""} onClick={() => setBg(b)}>
                  {b}
                </button>
              ))}
            </div>
          </div>
          {ws.freeform && <p className="banner">Freeform AI result. Change any parameter or seed to return to the procedural output.</p>}
          {gen.result ? <LivePreview rows={gen.result.rows} fps={gen.result.fps} pal={pal} zoom={zoom} bg={bg} /> : <p className="error">Generator failed: {gen.error}</p>}
          <div className="action-row">
            <input
              className="name-field"
              aria-label="Asset name"
              placeholder={defaultName(g, ws.params)}
              value={ws.name}
              onChange={(e) => upd((w) => ({ ...w, name: e.target.value }))}
            />
            <button className="primary" disabled={!draft} onClick={() => draft && props.onSave(draft)}>
              Save to library
            </button>
            <button disabled={!draft} onClick={() => draft && props.onOpenEditor(draft)}>
              Open in editor
            </button>
            {draft && <ExportMenu asset={draft} kit={kit} onError={props.onError} align="right" />}
            <button onClick={props.onImport} title="Quantise an image to this kit's palette">
              Import image…
            </button>
          </div>
          {gen.result && (
            <p className="dim fine">
              {gen.result.rows[0].frames[0].w}×{gen.result.rows[0].frames[0].h}px · {gen.result.rows.length} row{gen.result.rows.length === 1 ? "" : "s"} · {gen.result.fps} fps · seed {ws.seed}
            </p>
          )}
        </section>
        <Variations
          generator={g}
          params={ws.params}
          kit={kit}
          pal={pal}
          onAdopt={(params, seed) => upd((w) => ({ ...w, params, seed, freeform: null, origin: { kind: "procedural" } }))}
        />
      </div>
    </div>
  );
}
