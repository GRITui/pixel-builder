import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { emptyProject, mergeProjects, parseProject, serializeProject } from "../core/project";
import { EXAMPLE_RIG } from "../core/rigs/example";
import { main } from "./cli";
import { createMcpServer } from "./mcp";
import { callTool } from "./tools";
import { Workspace } from "./workspace";

let dir: string;
let ws: Workspace;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pb-rig-"));
  ws = new Workspace(join(dir, "ws"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));
const data = (name: string, input: unknown = {}): any => callTool(ws, name, input).data;

describe("project format", () => {
  it("loads old files without rig arrays and round-trips custom ones", () => {
    const old = serializeProject(emptyProject());
    expect(old).not.toContain("rigs");
    const { project, warnings } = parseProject(old);
    expect(warnings).toEqual([]);
    expect(project.rigs).toBeUndefined();
    const p = { ...emptyProject(), rigs: [EXAMPLE_RIG], clips: [{ id: "c", fps: 4, frames: [{}] }], attachments: [{ id: "a", name: "A", parts: [] }] };
    const back = parseProject(serializeProject(p)).project;
    expect(back.rigs?.[0].id).toBe(EXAMPLE_RIG.id);
    expect(back.clips).toHaveLength(1);
    expect(mergeProjects(p, back).rigs).toHaveLength(1);
    expect(parseProject(JSON.stringify({ ...p, rigs: [{ nope: 1 }] })).warnings.join()).toMatch(/invalid rig/);
  });
});

describe("rig tools", () => {
  it("lists rigs, clips, attachments with family", () => {
    expect(data("list_rigs").rigs[0]).toMatchObject({ family: "humanoid" });
    expect(data("list_clips").clips.map((c: any) => c.id)).toContain("walk");
    expect(data("list_attachments").attachments.map((a: any) => a.id)).toContain("ngob-hat");
  });

  it("e2e: generate rigged, attach hat, export spritesheet, rerender", () => {
    const rig = data("list_rigs").rigs[0].id;
    const clipIds = data("list_clips", { family: "humanoid" }).clips.map((c: any) => c.id);
    const clips = ["walk", ...(clipIds.includes("farm") ? ["farm"] : [])];
    const g = callTool(ws, "generate_rigged", { rig, clips, name: "farmer" });
    const a = (g.data as any).asset;
    expect(a.source.kind).toBe("rigged");
    expect(a.rows.map((r: any) => r.name)).toContain("walk-down");
    expect(g.images).toHaveLength(1);
    const before = JSON.stringify(ws.load().assets[0].rows);
    const t = callTool(ws, "attach", { id: a.id, add: ["ngob-hat"] });
    expect((t.data as any).asset.source.rig.attachments).toEqual(["ngob-hat"]);
    expect(JSON.stringify(ws.load().assets[0].rows)).not.toBe(before);
    const files = (t.data as any).asset.files as string[];
    expect(files.some((f) => f.endsWith(".png"))).toBe(true);
    expect(files.every(existsSync)).toBe(true);
    const sheet = JSON.parse(readFileSync(files.find((f) => f.endsWith(".json"))!, "utf8"));
    expect(JSON.stringify(sheet)).toContain("walk-down");
    expect(data("attach", { id: a.id, remove: ["ngob-hat"] }).asset.source.rig.attachments).toEqual([]);
    expect(data("rerender_assets").rerendered).toBe(1);
    expect(() => callTool(ws, "attach", { id: a.id, remove: ["ngob-hat"] })).toThrow(/no attachment/);
    expect(() => callTool(ws, "generate_rigged", { rig: "nope" })).toThrow(/Unknown rig 'nope'/);
    expect(() => callTool(ws, "generate_rigged", { rig, attachments: ["ngob-hta"] })).toThrow(/Did you mean 'ngob-hat'/);
  });

  it("creates custom rig, clip and attachment and renders with them", () => {
    const rig = { ...EXAMPLE_RIG, id: "my-biped", name: "Mine" };
    expect(callTool(ws, "create_rig", { rig }).images).toHaveLength(1);
    expect(() => callTool(ws, "create_rig", { rig: EXAMPLE_RIG })).toThrow(/built-in/);
    expect(() => callTool(ws, "create_rig", { rig: { ...rig, parts: [{ id: "x", kind: "ellipse", joint: "nowhere", rx: 1, ry: 1, z: 1 }] } })).toThrow(/unknown joint nowhere/);
    expect(() => callTool(ws, "create_rig", { rig: { id: "bad" } })).toThrow(/Invalid rig/);
    expect(() => callTool(ws, "create_rig", { rig: { ...rig, id: "slotty", parts: [{ ...rig.parts[0], slot: "nope" }] } })).toThrow(/unknown slot 'nope'/);
    expect(() => callTool(ws, "create_attachment", { attachment: { id: "empty", name: "empty", parts: [] } })).toThrow(/parts' is empty/);
    expect(() => callTool(ws, "create_clip", { clip: { id: "bob", fps: 4, frames: [{ wing: [0, 1] }] }, rig: "my-biped" })).toThrow(/unknown joint 'wing'/);
    expect(data("create_clip", { clip: { id: "bob", fps: 4, frames: [{}, { head: [0, 1] }] }, rig: "my-biped" }).clip.id).toBe("bob");
    const att = { id: "dot", name: "Dot", parts: [{ id: "dot", kind: "ellipse", joint: "head", rx: 2, ry: 2, z: 9 }] };
    expect(data("create_attachment", { attachment: att, rig: "my-biped" }).attachment.id).toBe("dot");
    expect(data("list_rigs", { family: "custom" }).rigs[0].id).toBe("my-biped");
    const g = data("generate_rigged", { rig: "my-biped", clips: ["bob"], attachments: ["dot"] });
    expect(g.asset.rows[0].frames).toBe(2);
    expect(ws.load().rigs).toHaveLength(1);
    expect(data("rerender_assets").rerendered).toBe(1);
  });
});

describe("rig tools over CLI and MCP", () => {
  it("cli generate-rigged --json", async () => {
    let out = "";
    const code = await main(["--workspace", join(dir, "cli"), "--json", "generate-rigged", "example-biped", "--attachments", "ngob-hat"], { out: (t) => (out += t), err: () => {} });
    expect(code).toBe(0);
    const j = JSON.parse(out);
    expect(j.ok).toBe(true);
    expect(j.asset.source.rig.attachments).toEqual(["ngob-hat"]);
  });

  it("mcp generate_rigged returns an image block", async () => {
    const [a, b] = InMemoryTransport.createLinkedPair();
    await createMcpServer(ws).connect(b);
    const client = new Client({ name: "t", version: "0" });
    await client.connect(a);
    const r = (await client.callTool({ name: "generate_rigged", arguments: { rig: "example-biped" } })) as { content: { type: string }[] };
    expect(r.content.some((c) => c.type === "image")).toBe(true);
  });
});
