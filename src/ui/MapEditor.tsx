// STUB — owned by Lane E. Keep the export name and props.
import type { Asset, StyleKit } from "../core/types";

export interface MapEditorProps {
  /** A map asset (asset.tilemap is set). */
  asset: Asset;
  kit: StyleKit;
  /** Whole library, so environment/object assets can be added to the tile set. */
  library: Asset[];
  onSave: (a: Asset) => void;
  onClose: () => void;
}

export function MapEditor({ onClose }: MapEditorProps) {
  return <div className="modal"><p>Map editor coming soon.</p><button onClick={onClose}>Close</button></div>;
}
