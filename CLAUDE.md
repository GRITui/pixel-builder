# Pixel Builder

Vite + React + TypeScript app with a tiny Node API (`server/`) for Claude.
See `docs/BUILD_PLAN.md` for architecture, the consistency model and file ownership.

- `npm run dev` — web (5173) + API (8787). `npm test` — vitest. `npx tsc` — typecheck.
- Preview a generator without a browser: `npx tsx scripts/preview.ts <id> out.png '[{}]'`.
- Sprites store palette *indices* (`colorIndex(material, level)`), never colours.
- Volumes are drawn with the lit `Painter`; every prop goes through `finalize`.

@AGENTS.md
