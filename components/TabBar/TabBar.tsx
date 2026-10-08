import Link from "next/link";
import { useRouter } from "next/router";
import { motion } from "motion/react";
import { History, ListChecks, Package, ScanLine, Settings2, ShieldCheck } from "lucide-react";
import { usePlan } from "@/hooks/usePlan";
import { useTranslation } from "@/hooks/useTranslation";
import { spring } from "@/lib/motion";
import { haptics } from "@/services/device";
import styles from "./TabBar.module.scss";

const tabs = [
  { href: "/", key: "scan", Icon: ScanLine },
  { href: "/history", key: "history", Icon: History },
  { href: "/parcels", key: "parcels", Icon: Package },
  { href: "/lists", key: "lists", Icon: ListChecks },
  { href: "/settings", key: "settings", Icon: Settings2 },
] as const;

/** Shown to administrators (full access) only; the page still asks for the token. */
const adminTab = { href: "/admin", key: "admin", Icon: ShieldCheck } as const;

export function TabBar() {
  const { pathname } = useRouter();
  const { t } = useTranslation();
  const { isAdmin } = usePlan();

  return (
    <nav className={styles.bar} aria-label="Main">
      <div className={styles.inner}>
        {(isAdmin ? [...tabs, adminTab] : tabs).map(({ href, key, Icon }) => {
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
