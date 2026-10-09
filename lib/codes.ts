// QR codes and barcodes read on a photo (services/codeReader.ts), and what
// their content means: a link to open, a Wi-Fi network to join, a phone
// number, a contact… or plain text and numbers to copy.

export type ScannedCode = {
  /** "qr" for 2D codes (QR, Data Matrix, Aztec, PDF417), "barcode" for the others. */
  kind: "qr" | "barcode";
  /** Display name of the format, e.g. "QR Code", "EAN-13". */
  format: string;
  text: string;
};

export type CodeContent =
  | { type: "url"; url: string; host: string }
  | { type: "wifi"; ssid: string; password: string | null; security: string | null }
  | { type: "email"; address: string }
  | { type: "phone"; number: string }
  | { type: "sms"; number: string; body: string | null }
  | { type: "contact"; name: string | null; phone: string | null; email: string | null }
  | { type: "geo"; lat: number; lng: number }
  | { type: "text"; text: string };

/** Fields of "WIFI:", "MECARD:"… payloads: "KEY:value;" with \ escaping ; , : and \. */
function fields(body: string) {
  const result: Record<string, string> = {};
  let key = "";
  let value = "";
  let inKey = true;
  for (let index = 0; index < body.length; index++) {
    const char = body[index];
    if (char === "\\" && index + 1 < body.length) {
      if (inKey) key += body[++index];
      else value += body[++index];
    } else if (inKey && char === ":") {
      inKey = false;
    } else if (!inKey && char === ";") {
      if (key) result[key.toUpperCase()] = value;
      key = "";
      value = "";
      inKey = true;
    } else if (inKey) {
      key += char;
    } else {
      value += char;
    }
  }
  if (key && !inKey) result[key.toUpperCase()] = value;
  return result;
}

function vcardField(text: string, name: string) {
  const line = text.split(/\r?\n/).find((item) => new RegExp(`^${name}[;:]`, "i").test(item));
  return line ? line.slice(line.indexOf(":") + 1).trim() || null : null;
}

/** Only web links open: never javascript:, intent: or file: URLs. */
function webUrl(text: string) {
  const candidate = /^www\./i.test(text) ? `https://${text}` : text;
  if (!/^https?:\/\//i.test(candidate)) return null;
  try {
    const url = new URL(candidate);
    return { url: url.href, host: url.hostname.replace(/^www\./, "") };
  } catch {
    return null;
  }
}

export function parseCode(raw: string): CodeContent {
  const text = raw.trim();
  const upper = text.toUpperCase();

  const url = webUrl(text);
  if (url) return { type: "url", ...url };

  if (upper.startsWith("WIFI:")) {
    const wifi = fields(text.slice(5));
    if (wifi.S) {
      const security = wifi.T && wifi.T.toLowerCase() !== "nopass" ? wifi.T : null;
      return { type: "wifi", ssid: wifi.S, password: wifi.P || null, security };
    }
  }
  if (upper.startsWith("MAILTO:")) return { type: "email", address: decodeURIComponent(text.slice(7).split("?")[0]) };
  if (upper.startsWith("MATMSG:")) {
    const mail = fields(text.slice(7));
    if (mail.TO) return { type: "email", address: mail.TO };
  }
  if (upper.startsWith("TEL:")) return { type: "phone", number: text.slice(4) };
  if (upper.startsWith("SMSTO:") || upper.startsWith("SMS:")) {
    const [number, ...body] = text.slice(text.indexOf(":") + 1).split(":");
    return { type: "sms", number, body: body.join(":") || null };
  }
  if (upper.startsWith("MECARD:")) {
    const card = fields(text.slice(7));
    return { type: "contact", name: card.N?.replace(",", " ").trim() || null, phone: card.TEL || null, email: card.EMAIL || null };
  }
  if (upper.startsWith("BEGIN:VCARD")) {
    return {
      type: "contact",
      name: vcardField(text, "FN") ?? vcardField(text, "N")?.split(";").filter(Boolean).reverse().join(" ") ?? null,
      phone: vcardField(text, "TEL"),
      email: vcardField(text, "EMAIL"),
    };
  }
  const geo = /^geo:(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/i.exec(text);
  if (geo) return { type: "geo", lat: Number(geo[1]), lng: Number(geo[2]) };

  return { type: "text", text };
}

/**
 * The code is what the photo is about (a QR code shot up close): its content
 * can be shown right away, without spending a scan. A barcode on a parcel
 * label or a product is left to the analysis.
 */
export function isMainSubject(code: ScannedCode, areaShare: number) {
  return code.kind === "qr" && areaShare >= 0.06;
}
