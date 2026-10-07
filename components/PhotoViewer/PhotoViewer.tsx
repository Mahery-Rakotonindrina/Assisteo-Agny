import { animate, AnimatePresence, motion, useMotionValue, useTransform } from "motion/react";
import { useEffect, useRef, useSyncExternalStore, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useTranslation } from "@/hooks/useTranslation";
import { spring } from "@/lib/motion";
import styles from "./PhotoViewer.module.scss";

type PhotoViewerProps = {
  src: string;
  alt: string;
  open: boolean;
  onClose: () => void;
};

const MAX_SCALE = 4;
const DOUBLE_TAP_ZOOM = 2.5;
const DOUBLE_TAP_MS = 300;
const CLOSE_DRAG_PX = 120;

type Point = { x: number; y: number };
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const noSubscribe = () => () => {};
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/**
 * Full-screen photo: pinch or double tap to zoom, drag to pan once zoomed,
 * swipe down (or tap outside, Escape, back) to close.
 */
export function PhotoViewer({ src, alt, open, onClose }: PhotoViewerProps) {
  const { t } = useTranslation();
  // Portals need the DOM: render nothing during prerendering.
  const mounted = useSyncExternalStore(noSubscribe, () => true, () => false);

  // Keep the page behind from scrolling, and close on Escape.
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!mounted) return null;
  return createPortal(
    <AnimatePresence>
      {open && <Viewer key="viewer" src={src} alt={alt} onClose={onClose} closeLabel={t("photo.close")} hint={t("photo.hint")} />}
    </AnimatePresence>,
    document.body,
  );
}

