"""HOST KNOWN-DIVERGENCE (owner decision 2026-11-17): the host lane's twin of the runtime kill list.

Run ONLY this file:  python -m pytest tests/test_pine_host_known_divergence.py -q -p no:cacheprovider

  * the committed list IS the derivation (every script with a committed production capture grading
    DIVERGE), and the rail fails BOTH ways, naming the script, with a control proving the scan sees a DIVERGE;
  * a listed script is refused BY NAME at every server door (save, served rows, alerts, scans, backtests,
    the scannable stamp), with a control that an unlisted script is not;
  * the census predicates do not count a listed script as transferring.
The browser doors (member preview, install) are railed in
`app/src/components/chart/engine/hostKnownDivergence.test.js`.
"""
from __future__ import annotations

import copy
import json
import pathlib
import sys

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools" / "vendor_harness"))
sys.path.insert(0, str(ROOT / "tools" / "pine_coverage"))

import host_divergence as hd  # noqa: E402
import coverage_map as CM  # noqa: E402

from api.services import host_known_divergence as hkd  # noqa: E402
from api.services import runtime_definitions as rt  # noqa: E402
from api.services import user_definitions as svc  # noqa: E402

#: listed: both committed production captures (RDDT and SPY daily) grade DIVERGE, TradingView holds 31 table cells and
#: ours 30. (contraction-box-doji-lines stood here until engine 78 (#1858), Pine's tolerant compare, re-graded both
#: its SPY captures to MATCH and its entry was lifted.)
LISTED = (ROOT / "corpus" / "committed" / "heat-map-seasons__53acdf3223.pine").read_text(encoding="utf-8")
#: not listed: both committed production captures grade MATCH
CONTROL = (ROOT / "corpus" / "committed" / "atr-bands__ad60b125e6.pine").read_text(encoding="utf-8")


# ═══ the list is the derivation, both ways ═══════════════════════════════════════

def test_the_committed_list_is_the_derivation_and_the_queue_doc_is_its_rendering():
    derived = hd.derive()
    assert len(derived) >= 1
    assert hd.disagreements(hd.committed(), derived) == []
    every = hd.derive_all()
    assert set(derived) < set(every)                                    # withheld-only scripts: rows, not listed
    assert hd.QUEUE_DOC.read_text(encoding="utf-8") == hd.render_queue(every)
    # every entry is held to its evidence: its source file hashes to it, and each named capture is a
    # committed production DIVERGE of THAT source
    v = {r["id"]: r for r in json.loads(hd.VERDICTS.read_text(encoding="utf-8"))["results"]}
    for sha, e in hd.committed().items():
        assert hd.source_hash((ROOT / e["source"]).read_text(encoding="utf-8")) == sha, e["slug"]
        assert e["reason"] and e["liftWhen"], e["slug"]
        for c in e["evidence"]["diverge"]:
            assert any(r["verdict"] == "DIVERGE" for rid, r in v.items() if rid == c["capture"]), (e["slug"], c)


def test_the_rail_fails_when_a_DIVERGE_script_is_missing_from_the_list():
    committed = hd.committed()
    sha = hd.source_hash(LISTED)
    assert sha in committed
    probs = hd.disagreements({k: v for k, v in committed.items() if k != sha}, hd.derive())
    assert probs and all("heat-map-seasons" in p and p.startswith("NOT LISTED") for p in probs), probs


def test_the_rail_fails_when_the_list_holds_a_script_no_capture_witnesses():
    committed = dict(hd.committed())
    committed["f" * 64] = {"slug": "synthetic-stale", "sha256": "f" * 64}
    probs = hd.disagreements(committed, hd.derive())
    assert probs == [f"STALE: synthetic-stale ({'f' * 12}) is listed but no committed capture of it grades DIVERGE "
                     "with a drawn difference on the production lane (its liftWhen is met: --write drops it)"]


def _drawn_plot_divergence():
    return {"id": "plot_x", "title": "SYNTHETIC", "verdict": "DIVERGE", "reason": "1 steady-state bars disagree"}


