import type { ForeignCurrency } from "@/lib/money";
import type { FxResponse } from "@/pages/api/fx";
import { httpClient } from "./httpClient";

// Today's rate to the ariary (GET /api/fx), once per app session, and the
// rate the user prefers (their forwarder's), remembered on this device.

const requests = new Map<ForeignCurrency, Promise<FxResponse | null>>();

export function marketRate(currency: ForeignCurrency) {
  let request = requests.get(currency);
  if (!request) {
    request = httpClient.get<FxResponse>(`/api/fx?from=${currency}`).catch(() => {
      requests.delete(currency);
      return null;
    });
    requests.set(currency, request);
  }
  return request;
}

const key = (currency: ForeignCurrency) => `fx.own.${currency}`;

export function ownRate(currency: ForeignCurrency): number | null {
  try {
    const value = Number(localStorage.getItem(key(currency)));
    return value > 0 ? value : null;
  } catch {
    return null;
  }
}

export function rememberOwnRate(currency: ForeignCurrency, rate: number | null) {
  try {
    if (rate && rate > 0) localStorage.setItem(key(currency), String(rate));
    else localStorage.removeItem(key(currency));
  } catch {
    // Private mode: not remembered.
  }
}
