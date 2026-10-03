// STUB — owned by Lane E. Keep the export name and props.
import type { Asset, Category, StyleKit } from "../core/types";

export interface ImportDialogProps {
  kit: StyleKit;
  /** Category the user is currently in; the dialog may let them change it. */
  category: Category;
  onImport: (a: Asset) => void;
  onClose: () => void;
}

export function ImportDialog({ onClose }: ImportDialogProps) {
  return <div className="modal"><p>Image import coming soon.</p><button onClick={onClose}>Close</button></div>;
}
