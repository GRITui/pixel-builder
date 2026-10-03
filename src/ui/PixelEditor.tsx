// STUB — owned by Lane E. Keep the export name and props.
import type { Asset, StyleKit } from "../core/types";

export interface PixelEditorProps {
  asset: Asset;
  kit: StyleKit;
  onSave: (a: Asset) => void;
  onClose: () => void;
}

export function PixelEditor({ onClose }: PixelEditorProps) {
  return <div className="modal"><p>Pixel editor coming soon.</p><button onClick={onClose}>Close</button></div>;
}
