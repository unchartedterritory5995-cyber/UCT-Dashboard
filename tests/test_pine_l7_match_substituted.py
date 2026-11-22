"""L7 (2026-11-14) -- MATCH_SUBSTITUTED is its own bucket and never counts as MATCH.

Owner ruling (option a): grade everything except the substituted values, labelled "UCT data". Peer
ask: a substituted series never counts as PROVEN-exact or MATCH in the coverage map, the evidence
ledger or capability admission, and its grade is a bucket of its own. The harness side (the verdict
itself) is railed in app/.../vendorHarness/vendorHarness.l7Substituted.test.js. Here:
  S1 the evidence ledger files, round-trips and classifies the verdict, with its substituted inputs;
     a MATCH-counting function given only MATCH_SUBSTITUTED rows counts 0;
  S2 the coverage map: verifiedTransfer unchanged, the new bucket at 1, never filed as DIVERGE;
  S3 every other MATCH reader keeps excluding it (the census, broker pins, capability evidence);
  S4 runtime admission: a MATCH_SUBSTITUTED capture admits only through the named substituted path;
  S5 the disclosure field the member door reads, empty by default.
"""
from __future__ import annotations

import collections
import hashlib
import json
import pathlib
import sys

import pytest

REPO = pathlib.Path(__file__).resolve().parents[1]
for p in (REPO / "tools" / "vendor_harness", REPO / "tools", REPO / "tools" / "pine_coverage"):
    sys.path.insert(0, str(p))

import evidence_ledger as el  # noqa: E402
import evidence_engine as ee  # noqa: E402
import coverage_map as cm  # noqa: E402
import capability_admission as ca  # noqa: E402

from api.services import rollout_gate as rg  # noqa: E402
from api.services import runtime_definitions as rt  # noqa: E402

TEXT = ("//@version=6\nindicator(\"Industry Flag [someone]\")\n"
        "plot(syminfo.industry == 'Semiconductors' ? ta.mom(close, 14) : na)\n")
ENGINE = 41
CID = "industry-flag-rddt-1d-2026-11-14"
SUB = [{"name": "syminfo.industry", "source": "uct:ticker_meta", "vendorValueFrom": "capture.symbol.industry",
        "checked": "by the comparator, against the capture"}]
FILED = [{"name": "syminfo.industry", "source": "uct:ticker_meta", "vendorValueFrom": "capture.symbol.industry"}]


def _sha(t):
    return hashlib.sha256(t.encode("utf-8")).hexdigest()


def _capture():
    return {"schema": "uct.vendor-capture/v1", "id": CID, "receipt": {"fnv1a": _sha(CID)[:8]},
            "symbol": {"pro_name": "NYSE:RDDT", "industry": "Semiconductors"}, "timeframe": "D",
            "bars": {"count": 500}, "source": {"text": TEXT, "sha256": _sha(TEXT), "declaredTitle": "Industry Flag"}}


def _row(prod=None, rton=None, subs=SUB):
    """A ledger row as `regrade` files it: each lane is the harness's verdict record."""
    cap = _capture()

    def lane(v):
        if not v:
            return None
        return {"verdict": v, "reason": "r", **({"substituted": subs} if subs is not None else {})}
    return el.make_row(capture=cap, capture_bytes=json.dumps(cap).encode("utf-8"),
                       verdicts={"production": lane(prod), "runtime-on": lane(rton)},
                       filed_by="regrade", licence="held", engine=ENGINE, grader="g" * 12,
                       stamp="2026-11-14T00:00:00Z")


SAMPLES = {"reference:industry-flag": el.source_shas(TEXT)}


# ── S1: the ledger ─────────────────────────────────────────────────────────────────

def test_S1_the_ledger_files_and_round_trips_MATCH_SUBSTITUTED_with_its_inputs(tmp_path):
    r = _row(prod="MATCH_SUBSTITUTED")
    assert el.row_problems(r) == []
    assert r["verdicts"]["production"] == {"verdict": "MATCH_SUBSTITUTED", "reason": "r", "substituted": FILED}
    path = tmp_path / "ledger.jsonl"
    assert el.append(path, [r]) == 1
    back = el.read_rows(path)
    assert back == [r]
    out = el.classify(back, SAMPLES, engine=ENGINE, lane="production")
    assert out["byKey"]["reference:industry-flag"]["verdicts"] == ["MATCH_SUBSTITUTED"]


