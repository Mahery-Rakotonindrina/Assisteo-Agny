import JSZip from "jszip";
import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { prepare } from "./helpers";

// "Télécharger une copie de mes données" in Réglages (demo: no account, so
// only what is on the device). The ZIP opens, with and without the photos,
// and keeps no secret.

test.describe.configure({ timeout: 90_000 });

const now = Date.now();
const photo = `data:image/jpeg;base64,${"/9j/".padEnd(40_000, "A")}`;
const scan = { id: "s1", createdAt: now - 3_600_000, updatedAt: now - 3_600_000, mode: "document", thumbnail: photo, preview: photo, analysis: { title: "Facture JIRAMA", summary: "" }, meta: { model: "demo", demo: true, durationMs: 1 } };
const expense = { id: "e1", kind: "expense", createdAt: now, updatedAt: now, at: now, amountMga: 12500, category: "market" };
const share = { id: "Hery", person: "Hery", lender: "Rado", token: "share-token-secret", createdAt: now };

/** Writes records straight into the app's stores (IndexedDB, one store per database). */
async function seed(page: Page) {
  await page.goto("/settings");
  await page.evaluate(
    async (data) => {
      const put = (name: string, store: string, records: Array<{ id: string }>) =>
        new Promise<void>((resolve, reject) => {
          const request = indexedDB.open(name);
          request.onupgradeneeded = () => request.result.createObjectStore(store);
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            const tx = request.result.transaction(store, "readwrite");
            for (const record of records) tx.objectStore(store).put(record, record.id);
            tx.oncomplete = () => {
              request.result.close();
              resolve();
            };
            tx.onerror = () => reject(tx.error);
          };
        });
      await put("pocket-assistant", "history", [data.scan]);
      await put("assisteo-expenses", "expenses", [data.expense]);
      await put("assisteo-loan-shares", "shares", [data.share]);
    },
    { scan, expense, share },
  );
  await page.reload();
}

async function download(page: Page) {
  const [file] = await Promise.all([page.waitForEvent("download"), page.getByTestId("data-copy-start").click()]);
  expect(file.suggestedFilename()).toMatch(/^assisteo-mes-donnees-\d{4}-\d{2}-\d{2}\.zip$/);
  // The toast of a copy before may still show.
  await expect(page.getByText("Ta copie est prête. Garde-la en lieu sûr.").last()).toBeVisible();
  return JSZip.loadAsync(await readFile(await file.path()));
}

test("the copy of my data downloads as a ZIP, with or without the photos", async ({ page }) => {
  // Phones open the share sheet: force the download.
  await page.addInitScript(() => Object.defineProperty(navigator, "canShare", { value: () => false }));
  await prepare(page);
  await seed(page);

  const card = page.getByTestId("data-copy");
  await card.scrollIntoViewIfNeeded();
  await expect(card.getByText(/Garde-le en lieu sûr/)).toBeVisible();
  await expect(card.getByText("Sans compte, le fichier contient ce qui est sur cet appareil.")).toBeVisible();
  await expect(page.getByTestId("data-copy-size")).toHaveText(/^environ \d+ Ko$/);
  const toggle = card.getByRole("switch", { name: "Avec les photos" });
  await expect(toggle).toHaveAttribute("aria-checked", "true");

  const zip = await download(page);
  const names = Object.keys(zip.files);
  expect(names).toEqual(expect.arrayContaining(["LISEZ-MOI.txt", "historique.json", "depenses.json", "prets.json", "reglages.json", "photos/historique/s1-preview.jpg"]));
  expect(names).not.toContain("compte.json");
  const readme = await zip.file("LISEZ-MOI.txt")!.async("string");
  expect(readme).toContain("Tu n’étais pas connecté à un compte");
  const history = JSON.parse(await zip.file("historique.json")!.async("string"));
  expect(history.analyses[0]).toMatchObject({ id: "s1", preview: "photos/historique/s1-preview.jpg", createdAt: new Date(scan.createdAt).toISOString() });
  const expenses = JSON.parse(await zip.file("depenses.json")!.async("string"));
  expect(expenses.records.expense[0].amountMga).toBe(12500);
  const all = await Promise.all(names.filter((name) => name.endsWith(".json")).map((name) => zip.file(name)!.async("string")));
  expect(all.join("")).not.toContain("share-token-secret");
  expect(JSON.parse(await zip.file("reglages.json")!.async("string"))).toMatchObject({ locale: "fr" });

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  const light = await download(page);
  expect(Object.keys(light.files).some((name) => name.startsWith("photos/"))).toBe(false);
  expect(await light.file("LISEZ-MOI.txt")!.async("string")).toContain("pas de photos dans cette copie");
});

test("the copy's card fits a 320 px screen in very large text", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.addInitScript(() =>
    localStorage.setItem("CapacitorStorage.settings.v1", JSON.stringify({ locale: "fr", theme: "dark", textSize: "xlarge", notifyOnResult: false, onboardingDone: true, updatedAt: 0 })),
  );
  await prepare(page);
  await page.goto("/settings");
  const card = page.getByTestId("data-copy");
  await card.scrollIntoViewIfNeeded();
  await expect(page.getByTestId("data-copy-start")).toBeVisible();
  const box = await page.getByTestId("data-copy-start").boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(44);
  const overflow = await card.evaluate((element) => [...element.querySelectorAll("*")].filter((child) => child.getBoundingClientRect().right > window.innerWidth + 1).length);
  expect(overflow).toBe(0);
});
