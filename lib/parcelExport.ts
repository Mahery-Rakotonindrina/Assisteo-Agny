import { eventTime } from "@/lib/parcels";
import { parcelTotalMga, type Parcel } from "@/services/parcelStore";
import { toDateInput } from "./format";

// Reseller tools (Pro): the parcels as a spreadsheet. A CSV that Excel opens
// directly in French settings: ";" between columns, UTF-8 with a BOM so
// accents survive, amounts as plain numbers so they can be added up.

type Translate = (key: string, params?: Record<string, string | number>) => string;

const columns = [
  "client",
  "title",
  "platform",
  "orderNumber",
  "trackingNumber",
  "carrier",
  "status",
  "orderedAt",
  "receivedAt",
  "items",
  "priceMga",
  "feesMga",
  "feesDetail",
  "totalMga",
] as const;

/** A cell, quoted when it holds a separator, a quote or a line break. */
function cell(value: string | number | null | undefined) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[";\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const day = (value: string | null | undefined) => {
  const time = eventTime(value);
  return time === null ? (value ?? "") : toDateInput(time);
};

export function parcelsCsv(parcels: Parcel[], t: Translate) {
  const header = columns.map((column) => cell(t(`parcels.export.columns.${column}`)));
  const rows = parcels.map((parcel) => {
    const { info } = parcel;
    const fees = parcel.fees ?? [];
    const values: Record<(typeof columns)[number], string | number | null> = {
      client: parcel.client?.trim() || null,
      title: parcel.title,
      platform: info.platform,
      orderNumber: info.orderNumber,
      trackingNumber: info.trackingNumber,
      carrier: info.carrier,
      status: parcel.receivedAt ? t("parcels.receivedLabel") : t(`parcel.statuses.${info.status}`),
      orderedAt: day(info.orderedAt),
      receivedAt: parcel.receivedAt ? toDateInput(parcel.receivedAt) : null,
      items: info.items.map((item) => [item.name, item.variant && `(${item.variant})`, item.quantity > 1 && `×${item.quantity}`].filter(Boolean).join(" ")).join(" + "),
      priceMga: parcel.priceMga ?? null,
      feesMga: fees.length ? fees.reduce((total, fee) => total + (fee.amountMga || 0), 0) : null,
      feesDetail: fees.map((fee) => `${fee.label} ${fee.amountMga}`).join(", "),
      totalMga: parcelTotalMga(parcel) || null,
    };
    return columns.map((column) => cell(values[column]));
  });
  return "\uFEFF" + [header, ...rows].map((row) => row.join(";")).join("\r\n") + "\r\n";
}
