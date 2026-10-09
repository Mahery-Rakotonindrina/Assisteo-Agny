// Live test helpers for Assisteo: throwaway accounts on the real Supabase,
// the admin API, and a headless Edge driven over the DevTools protocol.
//
// A check script imports this file by its absolute path and is run with
// Node 22 (it needs the global WebSocket; the default `node` here is 20):
//   "$NVM_HOME/v22.23.3/node.exe" <scratchpad>/my-check.mjs
// Env: BASE_URL (default http://localhost:3130), OUT_DIR (screenshots and the
// browser profile, default <tmp>/assisteo-live).
//
// Always end with `await cleanup()` in a `finally`: it deletes the accounts,
// their subscriptions, and the browser profiles (each one weighs ~50 MB and
// they once filled the disk).
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const PROJECT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
export const BASE = process.env.BASE_URL ?? "http://localhost:3130";
export const OUT = process.env.OUT_DIR ?? join(tmpdir(), "assisteo-live");
mkdirSync(OUT, { recursive: true });

const require = createRequire(join(PROJECT, "package.json"));
const { createClient } = require("@supabase/supabase-js");
export { require };

export const env = Object.fromEntries(
  readFileSync(join(PROJECT, ".env.local"), "utf8")
    .split(/\r?\n/)
    .filter((line) => /^[A-Z_]+=/.test(line))
    .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1).replace(/^"|"$/g, "")]),
);
export const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
export const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A fresh install id (the API wants 16 to 64 letters, digits or dashes). */
export const installId = () => `test-install-${Date.now()}${Math.random().toString(36).slice(2, 8)}`;

/** Calls the app's API. `headers` can carry an account's `auth`. */
export const api = (method, path, body, headers = {}) =>
  fetch(BASE + path, { method, headers: { "Content-Type": "application/json", "x-install-id": installId(), ...headers }, body: body && JSON.stringify(body) });

/**
 * Calls the admin API with the bare admin token: refused (401) once the
 * admin's two-factor is on, except on the routes the APK workflow uses.
 */
export const adminApi = (method, path, body) =>
  api(method, path, body, { Authorization: `Bearer ${env.ADMIN_TOKEN}`, ...(env.CRON_SECRET ? { "X-Cron-Secret": env.CRON_SECRET } : {}) });

let failures = 0;
export function check(label, ok, extra = "") {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label} ${extra}`);
}

const created = [];

/**
 * A throwaway account (…@example.com), signed in, optionally on a paid plan
 * for a month: "lite" | "premium" | "pro" | "unlimited". Deleted by cleanup().
 */
export async function account(prefix, plan = null) {
  const email = `${prefix}-${Date.now()}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true });
  if (error) throw error;
  created.push({ id: data.user.id, email });
  if (plan) {
    // Straight into the table (the server reads it on each request, no cache):
    // works even when the admin API asks for its second factor.
    const end = new Date();
    end.setMonth(end.getMonth() + 1);
    const { error: subError } = await admin.from("subscriptions").insert({ email, plan, ends_at: end.toISOString(), note: "test" });
    if (subError) throw subError;
  }
  const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  const { data: verified, error: otpError } = await anon.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: "magiclink" });
  if (otpError) throw otpError;
  return { email, id: data.user.id, session: verified.session, auth: { Authorization: `Bearer ${verified.session.access_token}` } };
}

const browsers = [];

