import type { RepeatEvery } from "./reminderRepeat";

// "Add to my calendar": a Google Calendar link, or an .ics file (RFC 5545)
// for any other calendar app. Pure, so it can be tested.

export type CalendarEvent = {
  /** Stable id, so importing the same reminder twice updates it. */
  uid: string;
  title: string;
  details?: string;
  start: number;
  /** Length of the event, in minutes. */
  minutes?: number;
  repeat?: RepeatEvery;
};

const DEFAULT_MINUTES = 30;

/** 20261027T063000Z */
export function utcStamp(timestamp: number) {
  return new Date(timestamp).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/**
 * The repetition rule, following the app: a 29th, 30th or 31st falls on the
 * last day of shorter months (and 29 February on the 28th), where a plain
 * FREQ=MONTHLY would skip those months (RFC 5545). The day is the one of
 * DTSTART, in UTC like DTSTART itself.
 */
export function rrule(repeat: RepeatEvery, start: number) {
  const date = new Date(start);
  const day = date.getUTCDate();
  if (repeat === "monthly") {
    if (day < 29) return "RRULE:FREQ=MONTHLY";
    const days = Array.from({ length: day - 27 }, (_, index) => 28 + index).join(",");
    return `RRULE:FREQ=MONTHLY;BYMONTHDAY=${days};BYSETPOS=-1`;
  }
  if (date.getUTCMonth() === 1 && day === 29) return "RRULE:FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=28,29;BYSETPOS=-1";
  return "RRULE:FREQ=YEARLY";
}

export function googleCalendarUrl(event: CalendarEvent) {
  const end = event.start + (event.minutes ?? DEFAULT_MINUTES) * 60_000;
  const params = new URLSearchParams({ action: "TEMPLATE", text: event.title, dates: `${utcStamp(event.start)}/${utcStamp(end)}` });
  if (event.details) params.set("details", event.details);
  if (event.repeat) params.set("recur", rrule(event.repeat, event.start));
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/** Escapes a TEXT value (RFC 5545 §3.3.11). */
export function escapeIcsText(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** Folds a content line to 75 octets (RFC 5545 §3.1), without splitting a character. */
function fold(line: string) {
  const encoder = new TextEncoder();
  const parts: string[] = [];
  let current = "";
  let size = 0;
  for (const char of line) {
    const length = encoder.encode(char).length;
    if (size + length > (parts.length === 0 ? 75 : 74)) {
      parts.push(current);
      current = "";
      size = 0;
    }
    current += char;
    size += length;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

/** A calendar with one event and an alarm at its start time. Lines end in CRLF. */
export function icsCalendar(event: CalendarEvent, now = Date.now()) {
  const end = event.start + (event.minutes ?? DEFAULT_MINUTES) * 60_000;
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Assisteo Agny//Reminders//FR",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${event.uid}`,
    `DTSTAMP:${utcStamp(now)}`,
    `DTSTART:${utcStamp(event.start)}`,
    `DTEND:${utcStamp(end)}`,
    ...(event.repeat ? [rrule(event.repeat, event.start)] : []),
    `SUMMARY:${escapeIcsText(event.title)}`,
    ...(event.details ? [`DESCRIPTION:${escapeIcsText(event.details)}`] : []),
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    `DESCRIPTION:${escapeIcsText(event.title)}`,
    "TRIGGER:PT0M",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.map(fold).join("\r\n") + "\r\n";
}
