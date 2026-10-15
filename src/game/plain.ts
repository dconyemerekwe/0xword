// Checks for untrusted, JSON-like data: webview messages (src/protocol.ts),
// stored stats (src/stats.ts) and saved webview state (Round and Session).
// Reading never runs the sender's code or reaches the prototype chain. Pure:
// no `vscode` import, so it can be unit-tested and bundled into the webview.
// The only copy of these helpers; import them from here.

/**
 * The own fields of a plain object (`{...}` or `JSON.parse` output) as a map,
 * or null for anything else: null, primitives, arrays, class instances,
 * symbol keys or getters. `__proto__` and `constructor` are just keys here.
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

/**
 * The items of a plain array of at most `maxLength` items, copied, or null for
 * anything else: non-arrays, subclasses, holes, extra properties or getters.
 */
export function plainItems(raw: unknown, maxLength: number): unknown[] | null {
  if (!Array.isArray(raw) || Object.getPrototypeOf(raw) !== Array.prototype) {
    return null;
  }
  const length: unknown = raw.length;
  if (typeof length !== "number" || length > maxLength || Reflect.ownKeys(raw).length !== length + 1) {
    return null;
  }
  const items: unknown[] = [];
  for (let i = 0; i < length; i++) {
    const descriptor = Object.getOwnPropertyDescriptor(raw, String(i));
    if (descriptor === undefined || !("value" in descriptor)) {
      return null;
    }
    items.push(descriptor.value);
  }
  return items;
}

/** True if `fields` has exactly these keys, no more and no fewer. */
export function hasExactKeys(fields: ReadonlyMap<string, unknown>, keys: readonly string[]): boolean {
  return fields.size === keys.length && keys.every((key) => fields.has(key));
}

export function isIntegerInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}