/** A headless Edge, phone-sized by default. Screenshots go to OUT. */
export async function browser({ mobile = true } = {}) {
  const port = 9700 + Math.floor(Math.random() * 200);
  const profile = join(OUT, `profile-${Date.now()}`);
  const proc = spawn("C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", ["--headless=new", "--disable-gpu", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
  const entry = { proc, profile, ws: null };
  browsers.push(entry);
  let target;
  for (let i = 0; i < 100 && !target; i++) {
    await sleep(300);
    try { target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" })).json(); } catch {}
  }
  if (!target) throw new Error("Edge did not start");
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  entry.ws = ws;
  await new Promise((r) => ws.addEventListener("open", r));
  let seq = 0;
  const pending = new Map();
  const events = [];
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    else if (m.method) events.push(m);
  });
  const send = (method, params = {}) => new Promise((res) => { const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
  const evaluate = async (expression) => {
    const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) console.log("EXCEPTION", JSON.stringify(r.result.exceptionDetails).slice(0, 300));
    return r.result?.result?.value;
  };
  const centerOf = (label) => evaluate(`(() => { const b = [...document.querySelectorAll("button, a, [role=tab]")].find((x) => x.textContent.trim() === ${JSON.stringify(label)}); if (!b) return null; b.scrollIntoView({ block: "center" }); const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);

  await send("Page.enable");
  await send("Network.enable");
  await send("Runtime.enable");
  if (mobile) await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await send("Browser.grantPermissions", { origin: BASE, permissions: ["clipboardReadWrite", "clipboardSanitizedWrite"] });

  const page = {
    send,
    evaluate,
    /** CDP events seen so far (console messages, network…). */
    events,
    go: async (path, wait = 4000) => { await send("Page.navigate", { url: BASE + path }); await sleep(wait); },
    shot: async (name) => { const r = await send("Page.captureScreenshot", { format: "png" }); const file = join(OUT, `${name}.png`); writeFileSync(file, Buffer.from(r.result.data, "base64")); return file; },
    text: async () => ((await evaluate("document.body.innerText")) ?? "").replace(/[\u00a0\u202f]/g, " "),
    /** Clicks the first button, link or tab with this text (exact, or contained). */
    click: (label, exact = true) => evaluate(`(() => { const b = [...document.querySelectorAll("button, a, [role=tab]")].find((x) => ${exact ? `x.textContent.trim() === ${JSON.stringify(label)}` : `x.textContent.includes(${JSON.stringify(label)})`}); if (!b) return false; b.click(); return true; })()`),
    /** A real mouse click (for handlers that need a trusted event, like copying). */
    realClick: async (label) => {
      if (!(await centerOf(label))) return false;
      await sleep(300);
      const at = await centerOf(label);
      for (const type of ["mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x: at.x, y: at.y, button: "left", clickCount: 1 });
      return true;
    },
    waitFor: async (predicate, ms = 60_000) => { for (let waited = 0; waited < ms; waited += 1000) { if (await predicate()) return true; await sleep(1000); } return false; },
    offline: (yes) => send("Network.emulateNetworkConditions", { offline: yes, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }),
    /** Skips the welcome screens; call on a page of the app, then reload. */
    settings: (overrides = {}) => evaluate(`localStorage.setItem("CapacitorStorage.settings.v1", ${JSON.stringify(JSON.stringify({ locale: "fr", theme: "dark", notifyOnResult: false, haptics: true, onboardingDone: true, dataSaver: "auto", updatedAt: 0, ...overrides }))}); true`),
    /** Signs the page in as `who` (from account()); reload afterwards. */
    login: (who) => evaluate(`localStorage.setItem("capacitor-storage_assisteo-auth", ${JSON.stringify(JSON.stringify(who.session))}); localStorage.removeItem("plan.v1"); localStorage.removeItem("CapacitorStorage.plan.v1"); true`),
    /**
     * Pastes an image on the scan screen, like Ctrl+V. `source` is page code
     * that sets `blob` (helpers: `load(src)` gives an Image), e.g.
     * imageFromBase64(b64, "image/png").
     */
    paste: (source) => evaluate(`(async () => {
      const load = (src) => new Promise((ok, ko) => { const i = new Image(); i.onload = () => ok(i); i.onerror = ko; i.src = src; });
      let blob;
      ${source}
      const dt = new DataTransfer();
      dt.items.add(new File([blob], "photo." + (blob.type === "image/png" ? "png" : "jpg"), { type: blob.type }));
      window.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true }));
      return blob.size;
    })()`),
    close: () => closeBrowser(entry),
  };
  return page;
}

/** Page code for paste(): an image given as base64. */
export const imageFromBase64 = (b64, type) => `blob = new Blob([Uint8Array.from(atob(${JSON.stringify(b64)}), (c) => c.charCodeAt(0))], { type: ${JSON.stringify(type)} });`;

/** Page code for paste(): a white A4 page with lines of text ([size, text] pairs). */
export const imageOfText = (lines) => `const c = document.createElement("canvas"); c.width = 1240; c.height = 1754; const x = c.getContext("2d"); x.fillStyle = "#fff"; x.fillRect(0, 0, 1240, 1754); x.fillStyle = "#111"; ${JSON.stringify(lines)}.forEach(([size, text], i) => { x.font = (size > 50 ? "bold " : "") + size + "px sans-serif"; x.fillText(text, 90, 160 + i * 95); }); blob = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.9));`;

async function closeBrowser(entry) {
  try { entry.ws?.close(); } catch {}
  entry.proc.kill();
  await sleep(1500);
  rmSync(entry.profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
  browsers.splice(browsers.indexOf(entry), 1);
}

/** Deletes everything the run created. Returns the number of failed checks. */
export async function cleanup() {
  const emails = created.map((u) => u.email);
  if (emails.length) await admin.from("subscriptions").delete().in("email", emails);
  for (const u of created.splice(0)) await admin.auth.admin.deleteUser(u.id);
  for (const entry of [...browsers]) await closeBrowser(entry);
  console.log(`cleanup: ${emails.length} account(s) deleted, ${failures} check(s) failed`);
  return failures;
}
