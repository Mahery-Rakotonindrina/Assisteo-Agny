// "Économie de données": lighter photos on a slow or metered connection, and
// the photos of scans made on other devices downloaded small. Per device (a
// phone on 3G, the computer on Wi-Fi). "auto" follows the phone's own data
// saver and the connection speed when the browser reports them (Android;
// iPhones don't, so "auto" stays off there).

export type DataSaverPreference = "auto" | "on" | "off";

type NetworkInformation = { saveData?: boolean; effectiveType?: string };

let preference: DataSaverPreference = "auto";

export function setDataSaverPreference(value: DataSaverPreference) {
  preference = value;
}

/** The phone asks to save data, or the connection is 3G or slower. */
export function connectionIsSlow() {
  if (typeof navigator === "undefined") return false;
  const connection = (navigator as Navigator & { connection?: NetworkInformation }).connection;
  return Boolean(connection?.saveData) || ["slow-2g", "2g", "3g"].includes(connection?.effectiveType ?? "");
}

export function isSavingData(value: DataSaverPreference = preference) {
  return value === "on" || (value === "auto" && connectionIsSlow());
}
