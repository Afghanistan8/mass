"use client";

import { ADDRESSES } from "@/lib/config";
import { readContract } from "@/lib/genlayer";

export type Charter = {
  charter_key: string; protocol_key: string; protocol_name: string; owner: string; guardian: string;
  protected_target: string; trigger_policy: string; evidence_policy: string;
  evidence_hosts: string[]; evidence_scopes: { host: string; path_prefix: string }[];
  allowed_actions: string[]; allowed_lanes: string[];
  max_duration_minutes: number; capability_ttl_minutes: number; activation_delay_minutes: number;
  published_at: number; eligible_at: number; version: number; charter_digest: string;
};

export type SourceState = {
  url: string; state: "SUPPORTS_TRIGGER" | "CONTRADICTS_TRIGGER" | "NEUTRAL" | "UNAVAILABLE";
  finding: string; quote: string; http_status: number; content_digest: string; raw_digest: string; injection_flagged: boolean;
};

export type Assessment = {
  decision: string; summary: string; trigger_clauses: string[]; material_findings: string[];
  source_states: SourceState[]; incident_digest: string; charter_digest: string; action_digest: string;
  evidence_commitment_digest: string; assessed_at: number; attempt: number; authority_status?: string;
};

export type Incident = {
  incident_key: string; charter_key: string; charter_digest: string; protocol_key: string; requester: string;
  guardian: string; target: string; action_class: string; scope: string; duration_minutes: number; reason: string;
  evidence_urls: string[]; capability_ttl_minutes: number; opened_at: number; expires_at: number;
  incident_digest: string; action_digest: string; status: string; assessment_json: string; assessment_digest: string;
  evidence_commitment_digest: string; assessment_count: number; capability_key: string;
};

export type Capability = {
  capability_key: string; incident_key: string; holder: string; guardian: string; guardian_approved: boolean;
  target: string; action_class: string; scope: string; duration_minutes: number; action_digest: string;
  charter_digest: string; assessment_digest: string; issuer: string; issued_at: number; expires_at: number;
  dispatch_status: "ISSUED" | "DISPATCHED" | "APPLIED"; dispatch_count: number; consumed: boolean;
};

export type TargetStatus = {
  gate_address: string; governance_address: string; action_count: string; paused: boolean; paused_until: number;
  lanes: Record<string, { quarantined: boolean; until: number }>; applied_capability_count: number; last_action_json: string;
};

export type LedgerRecord = {
  incident_key: string; attempt: number; charter_digest: string; decision: string; assessment_digest: string;
  evidence_commitment_digest: string; summary: string; recorded_at: number;
  commitments: { url: string; state: string; http_status: number; content_digest: string; raw_digest: string }[];
};

export type AuditEntry = { seq: number; at: number; kind: string; incident_key: string; actor: string; data: Record<string, unknown> };

const parse = <T,>(raw: unknown): T | null => {
  if (typeof raw !== "string" || !raw) return null;
  try { return JSON.parse(raw) as T; } catch { return null; }
};
const strings = (raw: unknown): string[] => (Array.isArray(raw) ? raw.map(String) : []);

export const getCharter = async (key: string) => parse<Charter>(await readContract(ADDRESSES.charterRegistry, "get_charter_json", [key]));
export const listCharterKeys = async () => strings(await readContract(ADDRESSES.charterRegistry, "list_charter_keys"));
export const getActiveCharterKey = async (protocol: string) => String(await readContract(ADDRESSES.charterRegistry, "get_active_charter_key", [protocol]) ?? "");

export const getIncident = async (key: string, pending = false) =>
  parse<Incident>(await readContract(ADDRESSES.massEngine, "get_incident_json", [key], pending));
export const listIncidentKeys = async (pending = false) => strings(await readContract(ADDRESSES.massEngine, "list_incident_keys", [], pending));
export const listAudit = async () =>
  strings(await readContract(ADDRESSES.massEngine, "list_audit_log")).map((s) => parse<AuditEntry>(s)).filter((e): e is AuditEntry => !!e);

export const getCapability = async (key: string) => parse<Capability>(await readContract(ADDRESSES.capabilityGate, "get_capability_json", [key]));
export const listCapabilityKeys = async () => strings(await readContract(ADDRESSES.capabilityGate, "list_capability_keys"));

export const getTargetStatus = async () => parse<TargetStatus>(await readContract(ADDRESSES.protectedTarget, "get_status_json"));
export const listEmergencyHistory = async () =>
  strings(await readContract(ADDRESSES.protectedTarget, "list_emergency_history")).map((s) => parse<Record<string, unknown>>(s)).filter(Boolean) as Record<string, unknown>[];
export const getGovernance = async () => String(await readContract(ADDRESSES.protectedTarget, "get_governance_address") ?? "");

export const getLatestLedgerRecord = async (incident: string) => parse<LedgerRecord>(await readContract(ADDRESSES.evidenceLedger, "get_latest_record_json", [incident]));
export const listLedgerKeys = async () => strings(await readContract(ADDRESSES.evidenceLedger, "list_record_keys"));
export const getLedgerRecord = async (key: string) => parse<LedgerRecord>(await readContract(ADDRESSES.evidenceLedger, "get_record_json", [key]));
export const verifyCommitment = async (incident: string, digest: string) => (await readContract(ADDRESSES.evidenceLedger, "verify_commitment", [incident, digest])) === true;

export const parseAssessment = (incident: Incident | null): Assessment | null => parse<Assessment>(incident?.assessment_json);
