import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

// Users can point the server at any OpenAI-compatible API. Without these
// checks that would let anyone make the server call internal addresses (cloud
// metadata, private networks, localhost): classic SSRF.

export class UnsafeUrlError extends Error {}

function isPrivateIPv4(ip: string) {
  const [a, b] = ip.split(".").map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    (a === 169 && b === 254) || // link-local, cloud metadata
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) || // benchmarking
    a >= 224 // multicast and reserved
  );
}

function isPrivateIP(ip: string) {
  if (isIP(ip) === 4) return isPrivateIPv4(ip);
  const normalized = ip.toLowerCase();
  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateIPv4(mapped[1]);
  return (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") || // unique local
    normalized.startsWith("fe8") ||
    normalized.startsWith("fe9") ||
    normalized.startsWith("fea") ||
    normalized.startsWith("feb") // link-local
  );
}

/** Throws UnsafeUrlError unless the URL is https and resolves to public addresses only. */
export async function assertPublicHttpsUrl(raw: string) {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeUrlError("Invalid URL.");
  }
  if (url.protocol !== "https:") throw new UnsafeUrlError("Only https:// APIs are allowed.");
  if (url.username || url.password) throw new UnsafeUrlError("Credentials in the URL are not allowed.");

  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || /\.(localhost|local|internal|lan|home|corp)$/i.test(host)) {
    throw new UnsafeUrlError("Local addresses are not allowed.");
  }

  const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => []);
  if (addresses.length === 0) throw new UnsafeUrlError("This address can't be resolved.");
  if (addresses.some(({ address }) => isPrivateIP(address))) {
    throw new UnsafeUrlError("Private network addresses are not allowed.");
  }
  return url;
}
