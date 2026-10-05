import { useRef, useState } from "react";
import { readReferenceImage } from "../../ai/refimage";

/** Minimal "Attach reference" control: one optional image sent with the AI request. */
export function AttachReference(props: { value: string | null; onChange: (dataUrl: string | null) => void; disabled?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [err, setErr] = useState("");
  const pick = async (f: File | undefined) => {
    if (!f) return;
    setErr("");
    try {
      props.onChange(await readReferenceImage(f));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not read that image.");
    }
  };
  return (
    <span className="attach-ref">
      <input
        ref={input}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          void pick(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      {props.value ? (
        <>
          <img src={props.value} alt="Attached reference" width={28} height={28} style={{ objectFit: "cover", verticalAlign: "middle" }} />{" "}
          <button type="button" className="ghost" disabled={props.disabled} aria-label="Remove attached reference" onClick={() => props.onChange(null)}>
            ✕
          </button>
        </>
      ) : (
        <button type="button" disabled={props.disabled} title="Attach a reference image: Claude matches its subject and style using the kit palette" onClick={() => input.current?.click()}>
          Attach reference
        </button>
      )}
      {err && <span className="error" role="alert"> {err}</span>}
    </span>
  );
}
