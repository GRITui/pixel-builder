/** Contact sheet of every MMO ui kind x skin: npx tsx scripts/mmo-sheet.ts out.png [kitId] */
import { KIT_PRESETS } from "../src/core/kit";
import { uiGenerator } from "../src/core/generators/ui";
import { defaults } from "../src/core/generators/types";
import { savePng } from "./sheet";

const [, , out = "mmo-sheet.png", kitId = "kit-hd-rich", skinArg = "mmo-gold"] = process.argv;
const kit = KIT_PRESETS.find((k) => k.id === kitId) ?? KIT_PRESETS[0];
const kinds: [string, object][] = [
  ["unit-frame", { portrait: "silhouette" }], ["unit-frame", { portrait: "hero" }], ["minimap-frame", {}], ["minimap-frame", { shape: "square" }],
  ["skill-bar", { cooldown: 4 }], ["chat-panel", {}], ["quest-tracker", {}], ["tooltip", {}], ["nameplate", { name: "SLIME", tone: "red", hp: 60 }],
  ["damage-numbers", {}], ["damage-numbers", { tone: "yellow", crit: true }], ["damage-numbers", { tone: "red", amount: 42 }],
  ["bar", { accent: "cloth2" }], ["panel", {}], ["button", {}], ["slot", {}],
];
const sheet = [skinArg].flatMap((skin) =>
  kinds.map(([kind, extra]) => uiGenerator.generate({ ...defaults(uiGenerator), kind, skin, ...extra } as never, kit, 2).rows.flatMap((r) => r.frames.slice(0, kind === "skill-bar" && r.name === "sweep" ? 9 : 4))),
);
savePng(out, sheet, kit, Number(process.env.SCALE ?? 3));
