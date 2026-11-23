import type { PlanFeature } from "@/lib/plans";

// "Raccourcis de l'accueil": which shortcuts the home shows, and in what order.
// What is stored is only what the user changed (the hidden ones and an order),
// never a fixed list: a shortcut the app adds later shows up at the end, and a
// key that no longer exists is ignored. Pure, so it can be tested.

/** Every shortcut, in the default order. */
export const homeShortcutKeys = ["agenda", "food", "papers", "bills", "garage", "inventory", "plants", "health", "shop", "expenses", "pockets", "loans"] as const;
export type HomeShortcutKey = (typeof homeShortcutKeys)[number];

/** Synced with the account (a setting like the others). */
export type HomeShortcutsPref = { hidden: string[]; order: string[] };

export const defaultShortcuts: HomeShortcutsPref = { hidden: [], order: [] };

const keysOf = (value: unknown): string[] => (Array.isArray(value) ? [...new Set(value.filter((item): item is string => typeof item === "string"))] : []);

/** What was stored (maybe by another version, maybe damaged), as a safe value. */
export function normalizeShortcuts(value: unknown): HomeShortcutsPref {
  if (!value || typeof value !== "object") return defaultShortcuts;
  const { hidden, order } = value as Partial<HomeShortcutsPref>;
  return { hidden: keysOf(hidden), order: keysOf(order) };
}

export type ShortcutContext = {
  /** The plan gives this feature (or the Admin is testing it). */
  has: (feature: PlanFeature) => boolean;
  hasBills: boolean;
  /** Member of a household: "Mes dépenses" stays open to them. */
  inHousehold: boolean;
  /** Kept expenses and loans stay reachable, read only, once the feature is off. */
  keptExpenses: boolean;
  keptLoans: boolean;
};

/** The shortcuts the plan and the data allow today, in the default order. The setting never adds to them. */
export function availableShortcuts({ has, hasBills, inHousehold, keptExpenses, keptLoans }: ShortcutContext): HomeShortcutKey[] {
  const offered: Record<HomeShortcutKey, boolean> = {
    // An overview screen, for every plan: near the top by default.
    agenda: true,
    food: true,
    papers: true,
    bills: hasBills,
    // These three show with their plan's label when the plan lacks them.
    garage: true,
    inventory: true,
    plants: true,
    health: true,
    shop: has("shop"),
    expenses: has("expenses") || inHousehold || keptExpenses,
    pockets: has("expenses"),
    loans: has("loans") || keptLoans,
  };
  return homeShortcutKeys.filter((key) => offered[key]);
}

export type Arranged = {
  /** All the available ones in the user's order, hidden or not (what the editor lists). */
  all: string[];
  /** What the home shows. */
  visible: string[];
};

/** The available shortcuts in the saved order: the ones it names first, the others after, in the default order. */
export function arrangeShortcuts(available: readonly string[], pref: HomeShortcutsPref): Arranged {
  const known = new Set(available);
  const named = pref.order.filter((key) => known.has(key));
  const all = [...named, ...available.filter((key) => !named.includes(key))];
  const hidden = new Set(pref.hidden);
  return { all, visible: all.filter((key) => !hidden.has(key)) };
}

/** Moves a shortcut up (-1) or down (+1) among the available ones; the keys not available now keep their place in the saved order. */
export function moveShortcut(pref: HomeShortcutsPref, available: readonly string[], key: string, step: -1 | 1): HomeShortcutsPref {
  const { all } = arrangeShortcuts(available, pref);
  const from = all.indexOf(key);
  const to = from + step;
  if (from < 0 || to < 0 || to >= all.length) return pref;
  const moved = [...all];
  [moved[from], moved[to]] = [moved[to], moved[from]];
  return { ...pref, order: [...moved, ...pref.order.filter((item) => !moved.includes(item))] };
}

/** Shows or hides one shortcut. */
export function setShortcutHidden(pref: HomeShortcutsPref, key: string, hidden: boolean): HomeShortcutsPref {
  const rest = pref.hidden.filter((item) => item !== key);
  return { ...pref, hidden: hidden ? [...rest, key] : rest };
}

/** Whether nothing was changed. */
export const isDefaultShortcuts = (pref: HomeShortcutsPref) => pref.hidden.length === 0 && pref.order.length === 0;