def test_S1_a_MATCH_counter_given_only_MATCH_SUBSTITUTED_rows_counts_zero():
    only_sub = el.classify([_row(prod="MATCH_SUBSTITUTED")], SAMPLES, engine=ENGINE, lane="production")
    assert el.fresh_match_counts(only_sub) == {"match": 0, "matchSubstituted": 1}
    assert not el.is_match("MATCH_SUBSTITUTED") and el.is_match_substituted("MATCH_SUBSTITUTED")
    # control: the same row graded MATCH counts once, in the MATCH counter
    plain = el.classify([_row(prod="MATCH", subs=None)], SAMPLES, engine=ENGINE, lane="production")
    assert el.fresh_match_counts(plain) == {"match": 1, "matchSubstituted": 0}


@pytest.mark.parametrize("prod,subs,needle", [
    ("MATCH_SUBSTITUTED", None, "names no substituted inputs"),
    ("MATCH_SUBSTITUTED", [], "names no substituted inputs"),
    ("MATCH", SUB, "a MATCH lane carries substituted inputs"),
])
def test_S1_the_row_check_refuses_a_substitution_that_contradicts_its_verdict(prod, subs, needle):
    cap = _capture()
    lane = {"verdict": prod, "reason": "r", **({"substituted": subs} if subs is not None else {})}
    with pytest.raises(ValueError, match=needle):
        el.make_row(capture=cap, capture_bytes=json.dumps(cap).encode("utf-8"),
                    verdicts={"production": lane, "runtime-on": None}, filed_by="regrade", licence="held",
                    engine=ENGINE, grader="g" * 12, stamp="2026-11-14T00:00:00Z")


def test_S1_a_DIVERGE_under_a_substitution_keeps_its_inputs_and_stays_DIVERGE():
    r = _row(prod="DIVERGE")
    assert el.row_problems(r) == [] and r["verdicts"]["production"]["substituted"] == FILED
    out = el.classify([r], SAMPLES, engine=ENGINE, lane="production")
    assert out["byKey"]["reference:industry-flag"]["verdicts"] == ["DIVERGE"]


def test_S1_promote_files_the_substituted_inputs_from_the_runs_verdicts():
    src = (REPO / "tools" / "vendor_harness" / "evidence_engine.py").read_text(encoding="utf-8")
    assert '"substituted": (v or {}).get("substituted"),' in src
    assert '**({"substituted": i["substituted"]} if i.get("substituted") else {})' in src


# ── S2: the coverage map ──────────────────────────────────────────────────────────

def _scripts():
    return [{"key": "reference:industry-flag", "_items": {"ta.mom", "syminfo.industry", "plot", "strategy.entry"}}]


def _fold(rows, tmp_path):
    path = tmp_path / "evidence-ledger.jsonl"
    path.write_text("".join(json.dumps(r) + "\n" for r in rows), encoding="utf-8")
    scripts = _scripts()
    led = cm.ledger_evidence(str(path), scripts, {"reference:industry-flag": TEXT}.get, cm.LANE_PRODUCTION, ENGINE)
    cap_rows, verified, diverge, substituted = [], collections.Counter(), collections.Counter(), collections.Counter()
    cm.fold_ledger(scripts, led, cap_rows, verified, diverge, substituted)
    return cm.vendor_verdict_of(scripts[0]), verified, diverge, substituted


def test_S2_a_ledger_MATCH_SUBSTITUTED_is_its_own_bucket_never_verified_never_DIVERGE(tmp_path):
    verdict, verified, diverge, substituted = _fold([_row(prod="MATCH_SUBSTITUTED")], tmp_path)
    assert verdict == "MATCH_SUBSTITUTED"
    assert not verified and not diverge
    assert substituted["ta.mom"] == 1 and substituted["syminfo.industry"] == 1
    assert "strategy.entry" not in substituted
    # control: the same row graded MATCH is verified
    verdict, verified, diverge, substituted = _fold([_row(prod="MATCH", subs=None)], tmp_path)
    assert verdict == "MATCH" and verified["ta.mom"] == 1 and not substituted


def test_S2_credit_capture_without_a_substituted_counter_credits_nothing():
    v, d = collections.Counter(), collections.Counter()
    cm.credit_capture("MATCH_SUBSTITUTED", {"ta.mom"}, v, d)
    assert not v and not d


def test_S2_script_verdict_ranks_the_bucket_below_MATCH_and_below_DIVERGE():
    # (2026-11-19) any DIVERGE dominates: a substituted MATCH beside a DIVERGE is a DIVERGE (it read MATCH_SUBSTITUTED)
    assert cm.script_verdict(["MATCH_SUBSTITUTED"]) == "MATCH_SUBSTITUTED"
    assert cm.script_verdict(["MATCH_SUBSTITUTED", "DIVERGE"]) == "DIVERGE"
    assert cm.script_verdict(["MATCH_SUBSTITUTED", "INCONCLUSIVE"]) == "MATCH_SUBSTITUTED"
    assert cm.script_verdict(["MATCH_SUBSTITUTED", "MATCH"]) == "MATCH"
    assert cm.script_verdict(["DIVERGE", "INCONCLUSIVE"]) == "DIVERGE"
    assert cm.script_verdict([]) is None


