import type { AiStatus } from "../../ai/client";
import { resolveRamps } from "../../core/kit";
import type { Material } from "../../core/palette";
import type { StyleKit } from "../../core/types";

const PREVIEW_MATS: Material[] = ["skin", "cloth", "cloth2", "foliage", "wood", "water", "gold", "accent"];

export function AiPill({ status, onRefresh }: { status: AiStatus | null; onRefresh: () => void }) {
  const state = !status ? "checking" : status.enabled ? "on" : "off";
  const label = !status ? "AI: checking…" : status.enabled ? `AI: ${status.provider && status.provider !== "anthropic" ? `${status.provider} / ` : ""}${status.model ?? "on"}` : "AI: off";
  const title = !status ? "Contacting the AI server…" : status.enabled ? `${status.provider === "openai" ? "OpenAI-compatible" : "Claude"} provider${status.model ? `, model ${status.model}` : ""}${status.visionModel && status.visionModel !== status.model ? `, vision ${status.visionModel}` : ""}. Click to re-check.` : `${status.reason ?? "Set ANTHROPIC_API_KEY on the server."} Click to re-check.`;
  return (
    <button className={`pill ${state}`} onClick={onRefresh} title={title}>
      <span className="dot" /> {label}
    </button>
  );
}

export function TopBar(props: { kits: StyleKit[]; kit: StyleKit; onKit: (id: string) => void; onEditKit: () => void; status: AiStatus | null; onRefreshAi: () => void }) {
  const ramps = resolveRamps(props.kit);
  return (
    <header className="topbar">
      <div className="brand" aria-label="Pixel Builder">
        <span className="logo" aria-hidden="true" />
        Pixel Builder
      </div>
      <div className="kit-picker">
        <label htmlFor="kit-select" className="dim">
          Style Kit
        </label>
        <select id="kit-select" value={props.kit.id} onChange={(e) => props.onKit(e.target.value)}>
          {props.kits.map((k) => (
            <option key={k.id} value={k.id}>
              {k.name}
            </option>
          ))}
        </select>
        <span className="kit-swatches" aria-hidden="true">
          {PREVIEW_MATS.map((m) => (
            <i key={m} style={{ background: ramps[m][2] }} />
          ))}
        </span>
        <button onClick={props.onEditKit}>Edit kit</button>
      </div>
      <span className="grow" />
      <AiPill status={props.status} onRefresh={props.onRefreshAi} />
    </header>
  );
}
