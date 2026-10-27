import { googleCalendarUrl, icsCalendar, type CalendarEvent } from "@/lib/calendar";
import type { RepeatEvery } from "@/lib/reminderRepeat";
import type { HistoryEntry } from "@/types/history";
import { openExternal } from "./device";
import { shareFile } from "./fileShare";

// "Add to my calendar" from a reminder: Google Calendar in the browser (or
// its app), or an .ics file for any other calendar app (downloaded on the
// web, shared in the app).

export type CalendarKind = "google" | "ics";

export function reminderEvent(entry: HistoryEntry, at: number, texts: { title: string; body: string }, repeat?: RepeatEvery | null): CalendarEvent {
  return { uid: `${entry.id}@assisteo-agny`, title: texts.title, details: texts.body, start: at, repeat: repeat ?? undefined };
}

/** A file name from the reminder's title: "rappel-facture-jirama.ics". */
export function icsFileName(title: string) {
  const slug = title
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `${slug || "rappel"}.ics`;
}

export async function addToCalendar(kind: CalendarKind, event: CalendarEvent) {
  if (kind === "google") {
    openExternal(googleCalendarUrl(event));
    return "opened" as const;
  }
  const bytes = new TextEncoder().encode(icsCalendar(event));
  return shareFile(icsFileName(event.title), bytes.buffer as ArrayBuffer, "text/calendar", event.title);
}
