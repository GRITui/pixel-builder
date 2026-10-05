import type { AiStatus } from "../../ai/client";
import type { Asset } from "../../core/types";
import type { FlatPalette } from "../render";
import { AttachReference } from "./AttachReference";
import { aiOffReason } from "./common";
import { SpriteCanvas, fitScale } from "./SpriteView";

export type AiBusy = "vibe" | "pixels" | null;

export function PromptBox(props: {
  prompt: string;
  onPrompt: (s: string) => void;
  status: AiStatus | null;
  busy: AiBusy;
  error: string | null;
  notes: string;
  refs: Asset[];
  pal: FlatPalette;
  onRemoveRef: (id: string) => void;
  attached?: string | null;
  onAttach?: (dataUrl: string | null) => void;
  onVibe: () => void;
  onFreeform: () => void;
  /** Freeform painting makes no sense for maps. */
  freeformDisabledReason?: string;
}) {
  const { status, busy, prompt } = props;
  const enabled = !!status?.enabled;
  const offWhy = aiOffReason(status);
  const empty = !prompt.trim();
  const vibeTitle = !enabled ? offWhy : empty ? "Describe what you want first" : "Ask Claude for generator parameters, then render procedurally on-style";
  const freeTitle = !enabled ? offWhy : props.freeformDisabledReason ? props.freeformDisabledReason : empty ? "Describe what you want first" : "Claude paints pixels directly, restricted to the kit palette";
  return (
    <section className="card prompt-box">
      <label htmlFor="prompt" className="card-title">
        Describe it
      </label>
      <textarea
        id="prompt"
        rows={3}
        value={prompt}
        placeholder="e.g. a grumpy dwarf blacksmith with a red beard and a heavy hammer"
        onChange={(e) => props.onPrompt(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && enabled && !empty && !busy) props.onVibe();
        }}
      />
      <div className="btn-row">
        <button className="primary" disabled={!enabled || empty || !!busy} title={vibeTitle} onClick={props.onVibe}>
          {busy === "vibe" ? "Vibing…" : "✦ Vibe"}
        </button>
        <button disabled={!enabled || empty || !!busy || !!props.freeformDisabledReason} title={freeTitle} onClick={props.onFreeform}>
          {busy === "pixels" ? "Painting…" : "Freeform pixels"}
        </button>
      </div>
      {props.onAttach && <AttachReference value={props.attached ?? null} onChange={props.onAttach} disabled={!!busy} />}
      {!enabled && <p className="hint">{status ? offWhy : "Checking the AI server…"}</p>}
      <div className="refs">
        <span className="dim">Style references ({props.refs.length}/2)</span>
        {props.refs.length === 0 && <span className="hint">Pick up to 2 library assets with “Ref” in the right strip; Freeform pixels will imitate them.</span>}
        {props.refs.map((a) => {
          const s = a.rows[0].frames[0];
          return (
            <span key={a.id} className="ref-chip" title={a.name}>
              <span className="checker ref-thumb">
                <SpriteCanvas sprite={s} pal={props.pal} scale={fitScale(s.w, s.h, 28)} />
              </span>
              <span className="ref-name">{a.name}</span>
              <button className="ghost" aria-label={`Remove reference ${a.name}`} onClick={() => props.onRemoveRef(a.id)}>
                ✕
              </button>
            </span>
          );
        })}
      </div>
      {busy && (
        <p className="progress" role="status">
          <span className="spinner" /> {busy === "vibe" ? "Claude is choosing parameters…" : "Claude is painting pixels (this can take a while)…"}
        </p>
      )}
      {props.error && (
        <p className="error" role="alert">
          {props.error}
        </p>
      )}
      {props.notes && !props.error && <p className="notes">“{props.notes}”</p>}
    </section>
  );
}
