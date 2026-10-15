// Checks for untrusted plain data: webview messages and stored stats. Pure:
// no `vscode` import, so it can be unit-tested and bundled into the webview.

/**
 * The own fields of a plain object (`{...}` or `JSON.parse` output) as a map,
 * or null for anything else: null, primitives, arrays, class instances,
 * symbol keys or getters. Reading from the map never runs the sender's code
 * or reaches the prototype chain, so `__proto__` and `constructor` are just
 * keys like any other (and so rejected as extra fields).
 */
export function plainFields(raw: unknown): Map<string, unknown> | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }
  const proto: unknown = Object.getPrototypeOf(raw);
  if (proto !== Object.prototype && proto !== null) {
    return null;
  }
  const fields = new Map<string, unknown>();
  for (const key of Reflect.ownKeys(raw)) {
    const descriptor = Object.getOwnPropertyDescriptor(raw, key);
    if (typeof key !== "string" || descriptor === undefined || !("value" in descriptor)) {
      return null;
    }
    fields.set(key, descriptor.value);
  }
  return fields;
}

/** True if `fields` has exactly these keys, no more and no fewer. */
export function hasExactKeys(fields: ReadonlyMap<string, unknown>, keys: readonly string[]): boolean {
  return fields.size === keys.length && keys.every((key) => fields.has(key));
}

export function isIntegerInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}
