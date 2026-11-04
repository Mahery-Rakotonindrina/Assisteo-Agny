import { isValidElement, type ReactElement } from "react";
import { Html, Head, Main, NextScript } from "next/document";
import { bootScript } from "@/lib/bootScript";
import { config } from "@/lib/config";
import iosSplashScreens from "@/lib/iosSplashScreens.json";
import { BOOT_DATA_ID, BOOT_SCRIPT_SRC, bootData, escapeJson, inlineBootstrap } from "@/lib/turbopackBoot";

/**
 * Next's head, with Turbopack's inline chunk list moved out of the way of the
 * site's CSP (lib/turbopackBoot.ts): the same list as JSON, queued by an
 * external script. The app's static export has no CSP: left as Next writes it.
 */
class StrictHead extends Head {
  getScripts(files: Parameters<Head["getScripts"]>[0]) {
    const scripts = super.getScripts(files);
    if (process.env.BUILD_TARGET === "mobile") return scripts;
    const index = scripts.findIndex((script) => script.key === "turbopack-bootstrap");
    const data = bootData(this.context.buildManifest, this.context.__NEXT_DATA__.page);
    if (index < 0 || !data) return scripts;
    const inline = scripts[index] as ReactElement<{ dangerouslySetInnerHTML?: { __html?: string } }>;
    if (!isValidElement(inline) || inline.props.dangerouslySetInnerHTML?.__html !== inlineBootstrap(data)) return scripts;
    return [
      ...scripts.slice(0, index),
      <script key="next-boot-data" id={BOOT_DATA_ID} type="application/json" dangerouslySetInnerHTML={{ __html: escapeJson(JSON.stringify(data)) }} />,
      <script key="next-boot" src={BOOT_SCRIPT_SRC} defer />,
      ...scripts.slice(index + 1),
    ];
  }
}

export default function Document() {
  return (
    <Html lang="fr">
      <StrictHead>
        <meta name="theme-color" content="#0b0c10" media="(prefers-color-scheme: dark)" />
        <meta name="theme-color" content="#f4f5f0" media="(prefers-color-scheme: light)" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="Assisteo Agny" />
        {config.googleSiteVerification && <meta name="google-site-verification" content={config.googleSiteVerification} />}
        <link rel="manifest" href="/manifest.webmanifest" />
        <link rel="icon" href="/icon.svg" type="image/svg+xml" />
        {/* iOS home screen: PNG only (an SVG makes iOS screenshot the page instead). */}
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        {/* iOS launch screen for the web app: one image per screen size (npm run icons). */}
        {iosSplashScreens.map(({ width, height, ratio }) => (
          <link
            key={`${width}x${height}@${ratio}`}
            rel="apple-touch-startup-image"
            href={`/splash/${width}x${height}@${ratio}x.png`}
            media={`(device-width: ${width}px) and (device-height: ${height}px) and (-webkit-device-pixel-ratio: ${ratio}) and (orientation: portrait)`}
          />
        ))}
        {/* Before first paint: the native tag and the text size (lib/bootScript.ts, allowed by its hash in the CSP). */}
        <script dangerouslySetInnerHTML={{ __html: bootScript }} />
      </StrictHead>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
