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
| `Attachment` | `id`, `name`, `parts`, optional `joints` (extra joints such as a tool tip, posed by clips); a part with an existing id replaces it (e.g. swap the hair) |

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

## Eight directions

`renderRig(r, clips, { directions: 8 })` adds two 3/4 views, `down-side` and
`up-side` (right-facing; the left diagonals are lit mirrors, like `left`).
Rows are `<clip>-<dir>` in the order down, down-right, right, up-right, up,
up-left, left, down-left; the default (4) is unchanged.

- Joints: a missing diagonal rest is the midpoint of the front/back view and the side view.
- Parts: a part that lists a diagonal view appears exactly there; otherwise it follows `side`
  (down-only/up-only parts are hidden; face-like ids are dropped in `up-side`). `noDiag: true` hides a
  side part when a dedicated diagonal part replaces it.
- Clips: a per-view clip without diagonal frames borrows the `side` frames with x scaled by 0.75.
- Isometric camera (`camera: "iso"`, `map isometric`) is not implemented yet (follow-up on #17).
