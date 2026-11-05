import type { Locale } from "@/i18n.config";
import type { ParcelStatus } from "@/lib/ai/schema";
import { formatAriary, formatDate } from "@/lib/format";

// Reseller tools (Pro): "Envoyer le statut au client". A message ready for
// WhatsApp: the parcel, where it is, its tracking number and what is left
// to pay. Never what the parcel cost the reseller (price, fees, profit).

type Translate = (key: string, params?: Record<string, string | number>) => string;

/** Only what the client may see of a parcel. */
type ClientView = {
  title: string;
  client?: string;
  info: { status: ParcelStatus; trackingNumber: string | null };
  receivedAt?: number;
  salePriceMga?: number;
  paidMga?: number;
};

/** Where the parcel is, in the client's words. */
function statusText(parcel: ClientView, t: Translate, locale: Locale) {
  if (parcel.receivedAt) return t("parcels.receivedOn", { date: formatDate(parcel.receivedAt, locale) });
  // "Delivered" by the carrier is often the forwarder's warehouse abroad.
  if (parcel.info.status === "delivered") return t("parcelWhatsapp.atForwarder");
  return t(`parcel.statuses.${parcel.info.status}`);
}

/** The message, one line each: greeting, parcel and status, tracking number, what is left to pay. */
export function parcelStatusMessage(parcel: ClientView, t: Translate, locale: Locale) {
  const lines = [
    parcel.client?.trim() ? t("parcelWhatsapp.greeting", { name: parcel.client.trim() }) : t("parcelWhatsapp.greetingNoName"),
    t("parcelWhatsapp.status", { title: parcel.title, status: statusText(parcel, t, locale) }),
    parcel.info.trackingNumber ? t("parcelWhatsapp.tracking", { number: parcel.info.trackingNumber }) : null,
  ];
  if (parcel.salePriceMga && parcel.salePriceMga > 0) {
    const due = Math.max(0, parcel.salePriceMga - (parcel.paidMga ?? 0));
    lines.push(due > 0 ? t("parcelWhatsapp.due", { amount: formatAriary(due, locale) }) : t("parcelWhatsapp.allPaid"));
  }
  return lines.filter(Boolean).join("\n");
}

type WithPhone = { client?: string; clientPhone?: string; updatedAt: number };

const sameClient = (a: string | undefined, b: string | undefined) => Boolean(a?.trim()) && a!.trim().toLocaleLowerCase() === (b ?? "").trim().toLocaleLowerCase();

/**
 * The client's number: the parcel's own, else the one last typed on another
 * parcel of the same client. Undefined when none is known.
 */
export function clientPhone(parcel: WithPhone, parcels: WithPhone[]) {
  if (parcel.clientPhone?.trim()) return parcel.clientPhone.trim();
  return [...parcels]
    .filter((other) => other.clientPhone?.trim() && sameClient(other.client, parcel.client))
    .sort((a, b) => b.updatedAt - a.updatedAt)[0]
    ?.clientPhone?.trim();
}

