/** Copies only the given keys that are present on the source object. */
export function pick<T extends object, K extends keyof T>(source: Partial<T>, keys: readonly K[]): Pick<T, K> {
  const result = {} as Pick<T, K>;
  for (const key of keys) {
    if (key in source && source[key] !== undefined) result[key] = source[key] as T[K];
  }
  return result;
}
