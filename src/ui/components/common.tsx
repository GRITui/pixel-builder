import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { aiStatus, type AiStatus } from "../../ai/client";
import { resolveRamps } from "../../core/kit";
import type { Material } from "../../core/palette";
import type { StyleKit } from "../../core/types";
import { paletteFor } from "../render";

export function usePalette(kit: StyleKit) {
  return useMemo(() => paletteFor(kit), [kit]);
}

/** Polls /api/health once and on demand. */
export function useAiStatus(): { status: AiStatus | null; refresh: () => void } {
  const [status, setStatus] = useState<AiStatus | null>(null);
  const refresh = useCallback(() => {
    aiStatus()
      .then(setStatus)
      .catch((e) => setStatus({ enabled: false, model: null, reason: e instanceof Error ? e.message : "AI server unreachable" }));
  }, []);
  useEffect(refresh, [refresh]);
  return { status, refresh };
}

export function aiOffReason(status: AiStatus | null): string {
  if (!status) return "Checking the AI server…";
  return status.reason ? `AI is off: ${status.reason}` : "AI is off: set ANTHROPIC_API_KEY on the server and restart it.";
}

/** Five hard-stop gradient showing a material ramp (dark -> light). */
export function rampGradient(ramp: string[]): string {
  const n = ramp.length;
  return `linear-gradient(90deg, ${ramp.map((c, i) => `${c} ${(i / n) * 100}% ${((i + 1) / n) * 100}%`).join(", ")})`;
}

export function RampSwatch({ kit, material, className = "" }: { kit: StyleKit; material: Material; className?: string }) {
  const ramp = resolveRamps(kit)[material];
  return <span className={`ramp ${className}`} style={{ background: rampGradient(ramp) }} title={material} />;
}

export function Modal({ title, onClose, children, wide, footer }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean; footer?: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`dialog ${wide ? "wide" : ""}`} role="dialog" aria-modal="true" aria-label={title}>
        <header className="dialog-head">
          <h2>{title}</h2>
          <button className="ghost" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>
        <div className="dialog-body">{children}</div>
        {footer && <footer className="dialog-foot">{footer}</footer>}
      </div>
    </div>
  );
}
