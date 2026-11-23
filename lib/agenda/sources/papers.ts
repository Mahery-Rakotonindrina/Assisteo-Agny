import { listPapers } from "@/lib/papers";
import { addDays, localDay } from "../days";
import { inWindow, type AgendaItem, type AgendaSource } from "../types";

/** An expired paper stays "late" this many days, then leaves the agenda (it stays in "Mes papiers"). */
export const LATE_PAPER_DAYS = 90;

/** The expiry of the papers kept (ID, insurance, warranty…); an expired one is late for LATE_PAPER_DAYS. For everyone. */
export const papersSource: AgendaSource = {
  id: "papers",
  domain: "papers",
  collect(context) {
    const items: AgendaItem[] = [];
    const oldest = addDays(localDay(context.now), -LATE_PAPER_DAYS);
    for (const paper of listPapers(context.data.entries, context.now)) {
      if (paper.expiry === null) continue;
      const base = { domain: "papers", at: paper.expiry, timed: false, label: { key: "agenda.items.paper", params: { title: paper.entry.analysis.title } }, href: `/result?id=${encodeURIComponent(paper.entry.id)}` };
      if (paper.status === "expired") {
        if (paper.expiry >= oldest) items.push({ ...base, key: `paper-late:${paper.entry.id}`, detail: { key: "agenda.items.expired" }, late: true });
      } else if (inWindow(paper.expiry, context)) items.push({ ...base, key: `paper:${paper.entry.id}` });
    }
    return items;
  },
};
