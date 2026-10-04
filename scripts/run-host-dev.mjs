#!/usr/bin/env node
/**
 * Start the Cyfers host (`somtoday-login`) when checked out as a sibling.
 * Usage: npm run dev
 */

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HOST_DIR = path.resolve(ROOT, "..", "somtoday-login");
const HOST_PKG = path.join(HOST_DIR, "package.json");
const PREFERRED_SCRIPTS = ["dev", "dev:electron", "electron:dev"];

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (!existsSync(HOST_DIR) || !existsSync(HOST_PKG)) {
  fail(
    [
      "Could not find sibling Cyfers host at ../somtoday-login",
      "",
      "Clone it next to this repo, then retry:",
      "",
      "  cd ..",
      "  git clone https://github.com/Samhij/somtoday-login.git",
      "  cd cyfer-plugins",
      "  npm run dev",
      "",
      `Expected path: ${HOST_DIR}`,
    ].join("\n"),
  );
}

let pkg;
try {
  pkg = JSON.parse(readFileSync(HOST_PKG, "utf8"));
} catch {
  fail(`Could not read package.json at ${HOST_PKG}`);
}

const scripts = pkg?.scripts && typeof pkg.scripts === "object" ? pkg.scripts : {};
const scriptName = PREFERRED_SCRIPTS.find((name) => typeof scripts[name] === "string");

if (!scriptName) {
  fail(
    [
      `Found ${HOST_DIR}, but its package.json has no suitable dev script.`,
      `Looked for: ${PREFERRED_SCRIPTS.join(", ")}`,
    ].join("\n"),
  );
}

console.log(`Starting Cyfers host: npm run ${scriptName} (in ${HOST_DIR})`);

const child = spawn("npm", ["run", scriptName], {
  cwd: HOST_DIR,
  stdio: "inherit",
  shell: process.platform === "win32",
  env: process.env,
});

child.on("error", (err) => {
  fail(`Failed to start host: ${err.message}`);
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
