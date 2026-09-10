import type { AnchorHTMLAttributes, ReactNode } from "react";
import styles from "./Button.module.scss";

type ButtonProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  variant?: "primary" | "secondary";
  children: ReactNode;
};

export function Button({ variant = "primary", className, children, ...rest }: ButtonProps) {
  return (
    <a
      className={[styles.button, styles[variant], className].filter(Boolean).join(" ")}
      {...rest}
    >
      {children}
    </a>
  );
}
