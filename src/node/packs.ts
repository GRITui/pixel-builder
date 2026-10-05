// Asset packs: named lists of generate_asset / generate_rigged calls that build a
// starter set in one go (generate_pack). Entries are plain tool inputs, so a pack is
// exactly what an agent would have typed, and it stays reproducible (fixed seeds).

export interface PackEntryProcedural {
  name: string;
  generator: string;
  params?: Record<string, string | number | boolean>;
  seed?: number;
  /** Free-form labels for `only` filtering (e.g. "sea", "normal", "tool"). */
  tags?: string[];
}

export interface PackEntryRigged {
  name: string;
  rig: string;
  slots?: Record<string, string>;
  attachments?: string[];
  clips?: string[];
  tags?: string[];
}

export type PackEntry = PackEntryProcedural | PackEntryRigged;

export interface PackManifest {
  id: string;
  name: string;
  description: string;
  entries: PackEntry[];
}

export const isRigged = (e: PackEntry): e is PackEntryRigged => "rig" in e;

const AGES = ["baby", "kid", "young-adult", "senior", "elder"] as const;
const SEXES = ["male", "female"] as const;
const FENCE = ["h", "v", "post", "corner-ne", "corner-nw", "corner-se", "corner-sw", "t-n", "t-e", "t-s", "t-w", "cross", "gate-closed", "gate-open"];
const ANIMALS: [species: string, sets: string[]][] = [
  ["dog", ["normal", "sea"]], ["cat", ["normal", "sea"]], ["chicken", ["normal", "sea"]], ["fish", ["normal", "sea"]],
  ["cow", ["normal"]], ["sheep", ["normal"]], ["water-buffalo", ["sea"]], ["pig", ["sea"]],
];
const GROUND_KINDS = ["ground-top", "ground-edge-left", "ground-edge-right", "ground-fill", "ground-wall-left", "ground-wall-right", "ground-inner-left", "ground-inner-right", "slope-up", "slope-down"];
const g = (name: string, generator: string, params: PackEntryProcedural["params"], tags: string[], seed = 1): PackEntry => ({ name, generator, params, seed, tags });
/** The player farmer holding each tool, with the matching work clip. */
const worker = (tool: string, clip: string): PackEntry => ({
  name: `farmer-${clip}`,
  rig: "human-male-young-adult",
  attachments: ["costume-overalls", "straw-hat", tool],
  clips: ["idle", "walk", clip],
  tags: ["character", "player", "tool-anim"],
});

