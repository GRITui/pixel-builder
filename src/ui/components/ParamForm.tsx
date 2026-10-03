import { resolveRamps } from "../../core/kit";
import { MATERIALS, type Material } from "../../core/palette";
import { PAINT, type Generator, type ParamSpec, type ParamValue, type Params } from "../../core/generators/types";
import type { StyleKit } from "../../core/types";
import { rampGradient } from "./common";

function MaterialPicker({ spec, value, kit, onChange }: { spec: Extract<ParamSpec, { type: "material" }>; value: Material; kit: StyleKit; onChange: (m: Material) => void }) {
  const ramps = resolveRamps(kit);
  const opts = (spec.options ?? PAINT).filter((m) => MATERIALS.includes(m));
  const all = opts.includes(value) ? opts : [value, ...opts];
  return (
    <div className="mat-picker" role="radiogroup" aria-label={spec.label}>
      {all.map((m) => (
        <button
          key={m}
          type="button"
          role="radio"
          aria-checked={m === value}
          aria-label={m}
          title={m}
          className={`mat-chip ${m === value ? "on" : ""}`}
          style={{ background: rampGradient(ramps[m]) }}
          onClick={() => onChange(m)}
        />
      ))}
    </div>
  );
}

export function ParamForm({ generator, params, kit, onChange }: { generator: Generator; params: Params; kit: StyleKit; onChange: (key: string, v: ParamValue) => void }) {
  return (
    <div className="params">
      {generator.params.map((s) => {
        const id = `p-${generator.id}-${s.key}`;
        const v = params[s.key];
        return (
          <div key={s.key} className={`param param-${s.type}`}>
            <label htmlFor={id}>
              {s.label}
              {s.type === "material" && <span className="dim"> · {String(v)}</span>}
              {s.type === "number" && <span className="dim"> · {String(v)}</span>}
            </label>
            {s.type === "select" && (
              <select id={id} value={String(v)} onChange={(e) => onChange(s.key, e.target.value)}>
                {(s.options.includes(String(v)) ? s.options : [String(v), ...s.options]).map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            )}
            {s.type === "material" && <MaterialPicker spec={s} value={String(v) as Material} kit={kit} onChange={(m) => onChange(s.key, m)} />}
            {s.type === "number" && (
              <div className="num-row">
                <input id={id} type="range" min={s.min} max={s.max} step={s.step ?? 1} value={Number(v)} onChange={(e) => onChange(s.key, Number(e.target.value))} />
                <input
                  type="number"
                  aria-label={`${s.label} value`}
                  min={s.min}
                  max={s.max}
                  step={s.step ?? 1}
                  value={Number(v)}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    if (Number.isFinite(n)) onChange(s.key, Math.max(s.min, Math.min(s.max, n)));
                  }}
                />
              </div>
            )}
            {s.type === "bool" && (
              <label className="switch">
                <input id={id} type="checkbox" checked={Boolean(v)} onChange={(e) => onChange(s.key, e.target.checked)} />
                <span>{Boolean(v) ? "On" : "Off"}</span>
              </label>
            )}
          </div>
        );
      })}
    </div>
  );
}
