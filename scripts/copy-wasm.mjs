// Copies the barcode reader's WebAssembly next to the app (public/vendor), so
// the native app reads QR codes offline and the web build never fetches it
// from a CDN. Runs before dev and every build; the copy is ignored by git and
// always matches the installed zxing-wasm version.
import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const source = require.resolve("zxing-wasm/reader/zxing_reader.wasm");
mkdirSync(join("public", "vendor"), { recursive: true });
copyFileSync(source, join("public", "vendor", "zxing_reader.wasm"));
