// Builds the example scans shown to new users (public/examples/*.jpg).
// Photos come from Wikimedia Commons under CC0 or public domain; the bill is
// drawn here (fictional supplier). Usage: npm run examples
import { mkdirSync, writeFileSync } from "node:fs";
import sharp from "sharp";

const OUT = "public/examples";
const SIZE = 720;
const USER_AGENT = "AssisteoAgny/1.0 (https://assisteo-agny.vercel.app)";

/** crop: fractions of the source image, or "cover" for a centred square. */
const photos = [
  { id: "food", title: "File:Salad of mixed greens, herring, avocado, and plum and cherry tomatoes, with mustard dressing, cheddar cheese, and black pepper - Massachusetts.jpg", crop: "cover" },
  { id: "vehicle", title: "File:22 Toyota Corolla Hybrid LE.jpg", crop: "cover" },
  // Framed on the leaves; leaves out the distant visitors at the top.
  { id: "object", title: "File:Monstera deliciosa A.jpg", crop: { left: 0.31, top: 0.12, width: 0.42, height: 0.56 } },
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function commons(titles) {
  const url = new URL("https://commons.wikimedia.org/w/api.php");
  url.search = new URLSearchParams({
    action: "query",
    format: "json",
    titles: titles.join("|"),
    prop: "imageinfo",
    iiprop: "url|extmetadata",
    iiextmetadatafilter: "LicenseShortName|Artist",
    iiurlwidth: "1280",
  });
  const response = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!response.ok) throw new Error(`Commons API: ${response.status}`);
  const pages = Object.values((await response.json()).query.pages);
  return new Map(pages.map((page) => [page.title, page.imageinfo[0]]));
}

async function processPhoto(buffer, crop) {
  const image = sharp(buffer);
  if (crop !== "cover") {
    const { width, height } = await image.metadata();
    image.extract({
      left: Math.round(crop.left * width),
      top: Math.round(crop.top * height),
      width: Math.round(crop.width * width),
      height: Math.round(crop.height * height),
    });
  }
  return image.resize(SIZE, SIZE, { fit: "cover" }).jpeg({ quality: 80, mozjpeg: true }).toBuffer();
}

// A fictional electricity bill photographed on a table; numbers match the
// demo analysis (lib/ai/mock.ts).
function billSvg() {
  const line = (y, label, value, bold = false) =>
    `<text x="70" y="${y}" font-size="26" ${bold ? 'font-weight="700"' : ""} fill="#1f2328">${label}</text>` +
    `<text x="550" y="${y}" font-size="26" text-anchor="end" ${bold ? 'font-weight="700"' : ""} fill="#1f2328">${value}</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="900" font-family="Arial, Helvetica, sans-serif">
  <defs>
    <linearGradient id="table" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#9c8670"/><stop offset="1" stop-color="#6d5a48"/></linearGradient>
    <radialGradient id="light" cx="45%" cy="35%" r="75%"><stop offset="0" stop-color="#fff" stop-opacity="0.18"/><stop offset="1" stop-color="#000" stop-opacity="0.35"/></radialGradient>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="18" stdDeviation="18" flood-opacity="0.45"/></filter>
  </defs>
  <rect width="900" height="900" fill="url(#table)"/>
  <g transform="translate(150 70) rotate(-4 300 380)" filter="url(#shadow)">
    <rect width="620" height="790" rx="6" fill="#fbfaf6"/>
    <rect width="620" height="96" fill="#1d5fd1"/>
    <circle cx="70" cy="48" r="24" fill="#fbfaf6"/><path d="M66 32 L58 52 H70 L64 66 L82 42 H70 L76 32 Z" fill="#1d5fd1"/>
    <text x="110" y="58" font-size="30" font-weight="700" fill="#fbfaf6" letter-spacing="2">ÉNERGIE EXEMPLE</text>
    <text x="70" y="160" font-size="38" font-weight="700" fill="#1f2328">Facture d’électricité</text>
    <text x="70" y="200" font-size="22" fill="#5b6270">N° 2026-0915-4471 · émise le 20 septembre</text>
    <rect x="70" y="232" width="480" height="128" rx="10" fill="#eef2fb"/>
    <text x="92" y="274" font-size="23" fill="#1f2328">Période : 1er août – 30 septembre</text>
    <text x="92" y="308" font-size="23" fill="#1f2328">Consommation : 312 kWh</text>
    <text x="92" y="342" font-size="23" fill="#1f2328">Abonnement : 6 kVA</text>
    ${line(420, "Abonnement", "21,36 €")}
    ${line(462, "Consommation (312 kWh)", "54,91 €")}
    ${line(504, "Taxes et contributions", "7,93 €")}
    <line x1="70" y1="530" x2="550" y2="530" stroke="#d5d9e2" stroke-width="2"/>
    ${line(574, "Total TTC", "84,20 €", true)}
    <rect x="70" y="618" width="480" height="76" rx="10" fill="#fff4e0"/>
    <text x="92" y="652" font-size="23" font-weight="700" fill="#8a4b00">Prélèvement le 15 octobre</text>
    <text x="92" y="682" font-size="20" fill="#8a4b00">sur le compte se terminant par 0427</text>
    <text x="70" y="752" font-size="18" fill="#9aa1ad">Document d’exemple · Assisteo Agny</text>
  </g>
  <rect width="900" height="900" fill="url(#light)"/>
</svg>`;
}

mkdirSync(OUT, { recursive: true });
const info = await commons(photos.map((photo) => photo.title));
const credits = ["Example photos (Wikimedia Commons), free to reuse:", ""];
for (const photo of photos) {
  const item = info.get(photo.title);
  if (!item) throw new Error(`Not found on Commons: ${photo.title}`);
  const license = item.extmetadata.LicenseShortName.value;
  if (!/cc0|public domain/i.test(license)) throw new Error(`${photo.title}: unexpected license ${license}`);
  const response = await fetch(item.thumburl, { headers: { "User-Agent": USER_AGENT } });
  if (!response.ok) throw new Error(`${photo.title}: download failed (${response.status})`);
  writeFileSync(`${OUT}/${photo.id}.jpg`, await processPhoto(Buffer.from(await response.arrayBuffer()), photo.crop));
  const artist = (item.extmetadata.Artist?.value ?? "").replace(/<[^>]+>/g, "").trim();
  credits.push(`- ${photo.id}.jpg: ${photo.title.replace(/^File:/, "")} (${artist}, ${license}) ${item.descriptionurl}`);
  await sleep(3000);
}
const bill = await sharp(Buffer.from(billSvg())).resize(SIZE, SIZE).jpeg({ quality: 82, mozjpeg: true }).toBuffer();
writeFileSync(`${OUT}/document.jpg`, bill);
credits.push("- document.jpg: drawn for this app (fictional supplier and figures).", "");
writeFileSync(`${OUT}/CREDITS.txt`, credits.join("\n"));
console.log("Example images written to", OUT);
