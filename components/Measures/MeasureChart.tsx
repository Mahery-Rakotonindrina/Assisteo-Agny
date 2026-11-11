import { useState } from "react";
import { useTranslation } from "@/hooks/useTranslation";
import { formatDate, formatDateTime } from "@/lib/format";
import { measureLine, valuesOf, yRange, type Measure } from "@/lib/measures";
import styles from "./Measures.module.scss";

const WIDTH = 300;
const HEIGHT = 120;
const PAD = { top: 10, right: 10, bottom: 8, left: 34 };

type Props = {
  series: Measure[];
  since: number;
  until: number;
  /** "Systolique", "Diastolique" for two lines; one line has no legend (the card's title names it). */
  labels: string[];
  number: (value: number, decimals: number) => string;
  decimals: number;
};

/**
 * One kind of measure over the period: a thin line per value (two for the
 * blood pressure: blue and orange, with a legend), a dot per measure, three
 * quiet grid lines with their values. Touching a dot shows its date and value
 * above the chart; the list of values sits below (the table view).
 */
export function MeasureChart({ series, since, until, labels, number, decimals }: Props) {
  const { t, locale } = useTranslation();
  const [picked, setPicked] = useState<string | null>(null);
  const [min, max] = yRange(series);
  const x = (at: number) => PAD.left + ((at - since) / Math.max(until - since, 1)) * (WIDTH - PAD.left - PAD.right);
  const y = (value: number) => PAD.top + (1 - (value - min) / Math.max(max - min, 1e-9)) * (HEIGHT - PAD.top - PAD.bottom);
  const grid = [max, (min + max) / 2, min];
  const lines = labels.length || 1;
  // The last value is the card's headline already: the readout waits for a dot touched.
  const shown = series.find((measure) => measure.id === picked);

  return (
    <div className={styles.chart}>
      <p className={styles.readout} aria-live="polite" data-testid="measure-readout">
        {shown ? (
          <>
            <strong>{measureLine(shown, t, number)}</strong>
            <span>{formatDateTime(shown.at, locale)}</span>
          </>
        ) : (
          <span>{t("health.measures.tapHint")}</span>
        )}
      </p>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label={t("health.measures.chartLabel", { count: series.length, from: formatDate(since, locale), to: formatDate(until, locale) })}
        data-testid="measure-chart"
      >
        {grid.map((value, index) => (
          <g key={index}>
            <line x1={PAD.left} x2={WIDTH - PAD.right} y1={y(value)} y2={y(value)} className={styles.grid} />
            <text x={PAD.left - 4} y={y(value)} className={styles.tick} textAnchor="end" dominantBaseline="middle">
              {number(value, decimals)}
            </text>
          </g>
        ))}
        {Array.from({ length: lines }, (_, line) => (
          <polyline
            key={line}
            className={styles.line}
            data-line={line + 1}
            points={series.map((measure) => `${x(measure.at).toFixed(1)},${y(valuesOf(measure)[line]).toFixed(1)}`).join(" ")}
          />
        ))}
        {series.map((measure) =>
          valuesOf(measure).map((value, line) => (
            <circle key={`${measure.id}-${line}`} className={styles.dot} data-line={line + 1} data-picked={measure.id === shown?.id || undefined} cx={x(measure.at)} cy={y(value)} r={measure.id === shown?.id ? 4.5 : 3.2} />
          )),
        )}
        {/* Hit areas wider than the dots: a finger, not a cursor. */}
        {series.map((measure) => (
          <rect
            key={`hit-${measure.id}`}
            className={styles.hit}
            x={x(measure.at) - 8}
            y={0}
            width={16}
            height={HEIGHT}
            onPointerEnter={() => setPicked(measure.id)}
            onClick={() => setPicked(measure.id)}
          />
        ))}
      </svg>
      <div className={styles.axis} aria-hidden>
        <span>{formatDate(since, locale)}</span>
        <span>{formatDate(until, locale)}</span>
      </div>
      {labels.length > 1 && (
        <ul className={styles.legend}>
          {labels.map((label, index) => (
            <li key={label} data-line={index + 1}>
              {label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
