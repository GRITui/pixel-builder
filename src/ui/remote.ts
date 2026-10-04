// Shared team library (web side). When `/api/projects/<id>` answers, the project is
// loaded from and saved to the server (ETag + If-Match); otherwise the app keeps using
// localStorage exactly as before. Token and project id live in localStorage.
import { useCallback, useEffect, useRef, useState } from "react";
import { parseProject, serializeProject, type ProjectFile } from "../core/project";

const TOKEN_KEY = "pixel-builder:v1:token";
const PROJECT_KEY = "pixel-builder:v1:remote-project";
const POLL_MS = 5000;
const SAVE_DEBOUNCE_MS = 800;
const CONFLICT_MSG = "This library changed elsewhere. Reload to get the latest version (your unsaved changes here will be replaced).";

function lsGet(k: string): string | null {
  try {
    return window.localStorage.getItem(k);
  } catch {
    return null;
  }
}
function lsSet(k: string, v: string) {
  try {
    if (v) window.localStorage.setItem(k, v);
    else window.localStorage.removeItem(k);
  } catch {
    /* ignore */
  }
}

export const getToken = () => lsGet(TOKEN_KEY) ?? "";
export const setToken = (t: string) => lsSet(TOKEN_KEY, t.trim());
export const getProjectId = () => lsGet(PROJECT_KEY) || "team";
export const setProjectId = (id: string) => lsSet(PROJECT_KEY, id.trim());

/** Authorization header for API calls when a token is stored. */
export function authHeaders(): Record<string, string> {
  const t = getToken();
  return t ? { authorization: `Bearer ${t}` } : {};
}

export type SyncState = "off" | "connecting" | "synced" | "saving" | "conflict" | "auth" | "error";

interface Remote {
  id: string;
  etag: string | null;
  /** serializeProject of the last state known to match the server. */
  text: string;
}

const url = (id: string) => `/api/projects/${encodeURIComponent(id)}`;

export function useRemoteSync(project: ProjectFile, replaceProject: (p: ProjectFile) => void) {
  const [state, setState] = useState<SyncState>("connecting");
  const [message, setMessage] = useState("");
  const remote = useRef<Remote | null>(null);
  const projectRef = useRef(project);
  projectRef.current = project;
  const stateRef = useRef(state);
  stateRef.current = state;
  const inflight = useRef(false);

  const adopt = useCallback(
    (text: string, etag: string | null) => {
      const parsed = parseProject(text).project;
      remote.current = { id: getProjectId(), etag, text: serializeProject(parsed) };
      replaceProject(parsed);
    },
    [replaceProject],
  );

  /** Initial connect, also used by "reload". */
  const connect = useCallback(async () => {
    const id = getProjectId();
    setState("connecting");
    try {
      const res = await fetch(url(id), { headers: authHeaders() });
      if (res.status === 401) {
        setState("auth");
        setMessage("The server needs an access token.");
        return;
      }
      if (res.status === 404) {
        const text = serializeProject(projectRef.current);
        const put = await fetch(url(id), { method: "PUT", headers: { ...authHeaders(), "content-type": "application/json" }, body: text });
        if (!put.ok) throw new Error(`HTTP ${put.status}`);
        remote.current = { id, etag: put.headers.get("etag"), text };
        setState("synced");
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      adopt(await res.text(), res.headers.get("etag"));
      setState("synced");
      setMessage("");
    } catch {
      remote.current = null;
      setState("off"); // no server: plain localStorage mode
    }
  }, [adopt]);

  useEffect(() => {
    void connect();
  }, [connect]);

  // save: debounce local changes, PUT with If-Match
  useEffect(() => {
    const r = remote.current;
    if (!r || (state !== "synced" && state !== "saving")) return;
    const text = serializeProject(project);
    if (text === r.text) return;
    const t = setTimeout(async () => {
      if (inflight.current) return;
      inflight.current = true;
      setState("saving");
      try {
        const res = await fetch(url(r.id), { method: "PUT", headers: { ...authHeaders(), "content-type": "application/json", ...(r.etag ? { "if-match": r.etag } : {}) }, body: text });
        if (res.status === 409) {
          setState("conflict");
          setMessage(CONFLICT_MSG);
        } else if (res.status === 401) {
          setState("auth");
          setMessage("The server needs an access token.");
        } else if (!res.ok) {
          setState("error");
          setMessage(`Save failed (HTTP ${res.status}).`);
        } else {
          r.etag = res.headers.get("etag");
          r.text = text;
          setState("synced");
        }
      } catch {
        setState("error");
        setMessage("Could not reach the server; changes are kept in this browser.");
      } finally {
        inflight.current = false;
      }
    }, SAVE_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [project, state]);

  // poll for remote changes (so two browsers share one live library)
  useEffect(() => {
    const timer = setInterval(async () => {
      const r = remote.current;
      if (!r || stateRef.current !== "synced" || inflight.current) return;
      try {
        const res = await fetch(url(r.id), { headers: { ...authHeaders(), ...(r.etag ? { "if-none-match": r.etag } : {}) } });
        if (res.status === 304 || !res.ok) return;
        const etag = res.headers.get("etag");
        if (etag === r.etag) return;
        if (serializeProject(projectRef.current) !== r.text) {
          setState("conflict");
          setMessage(CONFLICT_MSG);
          return;
        }
        adopt(await res.text(), etag);
      } catch {
        /* transient; try again next tick */
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [adopt]);

  return { state, message, reload: connect };
}
