// Translating locales/fr.json into Malagasy (locales/mg.json) by parts.
//
//   node scripts/mg-locale.mjs todo <dir> [maxKB]   write the keys mg.json does not have yet as <dir>/todo-NN.json
//   node scripts/mg-locale.mjs merge <dir>          merge <dir>/done-NN.json into mg.json, checking each part
//   node scripts/mg-locale.mjs verify <dir> <NN>     check one part (done-NN.json against todo-NN.json), writes nothing
//   node scripts/mg-locale.mjs check                check mg.json against fr.json (keys, placeholders, names)
//
// A done-NN.json has the same nested shape as its todo-NN.json, translated.
import { mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { inOrderOf, leaves, merge, missingFrom, parts, problems } from "./lib/localeParts.mjs";

const read = (file) => JSON.parse(readFileSync(file, "utf8"));
const FR = "locales/fr.json";
const MG = "locales/mg.json";

// Keep the end of lines of fr.json (CRLF in a Windows checkout).
const eol = readFileSync(FR, "utf8").includes("\r\n") ? "\r\n" : "\n";
const write = (file, dict) => writeFileSync(file, (JSON.stringify(dict, null, 2) + "\n").replace(/\n/g, eol));

const [command, dir, size] = process.argv.slice(2);
const fr = read(FR);
const mg = existsSync(MG) ? read(MG) : {};

function report(list) {
  for (const [key, problem] of list.slice(0, 80)) console.log(`  ${key}: ${problem}`);
  if (list.length > 80) console.log(`  … and ${list.length - 80} more`);
}

if (command === "todo" && dir) {
  mkdirSync(dir, { recursive: true });
  const todo = missingFrom(fr, mg);
  const list = parts(todo, Number(size ?? 24) * 1024);
  list.forEach((part, index) => writeFileSync(join(dir, `todo-${String(index + 1).padStart(2, "0")}.json`), JSON.stringify(part, null, 2)));
  console.log(`${leaves(todo).length} keys to translate, in ${list.length} parts in ${dir}`);
} else if (command === "merge" && dir) {
  let ok = true;
  for (const name of readdirSync(dir).filter((file) => /^done-\d+\.json$/.test(file)).sort()) {
    const part = read(join(dir, name));
    const source = read(join(dir, name.replace("done", "todo")));
    const list = problems(source, part);
    if (list.length > 0) {
      ok = false;
      console.log(`${name}: ${list.length} problem(s), not merged`);
      report(list);
    } else merge(mg, part);
  }
  write(MG, inOrderOf(fr, mg));
  const rest = problems(fr, mg).filter(([, problem]) => problem !== "missing");
  console.log(`mg.json written: ${leaves(mg).length} / ${leaves(fr).length} keys`);
  if (!ok || rest.length > 0) process.exitCode = 1;
} else if (command === "verify" && dir && size) {
  const list = problems(read(join(dir, `todo-${size}.json`)), read(join(dir, `done-${size}.json`)));
  report(list);
  console.log(list.length === 0 ? "part ok" : `${list.length} problem(s)`);
  if (list.length > 0) process.exitCode = 1;
} else if (command === "check") {
  const list = problems(fr, mg);
  report(list);
  console.log(list.length === 0 ? "mg.json matches fr.json" : `${list.length} problem(s)`);
  if (list.length > 0) process.exitCode = 1;
} else {
  console.log("usage: node scripts/mg-locale.mjs todo <dir> [maxKB] | merge <dir> | check");
  process.exitCode = 1;
}
