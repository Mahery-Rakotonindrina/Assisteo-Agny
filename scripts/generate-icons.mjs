// Generates every native icon and splash image from the brand SVGs.
// Usage: npm run icons   (then commit the PNGs; `cap sync` keeps them)
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import sharp from "sharp";

const BG = "#0b0c10";
const icon = readFileSync("public/icon.svg", "utf8");
const glyph = readFileSync("assets/brand/glyph.svg", "utf8");

// Full-bleed square (stores and iOS apply their own mask).
const squareIcon = icon.replaceAll('rx="116"', 'rx="0"');
// Background layer of the Android adaptive icon: dark with the lime glow.
const adaptiveBackground = squareIcon.replace(/<g[\s\S]*<\/svg>/, "</svg>");
// Monochrome glyph for the status bar (Android tints it, colours are ignored).
// Cropped to the glyph so it fills the 24 dp box.
// Splash art: the glyph over a soft lime halo, on the app background.
const splashArt = glyph.replace(
  /<g /,
  '<defs><radialGradient id="halo"><stop offset="0" stop-color="#c6ff4d" stop-opacity="0.28"/><stop offset="1" stop-color="#c6ff4d" stop-opacity="0"/></radialGradient></defs><circle cx="256" cy="256" r="256" fill="url(#halo)"/><g ',
);
const notificationGlyph = glyph.replace(/#f3f4f6|#c6ff4d/g, "#ffffff").replace('viewBox="0 0 512 512"', 'viewBox="116 116 280 280"');

const res = "android/app/src/main/res";
const densities = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };

async function png(svg, size, file, { scale = 1, circle = false, flatten = false } = {}) {
  mkdirSync(dirname(file), { recursive: true });
  const [w, h] = Array.isArray(size) ? size : [size, size];
  const inner = Math.round(Math.min(w, h) * scale);
  let image = sharp(Buffer.from(svg), { density: 384 }).resize(inner, inner);
  if (circle) {
    const mask = Buffer.from(`<svg width="${inner}" height="${inner}"><circle cx="${inner / 2}" cy="${inner / 2}" r="${inner / 2}"/></svg>`);
    image = sharp(await image.png().toBuffer()).composite([{ input: mask, blend: "dest-in" }]);
  }
  const buffer = await image.png().toBuffer();
  const canvas = sharp({ create: { width: w, height: h, channels: 4, background: flatten ? BG : { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: buffer, gravity: "center" }]);
  await (flatten ? canvas.flatten({ background: BG }) : canvas).png().toFile(file);
}

for (const [name, factor] of Object.entries(densities)) {
  const dir = join(res, `mipmap-${name}`);
  // Legacy launchers (< Android 8): the rounded icon as is.
  await png(icon, 48 * factor, join(dir, "ic_launcher.png"));
  await png(squareIcon, 48 * factor, join(dir, "ic_launcher_round.png"), { circle: true });
  // Adaptive icon layers, 108 dp; the glyph stays inside the 66 dp safe zone.
  await png(glyph, 108 * factor, join(dir, "ic_launcher_foreground.png"), { scale: 0.62 });
  await png(adaptiveBackground, 108 * factor, join(dir, "ic_launcher_background.png"));
  // Notification icon, 24 dp.
  await png(notificationGlyph, 24 * factor, join(res, `drawable-${name}`, "ic_stat_notify.png"));
}

// Splash (Android < 12 and iOS): the glyph centred on the app background.
const splashSizes = {
  "drawable/splash.png": [480, 320],
  "drawable-port-mdpi/splash.png": [320, 480],
  "drawable-port-hdpi/splash.png": [480, 800],
  "drawable-port-xhdpi/splash.png": [720, 1280],
  "drawable-port-xxhdpi/splash.png": [960, 1600],
  "drawable-port-xxxhdpi/splash.png": [1280, 1920],
  "drawable-land-mdpi/splash.png": [480, 320],
  "drawable-land-hdpi/splash.png": [800, 480],
  "drawable-land-xhdpi/splash.png": [1280, 720],
  "drawable-land-xxhdpi/splash.png": [1600, 960],
  "drawable-land-xxxhdpi/splash.png": [1920, 1280],
};
for (const [file, size] of Object.entries(splashSizes)) {
  await png(splashArt, size, join(res, file), { scale: 0.5, flatten: true });
}

const ios = "ios/App/App/Assets.xcassets";
await png(squareIcon, 1024, join(ios, "AppIcon.appiconset/AppIcon-512@2x.png"), { flatten: true });
for (const suffix of ["", "-1", "-2"]) {
  await png(splashArt, 2732, join(ios, `Splash.imageset/splash-2732x2732${suffix}.png`), { scale: 0.3, flatten: true });
}

console.log("Icons and splash screens generated.");
