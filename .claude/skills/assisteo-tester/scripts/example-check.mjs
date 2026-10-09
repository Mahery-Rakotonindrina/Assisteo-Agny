// Template for a live check: copy it to the scratchpad, fix the import path,
// keep the try/finally. Run with Node 22, the app started on BASE_URL:
//   "$NVM_HOME/v22.23.3/node.exe" <scratchpad>/my-check.mjs
import { account, api, browser, check, cleanup, sleep } from "./live.mjs";

try {
  // API: a free account sees its plan.
  const free = await account("check-free");
  const r = await api("GET", "/api/plan", undefined, free.auth);
  const plan = await r.json();
  check("free account: /api/plan answers", r.ok, JSON.stringify(plan.usage ?? plan).slice(0, 120));

  // Browser: a Premium account, signed in, on the scan screen.
  const premium = await account("check-premium", "premium");
  const page = await browser();
  await page.go("/", 2000);
  await page.settings();
  await page.login(premium);
  await page.go("/", 5000);
  // A new paid account first sees "Bienvenue dans Premium", once.
  check("Premium: the plan's welcome sheet", (await page.text()).includes("Bienvenue dans Premium"));
  await page.click("C’est parti");
  await sleep(800);
  const text = await page.text();
  check("Premium: the scan screen offers several pages", text.includes("Plusieurs pages") && !text.includes("Bienvenue dans"));
  await page.shot("example-scan");
  // page.paste(imageOfText([[60, "FACTURE"], [38, "Total : 12 000 Ar"]])) would now
  // start a real analysis: it spends a scan and calls the AI.
} finally {
  const failed = await cleanup();
  process.exit(failed ? 1 : 0);
}
