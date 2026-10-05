import { afterEach, describe, expect, it } from "vitest";
import { fetchImage, isBlockedIp, URL_FETCH_MAX_BYTES } from "./refs";

const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]);
const img = (body: BodyInit = png, type = "image/png", extra: Record<string, string> = {}) => new Response(body, { status: 200, headers: { "content-type": type, ...extra } });
const redirect = (to: string) => new Response(null, { status: 302, headers: { location: to } });
const pub = async () => [{ address: "93.184.216.34" }];

afterEach(() => { delete process.env.PIXEL_BUILDER_ALLOW_PRIVATE_URLS; });

describe("isBlockedIp", () => {
  it.each([
    "127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "100.127.1.1",
    "0.0.0.0", "224.0.0.1", "255.255.255.255", "::1", "::", "fc00::1", "fd12::1", "fe80::1", "ff02::1",
    "::ffff:127.0.0.1", "::ffff:10.0.0.1", "::ffff:7f00:1", "::ffff:169.254.169.254", "not-an-ip",
  ])("blocks %s", (ip) => expect(isBlockedIp(ip)).toBe(true));
  it.each(["93.184.216.34", "8.8.8.8", "172.32.0.1", "100.128.0.1", "2606:4700::1111", "::ffff:8.8.8.8"])("allows %s", (ip) => expect(isBlockedIp(ip)).toBe(false));
});

describe("fetchImage URL safety", () => {
  it("allows a public host", async () => {
    const b = await fetchImage("https://example.com/a.png", { lookup: pub, fetch: async () => img() });
    expect(b.length).toBe(png.length);
  });
  it("rejects non-http schemes", async () => {
    await expect(fetchImage("file:///etc/passwd", { lookup: pub, fetch: async () => img() })).rejects.toThrow(/http/);
    await expect(fetchImage("ftp://example.com/a.png")).rejects.toThrow(/http/);
  });
  it.each(["http://127.0.0.1/a.png", "http://169.254.169.254/latest/meta-data", "http://[::1]/a.png", "http://10.0.0.5/x", "http://[::ffff:192.168.0.1]/x"])("blocks literal %s", async (u) => {
    let called = false;
    await expect(fetchImage(u, { fetch: async () => { called = true; return img(); } })).rejects.toThrow(/private or reserved/);
    expect(called).toBe(false);
  });
  it("blocks hostnames resolving to private addresses (any record)", async () => {
    await expect(fetchImage("http://evil.test/a.png", { lookup: async () => [{ address: "93.184.216.34" }, { address: "10.0.0.1" }], fetch: async () => img() })).rejects.toThrow(/private or reserved/);
  });
  it("re-checks each redirect hop", async () => {
    const lookup = async (h: string) => [{ address: h === "internal.test" ? "192.168.1.10" : "93.184.216.34" }];
    const f = async (u: URL | string) => (String(u).includes("internal.test") ? img() : redirect("http://internal.test/secret.png"));
    await expect(fetchImage("https://example.com/a.png", { lookup, fetch: f as typeof fetch })).rejects.toThrow(/private or reserved/);
  });
  it("follows public redirects up to 3 hops", async () => {
    let n = 0;
    const f = async () => (n++ < 3 ? redirect(`/r${n}`) : img());
    expect((await fetchImage("https://example.com/a", { lookup: pub, fetch: f as typeof fetch })).length).toBe(png.length);
    n = -10;
    await expect(fetchImage("https://example.com/a", { lookup: pub, fetch: f as typeof fetch })).rejects.toThrow(/too many redirects/);
  });
  it("rejects oversize by header and by stream", async () => {
    await expect(fetchImage("https://example.com/a", { lookup: pub, fetch: async () => img(png, "image/png", { "content-length": String(URL_FETCH_MAX_BYTES + 1) }) })).rejects.toThrow(/limit/);
    const big = new Uint8Array(URL_FETCH_MAX_BYTES + 1);
    await expect(fetchImage("https://example.com/a", { lookup: pub, fetch: async () => img(big) })).rejects.toThrow(/larger than/);
  });
  it("rejects non-image content types", async () => {
    await expect(fetchImage("https://example.com/a", { lookup: pub, fetch: async () => img("<html>", "text/html; charset=utf-8") })).rejects.toThrow(/not an image/);
  });
  it("env escape hatch allows private hosts", async () => {
    process.env.PIXEL_BUILDER_ALLOW_PRIVATE_URLS = "1";
    expect((await fetchImage("http://127.0.0.1:9/a.png", { fetch: async () => img() })).length).toBe(png.length);
  });
});