def test_S2_verifiedTransfer_is_unchanged_and_the_new_bucket_reads_one():
    base = [{"clean": True, "vendorVerdict": "MATCH"}, {"clean": True, "vendorVerdict": "DIVERGE"},
            {"clean": False, "vendorVerdict": "MATCH"}, {"clean": True, "vendorVerdict": None}]
    before = cm.parity_counts(base, 5)
    assert before == {"verifiedTransfer": 1, "verifiedTransferPct": 20.0}           # byte-identical keys
    after = cm.parity_counts(base + [{"clean": True, "vendorVerdict": "MATCH_SUBSTITUTED"}], 5)
    assert after["verifiedTransfer"] == before["verifiedTransfer"] == 1
    assert after["verifiedTransferPct"] == before["verifiedTransferPct"]
    assert after["verifiedWithSubstitutedInputs"] == 1 and after["verifiedWithSubstitutedInputsPct"] == 20.0


def test_S2_the_main_loop_credits_committed_captures_through_the_same_rule():
    src = (REPO / "tools" / "pine_coverage" / "coverage_map.py").read_text(encoding="utf-8")
    assert 'credit_capture(r.get("verdict"), u["items"], verified_items, diverge_items, substituted_items)' in src
    assert "**parity_counts(scripts, N)," in src


# ── S3: the other MATCH readers keep excluding it ───────────────────────────────────

def test_S3_the_census_never_calls_a_substituted_script_matched():
    c = ee.Census({"scripts": [{"key": "a", "vendorVerdict": "MATCH_SUBSTITUTED"}, {"key": "b", "vendorVerdict": "MATCH"}]})
    assert not c.matched("a") and c.matched("b")


def test_S3_a_MATCH_SUBSTITUTED_fixture_un_pins_a_broker_rule():
    pins = {"schema": ee.PINS_SCHEMA, "rules": {"rule-x": ["cap-1"]}}
    out = ee.resolve_pins(pins, [{"captureId": "cap-1", "verdict": "MATCH_SUBSTITUTED"}], sources={})
    assert out["rules"] == {}


def test_S3_capability_evidence_never_counts_a_MATCH_SUBSTITUTED_ledger_row():
    inp = {"reference:flag": {"population": "reference", "hash": _sha(TEXT), "caps": ["core"]}}
    lanes = {"reference:flag": {"lane": "runtime"}}
    assert ca.ledger_runtime_evidence(inp, lanes, [_row(rton="MATCH_SUBSTITUTED")], set(), ENGINE) == {}
    # control: the same row graded MATCH is evidence
    assert ca.ledger_runtime_evidence(inp, lanes, [_row(rton="MATCH", subs=None)], set(), ENGINE) == \
        {"reference:flag": [(CID, "Industry Flag", ENGINE)]}


def test_S3_a_registry_evidence_entry_graded_MATCH_SUBSTITUTED_never_counts():
    e = {"capture": "c", "script": "s", "verdict": "MATCH_SUBSTITUTED", "runtimePane": "on"}
    assert not rg._pine_capability_evidence_counts("core", e)
    assert rg._pine_capability_evidence_counts("core", dict(e, verdict="MATCH"))


# ── S4: runtime admission ───────────────────────────────────────────────────────────

REG = {"a": {"status": "conformant", "evidence": ["cap-1"]}}
MS_ON = {"id": "cap-s", "verdict": "MATCH_SUBSTITUTED", "runtimePane": "on", "substituted": ["syminfo.industry"]}
MATCH_ON = {"id": "cap-m", "verdict": "MATCH", "runtimePane": "on"}
SUBST = {"capabilities": ["a"], "admission": "substituted", "substituted": ["syminfo.industry"], "captures": [MS_ON]}


def test_S4_a_MATCH_SUBSTITUTED_capture_admits_through_the_substituted_path():
    assert rg.pine_runtime_admission(SUBST, REG) == []
    assert rg.pine_runtime_substituted_inputs(SUBST) == ["syminfo.industry"]


def test_S4_it_never_admits_through_the_MATCH_path():
    reasons = rg.pine_runtime_admission({"capabilities": ["a"], "captures": [MS_ON]}, REG)
    assert any("no TradingView capture graded MATCH with the runtime pane on" in r for r in reasons)
    assert any("never admits on the MATCH path" in r and "admission: substituted" in r for r in reasons)
    assert rg.pine_runtime_substituted_inputs({"capabilities": ["a"], "captures": [MS_ON]}) == []
    # control: the R1 path is unchanged
    assert rg.pine_runtime_admission({"capabilities": ["a"], "captures": [MATCH_ON]}, REG) == []


