import { useEffect } from "react";
import { usePlan } from "@/hooks/usePlan";

/**
 * Puts the user's plan on <html> (data-plan), so the whole app can take its
 * colours: the background glows, the scan button's ring (styles/globals.scss).
 * A plan created from the Admin by its own id and colour (data-plan-color,
 * styles/planColors.scss).
 */
export function PlanTheme() {
  const { id, current, color } = usePlan();
  const tone = color();
  useEffect(() => {
    const root = document.documentElement;
    if (id === "free") delete root.dataset.plan;
    else root.dataset.plan = current;
    if (tone) root.dataset.planColor = tone;
    else delete root.dataset.planColor;
  }, [id, current, tone]);
  return null;
}
