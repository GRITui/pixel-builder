# Farming Kit v1 — plan and contracts

The first starter kit: everything a farm-life game needs to start, generated
from one Style Kit and built from **cores plus detail layers**. A character is
one core rig with layers on top (face, hair, costume, hat, bag), so new
characters are new combinations, not new art.

Lanes build in parallel. Each owns files (below) and must keep `npx tsc` and
`npm test` green, keep the **default output of existing generators
byte-identical** (agent recipes and saved assets depend on it), render every
new thing with `scripts/preview.ts` under all 3 kit presets and look at it.

## 1. Characters

### 1.1 / 1.2 Humans: sex x age cores (Lane A)
- `humanoidRig(build, age = "young-adult", sex = "male")` in `src/core/rigs/humanoid.ts`.
  `AGES = ["baby", "kid", "young-adult", "senior", "elder"]`, `SEXES = ["male", "female"]`.
- **Same joint names** (HUMANOID_JOINTS) for every age so every clip and layer fits.
- **Same head size** for every age (chibi): babies and kids are short bodies
  under the same head; seniors stoop slightly, elders more and are a little
  shorter. Female: narrower shoulders, slightly wider hips.
- Register 10 rigs `human-<sex>-<age>` (normal build). `humanoid-slim|normal|stocky`
  stay exactly as they are.
- `character` generator: new params `sex` (default male), `age` (default
  young-adult). Defaults must reproduce today's output exactly.
- Clips keep working on every age (smaller amplitude for baby is fine).

### Layers: face, hair, costume, hat, bag (Lane B)
- New `src/core/rigs/wardrobe.ts`: `WARDROBE: { layer: Layer; attachment: Attachment }[]`,
  `Layer = "face" | "hair" | "costume" | "hat" | "bag"`. Registered as humanoid
  attachments (ids are the contract):
  - face: `face` (exists), `face-beard`, `face-mustache`, `face-glasses`, `face-freckles`, `face-wrinkles`
  - hair: existing `hair-*` plus `hair-bun`, `hair-braids`, `hair-pigtails`, `hair-bob`
  - costume: `costume-overalls`, `costume-dress`, `costume-apron`, `costume-sarong`, `costume-smock`, `costume-sweater`
  - hat: `straw-hat`, `ngob-hat` (exist), `hat-cap`, `hat-bonnet`, `hat-bandana`, `hat-beanie`
  - bag: `basket` (exists), `bag-backpack`, `bag-satchel`, `bag-tote`
- Costumes are overlay parts on chest/hip/shoulder joints using rig slots
  (`top`, `bottom`, `accent`), so a costume recolours with slots. Every layer
  must look right on all 10 human rigs in all 4 directions.
- `character` generator: params `facial`, `costume`, `bag`; extend `headwear`
  options with the new hats. Defaults keep today's output.

### 1.3 Animals (Lane C)
- Species: add `cow`, `sheep`, `fish` (new rig family `fish`,
  `src/core/rigs/fish.ts`, clips `idle`, `swim`). Existing: dog, cat, pig,
  water-buffalo, chicken (+ rooster, duck, horse).
- `age` param `baby | adult` on the `animal` generator (calf, lamb, kitten,
  puppy, piglet, chick, fry): bigger head, shorter legs, smaller body; rigs
  `quadruped-<species>-baby`, `bird-chicken-baby`, `fish-<kind>-baby`.
- Export `FARM_SETS = { normal: [dog, cat, cow, chicken, sheep, fish], sea: [dog, cat, water-buffalo, chicken, pig, fish] }`.
- Cows: white with dark patches, pink muzzle, small horns. Sheep: wool puff body, dark face and legs.

## 2. Buildings (Lane D)
- `building` generator: param `size` (`small | medium | large`, default
  `medium` = today's output). New styles `farmhouse` (house small/medium/big),
  `coop` (small/large). `barn` gets small (today) and large.
- Large variants may use a canvas wider than `sizes.building` (like
  `half-brick`, 1.5x); bottom-centred, 1px margin.
- Classic barn colours: add wall material `cloth2` (red) and trim `sand` (white).

## 3. Environment (Lane E)
- Trees: param `cuttable` (default true for oak/pine/palm). Cuttable trees
  get rows `idle`, `sway`, `chop` (hit shake), `fall`, `stump`. Non-cuttable
  (`old-oak`, a wider landmark tree) gets `idle`, `sway`.
- Bush / flowers / tall-grass (weed): `idle`, `sway`; weed and bush also
  `cut`. Rock / boulder: `idle`, `break`. Stump: `idle`, `chop`.
- Fence: kind `fence` with param `piece` (`h`, `v`, `post`, `corner-ne|nw|se|sw`,
  `t-*`, `gate-closed`, `gate-open`) that joins seamlessly on the 16px grid;
  material wood/stone.
- Soil tiles (seamless, no outline): `tilled-soil-tile`, `watered-soil-tile`,
  `dried-soil-tile` (cracked), `snowed-soil-tile`.
- Row 0 frame 0 of every existing kind stays identical (maps use it).

## 4. Objects, tools and UI (Lane F)
- Tool icons (object kinds): `hoe`, `watering-can`, `axe`, `pickaxe`,
  `sickle`, `hammer`, `fishing-rod`, `seed-bag`; each with rows `icon` and an
  effect sprite `use` (e.g. water drops, wood chips, sparks).
- Held tools: new attachments `axe`, `watering-can`, `pickaxe`, `hammer` in
  `src/core/rigs/tools.ts` with tool-tip joints; new humanoid clips `chop`,
  `water`, `mine`, `fish` in `clips.ts`.
- UI kinds: `clock` (dial, param `hour`), `time-panel` (HH:MM), `weather-icon`
  (`weather`: sunny, cloudy, rain, storm, snow, windy), `season-icon`
  (`season`: spring, summer, fall, winter), `date-panel` (day, weekday,
  season). Text uses a new kit-palette pixel font `src/core/font.ts`
  (digits, A-Z, `:/-`).

## 5. The pack (integrator)
`packs/farming-v1.json` lists every asset (generator, params, name), and a
`generate_pack` tool builds it into a workspace in one call. Docs, skill and
`llms.txt` updated together.

## File ownership
| Lane | Owns |
|---|---|
| A ages | `rigs/humanoid.ts`, `rigs/humanoid.test.ts`, the `age`/`sex` parts of `generators/character.ts` |
| B layers | `rigs/wardrobe.ts` (+ test), the `facial`/`costume`/`bag`/`headwear` parts of `character.ts` |
| C animals | `rigs/quadruped.ts`, `rigs/bird.ts`, `rigs/fish.ts` (+ tests), `generators/animal.ts` |
| D buildings | `generators/building.ts` (+ test) |
| E environment | `generators/environment.ts` (+ test), new `generators/fence.ts` if needed |
| F tools + UI | `generators/object.ts`, `generators/ui.ts`, `core/font.ts`, `rigs/tools.ts`, `rigs/clips.ts` (+ tests) |
| integrator | `rigs/index.ts` registration, `node/tools.ts`, docs, skill, pack |

Lanes may append one line to the arrays in `rigs/index.ts` for their own
registrations; anything else outside your files, describe it in your report.
