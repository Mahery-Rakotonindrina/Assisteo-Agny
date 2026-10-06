import { App } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { useEffect, useState } from "react";
import { config } from "@/lib/config";

const buildLabel = config.appCommit ? `${config.appVersion} · ${config.appCommit}` : config.appVersion;

/**
 * Version to show users. In the native apps it's the installed app's own
 * version (what the store or APK says); on the web, the build's version and
 * the deployed commit.
 */
export function useAppVersion() {
  const [label, setLabel] = useState(buildLabel);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    App.getInfo()
      .then((info) => setLabel(`${info.version} (${info.build})`))
      .catch(() => undefined);
  }, []);

  return label;
}
