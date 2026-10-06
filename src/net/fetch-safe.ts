// SSRF-safe URL fetch (ported from v1 refs.ts): public hosts only, re-checked on every redirect hop,
// size limit, timeout. Set PIXEL_BUILDER_ALLOW_PRIVATE_URLS=1 for local development.
import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";

export class FetchError extends Error {}

export const FETCH_TIMEOUT_MS = 15000;
export const FETCH_MAX_REDIRECTS = 3;
export const FETCH_MAX_BYTES = 25 * 1024 * 1024;

function blockedV4([a, b]: number[]): boolean {
  return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

/** True if `ip` (v4/v6 literal) is loopback/private/link-local/CGNAT/multicast. Unparseable counts as blocked. */
export function isBlockedIp(ip: string): boolean {
  const addr = ip.replace(/^\[|\]$/g, "").split("%")[0].toLowerCase();
  const kind = isIP(addr);
  if (kind === 4) return blockedV4(addr.split(".").map(Number));
  if (kind !== 6) return true;
  let g = addr;
  const v4 = addr.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (v4) {
    const o = v4[1].split(".").map(Number);
    g = addr.slice(0, -v4[1].length) + ((o[0] << 8) | o[1]).toString(16) + ":" + ((o[2] << 8) | o[3]).toString(16);
  }
  const [h, t] = g.split("::");
  const hp = h ? h.split(":") : [], tp = t ? t.split(":") : [];
  const groups = g.includes("::") ? [...hp, ...Array(8 - hp.length - tp.length).fill("0"), ...tp] : hp;
  const w = groups.map((x) => parseInt(x, 16));
  if (w.length !== 8 || w.some((x) => Number.isNaN(x))) return true;
  if (w.slice(0, 5).every((x) => x === 0) && (w[5] === 0xffff || w[5] === 0)) return blockedV4([w[6] >> 8, w[6] & 255, w[7] >> 8, w[7] & 255]);
  if ((w[0] & 0xfe00) === 0xfc00 || (w[0] & 0xffc0) === 0xfe80 || (w[0] & 0xff00) === 0xff00) return true;
  return false;
}

export interface FetchDeps {
  lookup?: (host: string) => Promise<{ address: string }[]>;
  fetch?: typeof fetch;
}

async function assertPublicHost(u: URL, deps: FetchDeps): Promise<void> {
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new FetchError(`Only http and https URLs are allowed, got '${u.protocol}'.`);
  if (process.env.PIXEL_BUILDER_ALLOW_PRIVATE_URLS === "1") return;
  const host = u.hostname.replace(/^\[|\]$/g, "");
  let addrs: { address: string }[];
  if (isIP(host)) addrs = [{ address: host }];
  else {
    try {
      addrs = await (deps.lookup ?? ((h) => dnsLookup(h, { all: true })))(host);
    } catch (e) {
      throw new FetchError(`Could not resolve ${host}: ${(e as Error).message}`);
    }
  }
  if (!addrs.length) throw new FetchError(`Could not resolve ${host}.`);
  if (addrs.some((a) => isBlockedIp(a.address))) throw new FetchError(`Refusing to fetch ${u.origin}: it resolves to a private or reserved address. Set PIXEL_BUILDER_ALLOW_PRIVATE_URLS=1 for local development.`);
}

/** Fetch an http(s) image URL as bytes (image/* only). */
export async function fetchImage(url: string, deps: FetchDeps = {}): Promise<Buffer> {
  let u: URL;
  try { u = new URL(url); } catch { throw new FetchError(`'${url}' is not a valid URL.`); }
  const doFetch = deps.fetch ?? fetch;
  const signal = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  let res!: Response;
  for (let hop = 0; hop <= FETCH_MAX_REDIRECTS; hop++) {
    await assertPublicHost(u, deps);
    try { res = await doFetch(u, { signal, redirect: "manual" }); } catch (e) { throw new FetchError(`Could not fetch ${url}: ${(e as Error).message}`); }
    const loc = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && loc) {
      if (hop === FETCH_MAX_REDIRECTS) throw new FetchError(`${url}: too many redirects (max ${FETCH_MAX_REDIRECTS}).`);
      try { u = new URL(loc, u); } catch { throw new FetchError(`${url}: invalid redirect target.`); }
      await res.body?.cancel().catch(() => {});
      continue;
    }
    break;
  }
  if (!res.ok) throw new FetchError(`Fetching ${url} failed: HTTP ${res.status}.`);
  const type = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (!type.startsWith("image/")) {
    await res.body?.cancel().catch(() => {});
    throw new FetchError(`${url} is '${type || "unknown type"}', not an image.`);
  }
  const limitMb = FETCH_MAX_BYTES / 1048576;
  if (Number(res.headers.get("content-length") ?? 0) > FETCH_MAX_BYTES) throw new FetchError(`${url} is larger than ${limitMb} MB.`);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for await (const c of res.body as unknown as AsyncIterable<Uint8Array>) {
      size += c.length;
      if (size > FETCH_MAX_BYTES) throw new FetchError(`${url} is larger than ${limitMb} MB.`);
      chunks.push(c);
    }
  } catch (e) {
    if (e instanceof FetchError) throw e;
    throw new FetchError(`Download of ${url} failed: ${(e as Error).message}`);
  }
  return Buffer.concat(chunks);
}
