# Rig method

A rigged character is a **skeleton of joints** plus **declarative parts**
attached to them. Animation is **poses** (joint offsets per frame), so every
rig gets every clip; **attachments** (hats, tools, baskets) are parts pinned to
a joint once and follow every frame and direction. Everything is drawn by the
lit `Painter` and finished with `finalize`, so rigged sprites keep the kit's
light, shade steps and outline. Code: `src/core/rig.ts`; reference rig:
`src/core/rigs/example.ts`; tests: `src/core/rig.test.ts`.

## Data model (plain JSON)

| Type | What |
|---|---|
| `RigDef` | `grid` (design grid, e.g. 32), `joints`, `parts`, default material `slots` |
| `Joint` | `id`, `parent`, `rest` position on the grid, per view (`down` / `side` / `up`) or one value for all |
| `PartDef` | `ellipse` / `box` at a joint, `limb` (capsule) between two joints, `pixels` (legend-char rows pinned at a joint). Common: `id`, `z` (per view allowed), `views`, `slot`, `tone` |
| `Clip` | `id`, `fps`, `frames`: a list of `Pose`s, or per-view lists |
| `Pose` | `{ jointId: [dx, dy] }`: offsets in grid units; children inherit their parent's offset |
| `Attachment` | `id`, `name`, `parts`; a part with an existing id replaces it (e.g. swap the hair) |

Views: `down`, `side`, `up`; `left` renders as a mirror of `side` with lighting
recomputed. `renderRig({ rig, kit, slots, attachments }, clips)` returns rows
named `<clip>-<dir>`; `renderRigFrame` renders one frame; `validateRig` returns
readable errors for agent- or hand-written rigs.

## Rules for new rigs, clips and attachments

- Author on the design grid; the renderer scales to `kit.sizes.character`.
  `pixels` parts are 1px per cell (details only: eyes, buttons, small tools).
- Volumes use `ellipse` / `box` / `limb` so lighting stays consistent; never
  shade by hand in `pixels`.
- Keep a 1px margin inside the canvas for the outline.
- Respect `proportions(kit)`: a standing humanoid fills ~84% of its canvas.
- Clips must work for every rig with the same joint names; unknown joints in a
  pose are an error, missing ones mean "no offset".
- Always render the result (see `scripts/preview.ts`) and look at it in all
  three kit presets before opening a PR.
