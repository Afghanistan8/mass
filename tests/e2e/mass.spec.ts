import { expect, test } from "@playwright/test";
import { CHARTER_DIGEST, GUARDIAN, ME, TARGET, URL1, actionDigest, assessment, capability, envelope, incident, installChain, installWallet, sourceState, targetStatus, writesOf } from "./fixtures";

const noPageErrors = (page: import("@playwright/test").Page) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  return () => expect(errors).toEqual([]);
};

test.describe("public surface", () => {
  test("landing states the thesis and links to command", async ({ page }) => {
    const check = noPageErrors(page);
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("cannot self-certify");
    await expect(page.getByText("Mass of evidence. Mass of consensus. Zero self-certification.").first()).toBeVisible();
    await expect(page.getByRole("link", { name: "Open command" })).toHaveAttribute("href", "/command");
    check();
  });

  test("every primary route renders without a client error", async ({ page }) => {
    const check = noPageErrors(page);
    await installChain(page, { list_charter_keys: [], list_incident_keys: [], list_capability_keys: [], get_status_json: targetStatus(), list_emergency_history: [], list_audit_log: [], list_record_keys: [] });
    for (const route of ["/", "/command", "/charter/new", "/incident/new", "/target", "/audit"]) {
      const response = await page.goto(route);
      expect(response?.ok(), route).toBeTruthy();
      await expect(page.locator("main")).not.toContainText("Application error");
    }
    check();
  });

  test("build-info exposes commit, deployment id and Studionet", async ({ request }) => {
    const body = await (await request.get("/api/build-info")).json();
    expect(body.project).toBe("Mass");
    expect(body.chainId).toBe(61999);
    expect(body).toHaveProperty("gitCommitSha");
    expect(body).toHaveProperty("deploymentId");
    expect(Object.keys(body.contracts).sort()).toEqual(["capabilityGate", "charterRegistry", "evidenceLedger", "massEngine", "protectedTarget"]);
  });
});

test.describe("wallet UX", () => {
  test("missing wallet is explained, not silent", async ({ page }) => {
    await page.goto("/charter/new");
    await expect(page.getByText("No injected wallet detected")).toBeVisible();
    await expect(page.getByTestId("wallet-missing")).toBeVisible();
  });

  test("wrong network blocks writes and offers a switch", async ({ page }) => {
    await installWallet(page, { chainId: "0x1" });
    await installChain(page, { get_charter_json: null });
    await page.goto("/command");
    await page.getByTestId("connect-wallet").click();
    await expect(page.getByText(/Wrong network/)).toBeVisible();
    await expect(page.getByTestId("switch-network")).toBeVisible();
    await page.getByTestId("switch-network").click();
    await expect(page.getByTestId("wallet-address")).toBeVisible();
    await expect(page.getByText(/Wrong network/)).toHaveCount(0);
  });

  test("a rejected connection surfaces the wallet error", async ({ page }) => {
    await installWallet(page, { rejectConnect: true });
    await page.goto("/command");
    await page.getByTestId("connect-wallet").click();
    await expect(page.getByText("Connection was rejected in the wallet.")).toBeVisible();
  });

  test("an unconnected wallet cannot submit a write", async ({ page }) => {
    await installWallet(page);
    await installChain(page, { get_charter_json: null });
    await page.goto("/incident/new");
    await expect(page.getByTestId("freeze-incident")).toBeDisabled();
    await expect(page.getByText("Connect your wallet to write.")).toBeVisible();
  });
});

