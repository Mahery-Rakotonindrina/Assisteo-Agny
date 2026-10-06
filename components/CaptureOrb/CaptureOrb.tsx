import { motion } from "motion/react";
import { Camera } from "lucide-react";
import { spring } from "@/lib/motion";
import styles from "./CaptureOrb.module.scss";

type CaptureOrbProps = {
  label: string;
  onPress: () => void;
  disabled?: boolean;
};

/**
 * The main call to action: a breathing orb with a rotating light ring and
 * expanding halos, so the screen invites a tap without any copy.
 */
export function CaptureOrb({ label, onPress, disabled }: CaptureOrbProps) {
  return (
    <div className={styles.wrap}>
      <span className={styles.halo} aria-hidden />
      <span className={`${styles.halo} ${styles.haloDelayed}`} aria-hidden />
      <motion.button
        type="button"
        className={styles.orb}
        onClick={onPress}
        disabled={disabled}
        aria-label={label}
        whileHover={{ scale: 1.04 }}
        whileTap={{ scale: 0.92 }}
        transition={spring}
      >
        <span className={styles.ring} aria-hidden />
        <span className={styles.core}>
          <motion.span
            className={styles.glyph}
            animate={{ y: [0, -3, 0] }}
            transition={{ duration: 3.2, repeat: Infinity, ease: "easeInOut" }}
          >
            <Camera size={38} strokeWidth={1.8} />
          </motion.span>
        </span>
      </motion.button>
    </div>
  );
}
