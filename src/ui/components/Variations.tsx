import { useDeferredValue, useMemo, useState } from "react";
import { randomParams, type Generator, type GenResult, type Params } from "../../core/generators/types";
import { rng } from "../../core/rng";
import type { StyleKit } from "../../core/types";
import type { FlatPalette } from "../render";
import { AnimThumb } from "./SpriteView";

export interface Variation {
  params: Params;
  seed: number;
  result: GenResult | null;
}

/** "seeds" keeps the current params and varies the seed; "params" randomises everything. */
export function Variations({
  generator,
  params,
  kit,
  pal,
  onAdopt,
}: {
  generator: Generator;
  params: Params;
  kit: StyleKit;
  pal: FlatPalette;
  onAdopt: (params: Params, seed: number) => void;
}) {
  const [mode, setMode] = useState<"seeds" | "params">("seeds");
  const [nonce, setNonce] = useState(1);
  // Deferred so dragging a slider stays smooth while the six variations catch up.
  const live = useDeferredValue(params);

  const items = useMemo<Variation[]>(() => {
    const base = nonce * 7919;
    return Array.from({ length: 6 }, (_, i) => {
      const seed = (base + i * 104729) % 1_000_000_000;
      const p = mode === "seeds" ? live : randomParams(generator, rng(seed + 1));
      let result: GenResult | null = null;
      try {
        result = generator.generate(p, kit, seed);
      } catch {
        result = null;
      }
      return { params: p, seed, result };
    });
    // In "params" mode the variations are independent of the current params so
    // adopting one does not reshuffle the grid.
  }, [generator, kit, nonce, mode, mode === "seeds" ? live : null]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <section className="card variations">
      <div className="card-head">
        <h3 className="card-title">Variations</h3>
        <div className="seg" role="group" aria-label="Variation mode">
          <button className={mode === "seeds" ? "on" : ""} onClick={() => setMode("seeds")} title="Same parameters, different seeds">
            Seeds
          </button>
          <button className={mode === "params" ? "on" : ""} onClick={() => setMode("params")} title="Random parameters">
            Random
          </button>
        </div>
        <button onClick={() => setNonce((n) => n + 1)} title="Roll six new variations">
          ⟳ More
        </button>
      </div>
      <div className="var-grid">
        {items.map((v, i) =>
          v.result ? (
            <button key={`${nonce}-${i}`} className="var" title={`Seed ${v.seed} — click to adopt`} onClick={() => onAdopt(v.params, v.seed)}>
              <AnimThumb rows={v.result.rows} fps={v.result.fps} pal={pal} size={72} />
              <span className="dim">#{v.seed}</span>
            </button>
          ) : (
            <div key={i} className="var err">
              failed
            </div>
          ),
        )}
      </div>
    </section>
  );
}
