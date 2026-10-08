import { useRouter } from "next/router";
import { motion } from "motion/react";
import { useEffect, useState, type ReactNode } from "react";
import { PlanTheme } from "@/components/PlanTheme";
import { PlanWelcome } from "@/components/PlanWelcome";
import { Sidebar } from "@/components/Sidebar";
import { TabBar } from "@/components/TabBar";
import { easeOut } from "@/lib/motion";
import styles from "./AppShell.module.scss";

const tabRoutes = new Set(["/", "/history", "/parcels", "/settings", "/admin"]);

/**
 * Mobile (and native apps): one column with a floating tab bar.
 * Desktop browsers: a sidebar plus a wide content area. Both navs are always
 * rendered and toggled in CSS, so prerendered pages don't shift on hydration.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const showTabBar = tabRoutes.has(router.pathname);
  // Only animate pages reached by navigation: animating the first paint
  // would keep the prerendered HTML invisible until hydration.
  const [hasNavigated, setHasNavigated] = useState(false);

  useEffect(() => {
    const onStart = () => setHasNavigated(true);
    router.events.on("routeChangeStart", onStart);
    return () => router.events.off("routeChangeStart", onStart);
  }, [router.events]);

  return (
    <div className={styles.shell}>
      <div className={styles.aurora} aria-hidden>
        <span />
        <span />
      </div>
      <div className={styles.sidebar}>
        <Sidebar />
      </div>
      {/* Enter-only page transition: exit animations would outlive the
          previous page's CSS module, which Next unloads on navigation. */}
      <motion.main
        key={router.pathname}
        className={`${styles.main} ${showTabBar ? styles.withTabBar : ""}`}
        initial={hasNavigated ? { opacity: 0, y: 14, filter: "blur(6px)" } : false}
        // Drop the filter once done: any filter (even blur(0)) makes position:fixed
        // children (sheets, action bars) position against <main> instead of the screen.
        animate={{ opacity: 1, y: 0, filter: "blur(0px)", transitionEnd: { filter: "none", transform: "none" } }}
        transition={{ duration: 0.45, ease: easeOut }}
      >
        {children}
      </motion.main>
      {showTabBar && <TabBar />}
      <PlanTheme />
      <PlanWelcome />
    </div>
  );
}