function Viewer({ src, alt, onClose, closeLabel, hint }: { src: string; alt: string; onClose: () => void; closeLabel: string; hint: string }) {
  const stageRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const scale = useMotionValue(1);
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  // Dragging down at normal size fades the backdrop: a hint that letting go closes.
  const backdrop = useTransform(y, (value) => (scale.get() > 1 ? 1 : clamp(1 - Math.abs(value) / 400, 0.3, 1)));
  const pointers = useRef(new Map<number, Point>());
  const gesture = useRef<{ start: Point; startX: number; startY: number; startScale: number; startDistance: number; mid: Point; moved: boolean } | null>(null);
  const lastTap = useRef<{ at: number; point: Point } | null>(null);

  /** Point relative to the stage centre (the transform origin). */
  const fromCentre = (point: Point): Point => {
    const rect = stageRef.current!.getBoundingClientRect();
    return { x: point.x - rect.left - rect.width / 2, y: point.y - rect.top - rect.height / 2 };
  };

  /** Keeps a zoomed photo covering the screen instead of drifting off it. */
  const bounds = (nextScale: number) => {
    const stage = stageRef.current!.getBoundingClientRect();
    const image = imageRef.current!.getBoundingClientRect();
    const currentScale = scale.get();
    const width = (image.width / currentScale) * nextScale;
    const height = (image.height / currentScale) * nextScale;
    return { x: Math.max(0, (width - stage.width) / 2), y: Math.max(0, (height - stage.height) / 2) };
  };

  const settle = (nextScale: number, nextX: number, nextY: number) => {
    const limit = bounds(nextScale);
    void animate(scale, nextScale, spring);
    void animate(x, clamp(nextX, -limit.x, limit.x), spring);
    void animate(y, clamp(nextY, -limit.y, limit.y), spring);
  };

  /** Zooms to `nextScale` keeping the screen point `focus` (from the centre) still. */
  const zoomAround = (nextScale: number, focus: Point, from = { scale: scale.get(), x: x.get(), y: y.get() }) => {
    const ratio = nextScale / from.scale;
    return { x: focus.x - (focus.x - from.x) * ratio, y: focus.y - (focus.y - from.y) * ratio };
  };

  const onPointerDown = (event: ReactPointerEvent) => {
    (event.target as Element).setPointerCapture?.(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const points = [...pointers.current.values()];
    gesture.current = {
      start: points[0],
      startX: x.get(),
      startY: y.get(),
      startScale: scale.get(),
      startDistance: points.length === 2 ? distance(points[0], points[1]) : 0,
      mid: points.length === 2 ? fromCentre({ x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 }) : fromCentre(points[0]),
      moved: points.length > 1,
    };
  };

  const onPointerMove = (event: ReactPointerEvent) => {
    if (!pointers.current.has(event.pointerId) || !gesture.current) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const points = [...pointers.current.values()];
    const g = gesture.current;

    if (points.length === 2 && g.startDistance > 0) {
      const nextScale = clamp((g.startScale * distance(points[0], points[1])) / g.startDistance, 1, MAX_SCALE);
      const next = zoomAround(nextScale, g.mid, { scale: g.startScale, x: g.startX, y: g.startY });
      scale.set(nextScale);
      x.set(next.x);
      y.set(next.y);
      return;
    }
    const dx = points[0].x - g.start.x;
    const dy = points[0].y - g.start.y;
    if (Math.hypot(dx, dy) > 6) g.moved = true;
    if (scale.get() > 1) {
      x.set(g.startX + dx);
      y.set(g.startY + dy);
    } else {
      y.set(dy);
    }
  };

  const onPointerUp = (event: ReactPointerEvent) => {
    const g = gesture.current;
    pointers.current.delete(event.pointerId);
    if (pointers.current.size > 0) {
      // One finger left after a pinch: carry on panning from here.
      const [remaining] = pointers.current.values();
      gesture.current = { start: remaining, startX: x.get(), startY: y.get(), startScale: scale.get(), startDistance: 0, mid: fromCentre(remaining), moved: true };
      return;
    }
    gesture.current = null;
    if (!g) return;

    if (scale.get() <= 1) {
      if (Math.abs(y.get()) > CLOSE_DRAG_PX) {
        onClose();
        return;
      }
      settle(1, 0, 0);
    } else {
      settle(scale.get(), x.get(), y.get());
    }

    if (g.moved) return;
    // A tap beside the photo closes it.
    if (event.target !== imageRef.current && scale.get() <= 1) {
      onClose();
      return;
    }
    const point = { x: event.clientX, y: event.clientY };
    const now = event.timeStamp;
    const previous = lastTap.current;
    if (previous && now - previous.at < DOUBLE_TAP_MS && distance(previous.point, point) < 30) {
      lastTap.current = null;
      if (scale.get() > 1) settle(1, 0, 0);
      else {
        const next = zoomAround(DOUBLE_TAP_ZOOM, fromCentre(point));
        settle(DOUBLE_TAP_ZOOM, next.x, next.y);
      }
      return;
    }
    lastTap.current = { at: now, point };
  };

  const onWheel = (event: ReactWheelEvent) => {
    const nextScale = clamp(scale.get() * Math.exp(-event.deltaY * 0.0015), 1, MAX_SCALE);
    const next = zoomAround(nextScale, fromCentre({ x: event.clientX, y: event.clientY }));
    if (nextScale === 1) settle(1, 0, 0);
    else {
      const limit = bounds(nextScale);
      scale.set(nextScale);
      x.set(clamp(next.x, -limit.x, limit.x));
      y.set(clamp(next.y, -limit.y, limit.y));
    }
  };

  return (
    <motion.div
      className={styles.viewer}
      role="dialog"
      aria-modal="true"
      aria-label={alt}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
    >
      <motion.div className={styles.backdrop} style={{ opacity: backdrop }} />
      <div
        ref={stageRef}
        className={styles.stage}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={onWheel}
      >
        {/* Entry/exit on a wrapper, so it doesn't fight the gesture transforms. */}
        <motion.div
          className={styles.frame}
          initial={{ scale: 0.92, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.92, opacity: 0 }}
          transition={spring}
        >
          <motion.img ref={imageRef} src={src} alt={alt} className={styles.image} draggable={false} style={{ x, y, scale }} />
        </motion.div>
      </div>
      <button type="button" className={styles.close} onClick={onClose} aria-label={closeLabel}>
        <X size={22} />
      </button>
      <p className={styles.hint}>{hint}</p>
    </motion.div>
  );
}