/** Farming Kit v1 (docs/FARMING_KIT.md): cores + layers, farm animals, buildings, environment, tools and HUD. */
const FARMING_V1: PackManifest = {
  id: "farming-v1",
  name: "Farming Kit v1",
  description: "Starter farm-life set: 10 human cores (sex x age) + layered villagers, normal and Southeast-Asian farm animals (adult + baby), farmhouses, barns, coops, cuttable trees, props with sprites, fences, soil tiles, tool icons with use sprites, the farmer's tool animations and a time/weather/date/season HUD.",
  entries: [
    // 1. characters: cores, then villagers built from layers
    ...SEXES.flatMap((sex) => AGES.map((age) => g(`human-${sex}-${age}`, "character", { sex, age, hair_style: sex === "female" ? "long" : "short" }, ["character", "core"]))),
    g("villager-farmer", "character", { costume: "overalls", headwear: "straw-hat", bag: "satchel" }, ["character", "villager", "normal"]),
    g("villager-farmer-wife", "character", { sex: "female", hair_style: "braids", costume: "dress", headwear: "bonnet", bag: "basket" }, ["character", "villager", "normal"]),
    g("villager-grandpa", "character", { age: "elder", facial: "beard", hair: "stone", costume: "smock", headwear: "cap" }, ["character", "villager"]),
    g("villager-grandma", "character", { sex: "female", age: "elder", hair_style: "bun", hair: "stone", facial: "glasses", costume: "apron" }, ["character", "villager"]),
    g("villager-uncle", "character", { age: "senior", facial: "mustache", costume: "sweater", headwear: "beanie" }, ["character", "villager"]),
    g("villager-kid-boy", "character", { age: "kid", facial: "freckles", headwear: "cap", bag: "backpack" }, ["character", "villager"]),
    g("villager-kid-girl", "character", { sex: "female", age: "kid", hair_style: "pigtails", costume: "dress" }, ["character", "villager"]),
    g("villager-baby", "character", { age: "baby", costume: "smock", headwear: "beanie" }, ["character", "villager"]),
    g("villager-sea-farmer", "character", { costume: "sarong", headwear: "ngob-hat", bag: "basket", skin: "skin" }, ["character", "villager", "sea"]),
    g("villager-sea-farmer-woman", "character", { sex: "female", hair_style: "bun", costume: "sarong", headwear: "bandana", bag: "tote" }, ["character", "villager", "sea"]),
    worker("hoe", "farm"), worker("axe", "chop"), worker("watering-can", "water"), worker("pickaxe", "mine"), worker("fishing-rod", "fish"),
    // animals: normal farm and Southeast-Asian farm, adult and baby
    ...ANIMALS.flatMap(([species, sets]) => (["adult", "baby"] as const).map((age) => g(`animal-${species}${age === "baby" ? "-baby" : ""}`, "animal", { species, age }, ["animal", ...sets]))),
    // 2. buildings
    ...(["small", "medium", "large"] as const).map((size) => g(`house-${size}`, "building", { style: "farmhouse", size, wall: "sand" }, ["building", "house"])),
    g("barn-small", "building", { style: "barn", size: "small" }, ["building", "barn"]),
    g("barn-large", "building", { style: "barn", size: "large", wall: "cloth2", trim: "sand" }, ["building", "barn"]),
    g("coop-small", "building", { style: "coop", size: "small" }, ["building", "coop"]),
    g("coop-large", "building", { style: "coop", size: "large" }, ["building", "coop"]),
    // 3. environment
    ...["oak", "pine", "palm"].map((kind) => g(`tree-${kind}`, "environment", { kind, cuttable: true }, ["environment", "tree", "cuttable"])),
    g("tree-old-oak", "environment", { kind: "old-oak" }, ["environment", "tree", "landmark"]),
    g("bush", "environment", { kind: "bush" }, ["environment", "prop"]),
    g("flowers-red", "environment", { kind: "flowers", accent: "cloth2" }, ["environment", "prop"]),
    g("flowers-yellow", "environment", { kind: "flowers", accent: "gold" }, ["environment", "prop"]),
    g("weed", "environment", { kind: "tall-grass" }, ["environment", "prop"]),
    g("rock", "environment", { kind: "rock" }, ["environment", "prop"]),
    g("boulder", "environment", { kind: "boulder" }, ["environment", "prop"]),
    g("stump", "environment", { kind: "stump" }, ["environment", "prop"]),
    ...FENCE.map((piece) => g(`fence-${piece}`, "environment", { kind: "fence", piece }, ["environment", "fence"])),
    ...["tilled-soil", "watered-soil", "dried-soil", "snowed-soil", "grass", "dirt"].map((t) => g(`tile-${t}`, "environment", { kind: `${t}-tile` }, ["environment", "tile"])),
    // 4. tools (icon + use sprite) and HUD
    ...["hoe", "watering-can", "tool-axe", "pickaxe", "sickle", "hammer", "fishing-rod", "seed-bag"].map((kind) => g(`tool-${kind.replace(/^tool-/, "")}`, "object", { kind }, ["object", "tool"])),
    g("ui-clock", "ui", { kind: "clock", hour: 9, material: "wood" }, ["ui", "hud"]),
    g("ui-time", "ui", { kind: "time-panel", hour: 6, minute: 30, material: "wood" }, ["ui", "hud"]),
    g("ui-date", "ui", { kind: "date-panel", day: 1, weekday: "mon", season: "spring", material: "wood" }, ["ui", "hud"]),
    ...["sunny", "cloudy", "rain", "storm", "snow", "windy"].map((weather) => g(`ui-weather-${weather}`, "ui", { kind: "weather-icon", weather }, ["ui", "hud", "weather"])),
    ...["spring", "summer", "fall", "winter"].map((season) => g(`ui-season-${season}`, "ui", { kind: "season-icon", season }, ["ui", "hud", "season"])),
    g("ui-panel", "ui", { kind: "panel", material: "wood", style: "ornate" }, ["ui"]),
    g("ui-slot", "ui", { kind: "slot", material: "wood", style: "inset" }, ["ui"]),
    g("ui-button", "ui", { kind: "button", material: "wood" }, ["ui"]),
    g("ui-stamina", "ui", { kind: "bar", material: "wood", accent: "grass" }, ["ui", "hud"]),
  ],
};

/** Side-view starter (#20): use with the `kit-side` kit. Hero (profile rig + platformer clips), enemies, tiles, platform, ladder, parallax layers, level. */
const SIDE_VIEW_STARTER: PackManifest = {
  id: "side-view-starter",
  name: "Side-view starter",
  description: "Platformer starter for the kit-side camera: a side hero with idle/walk/run/jump/fall/climb/crouch, slime and beetle enemies, the ground tile set with slopes, a one-way platform, a ladder, a front-on house, sky/hills/trees parallax layers and a generated level.",
  entries: [
    { name: "hero-side", rig: "humanoid-side", attachments: ["costume-overalls", "straw-hat"], clips: ["idle", "walk", "run", "jump", "fall", "climb", "crouch"], tags: ["character", "player"] },
    g("enemy-slime", "sideenemy", { kind: "slime" }, ["character", "enemy"]),
    g("enemy-beetle", "sideenemy", { kind: "beetle", body: "cloth2" }, ["character", "enemy"]),
    ...GROUND_KINDS.map((kind) => g(`tile-${kind}`, "sideview", { kind }, ["environment", "tile"])),
    g("platform", "sideview", { kind: "platform", cols: 3 }, ["environment", "platform"]),
    g("ladder", "sideview", { kind: "ladder", rows: 2 }, ["environment", "ladder"]),
    g("house-side", "sideview", { kind: "building", cols: 6 }, ["building"]),
    g("bg-sky", "sideview", { kind: "bg-sky" }, ["environment", "background"]),
    g("bg-hills", "sideview", { kind: "bg-hills" }, ["environment", "background"]),
    g("bg-trees", "sideview", { kind: "bg-trees" }, ["environment", "background"]),
    g("level-1", "sidelevel", { cols: 48, rows: 14, house: 7 }, ["map", "level"], 3),
  ],
};