def test_CONTROL_the_scan_sees_a_DIVERGE_and_lifts_on_a_regrade(tmp_path):
    """A MATCH script's capture re-graded DIVERGE (a drawn plot) is named; a listed script's only DIVERGE
    re-graded MATCH is dropped (its liftWhen). Proves the scan reads the verdicts, not a constant."""
    doc = json.loads(hd.VERDICTS.read_text(encoding="utf-8"))
    control_sha = hd.source_hash(CONTROL)
    assert control_sha not in hd.derive()
    moved = copy.deepcopy(doc)
    for r in moved["results"]:
        if r["id"] == "atr-bands-spy-1d-2026-10-03":
            r["verdict"] = "DIVERGE"
            r["plots"] = list(r.get("plots") or []) + [_drawn_plot_divergence()]
        if r["id"] == "vw-fmt-tie-readings-rddt-1d-2026-11-15":
            r["verdict"] = "MATCH"
    f = tmp_path / "verdicts.json"
    f.write_text(json.dumps(moved), encoding="utf-8")
    d = hd.derive(f)
    assert control_sha in d and d[control_sha]["slug"] == "atr-bands"
    tie = hd.source_hash((ROOT / "tools" / "visual_conformance" / "probes" / "vw-fmt-tie-readings.pine")
                         .read_text(encoding="utf-8"))
    assert tie in hd.derive() and tie not in d
    probs = hd.disagreements(hd.committed(), d)
    assert any(p.startswith("NOT LISTED: atr-bands") for p in probs)
    assert any(p.startswith("STALE: vw-fmt-tie-readings") for p in probs)


SONARLAB = (ROOT / "corpus" / "committed" / "sonarlab-order-blocks__0df0d45ee6.pine").read_text(encoding="utf-8")


def test_a_WITHHELD_ONLY_divergence_is_not_listed_and_one_drawn_difference_lists_it(tmp_path):
    """Coordinator ruling on #1541: a capture whose only difference is objects this lane already withholds BY
    NAME (sonarlab-order-blocks on AAPL: 17 boxes withheld off the listing, plots not shown to differ) does not
    list its script; it keeps its queue row, marked. CONTROL: the SAME capture with one drawn difference lists it."""
    sha = hd.source_hash(SONARLAB)
    every = hd.derive_all()
    assert sha in every and [c["kind"] for c in every[sha]["evidence"]["diverge"]] == ["withheld"]
    assert not hd.is_listed(every[sha]) and sha not in hd.derive() and sha not in hd.committed()
    assert hkd.refused(SONARLAB) is None
    row = next(x for x in hd.QUEUE_DOC.read_text(encoding="utf-8").splitlines()
               if x.startswith(f"| {hd.queue_row_id('sonarlab-order-blocks')} | engine-gap |"))
    assert "withheld by name, not listed" in row
    moved = json.loads(hd.VERDICTS.read_text(encoding="utf-8"))
    for r in moved["results"]:
        if r["id"] == "sonarlab-order-blocks-aapl-1d-2026-10-02":
            r["plots"] = list(r.get("plots") or []) + [_drawn_plot_divergence()]
    f = tmp_path / "verdicts.json"
    f.write_text(json.dumps(moved), encoding="utf-8")
    d = hd.derive(f)
    assert sha in d and hd.is_listed(d[sha])
    assert any(c["kind"] == "drawn" for c in d[sha]["evidence"]["diverge"])


HTF = (ROOT / "corpus" / "committed" / "htf-candle-footprint-cartel-console__ca3ff4e904.pine").read_text(encoding="utf-8")
HTF_CAPTURES = ("htf-candle-footprint-cartel-console-rddt-1d-2026-09-28", "htf-candle-footprint-cartel-console-spy-1d-2026-10-03")


def _htf_regraded(tmp_path, partial_guard):
    """The committed verdicts with htf's two captures graded the way the vendor harness grades them since the
    disclosed-partial fix: INCONCLUSIVE, its lines and labels withheld whole by name, its boxes a disclosed partial."""
    moved = json.loads(hd.VERDICTS.read_text(encoding="utf-8"))
    for r in moved["results"]:
        if r["id"] in HTF_CAPTURES:
            r["verdict"] = "INCONCLUSIVE"
            r["objects"] = {**(r.get("objects") or {}), "verdict": "INCONCLUSIVE",
                            "withheld": f"objects:not-carried,{partial_guard}"}
            r.pop("objectsV2", None)
    f = tmp_path / f"verdicts-{partial_guard.replace(':', '-')}.json"
    f.write_text(json.dumps(moved), encoding="utf-8")
    return f


