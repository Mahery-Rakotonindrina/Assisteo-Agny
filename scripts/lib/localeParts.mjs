// Helpers to translate locales/fr.json into another language by parts
// (see scripts/mg-locale.mjs). A "leaf" is a string, or an array of strings.

const isLeaf = (value) => typeof value === "string" || Array.isArray(value);

/** Every leaf of a dictionary, as [path, value]. */
export function leaves(dict, prefix = []) {
  return Object.entries(dict).flatMap(([key, value]) => (isLeaf(value) ? [[[...prefix, key], value]] : leaves(value, [...prefix, key])));
}

export function getPath(dict, path) {
  return path.reduce((node, key) => (node && typeof node === "object" ? node[key] : undefined), dict);
}

export function setPath(dict, path, value) {
  let node = dict;
  for (const key of path.slice(0, -1)) node = node[key] ??= {};
  node[path[path.length - 1]] = value;
}

/** The {placeholders} and <tags> of a text, sorted: they must never change. */
export function tokens(text) {
  return [...String(text).matchAll(/\{\w+\}|<\/?[a-zA-Z][^>]*>/g)].map((match) => match[0]).sort();
}

/** Names and marks never translated: when the French text has one, the translation keeps it. */
export const protectedTerms = ["Assisteo Agny", "MVola", "Orange Money", "Airtel Money", "JIRAMA", "WhatsApp", "Lite", "Premium"];

const termIn = (text, term) => new RegExp(`(^|[^\\p{L}])${term}($|[^\\p{L}])`, "u").test(text);

/** The problems of a translation against its French source: [path, problem]. */
export function problems(fr, other) {
  const found = [];
  const wanted = new Map(leaves(fr).map(([path, value]) => [path.join("."), value]));
  const given = new Map(leaves(other).map(([path, value]) => [path.join("."), value]));
  for (const key of wanted.keys()) if (!given.has(key)) found.push([key, "missing"]);
  for (const key of given.keys()) if (!wanted.has(key)) found.push([key, "extra"]);
  for (const [key, source] of wanted) {
    const text = given.get(key);
    if (text === undefined) continue;
    if (Array.isArray(source) !== Array.isArray(text) || (Array.isArray(source) && source.length !== text.length)) {
      found.push([key, "shape"]);
      continue;
    }
    const pairs = Array.isArray(source) ? source.map((item, index) => [item, text[index]]) : [[source, text]];
    for (const [from, to] of pairs) {
      if (typeof to !== "string" || (to.trim() === "" && from.trim() !== "")) found.push([key, "empty"]);
      else if (tokens(from).join("|") !== tokens(to).join("|")) found.push([key, `placeholders ${tokens(from).join(" ")} / ${tokens(to).join(" ")}`]);
      else for (const term of protectedTerms) if (termIn(from, term) && !termIn(to, term)) found.push([key, `lost "${term}"`]);
    }
  }
  return found;
}

/** The dictionary in the same key order as the French one (so diffs stay readable). */
export function inOrderOf(fr, other) {
  const out = {};
  for (const [key, value] of Object.entries(fr)) {
    if (!(key in other)) continue;
    out[key] = isLeaf(value) ? other[key] : inOrderOf(value, other[key]);
  }
  return out;
}

/** Deep merge: `part` over `base`. */
export function merge(base, part) {
  for (const [key, value] of Object.entries(part)) {
    if (isLeaf(value) || typeof base[key] !== "object" || base[key] === null || isLeaf(base[key])) base[key] = value;
    else merge(base[key], value);
  }
  return base;
}

/** Leaves of `fr` that `other` does not have yet, as a nested object. */
export function missingFrom(fr, other) {
  const out = {};
  for (const [path, value] of leaves(fr)) if (getPath(other, path) === undefined) setPath(out, path, value);
  return out;
}

/** Splits a nested object into parts of about `maxBytes` of JSON, cutting between keys (down to the leaves when a group is too big). */
export function parts(dict, maxBytes) {
  const out = [];
  let current = {};
  let size = 0;
  const flush = () => {
    if (size > 0) out.push(current);
    current = {};
    size = 0;
  };
  const walk = (node, path) => {
    for (const [key, value] of Object.entries(node)) {
      const here = [...path, key];
      const bytes = Buffer.byteLength(JSON.stringify(value));
      if (!isLeaf(value) && bytes > maxBytes) walk(value, here);
      else {
        if (size + bytes > maxBytes) flush();
        setPath(current, here, value);
        size += bytes;
      }
    }
  };
  walk(dict, []);
  flush();
  return out;
}
