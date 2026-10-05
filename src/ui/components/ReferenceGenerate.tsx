import { useEffect, useMemo, useState } from "react";
import { vibeParams, type AiStatus } from "../../ai/client";
import { createAsset } from "../../core/asset";
import { generatorFor } from "../../core/generators";
import { randomSeed } from "../../core/rng";
import { CATEGORIES, type Asset, type Category, type Reference, type Sprite, type StyleKit } from "../../core/types";
import { distanceToScore, localScorer, referenceCandidates, refineWithAi, spriteRef, MATCHES, type Candidate, type Match } from "../../node/refgen";
import { paletteFor } from "../render";
import { loadReferenceImage, refDataUrl } from "../refs";
import { SpriteCanvas, fitScale } from "./SpriteView";

const CATS = CATEGORIES.filter((c) => c.id !== "map" && c.id !== "ui");

/** "Generate from reference": 6 candidates ranked by match to a library reference; click one to keep it. */
export function ReferenceGenerate({ references, initialId, kit, status, onKeep, onClose, onError }: {
  references: Reference[];
  initialId?: string;
  kit: StyleKit;
  status: AiStatus | null;
  onKeep: (a: Asset) => void;
  onClose: () => void;
  onError: (msg: string) => void;
}) {
  const [refId, setRefId] = useState(initialId ?? references[0]?.id ?? "");
  const [category, setCategory] = useState<Category>("building");
  const [match, setMatch] = useState<Match>("both");
  const [nonce, setNonce] = useState(0);
  const [cands, setCands] = useState<(Candidate & { ai?: boolean })[]>([]);
  const [busy, setBusy] = useState(false);
  const pal = useMemo(() => paletteFor(kit), [kit]);
  const g = generatorFor(category);
  const ref = references.find((r) => r.id === refId);

  useEffect(() => {
    if (!ref) return;
    let live = true;
    setBusy(true);
    loadReferenceImage({ references }, ref.id)
      .then((img) => {
        if (live) setCands(referenceCandidates({ generator: g, kit, reference: img, match, count: 6, seed: 1000 + nonce * 7919 }).candidates);
      })
      .catch((e) => onError(e instanceof Error ? e.message : String(e)))
      .finally(() => live && setBusy(false));
    return () => { live = false; };
  }, [ref?.id, g, kit, match, nonce]); // eslint-disable-line react-hooks/exhaustive-deps

  const askClaude = async () => {
    if (!ref) return;
    setBusy(true);
    try {
      const img = await loadReferenceImage({ references }, ref.id);
      const seed = randomSeed();
      const score = (s: Sprite) => distanceToScore(localScorer.distance(spriteRef(s, kit), img));
      const r = await refineWithAi({
        score,
        propose: async (feedback) => {
          const v = await vibeParams({ prompt: `Match the reference image.${feedback ? " " + feedback : ""}`, generator: g, kit, images: [refDataUrl(ref)] });
          const sprite = g.generate(v.params, kit, seed).rows[0].frames[0];
          return { value: v.params, sprite };
        },
      });
      const sprite = g.generate(r.best, kit, seed).rows[0].frames[0];
      setCands((c) => [{ seed, params: r.best, sprite, score: r.score, ai: true }, ...c.slice(0, 5)]);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const keep = (c: Candidate) => {
    const res = g.generate(c.params, kit, c.seed);
    onKeep(createAsset({
      name: `${String(c.params.style ?? g.label)} (ref)`,
      category,
      kit,
      rows: res.rows,
      fps: res.fps,
      tilemap: res.tilemap,
      meta: { ...res.meta, referenceId: refId },
      source: { kind: "procedural", generator: g.id, params: c.params, seed: c.seed },
    }));
  };

  return (
    <div className="id-overlay" role="dialog" aria-modal="true" aria-label="Generate from reference" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="id-dialog" style={{ maxWidth: 720 }}>
        <h3>Generate from reference</h3>
        {!references.length ? (
          <p>Add an image in the References panel first.</p>
        ) : (
          <>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 8 }}>
              {ref && <img src={refDataUrl(ref)} alt={ref.name} style={{ height: 64 }} />}
              <select aria-label="Reference" value={refId} onChange={(e) => setRefId(e.target.value)}>
                {references.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
              <select aria-label="Category" value={category} onChange={(e) => setCategory(e.target.value as Category)}>
                {CATS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
              <select aria-label="Match" value={match} onChange={(e) => setMatch(e.target.value as Match)}>
                {MATCHES.map((m) => <option key={m} value={m}>match {m}</option>)}
              </select>
              <button onClick={() => setNonce((n) => n + 1)} disabled={busy}>More</button>
              {status?.enabled && <button onClick={() => void askClaude()} disabled={busy} title="Claude proposes params from the image, scored and refined once">Ask Claude</button>}
            </div>
            <div className="var-grid">
              {cands.map((c, i) => (
                <button key={`${nonce}-${i}-${c.seed}`} className="var" title={`Score ${c.score}/100, seed ${c.seed}. Click to keep.`} onClick={() => keep(c)}>
                  <SpriteCanvas sprite={c.sprite} pal={pal} scale={fitScale(c.sprite.w, c.sprite.h, 96)} />
                  <span className="dim">{c.ai ? "Claude " : ""}{c.score}/100{c.params.style ? ` ${c.params.style}` : ""}</span>
                </button>
              ))}
            </div>
          </>
        )}
        <div style={{ marginTop: 8 }}><button onClick={onClose}>Close</button></div>
      </div>
    </div>
  );
}
