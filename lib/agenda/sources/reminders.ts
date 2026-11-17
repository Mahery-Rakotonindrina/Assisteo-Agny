import { nextOccurrence } from "@/lib/reminderRepeat";
import { inWindow, plain, type AgendaItem, type AgendaSource } from "../types";

/** Most occurrences of one repeating reminder shown in the window. */
const MAX_REPEATS = 40;

/** The reminders set on scans, with the next occurrences of a monthly or yearly one. Paused below Lite, like the reminders themselves. */
export const remindersSource: AgendaSource = {
  id: "reminders",
  domain: "reminders",
  collect(context) {
    if (!context.has("reminders")) return [];
    const items: AgendaItem[] = [];
    for (const entry of context.data.entries) {
      if (!entry.reminderAt) continue;
      const label = plain(entry.analysis.reminder?.title ?? entry.analysis.title);
      let at = entry.reminderAt;
      for (let count = 0; count < MAX_REPEATS && at < context.to; count += 1) {
        if (inWindow(at, context)) items.push({ key: `reminder:${entry.id}:${at}`, domain: "reminders", at, timed: true, label, href: `/result?id=${encodeURIComponent(entry.id)}` });
        if (!entry.reminderRepeat) break;
        at = nextOccurrence(entry.reminderRepeat, at);
      }
    }
    return items;
  },
};
