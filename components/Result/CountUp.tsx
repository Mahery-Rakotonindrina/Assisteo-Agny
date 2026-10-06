import { animate, useInView, useMotionValue, useTransform, motion } from "motion/react";
import { useEffect, useRef } from "react";

type CountUpProps = {
  value: number;
  duration?: number;
  format?: (value: number) => string;
};

/** Counts from 0 to `value` the first time it scrolls into view. */
export function CountUp({ value, duration = 1.1, format = (v) => Math.round(v).toString() }: CountUpProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });
  const count = useMotionValue(0);
  const text = useTransform(count, format);

  useEffect(() => {
    if (!inView) return;
    const controls = animate(count, value, { duration, ease: [0.22, 1, 0.36, 1] });
    return () => controls.stop();
  }, [count, duration, inView, value]);

  return <motion.span ref={ref}>{text}</motion.span>;
}
