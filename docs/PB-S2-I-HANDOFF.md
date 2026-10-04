# PB-S2-I (#18) — handoff after the board row was deleted

Card: `t_216e748d` (PB-S2-I: AI region edit / inpaint — lane I)
Repo: `/Users/grit/repos/pixel-builder`, branch `claude/keen-gates-gxtoff`
Commit: **`be02d33`** — "AI region edit (inpaint): editor tool, /api/inpaint, edit_region MCP tool (#18)"

## Board state: the card no longer exists

All four terminal transitions were rejected server-side:

| Call | Response |
|---|---|
| `kanban_show` | `task t_216e748d not found` |
| `kanban_complete` | `unknown id, stale run, or already terminal` |
| `kanban_request_review` | `task not found` |
| `kanban_block` | `unknown id or not in running/ready` |
| `kanban_heartbeat` | `unknown id or not running` |

Verified against the board DB directly (`~/.hermes/kanban.db`, the same file
`HERMES_KANBAN_DB` points at): `select count(*) from tasks where id='t_216e748d'`
returns **0**. No builder card is in `running`. Every sibling Sprint-2 card
survives (`t_c3dbcfb0` UX spec, `t_f191f716` docs sync, `t_1a59b806` parent
merge — all `done`), so this is not a DB swap or a board-resolution problem on my
side: this one row was deleted mid-run, while my earlier `kanban_comment`
(written ~17:40) still succeeded on it.

**To close this out:** re-file or restore the card, then mark it done against
`be02d33`. Nothing else is outstanding.

## What shipped

One pure core, `src/core/inpaint.ts` (265 lines), shared by all three surfaces so
they cannot drift:

- rect + lasso masks, masked-only merge, and the hard guarantee that unmasked
  pixels are byte-identical (merge -> `finalize` -> force-restore every unmasked
  cell, so a new silhouette cannot outline into untouched space);
- **server** `POST /api/inpaint` — `{sprite|frames, mask, prompt, kit}`; the model
  sees the whole sprite as legend rows for context, returns the merged frame(s);
- **agent** `edit_region {id, row, frame, rect|mask, prompt?|rows?, all_frames}` —
  agent-supplied `rows` work with no API key, prompt mode routes through the local
  API server (`PIXEL_API_URL`, default `127.0.0.1:8787`), rigged assets prefer the
  rig attachment path so every clip and direction follows the edit;
- **editor** Inpaint tool (key A) + Lasso sub-toggle, dashed region overlay dimming
  everything outside it, and an "AI edit" panel: prompt, All frames,
  Generate/Apply/Discard, Before/After pair, canonical AI-off and no-region states;
  Esc clears the region before closing the editor.

`callTool` stays synchronous for the 26 existing tools; async goes through a new
`callToolAsync`, so the CLI, MCP server and internal callers are untouched.

## Verification

- 81/81 across my suites: `inpaint.test.ts` 13, `editRegion.test.ts` 10,
  `tools.test.ts` 34, `server/prompts.test.ts` 18, `docs-sync.test.ts` 6.
- Full suite 669/669 over 38 files, `tsc` clean, `vite build` green (17:53–17:58).
- Headless before/after screenshots committed in `docs/screenshots/`
  (`inpaint-01-editor-opened.png` .. `inpaint-04-after-applied.png`), captured by
  `scripts/capture-inpaint.mjs` over CDP. Confirmed by eye: only masked pixels
  changed (arms/belt/skirt untouched), Apply/Discard appeared, Before/After
  populated.

Docs contract updated together per `AGENTS.md`: `tools.ts`, `SKILL.md`, its
`.claude` copy, `docs/integrations.md`, `llms.txt`.

Two real bugs the headless run caught that unit tests did not: the marquee
collapsed to 1x1 because React batches pointer moves against a stale `drag`
closure (fixed with a ref, mirroring the existing `strokeRef` pattern), and
`maskBounds` / polygon helpers were missing.

## Two hazards for whoever picks this up

**1. Concurrent agent in the same working tree.** Files I never touched changed
under me mid-run (`palette.ts`, `kit.ts`, `types.ts`, `README.md`, new
`aseprite.ts`, `rigs/detail.ts`). I ran one `git stash` to isolate a test
failure, which briefly stashed *their* uncommitted work; it restored cleanly and I
stopped, but with a shared tree any `stash` / `checkout` / `reset` hits both
lanes. **Parallel lanes need separate git worktrees.**

**2. `server/prompts.ts` is edited by both lanes.** I staged only my hunks via a
filtered `git apply --cached`; the other lane's `DetailMode` / `DETAILS` /
`detail:` kit-field lines stayed unstaged. They then committed on top of mine
(`633bc2f`), so history is clean — but a plain `git add server/prompts.ts` from
their side will re-stage my inpaint additions into their commit.

**Remaining red on the branch is entirely the `detail` lane**, not this card:
`src/core/detail.test.ts` (7 tests) plus `map` / `object` / `wardrobe`, and one
tsc error (`rgbToHsl` declared but not exported from `palette.ts`). Zero tsc errors
in any file of this card. Re-run `npm run build && npx vitest run` after that lane
lands, before merging. `tools.test.ts` passes 34/34 in isolation and only fails
while another lane is editing generator files mid-run.