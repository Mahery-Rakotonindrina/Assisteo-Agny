// Waits for the GitHub Actions runs of a commit, then prints one line per
// workflow, plus the failed jobs and steps when one fails.
// Usage: node .claude/skills/assisteo-livrer/scripts/ci-wait.mjs [sha]   (default: HEAD)
import { execSync } from "node:child_process";

const REPO = "Mahery-Rakotonindrina/Assisteo-Agny";
// The API wants the full sha.
const sha = execSync(`git rev-parse ${process.argv[2] ?? "HEAD"}`).toString().trim();
const api = async (path) => (await fetch(`https://api.github.com/repos/${REPO}${path}`, { headers: { Accept: "application/vnd.github+json" } })).json();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let runs = [];
// Up to ~25 minutes: the APK build is the longest.
for (let i = 0; i < 100; i++) {
  runs = (await api(`/actions/runs?head_sha=${sha}`)).workflow_runs ?? [];
  if (runs.length && runs.every((r) => r.status === "completed")) break;
  // A push that only changes .md files starts no run: give up after ~1 minute.
  if (!runs.length && i >= 4) { console.log(`no workflow run for ${sha.slice(0, 7)} (only .md files changed?)`); process.exit(0); }
  await sleep(15_000);
}

let failed = false;
for (const run of runs) {
  console.log(`${run.conclusion === "success" ? "ok  " : "FAIL"}  ${run.name}: ${run.status} ${run.conclusion ?? ""} (run ${run.id})`);
  if (run.conclusion && run.conclusion !== "success" && run.conclusion !== "skipped") {
    failed = true;
    for (const job of (await api(`/actions/runs/${run.id}/jobs`)).jobs ?? []) {
      if (job.conclusion === "success" || job.conclusion === "skipped") continue;
      const steps = (job.steps ?? []).filter((s) => s.conclusion === "failure").map((s) => s.name);
      console.log(`      job "${job.name}" ${job.conclusion}${steps.length ? `, step: ${steps.join(", ")}` : ""}`);
    }
    console.log(`      logs: gh run view ${run.id} --repo ${REPO} --log-failed`);
  }
}
process.exit(failed ? 1 : 0);
