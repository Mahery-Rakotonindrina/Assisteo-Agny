import { useId } from "react";
import styles from "./Logo.module.scss";

type LogoProps = {
  /** Height of the mark in pixels; the wordmark scales with it. */
  size?: number;
  /** Mark only (e.g. above a title that already names the app). */
  markOnly?: boolean;
  className?: string;
};

/**
 * The app's lockup: the scan glyph on its dark tile (same drawing as
 * public/icon.svg, inlined so it never flashes in) and the wordmark, with
 * "Agny" in italic green like the home headline's accent word.
 */
export function Logo({ size = 36, markOnly = false, className }: LogoProps) {
  const glow = useId();
  return (
    <span className={[styles.logo, className].filter(Boolean).join(" ")} style={{ "--logo-size": `${size}px` } as React.CSSProperties}>
      <svg className={styles.mark} viewBox="0 0 512 512" aria-hidden>
        <defs>
          <radialGradient id={glow} cx="50%" cy="110%" r="70%">
            <stop offset="0" stopColor="#c6ff4d" stopOpacity="0.9" />
            <stop offset="1" stopColor="#c6ff4d" stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect width="512" height="512" rx="116" fill="#0b0c10" />
        <rect width="512" height="512" rx="116" fill={`url(#${glow})`} />
        <g fill="none" stroke="#f3f4f6" strokeWidth="30" strokeLinecap="round" strokeLinejoin="round">
          <path d="M150 196v-30a36 36 0 0 1 36-36h30" />
          <path d="M296 130h30a36 36 0 0 1 36 36v30" />
          <path d="M362 316v30a36 36 0 0 1-36 36h-30" />
          <path d="M216 382h-30a36 36 0 0 1-36-36v-30" />
        </g>
        <circle cx="256" cy="256" r="54" fill="#c6ff4d" />
      </svg>
      {markOnly ? (
        <span className={styles.srOnly}>Assisteo Agny</span>
      ) : (
        <span className={styles.wordmark}>
          Assisteo <em>Agny</em>
        </span>
      )}
    </span>
  );
}