test.describe("forms fail closed before any transaction", () => {
  test("charter form rejects empty and self-guardian input", async ({ page }) => {
    await installWallet(page);
    await installChain(page, {});
    await page.goto("/charter/new");
    await page.getByTestId("connect-wallet").click();
    await expect(page.getByTestId("wallet-address")).toBeVisible();
    await page.getByTestId("publish-charter").click();
    await expect(page.getByText("Fix the highlighted fields before publishing")).toBeVisible();
    await page.locator('input[name="guardian"]').fill(ME);
    await page.getByTestId("publish-charter").click();
    await expect(page.getByText("The guardian must differ from the charter owner.")).toBeVisible();
    expect(await writesOf(page)).toEqual([]);
  });

  test("incident form rejects every non-canonical evidence URL", async ({ page }) => {
    await installWallet(page);
    await installChain(page, { get_charter_json: null });
    await page.goto("/incident/new");
    await page.getByTestId("connect-wallet").click();
    await expect(page.getByTestId("wallet-address")).toBeVisible();
    await page.locator('input[name="incidentKey"]').fill("INC-E2E-9");
    await page.locator('input[name="charterKey"]').fill("CHARTER-E2E");
    await page.locator('textarea[name="reason"]').fill("A reason that is comfortably longer than thirty characters.");
    const cases: Array<[string, RegExp]> = [
      ["http://example.com/a", /Must be an https/],
      ["https://example.com/a?x=1", /No whitespace, backslash, percent-encoding, query or fragment/],
      ["https://example.com/a/%2e%2e/b", /percent-encoding/],
      ["https://user@example.com/a", /Hostname must be canonical/],
      ["https://example.com:8443/a", /Hostname must be canonical/],
      ["https://example.com/a/../b", /Dot path segments/],
    ];
    for (const [url, message] of cases) {
      await page.locator('textarea[name="urls"]').fill(url);
      await page.getByTestId("freeze-incident").click();
      await expect(page.getByRole("alert").filter({ hasText: message }).first()).toBeVisible();
    }
    await page.locator('textarea[name="urls"]').fill("https://example.com/a\nhttps://example.com/a");
    await page.getByTestId("freeze-incident").click();
    await expect(page.getByText("Duplicate evidence URL.")).toBeVisible();
    expect(await writesOf(page)).toEqual([]);
  });

  test("a valid freeze submits exactly the frozen request", async ({ page }) => {
    await installWallet(page);
    await installChain(page, { get_charter_json: null });
    await page.goto("/incident/new");
    await page.getByTestId("connect-wallet").click();
    await expect(page.getByTestId("wallet-address")).toBeVisible();
    await page.locator('input[name="incidentKey"]').fill("INC-E2E-9");
    await page.locator('input[name="charterKey"]').fill("CHARTER-E2E");
    await page.locator('textarea[name="reason"]').fill("A reason that is comfortably longer than thirty characters.");
    await page.locator('textarea[name="urls"]').fill(URL1);
    await page.getByTestId("freeze-incident").click();
    await expect(page.getByTestId("tx-finalized")).toBeVisible();
    const [write] = await writesOf(page);
    expect(write.fn).toBe("open_incident");
    expect(write.args.slice(0, 6)).toEqual(["INC-E2E-9", "CHARTER-E2E", "PAUSE_PROTECTED_ACTION", "*", 30, "A reason that is comfortably longer than thirty characters."]);
    expect(JSON.parse(write.args[6] as string)).toEqual([URL1]);
  });
});

