
import { z } from "zod";
import { redis } from "./redis";

// Which app versions may still talk to the API. Editable from /admin so an
// incompatible change (a new API address, a breaking response) can force old
// APKs to update instead of failing in confusing ways.

export const AppVersionConfigSchema = z.object({
  /** Installed versions below this one are blocked until they update. Empty = none. */
  minimum: z.string().regex(/^(\d+(\.\d+){0,2})?$/),
  /** Newest published version: older installs get a gentle "update available". Empty = unknown. */
  latest: z.string().regex(/^(\d+(\.\d+){0,2})?$/),
  /** Where the new APK can be downloaded. */
  downloadUrl: z.url({ protocol: /^https$/ }).or(z.literal("")),
});

export type AppVersionConfig = z.infer<typeof AppVersionConfigSchema>;

const KEY = "config:app-version";
const defaults: AppVersionConfig = {
  minimum: process.env.APP_MIN_VERSION ?? "",
  latest: process.env.APP_LATEST_VERSION ?? "",
  downloadUrl: process.env.APP_DOWNLOAD_URL ?? "",
};

let memory: AppVersionConfig | null = null;

export async function getAppVersionConfig(): Promise<AppVersionConfig> {
  const stored = redis ? await redis.get<Partial<AppVersionConfig>>(KEY).catch(() => null) : memory;
  return { ...defaults, ...stored };
}

export async function setAppVersionConfig(config: AppVersionConfig) {
  if (redis) await redis.set(KEY, config);
  else memory = config;
}
