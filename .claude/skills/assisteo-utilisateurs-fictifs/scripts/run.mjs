// Plays the fictional users of personas.mjs in a headless Edge and writes a
// report for the owner: every step checked, screenshots, and one contact
// sheet per user (one image to look at instead of a dozen).
//
// Run with Node 22 (live.mjs needs the global WebSocket):
//   "$NVM_HOME/v22.23.3/node.exe" .claude/skills/assisteo-utilisateurs-fictifs/scripts/run.mjs [options]
// Options:
//   --serve       starts the built app (npm run build first) on port 3140 with
//                 the demo AI, and stops it at the end
//   --only a,b    only these personas (ids from personas.mjs)
//   --real-ai     allows scans when the server's AI is not the demo one
//                 (each costs an AI call and a scan)
// Env: BASE_URL (default http://localhost:3140), OUT_DIR (default
// <tmp>/assisteo-fictifs/<date>). The console only gets one line per user and
// the report's path: read rapport.md, then the contact sheets.
import { execSync, spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { PERSONAS, SCREENS } from "./personas.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);

const PORT = 3140;
const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
process.env.BASE_URL ??= `http://localhost:${PORT}`;
process.env.OUT_DIR ??= join(tmpdir(), "assisteo-fictifs", stamp);
// live.mjs reads BASE_URL and OUT_DIR when it loads.
const live = await import(pathToFileURL(resolve(here, "../../assisteo-tester/scripts/live.mjs")).href);
const { BASE, OUT, sleep, imageOfText } = live;
const sharp = live.require("sharp");
const SHOTS = join(OUT, "captures");
mkdirSync(SHOTS, { recursive: true });

const fr = JSON.parse(readFileSync(join(live.PROJECT, "locales/fr.json"), "utf8"));
const en = JSON.parse(readFileSync(join(live.PROJECT, "locales/en.json"), "utf8"));
const namespaces = Object.keys(fr);
// Menu words that only exist in one language: seen in the other one, the screen is half translated.
const onlyIn = (a, b) => Object.keys(a.nav).map((k) => a.nav[k]).filter((word) => !Object.values(b.nav).includes(word) && !/^Scan/.test(word));
const foreignWords = { fr: onlyIn(en, fr), en: onlyIn(fr, en) };

const PLAN_NAMES = { null: "sans compte", free: "compte gratuit", lite: "Lite", premium: "Premium", pro: "Pro", unlimited: "Admin" };
const THREE_G = { offline: false, latency: 300, downloadThroughput: 96_000, uploadThroughput: 32_000 };
const NORMAL = { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 };

// ---- In the page (sent as source with Function.prototype.toString) ---------

function clickInPage(label) {
  const norm = (s) => s.replace(/\s+/g, " ").trim();
  const all = [...document.querySelectorAll("button, a, summary, label, [role=tab], [role=radio], [role=button]")].filter((e) => e.getClientRects().length);
  const target = all.find((e) => norm(e.textContent) === label) ?? all.find((e) => norm(e.textContent).includes(label));
  if (!target) return false;
  target.scrollIntoView({ block: "center" });
  target.click();
  return true;
}

function inspectPage() {
  const visible = (e) => e.getClientRects().length > 0;
  const named = (e) =>
    e.textContent.trim() || e.getAttribute("aria-label") || e.getAttribute("aria-labelledby") || e.getAttribute("title") || e.querySelector("img[alt]:not([alt='']), svg[aria-label]");
  return {
    path: location.pathname + location.search,
    title: document.title,
    lang: document.documentElement.lang,
    text: document.body.innerText,
    overflow: document.documentElement.scrollWidth - window.innerWidth,
    unnamed: [...document.querySelectorAll("button, a, [role=button]")].filter((e) => visible(e) && !named(e)).slice(0, 5).map((e) => e.outerHTML.slice(0, 90)),
    brokenImages: [...document.images].filter((i) => visible(i) && i.complete && i.naturalWidth === 0).slice(0, 5).map((i) => i.getAttribute("src")),
  };
}

const call = (fn, ...values) => `(${fn.toString()})(${values.map((v) => JSON.stringify(v)).join(", ")})`;

// ---- Server ----------------------------------------------------------------

const health = async () => {
  try {
    const response = await fetch(`${BASE}/api/health`);
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
};

let server = null;
async function serve() {
  if (await health()) throw new Error(`Le port ${PORT} est déjà pris : arrête l'ancien serveur d'abord.`);
  server = spawn("npx", ["next", "start", "-p", String(PORT)], { cwd: live.PROJECT, env: { ...process.env, AI_DEMO_MODE: "true" }, shell: true, stdio: "ignore" });
  for (let i = 0; i < 60 && !(await health()); i++) await sleep(1000);
  if (!(await health())) throw new Error("Le serveur ne répond pas (as-tu lancé npm run build ?)");
}
function stopServer() {
  if (!server) return;
  // On Windows, killing npx leaves `next start` running: kill the whole tree.
  if (process.platform === "win32") execSync(`taskkill /pid ${server.pid} /T /F`, { stdio: "ignore" });
  else server.kill();
}

// ---- One user --------------------------------------------------------------

/** Problems seen in the browser events since the last step. */
function eventProblems(page, from, offline) {
  const problems = [];
  const notes = [];
  const short = (url) => url.replace(BASE, "").slice(0, 90);
  for (const { method, params } of page.events.slice(from)) {
    if (method === "Runtime.exceptionThrown") {
      const detail = params.exceptionDetails;
      problems.push({ level: "fail", text: `Erreur JavaScript : ${(detail.exception?.description ?? detail.text ?? "").split("\n")[0].slice(0, 160)}` });
    } else if (method === "Runtime.consoleAPICalled" && params.type === "error") {
      const message = params.args.map((a) => a.value ?? a.description ?? "").join(" ");
      if (!message.includes("Failed to load resource")) problems.push({ level: "warn", text: `Erreur dans la console : ${message.split("\n")[0].slice(0, 160)}` });
    } else if (method === "Network.responseReceived") {
      const { status, url } = params.response;
      if (status >= 500 || (status === 404 && !url.includes("/api/"))) problems.push({ level: "warn", text: `Réponse ${status} pour ${short(url)}` });
      else if (status >= 400) notes.push(`réponse ${status} pour ${short(url)}`);
    } else if (method === "Network.loadingFailed" && !params.canceled && params.errorText !== "net::ERR_ABORTED") {
      (offline ? notes : problems).push(offline ? `requête bloquée hors ligne (${params.errorText})` : { level: "warn", text: `Requête échouée : ${params.errorText}` });
    }
  }
  return { problems, notes: [...new Set(notes)].slice(0, 4) };
}

/** Checks of the screen itself, whatever the step. */
function screenProblems(info, persona, step, ms) {
  const problems = [];
  if (info.overflow > 2) problems.push({ level: "warn", text: `L'écran déborde sur le côté de ${info.overflow} px` });
  if (info.lang !== persona.locale) problems.push({ level: "warn", text: `Langue de la page « ${info.lang} » au lieu de « ${persona.locale} »` });
  const raw = [...new Set(info.text.split(/\s+/).filter((word) => namespaces.some((ns) => word.startsWith(`${ns}.`) && /^[a-zA-Z]+\.[a-zA-Z]/.test(word))))];
  if (raw.length) problems.push({ level: "warn", text: `Texte non traduit (clé brute) : ${raw.slice(0, 4).join(", ")}` });
  const words = new Set(info.text.split(/[^\p{L}]+/u));
  const foreign = foreignWords[persona.locale].filter((word) => words.has(word));
  if (foreign.length) problems.push({ level: "warn", text: `Mots de l'autre langue : ${foreign.join(", ")}` });
  if (info.unnamed.length) problems.push({ level: "warn", text: `Bouton sans nom pour les lecteurs d'écran : ${info.unnamed[0]}` });
  if (info.brokenImages.length) problems.push({ level: "warn", text: `Image qui ne s'affiche pas : ${info.brokenImages.join(", ")}` });
  const slow = persona.network === "3g" ? 15_000 : 5_000;
  if (step.go && ms > slow) problems.push({ level: "warn", text: `Lent : ${(ms / 1000).toFixed(1)} s pour s'afficher` });
  // innerText follows text-transform (titles in capitals): compare without case.
  const seen = info.text.toLocaleLowerCase("fr");
  const shows = (text) => seen.includes(text.toLocaleLowerCase("fr"));
  for (const text of step.expect ?? []) if (!shows(text)) problems.push({ level: "fail", text: `On ne voit pas « ${text} »` });
  for (const text of step.expectNot ?? []) if (shows(text)) problems.push({ level: "fail", text: `On voit encore « ${text} »` });
  return problems;
}

async function playPersona(persona, { demo }) {
  const mobile = persona.device === "mobile";
  const page = await live.browser({ mobile });
  if (!mobile) await page.send("Emulation.setDeviceMetricsOverride", { width: 1366, height: 900, deviceScaleFactor: 1, mobile: false });
  const network = persona.network === "3g" ? THREE_G : NORMAL;
  const who = persona.plan === null ? null : await live.account(`fictif-${persona.id}`, persona.plan === "free" ? null : persona.plan);

  // Settings live in the app's storage: open a light page first, then set them.
  await page.go("/terms", 3000);
  await page.settings({ locale: persona.locale, theme: persona.theme, textSize: persona.textSize, onboardingDone: !persona.firstVisit });
  await page.evaluate(`localStorage.setItem("text-size", ${JSON.stringify(persona.textSize)}); true`);
  if (who) await page.login(who);
  await page.send("Network.emulateNetworkConditions", network);

  const steps = [
    ...(persona.tour ? SCREENS.map(([path, name]) => ({ label: `Ouvre ${name}`, go: path })) : []),
    ...persona.steps,
  ];
  const results = [];
  let offline = false;
  let welcomed = false;
  const settle = async () => {
    await page.waitFor(async () => (await page.evaluate("document.readyState")) === "complete", 45_000);
    await sleep(persona.network === "3g" ? 2500 : 1200);
  };

  for (const [index, step] of steps.entries()) {
    const from = page.events.length;
    const problems = [];
    const started = Date.now();
    let ms = 0;
    let skipped = null;
    try {
      if (step.go) {
        await page.send("Page.navigate", { url: BASE + step.go });
        await settle();
        ms = Date.now() - started;
        // A new paid account first sees "Bienvenue dans <offre>".
        if (who && !welcomed && (await page.text()).includes("Bienvenue dans")) {
          await page.evaluate(call(clickInPage, "C’est parti"));
          await sleep(800);
          welcomed = true;
        }
      }
      if (step.offline !== undefined) {
        offline = step.offline;
        await page.send("Network.emulateNetworkConditions", offline ? { ...NORMAL, offline: true } : network);
      }
      if (step.click && !(await page.evaluate(call(clickInPage, step.click)))) problems.push({ level: "fail", text: `Bouton ou lien « ${step.click} » introuvable` });
      if (step.click) await settle();
      if (step.scan) {
        if (!demo && !flag("--real-ai")) skipped = "scan sauté : l'IA du serveur n'est pas en mode démo (--real-ai pour l'autoriser)";
        else {
          await page.paste(imageOfText([[64, "FACTURE JIRAMA"], [36, "Client : Rakoto Jean"], [36, "Montant : 45 000 Ar"], [36, "A payer avant le 15/11/2026"]]));
          if (step.offlineScan) await sleep(4000);
          else if (!(await page.waitFor(async () => (await page.evaluate("location.pathname")) === "/result", 90_000))) problems.push({ level: "fail", text: "Pas de résultat d'analyse après 90 s" });
          else await settle();
        }
      }
      if (step.wait) await sleep(step.wait);
    } catch (error) {
      problems.push({ level: "fail", text: `Le test a planté : ${error.message}` });
    }

    const info = await page.evaluate(call(inspectPage));
    const fromEvents = eventProblems(page, from, offline);
    problems.push(...fromEvents.problems, ...(info ? screenProblems(info, persona, step, ms) : [{ level: "fail", text: "Page illisible" }]));
    const shot = join(SHOTS, `${persona.id}-${String(index + 1).padStart(2, "0")}.jpg`);
    const capture = await page.send("Page.captureScreenshot", { format: "jpeg", quality: 60 });
    if (capture.result?.data) writeFileSync(shot, Buffer.from(capture.result.data, "base64"));
    const status = skipped ? "skip" : problems.some((p) => p.level === "fail") ? "fail" : problems.length ? "warn" : "ok";
    results.push({ step: index + 1, label: step.label, path: info?.path ?? "", seconds: ms ? +(ms / 1000).toFixed(1) : null, status, problems, notes: skipped ? [skipped] : fromEvents.notes, shot });
  }

  await page.close();
  return results;
}

// ---- Report ----------------------------------------------------------------

const ICON = { ok: "✅", warn: "⚠️", fail: "❌", skip: "⏭️" };
const COLOR = { ok: "#2e7d32", warn: "#ef8f00", fail: "#c62828", skip: "#757575" };

/** One image per user: every screenshot, numbered and framed by its result. */
async function contactSheet(persona, results) {
  const mobile = persona.device === "mobile";
  const [w, h] = mobile ? [234, 507] : [410, 270];
  const columns = mobile ? 5 : 3;
  const pad = 8;
  const tiles = [];
  for (const [i, r] of results.entries()) {
    let image;
    try {
      image = await sharp(r.shot).resize(w, h, { fit: "cover", position: "top" }).toBuffer();
    } catch {
      continue;
    }
    const label = Buffer.from(`<svg width="${w + 6}" height="${h + 6}"><rect x="1.5" y="1.5" width="${w + 3}" height="${h + 3}" fill="none" stroke="${COLOR[r.status]}" stroke-width="3"/><rect x="3" y="3" width="34" height="26" fill="${COLOR[r.status]}"/><text x="20" y="22" font-family="Segoe UI, Arial" font-size="17" font-weight="700" fill="#fff" text-anchor="middle">${r.step}</text></svg>`);
    const x = pad + (i % columns) * (w + 6 + pad);
    const y = pad + Math.floor(i / columns) * (h + 6 + pad);
    tiles.push({ input: image, left: x + 3, top: y + 3 }, { input: label, left: x, top: y });
  }
  const rows = Math.ceil(results.length / columns);
  const file = join(OUT, `planche-${persona.id}.jpg`);
  await sharp({ create: { width: pad + columns * (w + 6 + pad), height: pad + rows * (h + 6 + pad), channels: 3, background: "#ffffff" } })
    .composite(tiles)
    .jpeg({ quality: 70 })
    .toFile(file);
  return file;
}

function describe(persona) {
  const net = persona.network === "3g" ? "3G" : "bon réseau";
  const size = persona.textSize === "normal" ? "" : `, texte ${persona.textSize}`;
  return `${PLAN_NAMES[persona.plan]}, ${persona.device === "mobile" ? "téléphone" : "ordinateur"}, ${persona.locale.toUpperCase()}, thème ${persona.theme === "dark" ? "sombre" : "clair"}${size}, ${net}`;
}

function report(runs, { demo }) {
  const all = runs.flatMap((r) => r.results);
  const count = (status) => all.filter((r) => r.status === status).length;
  const lines = [
    `# Rapport des utilisateurs fictifs — ${new Date().toLocaleString("fr-FR")}`,
    "",
    `Site testé : ${BASE} (IA ${demo ? "en mode démo" : "réelle"}). ${runs.length} profils, ${all.length} étapes : ✅ ${count("ok")} · ⚠️ ${count("warn")} · ❌ ${count("fail")} · ⏭️ ${count("skip")}.`,
    "",
    "| Profil | Offre et appareil | Résultat |",
    "| --- | --- | --- |",
    ...runs.map(({ persona, results }) => {
      const n = (s) => results.filter((r) => r.status === s).length;
      return `| ${persona.name} | ${describe(persona)} | ✅ ${n("ok")} · ⚠️ ${n("warn")} · ❌ ${n("fail")}${n("skip") ? ` · ⏭️ ${n("skip")}` : ""} |`;
    }),
  ];
  for (const { persona, results, sheet } of runs) {
    lines.push("", `## ${persona.name}`, "", `${persona.who} — ${describe(persona)}.`, "", `Planche : ${sheet}`, "", "| # | Étape | Écran | Résultat | Détails |", "| --- | --- | --- | --- | --- |");
    for (const r of results) {
      const details = [...r.problems.map((p) => p.text), ...r.notes.map((n) => `(note) ${n}`)].join(" ; ").replace(/\|/g, "/");
      lines.push(`| ${r.step} | ${r.label} | ${r.path}${r.seconds ? ` (${r.seconds} s)` : ""} | ${ICON[r.status]} | ${details} |`);
    }
  }
  return `${lines.join("\n")}\n`;
}

// ---- Main ------------------------------------------------------------------

const only = option("--only")?.split(",");
const personas = only ? PERSONAS.filter((p) => only.includes(p.id)) : PERSONAS;
if (!personas.length) throw new Error(`Aucun profil ne correspond à --only ${only}`);

const runs = [];
let failed = false;
try {
  if (flag("--serve")) await serve();
  const status = await health();
  if (!status) throw new Error(`Le site ne répond pas sur ${BASE}`);
  const demo = status.ai === "demo";
  for (const persona of personas) {
    const results = await playPersona(persona, { demo });
    const sheet = await contactSheet(persona, results);
    runs.push({ persona, results, sheet });
    const n = (s) => results.filter((r) => r.status === s).length;
    console.log(`${persona.id.padEnd(10)} ✅ ${n("ok")}  ⚠️ ${n("warn")}  ❌ ${n("fail")}${n("skip") ? `  ⏭️ ${n("skip")}` : ""}`);
  }
  const file = join(OUT, "rapport.md");
  writeFileSync(file, report(runs, { demo }));
  writeFileSync(join(OUT, "rapport.json"), JSON.stringify(runs.map(({ persona, results, sheet }) => ({ persona: persona.id, sheet, results })), null, 2));
  console.log(`Rapport : ${file}`);
} catch (error) {
  failed = true;
  console.log(`ERREUR : ${error.message}`);
} finally {
  await live.cleanup();
  stopServer();
}
process.exit(failed ? 1 : 0);
