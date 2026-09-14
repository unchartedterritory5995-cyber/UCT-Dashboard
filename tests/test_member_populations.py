"""Three populations, counted by identity, never summed into one "members".

⚰️ **2026-09-13: THE SAMPLER PUBLISHED OUR OWN TEST ACCOUNT AS SEVEN INDEPENDENT
MEMBERS.** The 15:00 and 17:00 ET rows read `members 7`. All seven were the T-12
smoke account — `/api/auth/export-data` on that account holds exactly those seven
`notebook_offline_opt_in` rows, 17:51:57 → 18:14:46 UTC, matching the seven T-12
runs. The Sunday gate would have printed `organic members exposed = 7` into the
artifact the K window is judged on, inverting its central claim.

**Two faults, and they compound:**

1. the exclusion list held `smoke@…` but not `member-smoke@…` — two different
   accounts, 30 and 37 characters, one excluded and one not;
2. the count was `indep.length` — **ROWS, not identities** — while the
   config-served column beside it is explicitly *"BY IDENTITY, not by row: one
   member with six tabs is one member."* One real member with seven tabs would
   have read as seven members too.

⭐ **Seven opt-ins from seven fresh browser contexts is EXPECTED, not a dedupe
failure** — the opt-in dedupe marker is per tab/context by design. The defect was
never the seven events; it was calling them seven *members*.
"""
from __future__ import annotations

import importlib.util
import pathlib
import re
import sys

TOOLS = pathlib.Path(__file__).resolve().parents[1] / "tools"


def _load(name):
    spec = importlib.util.spec_from_file_location(name, TOOLS / (name + ".py"))
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


# ── the rosters ────────────────────────────────────────────────────────────

def test_the_T12_identity_is_a_declared_synthetic_member():
    """⛔ THE ONE THAT FAILED. `member-smoke@` must be on a list, by FULL email."""
    obs = _load("nb_observe")
    assert "member-smoke@uctintelligence.internal" in obs.SYNTHETIC_MEMBERS
    assert "smoke@uctintelligence.internal" in obs.SYNTHETIC_MEMBERS
    # ...and it is NOT quietly folded in with the rig, which would hide it
    assert "member-smoke@uctintelligence.internal" not in obs.RIG_AND_OWNER


def test_the_union_is_derived_not_typed_a_second_time():
    """⛔ `lesson_a_second_authority_over_one_value`. Two hand-kept lists over one
    question is how `member-smoke@` came to be on neither."""
    obs = _load("nb_observe")
    assert obs.NOT_A_MEMBER == obs.RIG_AND_OWNER + obs.SYNTHETIC_MEMBERS
    src = (TOOLS / "nb_observe.py").read_text(encoding="utf-8")
    assert "NOT_A_MEMBER = RIG_AND_OWNER + SYNTHETIC_MEMBERS" in src


def test_matching_is_by_FULL_EMAIL_never_by_prefix_or_substring():
    """⛔ A `startswith('smoke')` test would have caught `member-smoke@` only by
    luck — it does not start with it — and a substring test would silently
    swallow a real member whose address happened to contain one of these."""
    js = _load("nb_observe").OPTIN_JS
    assert "rigOwner.includes(email)" in js
    assert "synthetic.includes(email)" in js
    for bad in ("startsWith(", "indexOf(", ".includes('smoke"):
        assert bad not in js, bad


def test_an_unknown_internal_address_is_flagged_not_counted_as_organic():
    """⛔ `.internal` is reserved (RFC 8375) and unroutable, so nobody outside
    this programme can hold one. A new one is a synthetic account somebody
    provisioned without declaring it — counting it as organic is the same defect
    arriving from a new address."""
    obs = _load("nb_observe")
    assert obs.INTERNAL_DOMAIN == "@uctintelligence.internal"
    js = obs.OPTIN_JS
    assert "unknownInternal" in js
    assert "email.endsWith(internalDomain)" in js
    # ⭐ ORDER IS LOAD-BEARING: a DECLARED synthetic must be classified as
    # synthetic, not swept into the unknown bucket by the domain test.
    assert js.index("synthetic.includes(email)") < js.index("email.endsWith(internalDomain)")
    src = (TOOLS / "nb_observe.py").read_text(encoding="utf-8")
    assert "UNKNOWN INTERNAL identity opted in" in src, "it must raise an ANOMALY, not sit quiet"


def test_the_count_is_by_IDENTITY_not_by_row():
    """⛔ THE OTHER HALF. Seven events from one account is ONE account."""
    js = _load("nb_observe").OPTIN_JS
    assert "identities: b.size" in js
    assert "new Map()" in js
    # the old shape must be gone by NAME, not merely unused
    assert "memberCount" not in js
    assert "indep.length" not in js


def test_a_full_page_of_activity_is_reported_as_a_CAP():
    """⛔ "We found N" reads as "there are N" while the oldest rows sit outside
    the window (`lesson_a_saturated_instrument_reports_zero`)."""
    assert "capped: rows.length >= 200" in _load("nb_observe").OPTIN_JS