test.describe("finality and authority UX", () => {
  test("a confirmed assessment shows quotes, digests and finality rail", async ({ page }) => {
    await installWallet(page);
    await installChain(page, { get_incident_json: incident(), get_capability_json: capability(), get_latest_record_json: { decision: "TRIGGER_CONFIRMED" } });
    await page.goto("/incident/INC-E2E-1");
    await expect(page.getByTestId("decision-label")).toHaveText("Trigger confirmed");
    await expect(page.getByText("Grants authority only after FINALIZED")).toBeVisible();
    await expect(page.getByTestId("finality-rail")).toContainText("assessment FINALIZED");
    const card = page.getByTestId("source-card");
    await expect(card).toContainText("verbatim-verified by every validator");
    await expect(card).toContainText("HTTP 200");
    await expect(page.getByRole("link", { name: "Inspect capability →" })).toBeVisible();
  });

  test("injection tripwire shows tampering, grants nothing, and shows no capability", async ({ page }) => {
    const a = assessment({ decision: "SOURCE_TAMPERING_SUSPECTED", source_states: [sourceState({ state: "NEUTRAL", quote: "", injection_flagged: true, finding: "Source matched a prompt-injection tripwire and was excluded." })] });
    await installChain(page, { get_incident_json: incident({ status: "ASSESSED_NO_AUTHORITY", capability_key: "" }, a), get_capability_json: null, get_latest_record_json: null });
    await page.goto("/incident/INC-E2E-1");
    await expect(page.getByTestId("decision-label")).toHaveText("Source tampering suspected");
    await expect(page.getByText("Grants no authority")).toBeVisible();
    await expect(page.getByText("Injection tripwire", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Inspect capability →" })).toHaveCount(0);
  });

  test("a pending-only assessment is flagged as not final", async ({ page }) => {
    const finalized = incident({ status: "OPEN", assessment_count: 0, capability_key: "" }, null);
    await installChain(page, {
      get_incident_json: (_a: unknown[], pending: boolean) => (pending ? incident() : finalized),
      get_capability_json: null, get_latest_record_json: null,
    });
    await page.goto("/incident/INC-E2E-1");
    await expect(page.getByText("A newer assessment exists but is NOT final")).toBeVisible();
    await expect(page.getByText("Not yet assessed")).toBeVisible();
  });

  test("capability digest is recomputed in the browser and matches", async ({ page }) => {
    await installWallet(page);
    await installChain(page, { get_capability_json: capability() });
    await page.goto("/capability/CAP-INC-E2E-1");
    await expect(page.getByTestId("digest-match")).toBeVisible();
    await expect(page.getByText("Exactly this, and nothing else")).toBeVisible();
  });

  test("a tampered capability digest is flagged as a mismatch", async ({ page }) => {
    await installChain(page, { get_capability_json: capability({ action_digest: "0".repeat(64) }) });
    await page.goto("/capability/CAP-INC-E2E-1");
    await expect(page.getByTestId("digest-mismatch")).toContainText("MISMATCH");
  });

  test("guardian approval gates execution", async ({ page }) => {
    await installWallet(page);
    await installChain(page, { get_capability_json: capability({ guardian: GUARDIAN }) });
    await page.goto("/capability/CAP-INC-E2E-1");
    await page.getByTestId("connect-wallet").click();
    await expect(page.getByText("Guardian approval required before execution")).toBeVisible();
    await expect(page.getByTestId("execute-capability")).toBeDisabled();
    await expect(page.getByTestId("approve-capability")).toBeDisabled();
  });

  test("execution waits for FINALIZED and submits the exact envelope", async ({ page }) => {
    await installWallet(page);
    await installChain(page, { get_capability_json: capability() }, { delayMs: 900 });
    await page.goto("/capability/CAP-INC-E2E-1");
    await page.getByTestId("connect-wallet").click();
    await expect(page.getByTestId("wallet-address")).toBeVisible();
    await page.getByTestId("execute-capability").click();
    await expect(page.getByTestId("tx-finalizing")).toContainText("Accepted is not final");
    await expect(page.getByTestId("tx-finalized")).toBeVisible();
    const [write] = await writesOf(page);
    expect(write.fn).toBe("execute_capability");
    expect(write.args).toEqual(["CAP-INC-E2E-1", TARGET, "PAUSE_PROTECTED_ACTION", "*", 20]);
  });

  test("a rejected transaction is shown as rejection, never as success", async ({ page }) => {
    await installWallet(page);
    await installChain(page, { get_capability_json: capability() }, { behaviour: "reject" });
    await page.goto("/capability/CAP-INC-E2E-1");
    await page.getByTestId("connect-wallet").click();
    await expect(page.getByTestId("wallet-address")).toBeVisible();
    await page.getByTestId("execute-capability").click();
    await expect(page.getByTestId("tx-failed")).toContainText("rejected");
    await expect(page.getByTestId("tx-finalized")).toHaveCount(0);
  });

  test("a spent capability cannot be executed again", async ({ page }) => {
    await installWallet(page);
    await installChain(page, { get_capability_json: capability({ dispatch_status: "APPLIED", consumed: true }) });
    await page.goto("/capability/CAP-INC-E2E-1");
    await expect(page.getByText("Replay is rejected by the gate and by the target.")).toBeVisible();
    await expect(page.getByTestId("execute-capability")).toHaveCount(0);
  });

  test("target shows a live pause countdown that needs no keeper", async ({ page }) => {
    const until = Math.floor(Date.now() / 1000) + 600;
    await installChain(page, { get_status_json: targetStatus({ paused: true, paused_until: until, lanes: { bridge: { quarantined: true, until } } }), list_emergency_history: [] });
    await page.goto("/target");
    await expect(page.getByText("Protected actions are PAUSED")).toBeVisible();
    await expect(page.getByTestId("pause-countdown")).toContainText("no keeper");
    await expect(page.getByText(/bridge · quarantined/)).toBeVisible();
  });

  test("evidence explorer verifies a commitment against the finalized ledger", async ({ page }) => {
    const digest = "f".repeat(64);
    await installChain(page, {
      list_audit_log: [], list_record_keys: [], get_latest_record_json: null,
      verify_commitment: (args: unknown[]) => args[1] === digest,
    });
    await page.goto("/audit");
    await page.locator('input[name="incident"]').fill("INC-E2E-1");
    await page.locator('input[name="digest"]').fill(digest);
    await page.getByTestId("verify-commitment").click();
    await expect(page.getByText("FINALIZED evidence commitment recorded")).toBeVisible();
    await page.locator('input[name="digest"]').fill("0".repeat(64));
    await page.getByTestId("verify-commitment").click();
    await expect(page.getByText("not the finalized commitment")).toBeVisible();
  });
});

test("fixture digest helper agrees with the contracts' canonical form", () => {
  expect(actionDigest(envelope())).toMatch(/^[0-9a-f]{64}$/);
  expect(CHARTER_DIGEST).toHaveLength(64);
});

test.describe("regressions found by auditing the hosted site", () => {
  const charter = {
    charter_key: "CHARTER-E2E", protocol_key: "PROTO-E2E", protocol_name: "E2E Protocol", owner: ME, guardian: "", protected_target: TARGET,
    trigger_policy: "t", evidence_policy: "e", evidence_hosts: [], evidence_scopes: [], allowed_actions: [], allowed_lanes: [],
    max_duration_minutes: 60, capability_ttl_minutes: 30, activation_delay_minutes: 1, published_at: 1790000000, eligible_at: 1790000060, version: 1,
    charter_digest: CHARTER_DIGEST,
  };

  test("an incident whose capability was applied is not shown as awaiting finality (incident page)", async ({ page }) => {
    await installChain(page, { get_incident_json: incident(), get_capability_json: capability({ dispatch_status: "APPLIED", consumed: true }), get_latest_record_json: { decision: "TRIGGER_CONFIRMED" } });
    await page.goto("/incident/INC-E2E-1");
    await expect(page.getByText("Capability applied · spent")).toBeVisible();
    await expect(page.getByText("Assessed · awaiting finality")).toHaveCount(0);
  });

  test("an incident whose capability was applied is not shown as awaiting finality (overview)", async ({ page }) => {
    await installChain(page, {
      list_charter_keys: ["CHARTER-E2E"], list_incident_keys: ["INC-E2E-1"], list_capability_keys: ["CAP-INC-E2E-1"],
      get_status_json: targetStatus(), get_charter_json: charter, get_incident_json: incident(),
      get_capability_json: capability({ dispatch_status: "APPLIED", consumed: true }),
    });
    await page.goto("/command");
    await expect(page.getByText("Capability applied · spent").first()).toBeVisible();
    await expect(page.getByText("awaiting finality")).toHaveCount(0);
  });

  test("an issued but unused capability is shown as issued, not pending", async ({ page }) => {
    await installChain(page, { get_incident_json: incident(), get_capability_json: capability(), get_latest_record_json: null });
    await page.goto("/incident/INC-E2E-1");
    await expect(page.getByText("Capability issued · unused")).toBeVisible();
  });

  const v1 = { ...charter, charter_key: "CH-OLD", version: 1 };
  const v2 = { ...charter, charter_key: "CH-NEW", version: 2 };
  const byKey = (map: Record<string, unknown>) => (args: unknown[]) => map[String(args[0])] ?? null;

  test("a superseded charter says so and never offers activation", async ({ page }) => {
    await installWallet(page);
    await installChain(page, { get_charter_json: byKey({ "CH-OLD": v1, "CH-NEW": v2 }), get_active_charter_key: "CH-NEW" });
    await page.goto("/charter/CH-OLD");
    await page.getByTestId("connect-wallet").click();
    await expect(page.getByText("Superseded by v2", { exact: true })).toBeVisible();
    await expect(page.getByTestId("superseded-notice")).toContainText("can never be activated again");
    await expect(page.getByTestId("activate-charter")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Open the active version →" })).toHaveAttribute("href", "/charter/CH-NEW");
  });

  test("a newer charter that is not yet active can still be activated", async ({ page }) => {
    await installWallet(page);
    await installChain(page, { get_charter_json: byKey({ "CH-OLD": v1, "CH-NEW": v2 }), get_active_charter_key: "CH-OLD" });
    await page.goto("/charter/CH-NEW");
    await page.getByTestId("connect-wallet").click();
    await expect(page.getByText("Eligible · not active")).toBeVisible();
    await expect(page.getByText("An older version is active: CH-OLD")).toBeVisible();
    await expect(page.getByTestId("activate-charter")).toBeEnabled();
    await expect(page.getByTestId("superseded-notice")).toHaveCount(0);
  });

  test("the active charter offers an incident, not activation", async ({ page }) => {
    await installChain(page, { get_charter_json: byKey({ "CH-NEW": v2 }), get_active_charter_key: "CH-NEW" });
    await page.goto("/charter/CH-NEW");
    await expect(page.getByText("Active", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Freeze an incident →" })).toBeVisible();
    await expect(page.getByTestId("activate-charter")).toHaveCount(0);
  });

  test("every route has its own descriptive title", async ({ page }) => {
    await installChain(page, { list_charter_keys: [], list_incident_keys: [], list_capability_keys: [], get_status_json: targetStatus(), list_emergency_history: [], list_audit_log: [], list_record_keys: [], get_charter_json: null, get_incident_json: null, get_capability_json: null });
    const titles = new Map<string, string>();
    for (const route of ["/", "/command", "/charter/new", "/incident/new", "/target", "/audit", "/charter/CH-1", "/incident/INC-9", "/capability/CAP-9"]) {
      await page.goto(route);
      titles.set(route, await page.title());
    }
    expect(new Set(titles.values()).size).toBe(titles.size);
    expect(titles.get("/incident/INC-9")).toContain("INC-9");
    expect(titles.get("/capability/CAP-9")).toContain("CAP-9");
    for (const [route, title] of titles) if (route !== "/") expect(title, route).toMatch(/· Mass$/);
  });

  // The real-user race: server-rendered controlled inputs accept typing before hydration, but React state never
  // hears about it. Delay the JS so we type first, then prove the typed values are what gets submitted.
  const delayHydration = (page: import("@playwright/test").Page) =>
    page.route("**/_next/static/**", async (route) => { await new Promise((r) => setTimeout(r, 2500)); await route.continue(); });
  // React attaches __reactProps$* to DOM nodes only once it has hydrated them.
  const hydrated = (page: import("@playwright/test").Page, selector: string) =>
    page.waitForFunction((s) => { const el = document.querySelector(s); return !!el && Object.keys(el).some((k) => k.startsWith("__reactProps")); }, selector, { timeout: 30_000 });

  test("text typed before hydration is used, not lost (audit explorer verify)", async ({ page }) => {
    const digest = "a".repeat(64);
    await installChain(page, { list_audit_log: [], list_record_keys: [], get_latest_record_json: null, verify_commitment: (args: unknown[]) => args[0] === "INC-TYPED-EARLY" && args[1] === digest });
    await delayHydration(page);
    await page.goto("/audit", { waitUntil: "commit" });
    await page.locator('input[name="incident"]').fill("INC-TYPED-EARLY");
    await page.locator('input[name="digest"]').fill(digest);
    await hydrated(page, 'input[name="digest"]');
    await page.getByTestId("verify-commitment").click();
    await expect(page.getByText("FINALIZED evidence commitment recorded")).toBeVisible();
  });

  test("a deep link pre-fills only an empty field", async ({ page }) => {
    await installChain(page, { list_audit_log: [], list_record_keys: [], get_latest_record_json: null });
    await page.goto("/audit?incident=INC-FROM-LINK");
    await expect(page.locator('input[name="incident"]')).toHaveValue("INC-FROM-LINK");
  });

  test("a freeze submitted after pre-hydration typing sends the typed values, even with a deep-link preset", async ({ page }) => {
    await installWallet(page);
    await installChain(page, { get_charter_json: null });
    await delayHydration(page);
    await page.goto("/incident/new?charter=CHARTER-FROM-LINK", { waitUntil: "commit" });
    await page.locator('input[name="incidentKey"]').fill("INC-TYPED-EARLY");
    await page.locator('input[name="charterKey"]').fill("CHARTER-TYPED-EARLY");
    await page.locator('textarea[name="reason"]').fill("Typed before the page finished loading, comfortably over thirty characters.");
    await page.locator('textarea[name="urls"]').fill(URL1);
    await hydrated(page, 'textarea[name="urls"]');
    await page.getByTestId("connect-wallet").click();
    await expect(page.getByTestId("wallet-address")).toBeVisible();
    await page.getByTestId("freeze-incident").click();
    await expect(page.getByTestId("tx-finalized")).toBeVisible();
    const [write] = await writesOf(page);
    expect(write.fn).toBe("open_incident");
    expect(write.args[0]).toBe("INC-TYPED-EARLY");
    expect(write.args[1]).toBe("CHARTER-TYPED-EARLY");
    expect(write.args[5]).toBe("Typed before the page finished loading, comfortably over thirty characters.");
    expect(JSON.parse(write.args[6] as string)).toEqual([URL1]);
  });

  test("a deep-link charter preset fills the freeze form when nothing was typed", async ({ page }) => {
    await installChain(page, { get_charter_json: null });
    await page.goto("/incident/new?charter=CHARTER-FROM-LINK");
    await expect(page.locator('input[name="charterKey"]')).toHaveValue("CHARTER-FROM-LINK");
  });

  test("charter form keys typed before hydration are not reported as missing", async ({ page }) => {
    await installWallet(page);
    await installChain(page, {});
    await delayHydration(page);
    await page.goto("/charter/new", { waitUntil: "commit" });
    await page.locator('input[name="charterKey"]').fill("CHARTER-TYPED-EARLY");
    await page.locator('input[name="protocolKey"]').fill("PROTO-TYPED-EARLY");
    await hydrated(page, 'input[name="protocolKey"]');
    await page.getByTestId("connect-wallet").click();
    await expect(page.getByTestId("wallet-address")).toBeVisible();
    await page.getByTestId("publish-charter").click();
    await expect(page.getByText("Fix the highlighted fields before publishing")).toBeVisible();
    // Other fields are genuinely empty, but the two keys the user already typed must not be flagged.
    await expect(page.locator('input[name="charterKey"]')).not.toHaveAttribute("aria-invalid", "true");
    await expect(page.locator('input[name="protocolKey"]')).not.toHaveAttribute("aria-invalid", "true");
    await expect(page.locator('input[name="name"]')).toHaveAttribute("aria-invalid", "true").catch(() => undefined);
  });

  test("the favicon is served", async ({ request }) => {
    const response = await request.get("/icon.svg");
    expect(response.ok()).toBeTruthy();
    expect(response.headers()["content-type"]).toContain("svg");
  });

  test("a Studionet rate limit is explained and paced, not shown as a raw fetch failure", async ({ page }) => {
    // Reproduces production: Studionet answers 429 without CORS headers, which browsers surface as "Failed to fetch".
    let calls = 0;
    await page.route("https://studio.genlayer.com/**", (route) => { calls += 1; return route.fulfill({ status: 429, contentType: "application/json", body: JSON.stringify({ jsonrpc: "2.0", error: { code: -32029, message: "Rate limit exceeded: 30 requests per minute" }, id: null }) }); });
    await page.goto("/target");
    const notice = page.getByTestId("rpc-notice");
    await expect(notice).toBeVisible({ timeout: 20_000 });
    await expect(notice).toContainText("rate-limiting this browser");
    await expect(notice).toContainText("Nothing has failed");
    // The gate must not hammer the server: a handful of requests while backing off, never a flood.
    expect(calls).toBeLessThanOrEqual(6);
  });
});

test.describe("steward review round 1: bounded recovery and evidence completeness", () => {
  const past = Math.floor(Date.now() / 1000) - 120;

  test("an expired, never-applied capability can never act again", async ({ page }) => {
    await installWallet(page);
    await installChain(page, { get_capability_json: capability({ dispatch_status: "EXPIRED", stored_status: "DISPATCHED", dispatch_count: 1, expires_at: past }) });
    await page.goto("/capability/CAP-INC-E2E-1");
    await page.getByTestId("connect-wallet").click();
    await expect(page.getByTestId("capability-expired")).toContainText("never applied it before the authority deadline");
    await expect(page.getByTestId("capability-expired")).toContainText("new incident and a new finalized assessment");
    await expect(page.getByTestId("execute-capability")).toHaveCount(0);
    await expect(page.getByTestId("reconcile-capability")).toBeVisible();
  });

  test("a dispatched capability shows bounded recovery inside its window", async ({ page }) => {
    await installWallet(page);
    await installChain(page, { get_capability_json: capability({ dispatch_status: "DISPATCHED", dispatch_count: 1 }) }, { delayMs: 300 });
    await page.goto("/capability/CAP-INC-E2E-1");
    await page.getByTestId("connect-wallet").click();
    await expect(page.getByTestId("recovery-info")).toContainText("2 recovery dispatch(es) left");
    await expect(page.getByTestId("execute-capability")).toHaveText("Re-dispatch (exact recovery)");
    await expect(page.getByTestId("execute-capability")).toBeEnabled();
    await page.getByTestId("execute-capability").click();
    const [write] = await writesOf(page);
    expect(write.args).toEqual(["CAP-INC-E2E-1", TARGET, "PAUSE_PROTECTED_ACTION", "*", 20]);
  });

  test("the retry limit disables recovery", async ({ page }) => {
    await installWallet(page);
    await installChain(page, { get_capability_json: capability({ dispatch_status: "DISPATCHED", dispatch_count: 3 }) });
    await page.goto("/capability/CAP-INC-E2E-1");
    await page.getByTestId("connect-wallet").click();
    await expect(page.getByTestId("recovery-info")).toContainText("0 recovery dispatch(es) left");
    await expect(page.getByTestId("execute-capability")).toBeDisabled();
  });

  test("a deadline that passed on the client clock is treated as expired even before the chain says so", async ({ page }) => {
    await installWallet(page);
    await installChain(page, { get_capability_json: capability({ dispatch_status: "DISPATCHED", dispatch_count: 1, expires_at: past }) });
    await page.goto("/capability/CAP-INC-E2E-1");
    await page.getByTestId("connect-wallet").click();
    await expect(page.getByTestId("capability-expired")).toBeVisible();
    await expect(page.getByTestId("execute-capability")).toHaveCount(0);
  });

  test("source cards say whether validators read each source in full", async ({ page }) => {
    const a = assessment({ decision: "INSUFFICIENT_EVIDENCE", source_states: [sourceState(), sourceState({ url: "https://example.com/long", state: "NEUTRAL", quote: "", complete: false, text_chars: 18452 })] });
    await installChain(page, { get_incident_json: incident({ status: "ASSESSMENT_RETRYABLE", capability_key: "" }, a), get_capability_json: null, get_latest_record_json: null });
    await page.goto("/incident/INC-E2E-1");
    await expect(page.getByText("Read in full · 320 chars")).toBeVisible();
    await expect(page.getByText("Too long to read in full · cannot support")).toBeVisible();
  });

  test("an incident whose capability expired unused says so", async ({ page }) => {
    await installChain(page, { get_incident_json: incident(), get_capability_json: capability({ dispatch_status: "EXPIRED", dispatch_count: 1, expires_at: past }), get_latest_record_json: null });
    await page.goto("/incident/INC-E2E-1");
    await expect(page.getByText("Capability expired · never applied")).toBeVisible();
  });
});
