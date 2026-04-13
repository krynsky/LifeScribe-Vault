import { useMemo, useState } from "react";

import styles from "./NoteList.module.css";

export interface NoteListRow {
  id: string;
  type: string;
  title?: string;
  subtitle?: string;
}

interface Props {
  rows: NoteListRow[];
  onSelect: (id: string) => void;
  emptyLabel?: string;
}

export default function NoteList({ rows, onSelect, emptyLabel = "No notes yet." }: Props) {
  const [filter, setFilter] = useState("");
  const filtered = useMemo(() => {
    const f = filter.trim().toLowerCase();
    if (!f) return rows;
    return rows.filter((r) =>
      [r.title, r.subtitle, r.id].some((v) => v?.toLowerCase().includes(f)),
    );
  }, [rows, filter]);

  return (
    <div className={styles.wrapper}>
      <input
        type="search"
        className={styles.filter}
        placeholder="Filter…"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />
      {filtered.length === 0 ? (
        <div className={styles.empty}>{emptyLabel}</div>
      ) : (
        <ul className={styles.list}>
          {filtered.map((r) => (
            <li key={r.id}>
              <button type="button" className={styles.row} onClick={() => onSelect(r.id)}>
                <div className={styles.title}>{r.title ?? r.id}</div>
                {r.subtitle && <div className={styles.subtitle}>{r.subtitle}</div>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
