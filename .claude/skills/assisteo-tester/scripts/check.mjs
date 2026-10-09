// The four automated checks, quietly: one line per step, and only the useful
// part of the output when a step fails (it then stops there).
// Usage: node .claude/skills/assisteo-tester/scripts/check.mjs [--fast]
//   --fast  skips the end-to-end tests (Playwright, ~3-4 minutes)
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const fast = process.argv.includes("--fast");
const clean = (text) => text.replace(/\x1b\[[0-9;]*m/g, "");

const steps = [
  { name: "lint", cmd: "npx eslint .", summary: () => "no problem", failure: (out) => out.split("\n").filter(Boolean).slice(-40) },
  { name: "types", cmd: "npx tsc --noEmit -p .", summary: () => "no error", failure: (out) => out.split("\n").filter((l) => /error TS/.test(l)).slice(0, 30) },
  {
    name: "unit",
    cmd: "npx vitest run",
    summary: (out) => out.match(/Tests\s+(.+)/)?.[1]?.trim() ?? "passed",
    failure: (out) => {
      const lines = out.split("\n");
      const start = lines.findIndex((l) => /Failed Tests|FAIL /.test(l));
      return lines.slice(start < 0 ? -60 : start, (start < 0 ? lines.length : start) + 60);
    },
  },
  {
    name: "e2e",
    cmd: "npx playwright test",
    skip: fast,
    summary: (out) => [...out.matchAll(/^\s*(\d+ (?:passed|skipped|flaky|failed|did not run).*)$/gm)].map((m) => m[1].trim()).join(", ") || "passed",
    failure: (out) => {
      const lines = out.split("\n");
      const start = lines.findIndex((l) => /^\s+\d+\) /.test(l));
      return lines.slice(start < 0 ? -80 : start, (start < 0 ? lines.length : start) + 80);
    },
  },
];

for (const step of steps) {
  if (step.skip) { console.log(`skip  ${step.name}`); continue; }
  const started = Date.now();
  const { code, out } = await new Promise((done) => {
    let out = "";
    const child = spawn(step.cmd, { cwd: PROJECT, shell: true, env: { ...process.env, FORCE_COLOR: "0", CI: process.env.CI ?? "" } });
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("close", (code) => done({ code, out: clean(out) }));
  });
  const seconds = Math.round((Date.now() - started) / 1000);
  if (code === 0) {
    console.log(`ok    ${step.name} (${seconds}s): ${step.summary(out)}`);
  } else {
    console.log(`FAIL  ${step.name} (${seconds}s), exit ${code}:`);
    console.log(step.failure(out).join("\n"));
    process.exit(1);
  }
}
