import { APP_AUTH_CALLBACK, googleEnabled, safeReturnPath, usedCodes, WEB_AUTH_CALLBACK_PATH, withUsedCode } from "@/lib/googleSignIn";
import { accountsAvailable, supabase } from "@/lib/supabase";
import { getSession } from "./account";
import { isNative, openExternal } from "./device";

// "Continuer avec Google" (Supabase OAuth, PKCE). Shown only when Google is
// switched on in Supabase. The site goes to Google and comes back to
// /auth-callback; the Android app opens Google in the browser (Google refuses
// sign-ins inside an app's WebView) and comes back by its own link
// (APP_AUTH_CALLBACK, handled in useNativeBootstrap), then the same page.

const RETURN_KEY = "google-return.v1";
const CODES_KEY = "google-codes.v1";

let available: Promise<boolean> | null = null;

/** Whether Google is switched on in Supabase: asked once per launch; false when it can't be told. */
export function googleSignInAvailable(): Promise<boolean> {
  if (!accountsAvailable) return Promise.resolve(false);
  available ??= (async () => {
    try {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
      const response = await fetch(`${url}/auth/v1/settings`, { headers: { apikey: key } });
      return response.ok && googleEnabled(await response.json());
    } catch {
      return false;
    }
  })();
  // A failure (offline at launch) is asked again next time.
  void available.then((value) => {
    if (!value) available = null;
  });
  return available;
}

/** Leaves for Google's page; `returnTo` is where the user comes back once signed in. False when it could not start. */
export async function startGoogleSignIn(returnTo: string) {
  if (!accountsAvailable) return false;
  try {
    localStorage.setItem(RETURN_KEY, safeReturnPath(returnTo));
  } catch {
    // Private mode: back to the home page.
  }
  const native = isNative();
  const { data, error } = await supabase().auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: native ? APP_AUTH_CALLBACK : `${window.location.origin}${WEB_AUTH_CALLBACK_PATH}`,
      // The app opens the page itself, in the browser.
      skipBrowserRedirect: native,
    },
  });
  if (error || !data.url) return false;
  if (native) openExternal(data.url);
  return true;
}

// A code is exchanged once, even if the page asks twice (React's development mode, a deep link and the page).
const finishing = new Map<string, Promise<{ returnTo: string } | { error: true }>>();

/** Back from Google: the code becomes the session. The path to go back to, or the error. */
export function finishGoogleSignIn(code: string) {
  let running = finishing.get(code);
  if (!running) {
    running = exchange(code);
    finishing.set(code, running);
  }
  return running;
}

/** Whether this code was already exchanged on this device (a launch link Android replays after killing the app). */
export function googleCodeUsed(code: string) {
  try {
    return usedCodes(localStorage.getItem(CODES_KEY)).includes(code);
  } catch {
    return false;
  }
}

function rememberCode(code: string) {
  try {
    localStorage.setItem(CODES_KEY, withUsedCode(localStorage.getItem(CODES_KEY), code));
  } catch {
    // Private mode: only the page's own once-only guard remains.
  }
}

async function exchange(code: string): Promise<{ returnTo: string } | { error: true }> {
  // A code is good once. Already used, or refused while the person is signed in anyway (a replayed link): no failure to show.
  const signedIn = async () => Boolean(await getSession().catch(() => null));
  if (googleCodeUsed(code)) return (await signedIn()) ? { returnTo: "/" } : { error: true };
  rememberCode(code);
  const { error } = await supabase().auth.exchangeCodeForSession(code);
  if (error) return (await signedIn()) ? { returnTo: "/" } : { error: true };
  let returnTo = "/";
  try {
    returnTo = safeReturnPath(localStorage.getItem(RETURN_KEY));
    localStorage.removeItem(RETURN_KEY);
  } catch {
    // Private mode: the home page.
  }
  return { returnTo };
}
