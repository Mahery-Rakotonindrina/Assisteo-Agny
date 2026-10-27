import { Html, Head, Main, NextScript } from "next/document";
import { config } from "@/lib/config";
import iosSplashScreens from "@/lib/iosSplashScreens.json";

export default function Document() {
  return (
    <Html lang="fr">
      <Head>
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
        {/* Capacitor injects its bridge before page scripts: tag native builds
            before first paint so desktop styles never flash on tablets. The
            chosen text size is applied then too, so the text never jumps. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "if(window.Capacitor&&window.Capacitor.isNativePlatform&&window.Capacitor.isNativePlatform())document.documentElement.classList.add('native');try{var s=localStorage.getItem('text-size');if(s&&s!=='normal')document.documentElement.dataset.textSize=s}catch(e){}",
          }}
        />
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
