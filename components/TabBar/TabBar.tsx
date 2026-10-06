import Link from "next/link";
import { useRouter } from "next/router";
import { motion } from "motion/react";
import { History, ScanLine, Settings2 } from "lucide-react";
import { useTranslation } from "@/hooks/useTranslation";
import { spring } from "@/lib/motion";
import { haptics } from "@/services/device";
import styles from "./TabBar.module.scss";

const tabs = [
  { href: "/", key: "scan", Icon: ScanLine },
  { href: "/history", key: "history", Icon: History },
  { href: "/settings", key: "settings", Icon: Settings2 },
] as const;

export function TabBar() {
  const { pathname } = useRouter();
  const { t } = useTranslation();

  return (
    <nav className={styles.bar} aria-label="Main">
      <div className={styles.inner}>
        {tabs.map(({ href, key, Icon }) => {
          const active = pathname === href;
          return (
            <Link
              key={key}
              href={href}
              className={`${styles.tab} ${active ? styles.active : ""}`}
              aria-current={active ? "page" : undefined}
              onClick={() => !active && haptics.tap()}
            >
              {active && <motion.span layoutId="tab-pill" className={styles.pill} transition={spring} />}
              <motion.span className={styles.icon} animate={{ scale: active ? 1.08 : 1 }} transition={spring}>
                <Icon size={20} strokeWidth={active ? 2.4 : 2} />
              </motion.span>
              <span className={styles.label}>{t(`nav.${key}`)}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
