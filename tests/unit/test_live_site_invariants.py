"""Regression tests for defects found by auditing the hosted site (https://mass-iota-three.vercel.app)."""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def text(rel: str) -> str:
    return (ROOT / rel).read_text(encoding="utf-8")


# --- 1. Studionet rate limit: gen_call is capped at 30/min per IP and its 429s carry no CORS headers -----------
def test_every_read_goes_through_the_rate_limit_gate():
    src = text("lib/genlayer.ts")
    assert "createRpcGate" in src and "gate.run" in src
    read_fn = src.split("export async function readContract", 1)[1].split("export async function submitWrite", 1)[0]
    assert "gate.run" in read_fn
    # The old loop re-sent failed reads, which deepened the limit. No ad-hoc retry may come back.
    assert "for (let attempt" not in read_fn and "setTimeout" not in read_fn
    # Only the gate may call the SDK's readContract.
    assert src.count("readClient().readContract(") == 1


def test_gate_budget_leaves_headroom_under_the_server_limit():
    src = text("lib/genlayer.ts")
    budget = int(re.search(r"budget:\s*(\d+)", src).group(1))
    window_ms = int(re.search(r"windowMs:\s*([\d_]+)", src).group(1).replace("_", ""))
    assert window_ms == 60_000
    assert 10 <= budget <= 24, "Studionet allows 30 gen_call/min per IP; keep headroom for other tabs and devices"


def test_budget_is_shared_across_tabs_and_cache_survives_reload():
    src = text("lib/genlayer.ts")
    assert "localStorage" in src and "mass:rpc-window" in src
    assert "sessionStorage" in src and "mass:rpc-cache:" in src


def test_polling_stays_well_inside_the_read_budget():
    for path in (ROOT / "app").rglob("page.tsx"):
        for call in re.finditer(r"usePoll\((?:.|\n)*?\],\s*(\d+)", path.read_text(encoding="utf-8")):
            assert int(call.group(1)) >= 15000, f"{path.relative_to(ROOT)} polls faster than 15s"


def test_terminal_pages_stop_polling():
    assert "shouldPoll" in text("components/ui.tsx")
    assert "(d) => !d || !d.settled" in text("app/incident/[key]/page.tsx")
    assert 'd?.dispatch_status !== "APPLIED"' in text("app/capability/[key]/page.tsx")


def test_overview_reads_a_bounded_number_of_items():
    show = int(re.search(r"const SHOW = (\d+);", text("app/command/page.tsx")).group(1))
    # 3 list reads + 1 status + 3*SHOW item reads (+ rare capability lookups) must fit one 22-call budget.
    assert 4 + 3 * show <= 22


def test_a_failed_refresh_never_discards_loaded_data():
    for page in ("app/incident/[key]/page.tsx", "app/capability/[key]/page.tsx", "app/charter/[key]/page.tsx", "app/target/page.tsx"):
        src = text(page)
        assert "if (error && !" in src and "StaleNotice" in src, page
        assert "if (error) return" not in src, page
    assert "RpcNotice" in text("components/AppShell.tsx") and "rpc-notice" in text("components/AppShell.tsx")


def test_writes_clear_the_cache_only_after_finalization():
    tx = text("components/tx.tsx")
    assert tx.index("await waitForFinalization(hash)") < tx.index("clearReadCache()") < tx.index("onFinalized?.()")


# --- 2. Incident status must be true once the capability exists ----------------------------------------------------
def test_incident_status_is_derived_from_the_capability():
    policy = text("lib/policy.ts")
    assert "export function incidentDisplay" in policy
    assert "Capability applied" in policy and "Capability issued" in policy
    for page in ("app/command/page.tsx", "app/incident/[key]/page.tsx"):
        src = text(page)
        assert "incidentDisplay(" in src and "INCIDENT_STATUS[" not in src, page


