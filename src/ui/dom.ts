type Child = Node | string | null | false | undefined;
type Attributes = Record<string, unknown>;

/**
 * Makes an element: `on...` attributes with functions become event listeners, properties the element has
 * are set as properties (value, disabled, ...), anything else as attributes. Null and false children are
 * left out.
 */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attributes: Attributes = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (value === undefined || value === null || value === false) continue;
    if (name.startsWith("on") && typeof value === "function") el.addEventListener(name.slice(2), value as EventListener);
    else if (name === "class") el.className = String(value);
    else if (name in el) (el as unknown as Record<string, unknown>)[name] = value;
    else el.setAttribute(name, value === true ? "" : String(value));
  }
  for (const c of children) if (c !== null && c !== false && c !== undefined) el.append(c);
  return el;
}

/** "1.2 MB" and the like. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** When something happened, as people say it: "just now", "5 minutes ago", or the date. */
export function formatWhen(ms: number, now: number = Date.now()): string {
  const s = Math.round((now - ms) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(ms).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}
