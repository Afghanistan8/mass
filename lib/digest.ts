// Mirrors the contracts' canonical digest: sha256 over JSON with sorted keys and compact separators.
// Lets the browser independently recompute the action digest a capability is bound to.

const sortKeys = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => [k, sortKeys(v)]));
  }
  return value;
};

export const canonicalJson = (value: unknown) => JSON.stringify(sortKeys(value));

export async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export type ActionEnvelope = {
  incident_key: string; charter_digest: string; target: string; action_class: string; scope: string; duration_minutes: number;
};

export const actionDigest = (e: ActionEnvelope) =>
  sha256Hex(canonicalJson({ ...e, target: e.target.toLowerCase(), duration_minutes: Number(e.duration_minutes) }));
