import type { AppProps } from "next/app";
import { Geist, Geist_Mono } from "next/font/google";
import "@/styles/globals.scss";
import styles from "@/styles/App.module.scss";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export default function App({ Component, pageProps }: AppProps) {
  return (
    <div className={`${geistSans.variable} ${geistMono.variable} ${styles.app}`}>
      <Component {...pageProps} />
    </div>
  );
}
