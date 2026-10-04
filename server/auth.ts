// Request authentication. One seam: an Authenticator inspects a request and says yes or
// no. `none` is local dev, `token` is a shared bearer token. `proxy-header` (trust an
// identity header set by an OIDC proxy such as oauth2-proxy) is reserved, not built.
import { createHash, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";

export type AuthResult = { ok: true; user?: string } | { ok: false; status: 401 | 403; message: string };
export type Authenticator = (req: IncomingMessage) => AuthResult;
export type AuthMode = "none" | "token" | "proxy-header";

/** Constant-time string compare (hash both so lengths do not leak). */
export function safeEqual(a: string, b: string): boolean {
  return timingSafeEqual(createHash("sha256").update(a).digest(), createHash("sha256").update(b).digest());
}

export function createAuth(env: Record<string, string | undefined> = process.env): Authenticator {
  const mode = (env.AUTH || "none").toLowerCase() as AuthMode;
  if (mode === "none") return () => ({ ok: true });
  if (mode === "token") {
    const token = env.PIXEL_BUILDER_TOKEN;
    if (!token) throw new Error("AUTH=token needs PIXEL_BUILDER_TOKEN to be set.");
    return (req) => {
      const m = /^Bearer\s+(.+)$/i.exec(String(req.headers.authorization ?? ""));
      if (m && safeEqual(m[1].trim(), token)) return { ok: true };
      return { ok: false, status: 401, message: "Missing or invalid bearer token. Send `Authorization: Bearer $PIXEL_BUILDER_TOKEN`." };
    };
  }
  if (mode === "proxy-header") throw new Error("AUTH=proxy-header is not implemented yet (planned: trust an identity header from an OIDC proxy). Use AUTH=token.");
  throw new Error(`Unknown AUTH mode '${env.AUTH}'. Use none or token.`);
}

/** Paths that stay open in every mode (load balancer / docker healthchecks). */
export const isOpenPath = (path: string): boolean => path === "/healthz";
