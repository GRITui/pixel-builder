# Snake assets

All art is made with the pixelizer (`npm run snake:assets`, source in `examples/snake/make-assets.ts`).
Procedural "realistic" high-res sources (`render.ts`, `scene.ts`, no stock photos) go through era 16 with ONE locked look
(`snake-16bit`, preset vivid; palette in `palette.json`, look saved to `examples/snake/looks/`).
The look's palette comes from pixelizing an atlas containing every subject.

| File | Size | How |
|---|---|---|
| head.png | 16x16 | sprite mode; head faces right; eyes (3x3 blocks) and tongue pixels hand-placed from palette colours |
| body.png | 16x16 | sprite mode; horizontal, band rows 3..12; edge columns copied/mirrored for seamless joins |
| corner.png | 16x16 | sprite mode; joins LEFT and BOTTOM edges; edge pixels copied from body |
| tail.png | 16x16 | sprite mode; tip points LEFT, joins on its RIGHT edge |
| apple.png, gold.png | 16x16 | sprite mode; apple gets a 2px specular glint |
| grass-a.png, grass-b.png | 16x16 | tile mode; b shares a's outer ring so they tile with each other |
| wall.png | 16x16 | scene mode on a 3x3 tiling, centre cropped (exactly seamless) |
| title.png | 320x240 | scene mode; calm sky at top-centre for the title text |

Snake lighting is top-down (symmetric), so rotating parts by 90 degrees stays consistent.
Every pixel uses a palette.json colour; alpha is 0 or 255.
