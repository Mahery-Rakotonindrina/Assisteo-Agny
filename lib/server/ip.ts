// Rate limits by address: an IPv6 customer owns a whole /64, so counting each
// address would give a script billions of "different" visitors.

/** IPv4 as is; IPv6 reduced to its /64 prefix (its first four groups). Anything unreadable stays as it is. */
export function ipPrefix(ip: string): string {
  const raw = ip.trim().replace(/%.*$/, "");
  if (!raw.includes(":")) return raw;
  const mapped = raw.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i);
  if (mapped) return mapped[1];
  const [head, tail, ...extra] = raw.toLowerCase().split("::");
  if (extra.length > 0) return raw;
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const missing = 8 - left.length - right.length;
  if (tail === undefined ? left.length !== 8 : missing < 1) return raw;
  const groups = [...left, ...Array<string>(tail === undefined ? 0 : missing).fill("0"), ...right];
  if (groups.length !== 8 || groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return raw;
  return `${groups
    .slice(0, 4)
    .map((group) => group.replace(/^0+(?=.)/, ""))
    .join(":")}::/64`;
}