def test_a_partial_whose_place_no_capture_witnessed_keeps_its_entry_and_x_agreeing_drops_it(tmp_path):
    """Coordinator ruling 2026-11-19: never lift a withhold on a field no capture witnessed. htf-candle-footprint's
    3 drawn boxes agree with TradingView's on every field its 09-28 / 10-03 captures hold, but those captures predate
    the x table: graded `objects:partial-unpositioned`, the script STAYS listed, and only a capture with the x table
    (graded `objects:partial`, its place agreeing) lifts it."""
    sha = hd.source_hash(HTF)
    assert sha in hd.derive()                                        # listed today
    kept = hd.derive(_htf_regraded(tmp_path, hd.UNPOSITIONED))
    assert sha in kept and hd.is_listed(kept[sha])
    assert {c["kind"] for c in kept[sha]["evidence"]["diverge"]} == {"unpositioned"}
    assert "x table" in kept[sha]["liftWhen"] and "where they sit" in kept[sha]["reason"]
    row = next(x for x in hd.render_queue(hd.derive_all(_htf_regraded(tmp_path, hd.UNPOSITIONED))).splitlines()
               if x.startswith(f"| {hd.queue_row_id('htf-candle-footprint-cartel-console')} | withheld-ledger |"))
    assert "re-capture WITH the x table" in row
    # CONTROL: the same captures with the place witnessed and agreeing (`objects:partial`) lift it
    assert sha not in hd.derive(_htf_regraded(tmp_path, "objects:partial"))


# ═══ the server doors ════════════════════════════════════════════════════════════

def test_the_reader_names_a_listed_script_and_not_an_unlisted_one():
    why = hkd.refused(LISTED)
    assert why and why.startswith(hkd.GUARD + ":") and "TradingView 31, ours 30" in why and "withheld until that is fixed" in why
    assert "capture heat-map-seasons-rddt-1d-2026-09-28" in why and "\u2014" not in why
    assert hkd.refused(LISTED.replace("\n", "\r\n"))                    # the CRLF form is the same script
    assert hkd.refused(CONTROL) is None
    assert hkd.LIST_PATH == str(hd.LIST)                                # ONE authority: the file the browser imports
    assert set(hkd.committed()) == set(hd.committed())


def test_a_broken_list_file_lists_nothing_extra(tmp_path, monkeypatch):
    for content in ("{ not json", "[]", '{"scripts": [{"sha256": "zz"}]}'):
        f = tmp_path / "hk.json"
        f.write_text(content, encoding="utf-8")
        monkeypatch.setattr(hkd, "LIST_PATH", str(f))
        assert hkd.committed() == {}, content
        assert hkd.refused(LISTED) is None


SCRIPT_ID = "u_00000000c0de"


def _defn(def_id=SCRIPT_ID):
    return {
        "schemaVersion": 1, "id": def_id, "version": 1,
        "meta": {"name": "Listed", "shortName": "LS", "repaint": "non-repainting", "recurrenceOrigin": "pine"},
        "compute": {"kind": "ast", "ast": {"type": "call", "name": "sma", "args": [
            {"type": "series", "name": "close"}, {"type": "num", "value": 20}]}},
        "placement": {"target": "price"},
        "plots": [{"key": "value", "style": "line", "role": "primary"}],
        "inputs": [],
    }


@pytest.fixture
def store(tmp_path, monkeypatch):
    from api.services import alert_rev_migration as rev
    from api.services import indicator_alert_service as ias
    monkeypatch.setattr(svc, "_DB_PATH", str(tmp_path / "user_definitions.db"))
    svc._init_db()
    alert_db = tmp_path / "auth.db"
    monkeypatch.setenv("AUTH_DB_PATH", str(alert_db))
    monkeypatch.setattr(ias, "_DB_PATH", str(alert_db))
    ias.init_schema()
    rev.init_schema()
    return tmp_path


def _list_naming(tmp_path, source, slug="synthetic-subject"):
    f = tmp_path / "hk-synthetic.json"
    f.write_text(json.dumps({"scripts": [{"slug": slug, "sha256": hkd.source_hash(source),
                                          "reason": "SYNTHETIC divergence for the by-name rails"}]}), encoding="utf-8")
    return str(f)


