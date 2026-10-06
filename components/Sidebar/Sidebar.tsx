import Link from "next/link";
import { useRouter } from "next/router";
import { motion } from "motion/react";
import { Download, History, ScanLine, Settings2, Smartphone, UserRound } from "lucide-react";
import { useAiStatus } from "@/hooks/useAiStatus";
import { useInstallPrompt } from "@/hooks/useInstallPrompt";
import { useTranslation } from "@/hooks/useTranslation";
import { useAccount } from "@/lib/account/AccountProvider";
import { spring } from "@/lib/motion";
import styles from "./Sidebar.module.scss";

const links = [
  { href: "/", key: "scan", Icon: ScanLine },
  { href: "/history", key: "history", Icon: History },
  { href: "/settings", key: "settings", Icon: Settings2 },
] as const;

/** Desktop navigation, replacing the mobile tab bar on wide screens. */
export function Sidebar() {
  const { pathname } = useRouter();
  const { t } = useTranslation();
  const aiStatus = useAiStatus();
  const account = useAccount();
  const { canInstall, install } = useInstallPrompt();

  const statusLabel =
    aiStatus.status === "live"
      ? `${aiStatus.label ?? "IA"} · ${aiStatus.ownKey ? t("settings.aiOwnKey") : t("settings.aiLive")}`
      : aiStatus.status === "demo"
        ? t("settings.aiDemo")
        : aiStatus.status === "offline"
          ? t("settings.aiOffline")
          : "…";

  return (
    <aside className={styles.sidebar}>
      <Link href="/" className={styles.brand}>
        {/* eslint-disable-next-line @next/next/no-img-element -- static SVG logo */}
        <img src="/icon.svg" alt="" width={36} height={36} />
        <span>Assisteo Agny</span>
      </Link>

      <nav className={styles.nav} aria-label="Main">
        {links.map(({ href, key, Icon }) => {
          const active = pathname === href || (href === "/history" && pathname === "/result");
          return (
            <Link key={key} href={href} className={`${styles.link} ${active ? styles.active : ""}`} aria-current={active ? "page" : undefined}>
              {active && <motion.span layoutId="sidebar-pill" className={styles.pill} transition={spring} />}
              <Icon size={19} />
              <span>{t(`nav.${key}`)}</span>
            </Link>
          );
        })}
      </nav>

      <div className={styles.footer}>
        <div className={styles.install}>
          <strong>{t("sidebar.installTitle")}</strong>
          <p>{t("sidebar.installBody")}</p>
          {canInstall && (
            <button type="button" className={styles.installButton} onClick={() => void install()}>
              <Download size={16} />
              {t("sidebar.installCta")}
            </button>
          )}
          <p className={styles.mobile}>
            <Smartphone size={14} />
            {t("sidebar.mobileApps")}
          </p>
        </div>

        {account.available && account.session !== undefined && (
          <Link href="/settings?section=account" className={styles.account}>
            <span className={account.email ? styles.avatar : styles.avatarEmpty}>
              {account.email ? account.email.charAt(0).toUpperCase() : <UserRound size={16} />}
            </span>
            <span className={styles.accountText}>{account.email ?? t("account.signIn")}</span>
          </Link>
        )}

        <Link href="/settings" className={styles.status} data-status={aiStatus.status}>
          <span className={styles.dot} />
          {statusLabel}
        </Link>
      </div>
    </aside>
  );
}
