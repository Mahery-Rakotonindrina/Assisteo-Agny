import { Barcode, Contact, Copy, ExternalLink, Link2, Mail, MapPin, MessageSquare, Phone, QrCode, Type, Wifi } from "lucide-react";
import type { ReactNode } from "react";
import { useToast } from "@/components/Toast";
import { useTranslation } from "@/hooks/useTranslation";
import { parseCode, type ScannedCode } from "@/lib/codes";
import { copyText, haptics, openExternal } from "@/services/device";
import styles from "./CodeList.module.scss";

type Action = { label: string; icon: ReactNode; run: () => void };

/** QR codes and barcodes read on a photo, each with what can be done with it. */
export function CodeList({ codes }: { codes: ScannedCode[] }) {
  return (
    <ul className={styles.list}>
      {codes.map((code) => (
        <CodeItem key={`${code.format}-${code.text}`} code={code} />
      ))}
    </ul>
  );
}

function CodeItem({ code }: { code: ScannedCode }) {
  const { t } = useTranslation();
  const toast = useToast();
  const content = code.kind === "qr" ? parseCode(code.text) : ({ type: "text", text: code.text } as const);

  const copy = (text: string, message = t("codes.copied")) => async () => {
    haptics.tap();
    const copied = await copyText(text);
    toast(copied ? message : t("codes.copyFailed"), copied ? "success" : "error");
  };
  const open = (href: string) => () => {
    haptics.press();
    openExternal(href);
  };

  let icon: ReactNode = code.kind === "qr" ? <QrCode /> : <Barcode />;
  let title = code.text;
  let detail: string | null = null;
  const actions: Action[] = [];

  switch (content.type) {
    case "url":
      icon = <Link2 />;
      title = content.host;
      detail = content.url;
      actions.push({ label: t("codes.open"), icon: <ExternalLink />, run: open(content.url) }, { label: t("codes.copy"), icon: <Copy />, run: copy(content.url) });
      break;
    case "wifi":
      icon = <Wifi />;
      title = t("codes.wifi", { name: content.ssid });
      detail = content.password ? t("codes.wifiPassword", { password: content.password }) : t("codes.wifiOpen");
      if (content.password) actions.push({ label: t("codes.copyPassword"), icon: <Copy />, run: copy(content.password, t("codes.passwordCopied")) });
      break;
    case "email":
      icon = <Mail />;
      title = content.address;
      actions.push({ label: t("codes.write"), icon: <Mail />, run: open(`mailto:${content.address}`) }, { label: t("codes.copy"), icon: <Copy />, run: copy(content.address) });
      break;
    case "phone":
      icon = <Phone />;
      title = content.number;
      actions.push({ label: t("codes.call"), icon: <Phone />, run: open(`tel:${content.number}`) }, { label: t("codes.copy"), icon: <Copy />, run: copy(content.number) });
      break;
    case "sms":
      icon = <MessageSquare />;
      title = t("codes.sms", { number: content.number });
      detail = content.body;
      actions.push({
        label: t("codes.sendSms"),
        icon: <MessageSquare />,
        run: open(`sms:${content.number}${content.body ? `?body=${encodeURIComponent(content.body)}` : ""}`),
      });
      break;
    case "contact":
      icon = <Contact />;
      title = content.name ?? content.phone ?? content.email ?? code.text;
      detail = [content.phone, content.email].filter(Boolean).join(" · ") || null;
      if (content.phone) actions.push({ label: t("codes.call"), icon: <Phone />, run: open(`tel:${content.phone}`) });
      actions.push({ label: t("codes.copy"), icon: <Copy />, run: copy([content.name, content.phone, content.email].filter(Boolean).join("\n")) });
      break;
    case "geo":
      icon = <MapPin />;
      title = `${content.lat}, ${content.lng}`;
      actions.push({ label: t("codes.map"), icon: <MapPin />, run: open(`https://www.google.com/maps?q=${content.lat},${content.lng}`) });
      break;
    default:
      if (code.kind === "qr") icon = <Type />;
      actions.push({ label: t("codes.copy"), icon: <Copy />, run: copy(content.text) });
  }

  return (
    <li className={styles.item}>
      <span className={styles.icon} aria-hidden>
        {icon}
      </span>
      <div className={styles.body}>
        <small className={styles.format}>{code.format}</small>
        <strong className={content.type === "text" ? styles.text : undefined}>{title}</strong>
        {detail && <span className={styles.detail}>{detail}</span>}
        <div className={styles.actions}>
          {actions.map((action) => (
            <button key={action.label} type="button" onClick={action.run}>
              {action.icon} {action.label}
            </button>
          ))}
        </div>
      </div>
    </li>
  );
}
