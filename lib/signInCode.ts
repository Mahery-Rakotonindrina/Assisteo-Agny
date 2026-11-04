// The sign-in code in what was typed or pasted. People copy the whole e-mail
// subject or notification ("Ton code Assisteo Agny : 12345678"), sometimes a
// sentence around it, or the code with spaces: the code is found in all of it.

/**
 * Sign-in codes are 8 digits, as Supabase sends them (Authentication → Email
 * → OTP length). From 6 digits a button checks it too, should that setting
 * change (Supabase allows 6 to 10).
 */
export const CODE_LENGTH = 8;
export const MIN_CODE_LENGTH = 6;
export const MAX_CODE_LENGTH = 10;

/** The digits of a code: a run of digits, maybe split by spaces or dashes ("1234 5678"). */
const RUN = /\d(?:[ \u00a0\-.]?\d)*/g;

/** The code in a text, digits only (at most MAX_CODE_LENGTH); "" when there is none. */
export function codeFrom(text: string) {
  const runs = (text.match(RUN) ?? []).map((run) => run.replace(/\D/g, ""));
  return (
    runs.find((digits) => digits.length === CODE_LENGTH) ??
    runs.find((digits) => digits.length >= MIN_CODE_LENGTH && digits.length <= MAX_CODE_LENGTH) ??
    runs.join("").slice(0, MAX_CODE_LENGTH)
  );
}
