# `.aseprite` samples

Reference output from `pixel-builder export-asset --format aseprite`, one per
kit, committed so the exporter's real output can be diffed and re-checked
without regenerating it.

| File | Kit | Source |
| --- | --- | --- |
| `kit-default.aseprite` | `kit-default` | `generate-rigged`, rig `humanoid-normal`, clip `walk` |
| `kit-gameboy.aseprite` | `kit-gameboy` | same |
| `kit-neon.aseprite` | `kit-neon` | same |

All three are 32x32, 8-bit indexed, 16 frames over 4 tags, 3 rig-part layers
(`core`, `hair-short`, `face`), 44 zlib cels and a 91-entry palette (index 0
transparent, then the kit's flattened ramps).

## Verify

```bash
node scripts/verify-aseprite-samples.mjs docs/samples/aseprite/*.aseprite
```

`scripts/verify-aseprite-samples.mjs` is a deliberately independent structural
parser: it is written from the Aseprite format spec and shares no code with
either the encoder (`src/core/aseprite.ts`) or the round-trip reader
(`src/core/aseprite.test.ts`), so a shared misreading of the format cannot make
all three agree. It checks the header, walks every frame and chunk boundary,
inflates the cels, and asserts the palette, layer and tag fields.

## Regenerate

The exporter writes the asset's real id, which `generate-rigged` derives from
the rig and variant rather than the `--name` you pass:

```bash
pxb() { ./node_modules/.bin/tsx src/node/cli.ts --workspace "$1" "${@:2}"; }
for kit in kit-default kit-gameboy kit-neon; do
  ws="/tmp/ase-$kit"; mkdir -p "$ws"
  id=$(pxb "$ws" generate-rigged hero --rig humanoid-normal --clips walk \
        | sed -n 's/.*\[\(asset-[a-z0-9-]*\)\].*/\1/p')
  pxb "$ws" export-asset "$id" --format aseprite
  cp "$ws"/characters/*.aseprite "docs/samples/aseprite/$kit.aseprite"
done
node scripts/verify-aseprite-samples.mjs docs/samples/aseprite/*.aseprite
```

Regenerating should produce byte-identical files for the same kit: the exporter
is deterministic.