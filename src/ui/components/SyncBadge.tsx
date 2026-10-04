import { useState } from "react";
import { getProjectId, getToken, setProjectId, setToken, type SyncState } from "../remote";

const LABEL: Record<SyncState, string> = {
  off: "",
  connecting: "Connecting to shared library...",
  synced: "Shared library: synced",
  saving: "Shared library: saving...",
  conflict: "Changed elsewhere",
  auth: "Token needed",
  error: "Sync problem",
};

/** Tiny status chip + settings (token, project id) for the shared library. Hidden when no server library is in use. */
export function SyncBadge({ state, message, reload }: { state: SyncState; message: string; reload: () => void }) {
  const [open, setOpen] = useState(false);
  const [token, setTok] = useState(getToken());
  const [pid, setPid] = useState(getProjectId());
  if (state === "off" && !open) return null;
  const bad = state === "conflict" || state === "auth" || state === "error";
  return (
    <div role="status" style={{ position: "fixed", left: 16, bottom: 16, zIndex: 80, background: "var(--panel-2)", border: `1px solid ${bad ? "var(--bad)" : "var(--line-2)"}`, borderRadius: 8, padding: "6px 10px", fontSize: 12, maxWidth: 360 }}>
      <span>{LABEL[state] || "Shared library"}</span>{" "}
      {state === "conflict" && <button onClick={reload}>Reload</button>}{" "}
      <button onClick={() => setOpen(!open)} aria-label="Shared library settings">Settings</button>
      {message && bad && <div>{message}</div>}
      {open && (
        <div style={{ marginTop: 6, display: "grid", gap: 4 }}>
          <label>Project id <input value={pid} onChange={(e) => setPid(e.target.value)} /></label>
          <label>Access token <input type="password" value={token} onChange={(e) => setTok(e.target.value)} /></label>
          <button onClick={() => { setToken(token); setProjectId(pid); setOpen(false); reload(); }}>Save and reconnect</button>
        </div>
      )}
    </div>
  );
}
