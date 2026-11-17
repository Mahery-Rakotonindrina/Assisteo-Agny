import type { Appointment } from "@/lib/appointments";
import type { Vehicle } from "@/lib/garage";
import type { HealthProfile } from "@/lib/healthProfiles";
import type { HomeMedicine } from "@/lib/pharmacy";
import type { Vaccine } from "@/lib/vaccines";
import type { HomeItem } from "@/lib/inventory";
import type { Loan } from "@/lib/loans";
import type { ExpenseRecord } from "@/lib/expenses";
import type { Plant } from "@/lib/plants";
import type { PlanFeature } from "@/lib/plans";
import type { Parcel } from "@/services/parcelStore";
import type { HistoryEntry } from "@/types/history";

// "À venir" (/agenda): what is coming, day by day, from every part of the app.
// Each source (lib/agenda/sources/*) reads the calculation its own screen already
// makes and turns it into plain items; the screen only groups and shows them.
// To plug a new source (vaccines, expiry dates…): add its data to `AgendaData`,
// write a file in `sources/` that exports an `AgendaSource`, and list it in
// `sources/index.ts`. Its `domain` gets an icon and a colour in the screen's `domainStyle`.

/** A text of the screen, told by its key (the screen translates it): nothing in this folder knows a language. */
export type AgendaText = { key: string; params?: Record<string, string | number> };

/** The text of something the user wrote (a name, a title). */
export const plain = (text: string): AgendaText => ({ key: "agenda.plain", params: { text } });

export type AgendaItem = {
  /** Unique and steady, for React and for tests. */
  key: string;
  /** The part of the app it comes from: one filter chip, one icon, one colour. */
  domain: string;
  /** When: the moment, or the start of the day for a thing of a whole day. */
  at: number;
  /** Whether `at` is a real time of day (shown) rather than just a day. */
  timed: boolean;
  label: AgendaText;
  detail?: AgendaText;
  /** Where it opens. */
  href: string;
  /** Past and asking for an action: shown in "En retard" (an unpaid loan, an expired paper, a late parcel). */
  late?: boolean;
  /** An amount in ariary, shown beside it (a loan, a fixed expense). */
  amountMga?: number;
};

/** What the sources read: the data each screen keeps on the device. */
export type AgendaData = {
  entries: HistoryEntry[];
  appointments: Appointment[] | null | undefined;
  profiles: HealthProfile[] | null | undefined;
  loans: Loan[];
  /** The records of "Mes dépenses" (the fixed expenses and incomes are among them). */
  records: ExpenseRecord[];
  parcels: Parcel[];
  vehicles: Vehicle[];
  homeItems: HomeItem[];
  plants: Plant[];
  /** "Vaccins" (Ma santé): the next doses written by hand. */
  vaccines?: Vaccine[] | null;
  /** "Pharmacie de la maison" (Ma santé): the expiry dates. */
  pharmacy?: HomeMedicine[] | null;
};

export type AgendaContext = {
  now: number;
  /** The window: from the start of today to the end of the last day shown (excluded). */
  from: number;
  to: number;
  /** Whether the plan gives a feature: a source follows its own plan. */
  has: (feature: PlanFeature) => boolean;
  data: AgendaData;
};

export type AgendaSource = {
  id: string;
  domain: string;
  collect: (context: AgendaContext) => AgendaItem[];
};

export const inWindow = (at: number, { from, to }: Pick<AgendaContext, "from" | "to">) => at >= from && at < to;
