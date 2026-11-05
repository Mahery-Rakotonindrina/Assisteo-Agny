// "Continuer avec Google": what the app and the site share, pure so it can be
// tested. The flow itself is in services/googleSignIn.ts.

/** The Android app's own link: Google's page sends the browser back here, which reopens the app (AndroidManifest.xml). */
export const APP_AUTH_CALLBACK = "com.mahery.pocketassistant://auth-callback";

/** The site's page that finishes the sign-in (pages/auth-callback.tsx). */
export const WEB_AUTH_CALLBACK_PATH = "/auth-callback";

/**
 * Whether Google is switched on in Supabase, from GET /auth/v1/settings
 * (`external.google`). Anything else, or an error: off.
 */
export function googleEnabled(settings: unknown) {
  if (!settings || typeof settings !== "object") return false;
  const external = (settings as { external?: unknown }).external;
  return Boolean(external && typeof external === "object" && (external as { google?: unknown }).google === true);
}

export type AuthCallback = { code: string } | { error: string };

/**
 * What a return from Google brings: the code to exchange for a session, or
 * the error. Null when the link is not the sign-in's (another deep link).
 * The error may come in the query or after "#".
 */
export function parseAuthCallback(link: string): AuthCallback | null {
  if (!link.startsWith(APP_AUTH_CALLBACK)) return null;
  const rest = link.slice(APP_AUTH_CALLBACK.length);
  if (rest && !/^[/?#]/.test(rest)) return null;
  const params = new URLSearchParams(rest.replace(/^\/?[?#]?/, "").replace("#", "&"));
  return callbackFrom(params);
}

/** The same, from the query of the site's page. */
export function callbackFrom(params: URLSearchParams): AuthCallback | null {
  const code = params.get("code");
  if (code) return { code };
  const error = params.get("error_description") ?? params.get("error");
  return error ? { error } : null;
}

/** Where to go back after signing in: a path of this site only (never another site). */
export function safeReturnPath(value: string | null | undefined) {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith(WEB_AUTH_CALLBACK_PATH)) return "/";
  return value;
}
