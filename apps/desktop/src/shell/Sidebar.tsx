import { NavLink } from "react-router-dom";

import { SECTIONS } from "./sections";
import styles from "./AppShell.module.css";

export default function Sidebar() {
  return (
    <nav className={styles.sidebar} aria-label="Primary">
      <div className={styles.brand}>LifeScribe</div>
      <ul className={styles.sectionList}>
        {SECTIONS.map((s) => (
          <li key={s.path}>
            <NavLink
              to={s.path}
              end
              className={({ isActive }) =>
                isActive ? `${styles.link} ${styles.linkActive}` : styles.link
              }
            >
              <span className={styles.icon} aria-hidden="true">
                {s.icon}
              </span>
              <span>{s.label}</span>
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
