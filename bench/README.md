# bench

## The eval harness (`run.ts`, `RESULTS.md`)

`npx tsx bench/run.ts` (add `--quick` for the reduced matrix) runs the pixelizer on 8 synthetic images (`samples.ts`, no stock photos) across modes/eras/presets, checks `validate` + era colour limit, look-lock palette identity and an effect loop, and writes `RESULTS.md`. `bench.test.ts` runs a reduced version under vitest.

## Sprite quality gates (`quality-gate.ts`)

`npx tsx bench/quality-gate.ts` — exits non-zero when a gate fails.

Measures the **keyed subject** across all four eras, four backgrounds and two subjects:

- **gate 0 CONSTANT** — the mask must be identical across eras, or every number below is void.
- **gate 1 RANGE** — luma spread (p95−p5) must not shrink vs the source, measured *inside the same key mask*.
- **gate 2 DENSITY** — at least 5 of 16 value buckets occupied.
- **gate 3 BALANCE** — a skew only counts when it exceeds **the same subject's widest-era skew** by ≥2 buckets.

Gate 3 needs the control subject because ramp skew is a property of the *input*: a dimmed
subject skews era 16 exactly as much as era 8. A gate that fires on the control is measuring
the fixture, not the pixelizer. Current state: 4 failures, all `era 8` on the normal subject,
across all four backgrounds.

**Do not use luma spread alone as the value gate.** A wider p95−p5 gap is not more usable
tononal range — it is a crushed midtone with a blown highlight, and it passes the spread test
while failing the sprite. See `pixel-art-research/audit/S3b-value-gate.md`.

## Looking at the output (`look.sh`, `era-sheet.ts`)

`AGENTS.md` requires opening the preview before claiming a pipeline change works.

```bash
npx tsx bench/era-sheet.ts          # -> pixel-out/era-sheet.png, 4 eras side by side + greyscale
./bench/look.sh pixel-out/era-sheet.png "does the body read as a lit 3D form per column?"
```

`look.sh` uses `GOOGLE_API_KEY` + `gemini-3.8-flash`. The Cline key in this profile has no
balance (402 on any image request) and `vision_analyze` uses a different, revoked key.

When building a contact sheet by hand, three traps that each produced a silently wrong image:

1. **Fill transparent pixels during the upscale.** Upscaling writes alpha 255 everywhere, so
   the keyed-out background becomes opaque black and hides the art.
2. **Blit with separate source and destination indices.** Reading the source at the destination
   offset copies zeros and renders black squares.
3. **Upscale ≥12×.** A 148×86 sheet is unreadable to a vision model; 1586×810 is not.

## Hypothesis probes

Each script tests ONE claim and prints `CONFIRMED` / `NOT SUPPORTED`. Three of the four
hypotheses for the era 8 skew came back NOT SUPPORTED — run them before re-testing ground
they already cover.

| Script | Claim under test | Result |
|---|---|---|
| `value-recheck.ts` | every era preserves value range | CONFIRMED (0/16 lose) |
| `ramp-shape.ts` | era 8's spread is a crushed midtone + blown highlight, not more range | CONFIRMED |
| `nes-budget.ts` | the era 8 pick is unbalanced by count | NOT SUPPORTED (12/12) |
| `nes-hole.ts` | the NES palette leaves a value hole era 16 doesn't have | NOT SUPPORTED (same holes) |
| `chroma-weight-proof.ts` | `chromaWeight` 3 starves the era 8 ramp | NOT SUPPORTED (skew flat vs weight) |
| `skew-origin.ts` | the era 8 skew is a pixelizer defect, not the fixture | PARTLY — real on the normal subject, but a dimmed subject skews era 16 too |
| `hue-by-material.ts` | era 8 breaks hue, not just value | NOT SUPPORTED (era 8 escapes *less*: 23% vs 35%) |

Do not change `chromaWeight` without new evidence — it was measured, not guessed.