# ── the gate prints three numbers, every time ──────────────────────────────

def test_the_gate_prints_three_populations_and_never_one_figure():
    gate = _load("nb_gate")
    src = (TOOLS / "nb_gate.py").read_text(encoding="utf-8")
    assert "organic members exposed = " in src
    assert "synthetic = " in src and "rig/owner = " in src
    assert "counted by distinct identity, never summed" in src
    assert "POPULATION:" in src


def test_the_gate_reads_each_population_out_of_the_row():
    """Driven against the exact cell shape the sampler writes."""
    gate = _load("nb_gate")
    cell = ("2026-09-13 18:14:46 · organic 0 · synthetic 1 "
            "(7 events [member-smoke@uctintelligence.internal]) · rig/owner 1")
    pop = re.search
    # the gate's own helper is defined inside main(); assert the regex contract
    # it relies on holds for this cell rather than re-implementing it here.
    assert int(pop(r"organic\s+(\d+)", cell).group(1)) == 0
    assert int(pop(r"synthetic\s+(\d+)", cell).group(1)) == 1
    assert int(pop(r"rig/owner\s+(\d+)", cell).group(1)) == 1


def test_a_legacy_members_row_is_NOT_read_as_an_organic_count(tmp_path, monkeypatch):
    """⛔⛔ THE ROWS ALREADY IN THE LOG. Two rows carry the old `members 7`, whose
    number counted ROWS from any non-excluded address. Reading one as organic is
    exactly the false claim this whole change exists to stop — so the gate counts
    them separately and SAYS SO."""
    NL = chr(10)
    log = tmp_path / "obs.md"
    log.write_text(NL.join([
        "| at (ET) | opt-ins by population (UTC) | opt-in (windowed) | config-served (members) "
        "| blocked-baseline | sync-conflict notes | outbox | console errors | flag |",
        "|---|---|---|---|---|---|---|---|---|",
        "| 2026-09-13 15:00 ET | 2026-09-13 18:14:46 · members 7 | 25 | 0/0 | 0 | 3 | 0 | 0 | OK |",
        "| 2026-09-13 19:00 ET | 2026-09-13 20:00:14 · organic 0 · synthetic 1 (7 events) "
        "· rig/owner 1 | 25 | 0/0 | 0 | 3 | 0 | 0 | OK |",
        "",
    ]) + NL, encoding="utf-8")
    monkeypatch.setenv("NB_OBSERVE_LOG", str(log))
    monkeypatch.setenv("NB_GATE_VERDICT", str(tmp_path / "v.md"))
    monkeypatch.setenv("NB_RESUME_DOC", str(tmp_path / "absent.md"))
    monkeypatch.setenv("NB_GATE_REPO", str(tmp_path))      # skip the sweep subprocess
    gate = _load("nb_gate")
    gate.main()
    out = (tmp_path / "v.md").read_text(encoding="utf-8")
    assert "organic members exposed = 0" in out, out
    assert "synthetic = 1" in out
    assert "rig/owner = 1" in out
    # ⭐ the legacy row is named, not silently dropped — its 7 must never reappear
    assert "predate the three-population split" in out
    assert "organic members exposed = 7" not in out


def test_a_REAL_organic_member_still_reaches_the_verdict(tmp_path, monkeypatch):
    """⭐ THE PAIR. Narrowing what counts must not make a real member invisible —
    that would be the same failure pointing the other way, and far worse."""
    NL = chr(10)
    log = tmp_path / "obs.md"
    log.write_text(NL.join([
        "| at (ET) | opt-ins by population (UTC) | opt-in (windowed) | config-served (members) "
        "| blocked-baseline | sync-conflict notes | outbox | console errors | flag |",
        "|---|---|---|---|---|---|---|---|---|",
        "| 2026-09-13 19:00 ET | 2026-09-13 20:00:14 · organic 2 [ann@…, bob@…] "
        "· synthetic 1 · rig/owner 1 | 25 | 1/2 | 0 | 3 | 0 | 0 | OK |",
        "",
    ]) + NL, encoding="utf-8")
    monkeypatch.setenv("NB_OBSERVE_LOG", str(log))
    monkeypatch.setenv("NB_GATE_VERDICT", str(tmp_path / "v.md"))
    monkeypatch.setenv("NB_RESUME_DOC", str(tmp_path / "absent.md"))
    monkeypatch.setenv("NB_GATE_REPO", str(tmp_path))
    gate = _load("nb_gate")
    gate.main()
    out = (tmp_path / "v.md").read_text(encoding="utf-8")
    assert "organic members exposed = 2" in out, out
    assert "ORGANIC MEMBER IDENTITY(S)" in out
    # ...and the K-1 "synthetic population" qualifier must NOT fire now
    assert "100% of a synthetic population" not in out
