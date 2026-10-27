import { describe, expect, it } from "vitest";
import { escapeIcsText, googleCalendarUrl, icsCalendar, rrule, utcStamp, type CalendarEvent } from "@/lib/calendar";
import { icsFileName } from "@/services/calendarExport";

const start = Date.UTC(2026, 9, 27, 6, 30);
const event: CalendarEvent = { uid: "scan-1@assisteo-agny", title: "Facture JIRAMA", details: "Payer avant le 30", start };

describe("utcStamp", () => {
  it("writes the time in UTC, basic format", () => {
    expect(utcStamp(start)).toBe("20261027T063000Z");
  });
});

describe("googleCalendarUrl", () => {
  it("fills the template: title, 30 minutes in UTC, details", () => {
    const url = new URL(googleCalendarUrl(event));
    expect(url.origin + url.pathname).toBe("https://calendar.google.com/calendar/render");
    expect(url.searchParams.get("action")).toBe("TEMPLATE");
    expect(url.searchParams.get("text")).toBe("Facture JIRAMA");
    expect(url.searchParams.get("dates")).toBe("20261027T063000Z/20261027T070000Z");
    expect(url.searchParams.get("details")).toBe("Payer avant le 30");
    expect(url.searchParams.has("recur")).toBe(false);
  });

  it("repeats every month or every year", () => {
    expect(new URL(googleCalendarUrl({ ...event, repeat: "monthly" })).searchParams.get("recur")).toBe("RRULE:FREQ=MONTHLY");
    expect(new URL(googleCalendarUrl({ ...event, repeat: "yearly" })).searchParams.get("recur")).toBe("RRULE:FREQ=YEARLY");
  });
});

describe("icsCalendar", () => {
  const ics = icsCalendar({ ...event, title: "Loyer; maison, Tana", details: "Ligne 1\nLigne 2 \\ fin", repeat: "monthly" }, Date.UTC(2026, 9, 1));
  const lines = ics.split("\r\n");

  it("ends every line with CRLF", () => {
    expect(ics.endsWith("\r\n")).toBe(true);
    expect(ics.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
  });

  it("has one event, in UTC, with an alarm at its start", () => {
    expect(lines[0]).toBe("BEGIN:VCALENDAR");
    expect(lines).toContain("UID:scan-1@assisteo-agny");
    expect(lines).toContain("DTSTAMP:20261001T000000Z");
    expect(lines).toContain("DTSTART:20261027T063000Z");
    expect(lines).toContain("DTEND:20261027T070000Z");
    expect(lines).toContain("TRIGGER:PT0M");
    expect(lines.filter((line) => line === "BEGIN:VEVENT")).toHaveLength(1);
  });

  it("repeats with an RRULE", () => {
    expect(lines).toContain("RRULE:FREQ=MONTHLY");
    expect(icsCalendar(event)).not.toContain("RRULE");
  });

  it("escapes the texts", () => {
    expect(lines).toContain("SUMMARY:Loyer\\; maison\\, Tana");
    expect(lines).toContain("DESCRIPTION:Ligne 1\\nLigne 2 \\\\ fin");
  });

  it("folds long lines to 75 octets", () => {
    const long = icsCalendar({ ...event, details: "é".repeat(100) });
    for (const line of long.split("\r\n")) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    expect(long).toContain("\r\n ");
  });
});

describe("escapeIcsText", () => {
  it("escapes backslashes first", () => {
    expect(escapeIcsText("a\\,b")).toBe("a\\\\\\,b");
  });
});

describe("icsFileName", () => {
  it("makes a plain file name from the title", () => {
    expect(icsFileName("Échéance : Assurance auto")).toBe("echeance-assurance-auto.ics");
    expect(icsFileName("!!!")).toBe("rappel.ics");
  });
});

describe("rrule", () => {
  it("is plain up to the 28th", () => {
    expect(rrule("monthly", Date.UTC(2026, 0, 28, 6))).toBe("RRULE:FREQ=MONTHLY");
    expect(rrule("yearly", Date.UTC(2026, 1, 28, 6))).toBe("RRULE:FREQ=YEARLY");
  });

  it("takes the last day of shorter months, like the app", () => {
    expect(rrule("monthly", Date.UTC(2026, 0, 29, 6))).toBe("RRULE:FREQ=MONTHLY;BYMONTHDAY=28,29;BYSETPOS=-1");
    expect(rrule("monthly", Date.UTC(2026, 3, 30, 6))).toBe("RRULE:FREQ=MONTHLY;BYMONTHDAY=28,29,30;BYSETPOS=-1");
    expect(rrule("monthly", Date.UTC(2026, 0, 31, 6))).toBe("RRULE:FREQ=MONTHLY;BYMONTHDAY=28,29,30,31;BYSETPOS=-1");
    expect(rrule("yearly", Date.UTC(2028, 1, 29, 6))).toBe("RRULE:FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=28,29;BYSETPOS=-1");
    expect(rrule("yearly", Date.UTC(2026, 6, 31, 6))).toBe("RRULE:FREQ=YEARLY");
  });

  it("is the same in the Google link and the .ics file", () => {
    const end = { ...event, start: Date.UTC(2026, 0, 31, 6), repeat: "monthly" as const };
    const rule = "RRULE:FREQ=MONTHLY;BYMONTHDAY=28,29,30,31;BYSETPOS=-1";
    expect(new URL(googleCalendarUrl(end)).searchParams.get("recur")).toBe(rule);
    expect(icsCalendar(end).split("\r\n")).toContain(rule);
  });
});
