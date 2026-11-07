import * as esbuild from "esbuild";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const dist = path.join(root, "dist");
const rendererDir = path.join(dist, "renderer");
const watch = process.argv.includes("--watch");

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(rendererDir, { recursive: true });

/* ------------------------------------------------------------------ *
 * Assets
 * ------------------------------------------------------------------ */

// Icons are rasterised from build/icon.svg by `npm run icon`
// (scripts/make-icon.cjs), which needs Electron's renderer.
const iconPng = path.join(root, "build", "icon.png");
if (!fs.existsSync(iconPng)) {
  console.error("build/icon.png is missing — run `npm run icon` first.");
  process.exit(1);
}
fs.copyFileSync(iconPng, path.join(dist, "icon.png"));

for (const file of ["index.html", "styles.css"]) {
  fs.copyFileSync(path.join(root, "src", "renderer", file), path.join(rendererDir, file));
}

/* ------------------------------------------------------------------ *
 * Build
 * ------------------------------------------------------------------ */

/** @type {import("esbuild").BuildOptions[]} */
const targets = [
  {
    entryPoints: [path.join(root, "src", "main", "main.ts")],
    outfile: path.join(dist, "main.js"),
    bundle: true,
    platform: "node",
    target: "node22",
    format: "cjs",
    external: ["electron"],
    logLevel: "info",
  },
  {
    entryPoints: [path.join(root, "src", "preload", "preload.ts")],
    outfile: path.join(dist, "preload.js"),
    bundle: true,
    platform: "node",
    target: "node22",
    format: "cjs",
    external: ["electron"],
    logLevel: "info",
  },
  {
    entryPoints: [path.join(root, "src", "renderer", "app.ts")],
    outfile: path.join(rendererDir, "app.js"),
    bundle: true,
    platform: "browser",
    target: "chrome124",
    format: "iife",
    logLevel: "info",
  },
];

if (watch) {
  const contexts = await Promise.all(targets.map((t) => esbuild.context(t)));
  await Promise.all(contexts.map((c) => c.watch()));
  console.log("Watching for changes… (press Ctrl+C to stop)");
} else {
  await Promise.all(targets.map((t) => esbuild.build(t)));
  console.log("Build complete → dist/");
}