def test_a_listed_script_is_refused_by_name_at_every_server_door(store, tmp_path, monkeypatch):
    from api.routers import user_definitions as router_mod
    from api.services import alert_user_series as aus
    from api.services.screener import scan_run
    # CONTROL first: unlisted, the row saves, is served unstamped, and every lane admits it
    monkeypatch.setattr(hkd, "LIST_PATH", str(tmp_path / "absent.json"))
    svc.save("u1", SCRIPT_ID, _defn(), pine_source=CONTROL)
    row = svc.get("u1", SCRIPT_ID)
    assert "host_known_divergence" not in row
    assert svc.engine_withheld_reason(row) is None
    assert hkd.STAMP not in rt.stamp_served(row)["definition"]["meta"]
    aus._gate_engine(row, SCRIPT_ID)                                      # no raise
    assert scan_run._load_definition("u1", SCRIPT_ID)
    assert router_mod._stamped(row)["scan_refusal"] is None or router_mod._stamped(row)["scan_refusal"]["gate"] != "withheld"
    # LISTED (a synthetic list naming the stored script): refused by name at every door; nothing deleted
    monkeypatch.setattr(hkd, "LIST_PATH", _list_naming(tmp_path, CONTROL))
    row = svc.get("u1", SCRIPT_ID)
    why = row["host_known_divergence"]
    assert why.startswith(hkd.GUARD + ":") and "SYNTHETIC" in why
    assert svc.engine_withheld_reason(row) == why                        # alerts, sweep, on-demand, backtests
    assert rt.stamp_served(row)["definition"]["meta"][hkd.STAMP] == why  # served rows -> the install door
    assert hkd.STAMP not in row["definition"]["meta"]                    # the stored row is untouched
    with pytest.raises(aus.AdmissionRefused) as exc:
        aus._gate_engine(row, SCRIPT_ID)
    assert "SYNTHETIC" in str(exc.value)
    with pytest.raises(scan_run.RunRefused):
        scan_run._load_definition("u1", SCRIPT_ID)
    st = router_mod._stamped(row)
    assert st["scannable"] is False and st["scan_refusal"]["gate"] == "withheld"
    with pytest.raises(svc.SaveRefused) as exc:                           # the save door
        svc.save("u1", SCRIPT_ID, _defn(), pine_source=CONTROL)
    assert exc.value.guard == hkd.GUARD and "SYNTHETIC" in str(exc.value)
    assert svc.get("u1", SCRIPT_ID)["version"] == 1                       # nothing written
    # a runtime document is the runtime lane's: the host list does not stamp it
    assert not hkd.applies_to({"compute": {"kind": "runtime", "source": CONTROL}})


def test_a_stamp_a_client_wrote_back_is_dropped_when_unlisted(store, tmp_path, monkeypatch):
    monkeypatch.setattr(hkd, "LIST_PATH", str(tmp_path / "absent.json"))
    d = _defn()
    d["meta"][hkd.STAMP] = "stale"
    svc.save("u1", SCRIPT_ID, d, pine_source=CONTROL)
    served = rt.stamp_served(svc.get("u1", SCRIPT_ID))
    assert hkd.STAMP not in served["definition"]["meta"]


# ═══ the census ═══════════════════════════════════════════════════════════════════

def test_the_census_does_not_count_a_listed_script_as_transferring():
    u = CM.order_usage_of(LISTED)
    clean = {"clean": True, "attached": True, "steps": [{"lane": "host", "attached": True}]}
    assert CM.is_host_listed(LISTED) and CM.is_host_listed(LISTED.replace("\n", "\r\n"))
    assert CM.transfers_fully(clean, u, LISTED) is False
    assert CM.runtime_on_transfers(clean, False, False, CM.is_host_listed(LISTED)) is False
    # CONTROL: the same row of an unlisted script transfers on both lanes
    assert CM.transfers_fully(clean, CM.order_usage_of(CONTROL), CONTROL) is True
    assert CM.runtime_on_transfers(clean, False, False, CM.is_host_listed(CONTROL)) is True
    # a runtime ATTACH of a host-listed script is the runtime lane's to judge (its own kill list)
    rt_row = {"clean": False, "attached": True, "steps": [{"lane": "runtime", "attached": True}]}
    assert CM.runtime_on_transfers(rt_row, False, False, True) is True
    assert CM.runtime_on_transfers(rt_row, False, True, True) is False
    assert CM.host_listed_hashes() == frozenset(hd.committed())


def test_the_ratchet_names_the_list_as_the_wall():
    import coverage_ratchet as R
    clean = {"clean": True, "attached": True, "steps": [{"lane": "host", "attached": True}]}
    assert R.transfers("production", clean, LISTED) is False
    assert "host known-divergence list" in R.wall_of("production", clean, LISTED)
    assert R.transfers("production", clean, CONTROL) is True
