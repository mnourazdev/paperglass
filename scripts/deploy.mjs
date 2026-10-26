/**
 * Stage only the files the installed app needs, then publish them to
 * Cloudflare Pages. Development files (server, README, dotfiles) stay out of
 * the public deployment.
 *
 * Usage: npm run deploy
 */

import { cp, mkdir, rm } from "node:fs/promises";
import { spawn } from "node:child_process";

const OUTPUT = ".deploy";
const PROJECT = "paperglass";
const PUBLIC_FILES = [
  "index.html",
  "manifest.webmanifest",
  "sw.js",
  "_headers",
  "css",
  "js",
  "icons",
];

await rm(OUTPUT, { recursive: true, force: true });
await mkdir(OUTPUT, { recursive: true });

for (const entry of PUBLIC_FILES) {
  await cp(entry, `${OUTPUT}/${entry}`, { recursive: true });
}

const child = spawn(
  "npx",
  [
    "--yes",
    "wrangler",
    "pages",
    "deploy",
    OUTPUT,
    "--project-name",
    PROJECT,
    "--branch",
    "main",
    "--commit-dirty=true",
  ],
  { stdio: "inherit", shell: process.platform === "win32" }
);

child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