const MONSTER_CLIPS_ALL = ["idle", "walk", "attack", "hurt", "die"];
const mon = (rig: string): PackEntry => ({ name: rig.replace(/^monster-/, ""), rig, clips: MONSTER_CLIPS_ALL, tags: ["character", "monster"] });

/** Monsters v1 (#44): top-down monsters, every variant with idle, walk, attack, hurt (hit flash) and die (puff). */
const MONSTERS_V1: PackManifest = {
  id: "monsters-v1",
  name: "Monsters v1",
  description: "Cute top-down monsters that animate in 4 directions (8 with directions:8): mushroom (red, brown, poison, king), slime (green, blue, fire, metal), snapping plant, bat, wolf and skeleton. Clips idle, walk, attack (with anticipation), hurt (white hit flash) and die (dissolves into a puff).",
  entries: ["mushroom-red", "mushroom-brown", "mushroom-poison", "mushroom-king", "slime-green", "slime-blue", "slime-fire", "slime-metal", "plant", "bat", "wolf", "skeleton"].map((m) => mon(`monster-${m}`)),
};

/** Isometric starter (#17): use with the `kit-iso` kit. Hero with idle/walk on the four iso diagonals, ground tiles (flat and raised), props, a house and a map. */
const ISO_STARTER: PackManifest = {
  id: "iso-starter",
  name: "Isometric starter",
  description: "2:1 dimetric starter for the kit-iso camera: a hero with idle and walk rows for the four iso diagonals (walk-se, walk-sw, walk-ne, walk-nw), grass/dirt/sand/water/stone diamond tiles plus raised grass and stone blocks, tree, pine, rock, bush, fence segments along both iso axes, a gable house and a generated isometric map (Tiled isometric export with a props object layer).",
  entries: [
    { name: "hero-iso", rig: "human-male-young-adult", attachments: ["costume-overalls", "straw-hat"], clips: ["idle", "walk"], tags: ["character", "player"] },
    ...(["grass", "dirt", "sand", "water", "stone"] as const).map((kind) => g(`iso-tile-${kind}`, "iso-tile", { kind }, ["environment", "tile"])),
    g("iso-block-grass", "iso-tile", { kind: "grass", height: 1 }, ["environment", "tile", "block"]),
    g("iso-block-stone", "iso-tile", { kind: "stone", height: 2 }, ["environment", "tile", "block"]),
    ...(["tree", "pine", "rock", "bush", "fence-se", "fence-sw", "post"] as const).map((kind) => g(`iso-${kind}`, "iso-prop", { kind }, ["environment", "prop"])),
    g("iso-house", "iso-building", { size: 2 }, ["building", "house"]),
    g("iso-map", "isomap", { cols: 14, rows: 14 }, ["map"], 2),
    // world dressing (kit-iso): buildings, environment props, objects, crops
    ...(["cottage", "shop", "barn", "tower", "keep", "stilt-house", "half-brick", "farmhouse", "coop"] as const).map((style) => g(`iso-building-${style}`, "building", { style }, ["building"])),
    g("iso-building-dome", "building", { style: "cottage", roof_style: "dome", roof: "gold" }, ["building"]),
    ...(["palm", "dead-tree", "boulder", "flowers", "mushroom", "tall-grass", "stump", "crystal"] as const).map((kind) => g(`iso-env-${kind}`, "environment", { kind }, ["environment", "prop"])),
    ...(["well", "haystack", "gate-closed", "crop", "tree-hd"] as const).map((kind) => g(`iso-${kind}`, "iso-prop", { kind }, ["environment", "prop"])),
    g("iso-tile-soil", "iso-tile", { kind: "soil" }, ["environment", "tile"]),
    ...(["chest", "chest-open", "barrel", "crate", "torch", "sign", "pot"] as const).map((kind) => g(`iso-obj-${kind}`, "object", { kind }, ["object", "prop"])),
    g("iso-village", "isomap", { cols: 18, rows: 16, water: 0.12, hills: false, village: 4 }, ["map"], 4),
  ],
};

export const PACKS: PackManifest[] = [FARMING_V1, SIDE_VIEW_STARTER, MONSTERS_V1, ISO_STARTER];

export const packById = (id: string) => PACKS.find((p) => p.id === id);