# --- 3. Hardening ----------------------------------------------------------------------------------------------------
def test_security_headers_and_csp():
    cfg = text("next.config.ts")
    for needle in ('"X-Frame-Options", value: "DENY"', '"X-Content-Type-Options", value: "nosniff"', "Referrer-Policy", "Permissions-Policy"):
        assert needle in cfg, needle
    csp = re.search(r"const csp = \[(.*?)\]\.join", cfg, re.S).group(1)
    assert "frame-ancestors 'none'" in csp and "object-src 'none'" in csp and "base-uri 'self'" in csp
    assert "default-src 'self'" in csp
    # The only network host the page may talk to is the Studionet RPC.
    assert re.findall(r"https://[a-z.\-]+", csp) == ["https://studio.genlayer.com"]
    assert "'unsafe-eval'" not in csp
    assert "...(isProd ?" in cfg, "CSP must be production-only (next dev needs eval)"


def test_build_info_reports_real_build_time_and_verified_provenance():
    route = text("app/api/build-info/route.ts")
    assert "new Date()" not in route, "builtAt must be the build time, not the request time"
    assert "BUILD_TIME" in text("next.config.ts")
    manifest = json.loads(text("deployment-manifest.public.json"))
    assert "repositoryCommit" not in manifest and re.fullmatch(r"[0-9a-f]{40}", manifest["sourcesCommit"])
    assert "contractSourcesCommit" in route


def test_favicon_and_per_route_titles_exist():
    assert (ROOT / "app/icon.svg").exists()
    pages = [p for p in (ROOT / "app").rglob("page.tsx") if p.parent != ROOT / "app"]
    assert len(pages) == 8
    for page in pages:
        layout = page.parent / "layout.tsx"
        assert layout.exists(), f"{page.parent.relative_to(ROOT)} has no layout with a title"
        body = layout.read_text(encoding="utf-8")
        assert "title" in body and ("metadata" in body or "generateMetadata" in body)


def _lum(hex_color: str) -> float:
    c = [int(hex_color[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    c = [v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4 for v in c]
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]


def _ratio(a: str, b: str) -> float:
    hi, lo = sorted((_lum(a), _lum(b)), reverse=True)
    return (hi + 0.05) / (lo + 0.05)


def test_text_colours_meet_wcag_aa_on_every_surface():
    css = text("app/globals.css")
    tok = {name: value for name, value in re.findall(r"--color-([a-z-]+):\s*(#[0-9a-fA-F]{6});", css)}
    for fg in ("text", "dim", "faint", "verified", "pending", "rejected"):
        for bg in ("ink", "graphite", "panel", "raise"):
            assert _ratio(tok[fg], tok[bg]) >= 4.5, f"{fg} on {bg} is {_ratio(tok[fg], tok[bg]):.2f}"


# --- 4. Text typed before hydration must reach React state ---------------------------------------------------------
def test_every_server_rendered_form_adopts_text_typed_before_hydration():
    """A pre-hydration keystroke lands in the DOM but never in React state; each SSR form must adopt it on mount."""
    forms = ["app/charter/new/page.tsx", "app/incident/new/page.tsx"]
    for page in forms:
        src = text(page)
        assert "adoptPrehydrationValues(formRef.current" in src and "ref={formRef}" in src, page
    audit = text("app/audit/page.tsx")
    assert 'input[name="incident"]' in audit and 'input[name="digest"]' in audit
    assert "current || typedIncident || fromLink" in audit, "typed text must win over the ?incident= deep link"
    assert 'setIncident(new URLSearchParams' not in audit, "unconditional overwrite from the URL is the bug"


def test_incident_form_lets_typed_text_beat_the_deep_link_preset():
    src = text("app/incident/new/page.tsx")
    assert "preset && !merged.charterKey" in src


def test_every_charter_form_control_has_a_name_so_it_can_be_adopted():
    src = text("app/charter/new/page.tsx")
    for name in ("charterKey", "protocolKey", "name", "target", "trigger", "evidence", "scopes", "guardian", "lanes", "pause", "quarantine", "maxMinutes", "ttl", "delay"):
        assert f'name="{name}"' in src, name
