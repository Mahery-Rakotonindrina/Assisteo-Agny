import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import styles from "./Button.module.scss";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "md" | "lg" | "icon";

type CommonProps = {
  variant?: Variant;
  size?: Size;
  icon?: ReactNode;
  block?: boolean;
  className?: string;
  children?: ReactNode;
};

type ButtonAsButton = CommonProps & ButtonHTMLAttributes<HTMLButtonElement> & { href?: undefined };
type ButtonAsLink = CommonProps & { href: string; "aria-label"?: string };

export type ButtonProps = ButtonAsButton | ButtonAsLink;

export function Button(props: ButtonProps) {
  const { variant = "primary", size = "md", icon, block, className, children } = props;
  const classes = [styles.button, styles[variant], styles[size], block && styles.block, className]
    .filter(Boolean)
    .join(" ");
  const content = (
    <>
      {icon && <span className={styles.glyph}>{icon}</span>}
      {children}
    </>
  );

  if (props.href !== undefined) {
    return (
      <Link href={props.href} className={classes} aria-label={props["aria-label"]}>
        {content}
      </Link>
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { variant: _v, size: _s, icon: _i, block: _b, className: _c, children: _ch, type = "button", ...rest } = props;
  return (
    <button type={type} className={classes} {...rest}>
      {content}
    </button>
  );
}
