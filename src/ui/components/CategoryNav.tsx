import { CATEGORIES, type Asset, type Category } from "../../core/types";

export type View = Category | "library";

export function CategoryNav({ view, onView, assets }: { view: View; onView: (v: View) => void; assets: Asset[] }) {
  const count = (c: Category) => assets.filter((a) => a.category === c).length;
  return (
    <nav className="nav" aria-label="Categories">
      {CATEGORIES.map((c) => (
        <button key={c.id} className={view === c.id ? "on" : ""} aria-current={view === c.id ? "page" : undefined} onClick={() => onView(c.id)}>
          <span>{c.label}</span>
          <span className="count">{count(c.id) || ""}</span>
        </button>
      ))}
      <hr />
      <button className={view === "library" ? "on" : ""} aria-current={view === "library" ? "page" : undefined} onClick={() => onView("library")}>
        <span>Library</span>
        <span className="count">{assets.length || ""}</span>
      </button>
    </nav>
  );
}
