#!/usr/bin/env node
// Entry point for `pixel-builder`. Runs the bundled CLI (npm run build:node);
// in a source checkout without a build it falls back to running the
// TypeScript through tsx.
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const bundle = fileURLToPath(new URL("../dist-node/cli.mjs", import.meta.url));
const source = fileURLToPath(new URL("../src/node/cli.ts", import.meta.url));

let main;
if (existsSync(bundle)) {
  ({ main } = await import(pathToFileURL(bundle).href));
} else if (existsSync(source)) {
  try {
    const { register } = await import("tsx/esm/api");
    register();
  } catch {
    console.error("pixel-builder: dist-node/cli.mjs is missing. Run `npm run build:node` (or install dev dependencies so tsx is available).");
    process.exit(1);
  }
  ({ main } = await import(pathToFileURL(source).href));
} else {
  console.error("pixel-builder: installation is incomplete (no dist-node/cli.mjs).");
  process.exit(1);
}

process.exitCode = await main(process.argv.slice(2));
