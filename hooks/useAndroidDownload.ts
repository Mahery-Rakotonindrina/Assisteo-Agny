import { Capacitor } from "@capacitor/core";
import { useEffect, useState } from "react";
import type { AppVersionResponse } from "@/pages/api/app-version";
import { httpClient } from "@/services/httpClient";

let request: Promise<AppVersionResponse | null> | null = null;

/**
 * Where to download the Android app (set in Admin → "Versions de l'app",
 * or by the APK workflow), for the website. Null in the apps themselves, on
 * iPhones (an APK is of no use there) and while no link is set.
 */
export function useAndroidDownload() {
  const [download, setDownload] = useState<{ url: string; version: string } | null>(null);

  useEffect(() => {
    if (Capacitor.isNativePlatform() || /iPhone|iPad|iPod/i.test(navigator.userAgent)) return;
    request ??= httpClient.get<AppVersionResponse>("/api/app-version").catch(() => null);
    let cancelled = false;
    void request.then((result) => {
      if (!cancelled && result?.downloadUrl) setDownload({ url: result.downloadUrl, version: result.latest });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return download;
}
