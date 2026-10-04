# #36 rich detail — standard vs rich, side by side

Every sheet here has **standard on the left and rich on the right**, same
generator, same seed, same params, same pixel size. Only the kit's `detail`
field differs (`standard` is the shipped look; `rich` is this lane's work).

Regenerate any of them with:

```bash
SCALE=6 tsx scripts/detail-preview.ts docs/art/detail-36/character-kit-default.png character kit-default
SCALE=6 tsx scripts/detail-preview.ts docs/art/detail-36/character-kit-gameboy.png character kit-gameboy
SCALE=6 tsx scripts/detail-preview.ts docs/art/detail-36/character-kit-neon.png character kit-neon
SCALE=5 tsx scripts/detail-preview.ts docs/art/detail-36/animal-kit-default.png animal kit-default
SCALE=4 tsx scripts/detail-preview.ts docs/art/detail-36/building-kit-default.png building kit-default
```

## What rich adds

- **Hue-shifted shading** — shadows swing cool, highlights warm, so volumes read
  as lit rather than merely shaded. Skipped on achromatic ramps and on kits like
  gameboy whose steps are duplicates, so no kit gains colours.
- **Per-material outline (sel-out)** — each part is inked in its own darkest
  shade instead of one global ink, and overlapping parts get a separating seam.
- **Micro-detail** — eye highlights, a nose shade, elbow and knee folds, a shirt
  seam and pocket, a hair specular band, boot soles and laces (humanoids only).
- **Rim light** on the shadow-side edge.
- **Anti-aliasing** on curved silhouettes, one step below the edge's own shade.

## What it deliberately does not do

- The silhouette never grows: the AA band replaces the outline ring rather than
  adding one outside it, so a rich sprite occupies the same pixels as its standard
  twin and world scale is unchanged.
- `standard` output is byte-identical to a kit with no `detail` field.
- Ground tiles are untouched (they must tile seamlessly).
- Hand-painted rows (`paint_asset`) are left exactly as painted.

## Art-designer notes per sheet

| Sheet | What to check |
|---|---|
| `character-kit-default.png` | The main comparison. 32px, warm palette. Look for the per-material outline on the hat brim vs the hair, and the eye glints. |
| `character-kit-gameboy.png` | 16px, 4-tone. The hard case: rich must not turn to mud at this size, and the black outline must stay a clean closed loop. |
| `character-kit-neon.png` | 5 shade steps, `dither: true`. `kit-neon` dithers heavily *in standard too* (measured: 93 speckled pixels before any of this lane's passes, 106 after), so read the dither on both columns as the kit's own choice, not as rich noise. Coloured per-material outlines work best where adjacent materials differ in hue; same-hue neighbours (green hood vs green apron) stay soft by nature. |
| `animal-kit-default.png` | Animals pick up the per-material outline and rim light cleanly, with no haloing. |
| `building-kit-default.png` | Buildings pick up the hue shift and sel-out. Large flat wall areas are where a bad hue shift would show, so check them first. |