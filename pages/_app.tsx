import type { AppProps } from "next/app";
import Head from "next/head";
import { Geist, Geist_Mono, Instrument_Serif } from "next/font/google";
import { MotionConfig } from "motion/react";
import { AppShell } from "@/components/AppShell";
import { Onboarding } from "@/components/Onboarding";
import { ReminderKeeper } from "@/components/ReminderKeeper";
import { ToastProvider } from "@/components/Toast";
import { UpdateGate } from "@/components/UpdateGate";
import { useNativeBootstrap } from "@/hooks/useNativeBootstrap";
import { AccountProvider } from "@/lib/account/AccountProvider";
import { SettingsProvider } from "@/lib/settings/SettingsProvider";
import "@/styles/globals.scss";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const instrumentSerif = Instrument_Serif({
  variable: "--font-instrument-serif",
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
});

function Bootstrap() {
  useNativeBootstrap();
  return null;
}

export default function App({ Component, pageProps }: AppProps) {
  return (
    <>
      <Head>
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
      </Head>
      {/* Font families exposed on :root so fixed and portaled UI get them too. */}
      <style jsx global>{`
        :root {
          --font-geist-sans: ${geistSans.style.fontFamily};
          --font-geist-mono: ${geistMono.style.fontFamily};
          --font-instrument-serif: ${instrumentSerif.style.fontFamily};
        }
      `}</style>
      <SettingsProvider>
        <ToastProvider>
          <AccountProvider>
            <MotionConfig reducedMotion="user">
              <Bootstrap />
              <AppShell>
                <Component {...pageProps} />
              </AppShell>
              <Onboarding />
              <ReminderKeeper />
              <UpdateGate />
            </MotionConfig>
          </AccountProvider>
        </ToastProvider>
      </SettingsProvider>
    </>
  );
}
