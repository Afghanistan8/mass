// Single source of truth for how outcomes are explained. Red is reserved for rejection.

export type Tone = "verified" | "pending" | "rejected" | "neutral";

export const DECISIONS: Record<string, { label: string; tone: Tone; grants: boolean; meaning: string }> = {
  TRIGGER_CONFIRMED: {
    label: "Trigger confirmed", tone: "verified", grants: true,
    meaning: "Independent validators fetched the approved sources, each verified the leader's verbatim quotes against its own fetch, and agreed. A capability is issued only after this assessment reaches FINALIZED.",
  },
  TRIGGER_NOT_CONFIRMED: {
    label: "Trigger not confirmed", tone: "rejected", grants: false,
    meaning: "The approved evidence does not establish the charter trigger. No authority exists and none can be issued for this incident.",
  },
  INSUFFICIENT_EVIDENCE: {
    label: "Insufficient evidence", tone: "rejected", grants: false,
    meaning: "Sources were unavailable, too weak, or support was not backed by a verifiable quote. Uncertainty fails closed. The incident may be re-assessed up to three times.",
  },
  ACTION_DISPROPORTIONATE: {
    label: "Action disproportionate", tone: "rejected", grants: false,
    meaning: "An emergency may exist, but the requested action, scope or duration is broader than the charter justifies. Nothing is granted.",
  },
  CONFLICTING_EVIDENCE: {
    label: "Conflicting evidence", tone: "rejected", grants: false,
    meaning: "Approved sources disagree: at least one supports the trigger and another contradicts it. Conflict is never resolved in favour of power.",
  },
  EVIDENCE_STALE: {
    label: "Evidence stale", tone: "rejected", grants: false,
    meaning: "The evidence describes a situation the charter's evidence policy treats as out of date. Re-assess when fresh evidence is published.",
  },
  SOURCE_TAMPERING_SUSPECTED: {
    label: "Source tampering suspected", tone: "rejected", grants: false,
    meaning: "A source addressed the assessor or matched a prompt-injection tripwire. The whole evidence set is treated as compromised. Terminal for this incident.",
  },
};

export const INCIDENT_STATUS: Record<string, { label: string; tone: Tone }> = {
  OPEN: { label: "Frozen · awaiting assessment", tone: "pending" },
  AUTHORITY_PENDING_FINALITY: { label: "Assessed · awaiting finality", tone: "pending" },
  ASSESSMENT_RETRYABLE: { label: "Inconclusive · retryable", tone: "pending" },
  ASSESSED_NO_AUTHORITY: { label: "Closed · no authority", tone: "rejected" },
};

/**
 * The engine stores AUTHORITY_PENDING_FINALITY for good (it cannot observe the gate finalizing), so showing it
 * literally is wrong once the capability exists. Derive the truthful state from the capability.
 */
export function incidentDisplay(status: string, capability?: { dispatch_status: string } | null): { label: string; tone: Tone; pulse: boolean } {
  if (status === "AUTHORITY_PENDING_FINALITY" && capability) {
    if (capability.dispatch_status === "APPLIED") return { label: "Capability applied · spent", tone: "neutral", pulse: false };
    if (capability.dispatch_status === "DISPATCHED") return { label: "Capability dispatched · awaiting finality", tone: "pending", pulse: true };
    return { label: "Capability issued · unused", tone: "verified", pulse: false };
  }
  const base = INCIDENT_STATUS[status] ?? { label: status, tone: "neutral" as Tone };
  return { ...base, pulse: base.tone === "pending" };
}

export const SOURCE_STATE: Record<string, { label: string; tone: Tone }> = {
  SUPPORTS_TRIGGER: { label: "Supports trigger", tone: "verified" },
  CONTRADICTS_TRIGGER: { label: "Contradicts trigger", tone: "rejected" },
  NEUTRAL: { label: "Neutral", tone: "neutral" },
  UNAVAILABLE: { label: "Unavailable", tone: "rejected" },
};

export const DISPATCH: Record<string, { label: string; tone: Tone }> = {
  ISSUED: { label: "Issued · unused", tone: "verified" },
  DISPATCHED: { label: "Dispatched · awaiting finality", tone: "pending" },
  APPLIED: { label: "Applied · spent", tone: "neutral" },
};

export const ACTION_COPY: Record<string, string> = {
  PAUSE_PROTECTED_ACTION: "Pause every protected action on the target for the bound duration.",
  QUARANTINE_LANE: "Quarantine one named lane on the target for the bound duration; other lanes stay open.",
};

export const shortHex = (value: string, head = 6, tail = 4) =>
  value && value.length > head + tail + 2 ? `${value.slice(0, head + 2)}…${value.slice(-tail)}` : value;

export const formatTime = (unix: number) => (unix ? new Date(unix * 1000).toISOString().replace("T", " ").replace(".000Z", "Z") : "—");

export const countdown = (untilUnix: number, nowMs: number) => {
  const s = Math.max(0, Math.floor(untilUnix - nowMs / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return `${h ? `${h}h ` : ""}${m}m ${String(sec).padStart(2, "0")}s`;
};

// Mirrors MassEngine._canonical_url so the UI rejects what the contract would reject.
export function validateEvidenceUrl(url: string): string | null {
  if (!url.startsWith("https://")) return "Must be an https:// URL.";
  if (url.length > 500) return "URL is too long.";
  if (/[\s\\%?#]/.test(url) || [...url].some((c) => c.charCodeAt(0) < 0x21 || c.charCodeAt(0) === 0x7f)) return "No whitespace, backslash, percent-encoding, query or fragment allowed.";
  const [authority, ...rest] = url.slice(8).split("/");
  if (!/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(authority) || authority.includes("..")) return "Hostname must be canonical: no userinfo, port or trailing dot.";
  if (rest.some((s) => s === "." || s === "..")) return "Dot path segments are rejected.";
  return null;
}
