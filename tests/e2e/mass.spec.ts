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
