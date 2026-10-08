import { useEffect } from "react";
import { usePlan } from "@/hooks/usePlan";

/**
 * Puts the user's plan on <html> (data-plan), so the whole app can take its
 * colours: the background glows, the scan button's ring (styles/globals.scss).
 */
export function PlanTheme() {
  const { id } = usePlan();
  useEffect(() => {
    const root = document.documentElement;
    if (id === "free") delete root.dataset.plan;
    else root.dataset.plan = id;
  }, [id]);
  return null;
}
