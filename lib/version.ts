/** Compares dotted versions numerically ("1.0.10" > "1.0.9"). Missing parts count as 0. */
export function compareVersions(a: string, b: string) {
  const left = a.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const right = b.split(".").map((part) => Number.parseInt(part, 10) || 0);
  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    const diff = (left[index] ?? 0) - (right[index] ?? 0);
    if (diff !== 0) return Math.sign(diff);
  }
  return 0;
}

export type UpdateState = "ok" | "available" | "required";

export function updateState(installed: string, { minimum, latest }: { minimum: string; latest: string }): UpdateState {
  if (minimum && compareVersions(installed, minimum) < 0) return "required";
  if (latest && compareVersions(installed, latest) < 0) return "available";
  return "ok";
}
