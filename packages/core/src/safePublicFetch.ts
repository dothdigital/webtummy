import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export type SafePublicFetchOptions = { maxRedirects?: number; sameHostname?: boolean };

function unsafeIpv4(address: string) {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b, c] = parts;
  return a === 0 || a === 10 || a === 127 || a >= 224
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 0 && c === 0)
    || (a === 192 && b === 0 && c === 2)
    || (a === 192 && b === 168)
    || (a === 198 && (b === 18 || b === 19))
    || (a === 198 && b === 51 && c === 100)
    || (a === 203 && b === 0 && c === 113);
}

export function isUnsafeNetworkAddress(address: string) {
  const normalized = address.toLowerCase().split("%")[0];
  const version = isIP(normalized);
  if (version === 4) return unsafeIpv4(normalized);
  if (version !== 6) return true;
  if (normalized.startsWith("::ffff:")) return unsafeIpv4(normalized.slice(7));
  return normalized === "::" || normalized === "::1" || normalized.startsWith("fc") || normalized.startsWith("fd")
    || /^fe[89ab]/.test(normalized) || normalized.startsWith("ff") || normalized.startsWith("2001:db8:");
}

export async function assertSafePublicHttpUrl(input: string | URL) {
  const url = input instanceof URL ? new URL(input) : new URL(input);
  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("Only public HTTP or HTTPS URLs without embedded credentials are allowed.");
  if (url.port && !["80", "443"].includes(url.port)) throw new Error("Only standard public HTTP and HTTPS ports are allowed.");
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local") || hostname.endsWith(".internal") || hostname.endsWith(".home.arpa")) throw new Error("Local and private destinations are not allowed.");
  const addresses = await lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => isUnsafeNetworkAddress(address))) throw new Error("The destination resolves to a private, reserved, or unsafe network address.");
  return url;
}

export async function safePublicFetch(input: string | URL, init: RequestInit = {}, options: SafePublicFetchOptions = {}) {
  const maximum = options.maxRedirects ?? 5;
  const first = await assertSafePublicHttpUrl(input);
  let current = first;
  let requestInit: RequestInit = { ...init, redirect: "manual" };
  for (let hop = 0; hop <= maximum; hop++) {
    await assertSafePublicHttpUrl(current);
    const response = await fetch(current, requestInit);
    if (response.status < 300 || response.status >= 400) return response;
    const location = response.headers.get("location");
    if (!location) return response;
    if (hop === maximum) {
      await response.body?.cancel();
      throw new Error("The destination exceeded the safe redirect limit.");
    }
    const next = await assertSafePublicHttpUrl(new URL(location, current));
    if (options.sameHostname && next.hostname.toLowerCase() !== first.hostname.toLowerCase()) {
      await response.body?.cancel();
      throw new Error("The destination redirected to a different hostname.");
    }
    await response.body?.cancel();
    if (response.status === 303 || ((response.status === 301 || response.status === 302) && String(requestInit.method ?? "GET").toUpperCase() === "POST")) requestInit = { ...requestInit, method: "GET", body: undefined };
    current = next;
  }
  throw new Error("The destination could not be fetched safely.");
}
