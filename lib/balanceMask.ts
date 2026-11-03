/** What a hidden balance shows, exactly this, wherever a pocket's balance appears. */
export const BALANCE_MASK = "************";

/** Which balances are hidden, on this device only: every one, or the listed pockets. */
export type BalanceMask = { all: boolean; ids: string[] };

export const noMask: BalanceMask = { all: false, ids: [] };

/** A stored value of an older app or a bad file: nothing hidden. */
export function normalizeMask(value: unknown): BalanceMask {
  if (!value || typeof value !== "object") return noMask;
  const { all, ids } = value as Partial<BalanceMask>;
  return { all: all === true, ids: Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [] };
}

export const isHidden = (mask: BalanceMask, id: string) => mask.all || mask.ids.includes(id);

/** The total stays hidden when any pocket in it is hidden. */
export const isTotalHidden = (mask: BalanceMask, ids: string[]) => mask.all || ids.some((id) => mask.ids.includes(id));

/** The eye reads "closed" when every pocket given is hidden. */
export const areAllHidden = (mask: BalanceMask, ids: string[]) => mask.all || (ids.length > 0 && ids.every((id) => mask.ids.includes(id)));

/** The eye: hides every balance, or shows them all again. */
export const toggleAll = (mask: BalanceMask, ids: string[]): BalanceMask => (areAllHidden(mask, ids) ? noMask : { all: true, ids: mask.ids });

/** "Masquer son solde" / "Afficher son solde": one pocket, the others untouched (even under the eye). */
export function toggleOne(mask: BalanceMask, id: string, ids: string[]): BalanceMask {
  if (isHidden(mask, id)) {
    const rest = mask.all ? ids.filter((other) => other !== id) : mask.ids.filter((other) => other !== id);
    return { all: false, ids: rest };
  }
  return { all: false, ids: [...mask.ids, id] };
}