@pytest.mark.parametrize("record,needle", [
    (dict(SUBST, captures=[MATCH_ON]), "no TradingView capture graded MATCH_SUBSTITUTED"),
    (dict(SUBST, captures=[dict(MS_ON, substituted=["syminfo.sector"])]), "exactly its substituted inputs"),
    (dict(SUBST, captures=[dict(MS_ON, runtimePane="off")]), "with the runtime pane on"),
    (dict(SUBST, captures=[{k: v for k, v in MS_ON.items() if k != "substituted"}]), "MATCH_SUBSTITUTED"),
    (dict(SUBST, substituted=[]), "names no substituted inputs"),
    (dict(SUBST, substituted=["x", "x"]), "names no substituted inputs"),
    ({k: v for k, v in SUBST.items() if k != "substituted"}, "names no substituted inputs"),
    (dict(SUBST, admission="uct"), "unknown admission path"),
    (dict(SUBST, capabilities=["zz"]), "`zz` is not in the conformance registry"),
])
def test_S4_the_substituted_path_withholds_by_name(record, needle):
    reasons = rg.pine_runtime_admission(record, REG)
    assert reasons and any(needle in r for r in reasons), reasons


# ── S5: the disclosure field ────────────────────────────────────────────────────────

def _allowlist(tmp_path, monkeypatch, scripts):
    doc = {"_readme": [], "scripts": scripts,
           "capabilities": {"a": {"status": "conformant", "evidence": ["cap-1"]}}}
    f = tmp_path / "allow.json"
    f.write_text(json.dumps(doc), encoding="utf-8")
    monkeypatch.setattr(rt, "ALLOWLIST_PATH", str(f))


def test_S5_a_served_substituted_script_discloses_its_names_and_an_R1_row_is_unchanged(tmp_path, monkeypatch):
    sub_sha, plain_sha = "a" * 64, "b" * 64
    _allowlist(tmp_path, monkeypatch, [dict(SUBST, slug="flag", sha256=sub_sha),
                                       {"slug": "plain", "sha256": plain_sha, "capabilities": ["a"], "captures": [MATCH_ON]}])
    rep = rt.allow_report(with_capabilities=False)
    assert rep["served"] == [{"slug": "flag", "sha256": sub_sha, "admission": "substituted", "substituted": ["syminfo.industry"]},
                             {"slug": "plain", "sha256": plain_sha}]
    assert rt.substituted_inputs() == {sub_sha: ["syminfo.industry"]}
    assert set(rt.graded_allow_list()) == {sub_sha, plain_sha}
    from api.routers import user_definitions as router
    got = router.runtime_kill(user={"id": "u1"})
    assert got["substituted"] == {sub_sha: ["syminfo.industry"]}


def test_S5_a_withheld_substituted_script_is_not_disclosed_as_served(tmp_path, monkeypatch):
    _allowlist(tmp_path, monkeypatch, [dict(SUBST, slug="flag", sha256="a" * 64, captures=[MATCH_ON])])
    assert rt.substituted_inputs() == {}
    assert rt.allow_report(with_capabilities=False)["served"] == []


def test_S5_by_default_nothing_is_substituted_and_the_kill_read_is_unchanged(tmp_path, monkeypatch):
    """A list with no record on the substituted path discloses nothing, and the key is ABSENT."""
    _allowlist(tmp_path, monkeypatch, [{"slug": "plain", "sha256": "d" * 64, "capabilities": ["a"], "captures": [
        {"id": "p-rddt", "verdict": "MATCH", "runtimePane": "on"}]}])
    assert rt.substituted_inputs() == {}
    assert all("substituted" not in r and "admission" not in r for r in rt.allow_report(with_capabilities=False)["served"])
    from api.routers import user_definitions as router
    assert "substituted" not in router.runtime_kill(user={"id": "u1"})


def test_S5b_the_committed_list_discloses_RS_Ratings_one_substituted_input_and_no_others():
    """RS Rating (fred6724), admitted 2026-11-16: the ONE committed record on the substituted path.
    Any other committed record on that path, or any other disclosed name, fails here by name."""
    doc = json.loads(pathlib.Path(rt.ALLOWLIST_PATH).read_text(encoding="utf-8"))
    assert [s["slug"] for s in doc["scripts"] if "admission" in s] == ["rs-rating-fred6724"]
    rs = "caa94fe31a8788c0f52ca571dbb1b3f8a7499dae913ed5e710720fc8662c5af0"
    assert rt.substituted_inputs() == {rs: ["syminfo.industry"]}
    from api.routers import user_definitions as router
    assert router.runtime_kill(user={"id": "u1"})["substituted"] == {rs: ["syminfo.industry"]}
