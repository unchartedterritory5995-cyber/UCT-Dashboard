"""Exchange Breadth V1 — LIVE LEG: first-containing vintage, Bridge in the live path (with a bite check),
partitions, derived continuation, the atomic candidate store (restart / idempotency / crash), pin set."""
import hashlib
import json
import os
import shutil
import sqlite3
import subprocess
import sys

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TOOLS = os.path.join(ROOT, "tools", "breadth_exch")
sys.path.insert(0, TOOLS)
sys.path.insert(0, os.path.join(TOOLS, "identity"))
import identity_model as im  # noqa: E402
import live_core as lc  # noqa: E402

FX = json.load(open(os.path.join(ROOT, "tests", "fixtures", "exchange_identity_regression.json")))
LROWS = json.load(open(os.path.join(ROOT, "tests", "fixtures", "exchange_live_bridge_ledger_rows.json")))["rows"]
S = FX["sessions"]


# ── first-containing (owner) vintage ─────────────────────────────────────────────────────────────
def _vintage(archive, tag, manifest=b'{"tag":"x"}', ref=b'{"A":[]}'):
    vd = os.path.join(archive, tag)
    os.makedirs(os.path.join(vd, "inputs_" + tag))
    os.makedirs(os.path.join(vd, "grouped_" + tag))
    open(os.path.join(vd, "inputs_" + tag, "INPUT_MANIFEST.json"), "wb").write(manifest)
    open(os.path.join(vd, "inputs_" + tag, "pit_reference.json"), "wb").write(ref)
    open(os.path.join(vd, "grouped_" + tag, "2026-09-29_0.json"), "wb").write(b"[]")
    with open(os.path.join(archive, tag + ".SHA256SUMS"), "w") as f:
        for rel in sorted(["./inputs_%s/INPUT_MANIFEST.json" % tag, "./inputs_%s/pit_reference.json" % tag,
                           "./grouped_%s/2026-09-29_0.json" % tag]):
            f.write("%s  %s\n" % (lc.sha_file(os.path.join(vd, rel)), rel))
    return hashlib.sha256(manifest).hexdigest(), hashlib.sha256(ref).hexdigest()


def _prod(tag, d, mh, rh):
    pid = f"{d}-{tag}-abcdef0123"
    return {d: ("CURRENT", tag, pid)}, {d: (pid, {"vintage_tag": tag, "input_manifest_sha256": mh, "reference_sha256": rh})}


def test_owner_vintage_is_the_publishing_vintage_and_is_hash_verified(tmp_path):
    a = str(tmp_path)
    mh, rh = _vintage(a, "p202609302026")
    ps, pp = _prod("p202609302026", "2026-09-29", mh, rh)
    v = lc.owner_vintage("2026-09-29", ps, pp, a)
    assert v["tag"] == "p202609302026" and v["input_manifest_sha256"] == mh


def test_a_later_vintage_containing_the_session_is_never_used(tmp_path):
    # Vintage A first contains S; vintage B (later, enriched reference) also contains S. S stays on A —
    # and if A is gone, S REFUSES rather than falling forward to B.
    a = str(tmp_path)
    mh, rh = _vintage(a, "p202609302026")
    _vintage(a, "p202610022300", manifest=b'{"tag":"y"}', ref=b'{"A":[{"delisted_utc":"2026-09-30"}]}')
    ps, pp = _prod("p202609302026", "2026-09-29", mh, rh)
    assert lc.owner_vintage("2026-09-29", ps, pp, a)["tag"] == "p202609302026"
    shutil.rmtree(os.path.join(a, "p202609302026"))
    with pytest.raises(lc.Refused) as e:
        lc.owner_vintage("2026-09-29", ps, pp, a)
    assert e.value.reason == "OWNER_VINTAGE_MISSING"


@pytest.mark.parametrize("case,reason", [("unpublished", "NOT_YET_PUBLISHED"), ("noprov", "PROVENANCE_MISSING"),
                                         ("inconsistent", "PROVENANCE_INCONSISTENT"), ("hash", "PROVENANCE_MISMATCH"),
                                         ("bytes", "ARCHIVE_INTEGRITY")])
def test_owner_vintage_fails_closed(tmp_path, case, reason):
    a = str(tmp_path)
    mh, rh = _vintage(a, "p202609302026")
    ps, pp = _prod("p202609302026", "2026-09-29", mh, rh)
    if case == "unpublished":
        ps = {"2026-09-29": ("WAITING", None, None)}
    elif case == "noprov":
        pp = {}
    elif case == "inconsistent":
        pp["2026-09-29"][1]["vintage_tag"] = "p202610012031"     # two vintages claim the session
    elif case == "hash":
        pp["2026-09-29"][1]["reference_sha256"] = "0" * 64
    elif case == "bytes":
        open(os.path.join(a, "p202609302026", "grouped_p202609302026", "2026-09-29_0.json"), "wb").write(b"[1]")
    with pytest.raises(lc.Refused) as e:
        lc.owner_vintage("2026-09-29", ps, pp, a)
    assert e.value.reason == reason


# ── Bridge in the LIVE path + bite check ──────────────────────────────────────────────────────────
@pytest.fixture(scope="module")
def doc():
    st = im.IdentityState(S)
    days = {}
    for t, runs in FX["observations"].items():
        for i0, i1, ident, kb, cik, figi in runs:
            for i in range(i0, i1 + 1):
                days.setdefault(i, []).append((t, ident, cik, figi))
    for i in sorted(days):
        st.observe(i, days[i], "LEDGER")
    return st.to_doc()


# (ticker, session, expected SID, expected status, the raw key a LATER snapshot would hand the live leg)
CASES = [
    ("DBRG", "2026-09-24", "DBRG@2021-06-22", "NYSE", "DBRG|2026-10-01"),       # delisting-date enrichment
    ("TBPH", "2026-09-23", "TBPH@2014-06-03", "NASDAQ", "TBPH|2026-09-24"),     # enrichment, delisted next day
    ("FFR", "2026-09-30", "QLGN@2020-05-26", "NASDAQ", "FFR|active"),           # rename AIXC -> FFR
    ("FGC", "2026-09-28", "FGF@2020-12-17", "NASDAQ", "FGC|2012-12-11"),        # FGC: frozen ref = an old SP record
    ("ACI", "2016-01-11", "ACI@2008-01-02", "NYSE", "ACI|active"),              # ACI: Arch Coal
    ("ACI", "2020-06-26", "ACI@2020-06-26", "NYSE", "ACI|active"),              # ACI: Albertsons
    ("META", "2022-01-28", "META@2021-06-30", "OTHER", "META|active"),          # META: the ETF (Arca)
    ("META", "2022-06-09", "META@2022-06-09", "NASDAQ", "META|active"),         # META: Meta Platforms
    ("AA", "2016-10-31", "AA@2008-01-02", "NYSE", "AA|active"),                 # AA before the spin-off
    ("AA", "2016-11-01", "AA@2016-11-01", "NYSE", "AA|active"),                 # AA after
    ("BRK.A", "2026-10-01", "BRK.A@2008-01-02", "NYSE", "BRK.A|active"),
    ("BRK.B", "2026-10-01", "BRK.B@2008-01-02", "NYSE", "BRK.B|active"),
]


class RawKeyBridge:
    """The PRE-GATE live lookup: the vintage's own `ticker|delisted_utc` decides (what the bite restores)."""

    def __init__(self, rows, raw):
        self.rows, self.raw = {}, raw
        for r in rows:
            self.rows.setdefault(r[0], []).append((r[2], r[3], r[4]))

    def status(self, t, d):
        k = self.raw[(t, d)]
        if k not in self.rows:
            return k, k, "absent"
        cov = [s for f, tt, s in self.rows[k] if f <= d <= tt]
        return k, k, cov[0] if len(cov) == 1 else "UNRESOLVED"

    def sid(self, t, d):
        return self.raw[(t, d)]


def live_path(bridge):
    """(sid, status) for every case, computed by THE live leg's membership function."""
    out = {}
    for t, d, *_ in CASES:
        sid, _key, status, _src = lc.membership_status(t, d, bridge, "2026-10-01", None)
        out[(t, d)] = (sid, status)
    return out


def check(results):
    for t, d, sid, status, _raw in CASES:
        assert results[(t, d)] == (sid, status), (t, d, results[(t, d)])


def test_live_path_resolves_through_the_bridge(doc):
    check(live_path(im.Bridge(doc, LROWS)))


def test_bite_the_raw_key_live_path_fails_the_same_test(doc):
    raw = {(t, d): r for t, d, _s, _st, r in CASES}
    with pytest.raises(AssertionError):
        check(live_path(RawKeyBridge(LROWS, raw)))


def test_live_evidence_decides_after_the_ledger_and_never_the_vintage_key(doc):
    br = im.Bridge(doc, LROWS)
    live = {"DBRG": {"status": "NYSE", "source": "dated+tape"}}
    assert lc.membership_status("DBRG", "2026-10-02", br, "2026-10-01", live)[2:] == ("NYSE", "live:dated+tape")
    assert lc.membership_status("BRK.A", "2026-10-02", br, "2026-10-01", live)[2] == "UNRESOLVED"


# ── partitions ───────────────────────────────────────────────────────────────────────────────────
def test_only_nyse_and_nasdaq_enter_and_counts_reconcile():
    us = ["A", "B", "C", "D", "E", "F"]
    st = {"A": "NYSE", "B": "NASDAQ", "C": "OTHER", "D": "UNRESOLVED", "E": "CONFLICT", "F": "absent"}
    ny, na, c = lc.partition(us, st, "2026-10-02", "2009-06-11", "2008-01-02")
    assert (ny, na) == (["A"], ["B"]) and sum(c[k] for k in c if k != "us") == c["us"] == 6
    ny, na, c = lc.partition(us, st, "2009-06-10", "2009-06-11", "2008-01-02")
    assert ny == [] and na == ["B"]                     # NYSE before its canonical start never enters


# ── derived continuation ─────────────────────────────────────────────────────────────────────────
def test_derive_step_is_bit_exact_with_the_locked_engine_and_frozen_derivation():
    sys.path.insert(0, ROOT)
    import derive_exchange_series as dx
    import random
    rnd = random.Random(7)
    n = 300
    import datetime as dt
    dates = [(dt.date(2020, 1, 1) + dt.timedelta(days=i)).isoformat() for i in range(n)]
    adv = [rnd.randint(300, 1500) for _ in range(n)]
    dec = [rnd.randint(300, 1500) for _ in range(n)]
    ref = dx.derive(dates, adv, dec)
    stt = {"ad": None, "ema_fast": None, "ema_slow": None, "valid_obs": 0, "mcs": None}
    for i in range(n):
        stt, out = lc.derive_step(stt, adv[i], dec[i])
        assert (out["AD"], out["MCO"], out["MCS"]) == (ref["AD"][i], ref["MCO"][i], ref["MCS"][i]), i
    assert ref["epoch"] == dates[120]                   # publish on the 121st valid observation


def test_derive_step_hole_holds_and_resuming_from_state_equals_full_history():
    stt = {"ad": 10.0, "ema_fast": 3.0, "ema_slow": 1.0, "valid_obs": 500, "mcs": 7.0}
    s2, out = lc.derive_step(stt, None, None)
    assert s2 == stt and out == {"AD": 10.0, "MCO": None, "MCS": 7.0}
    s3, out = lc.derive_step(stt, 5, 5)                 # A == D: R = 0, trends still advance
    assert s3["valid_obs"] == 501 and out["MCO"] == 0.9 * 3.0 - 0.95 * 1.0


# ── the atomic store: sequence, restart idempotency, crash safety ───────────────────────────────
def _payload(d, n=3):
    rows = [("nyse", d, f"m{i}", 1.0, 2.0, 0.5, 1.5, "s") for i in range(n)]
    return {"rows": rows, "counts": {"us": 1}, "membership": [(d, "X", "X@2026", "NYSE", "ledger", "X|active")],
            "evidence": [], "derived": [("NYSE:AD", d, 1.0)], "trend": [("NYSE", d, 1.0, 0.1, 0.05, 121, 0.0)],
            "vintage": "pV", "input_manifest_sha256": "a", "reference_sha256": "b", "us_v2_pub_id": f"{d}-pV-x",
            "venue_source": "ledger", "rows_sha256": lc.rows_sha(rows), "membership_sha256": "m", "derived_sha256": "x",
            "identity_state_sha256": "i", "provenance": {}, "completed_at": "now"}


def test_store_sequence_restart_idempotency_and_exactly_one_new_session(tmp_path):
    p = str(tmp_path / "c.db")
    s = lc.Store(p)
    s.init_lineage({"historical_sha256": "e65b"})
    plan = ["2026-09-25", "2026-09-28", "2026-09-29"]
    with pytest.raises(lc.Refused):
        s.commit_session("2026-09-28", plan[0], _payload("2026-09-28"))      # no holes
    for d in plan[:2]:
        s.commit_session(d, plan[len(s.completed())], _payload(d))
    h = s.logical_sha256()
    s2 = lc.Store(p)                                                          # restart, no new input
    assert s2.completed() == plan[:2] and s2.logical_sha256() == h
    with pytest.raises(lc.Refused):
        s2.commit_session("2026-09-28", "2026-09-28", _payload("2026-09-28"))  # never re-appends
    s2.commit_session("2026-09-29", plan[len(s2.completed())], _payload("2026-09-29"))
    assert s2.completed() == plan
    assert s2.c.execute("SELECT COUNT(*) FROM breadth_daily_ohlc").fetchone()[0] == 9
    assert s2.c.execute("SELECT COUNT(*) FROM derived_series").fetchone()[0] == 3
    with pytest.raises(lc.Refused):
        s2.init_lineage({"historical_sha256": "other"})                       # lineage is fixed


@pytest.mark.parametrize("point", ["during_rows", "before_derived", "after_rows_before_marker"])
def test_crash_inside_the_commit_never_exposes_a_partial_session(tmp_path, point):
    p = str(tmp_path / "c.db")
    pj = tmp_path / "payloads.json"
    pj.write_text(json.dumps({d: _payload(d) for d in ("2026-09-25", "2026-09-28")}))
    lines = [
        "import sys, os, json",
        "sys.path.insert(0, %r)" % TOOLS,
        "import live_core as lc",
        "P = json.load(open(%r))" % str(pj),
        "T = ('rows', 'membership', 'derived', 'trend')",
        "fix = lambda x: dict(x, **{k: [tuple(r) for r in x[k]] for k in T})",
        "s = lc.Store(%r)" % p,
        "s.commit_session('2026-09-25', '2026-09-25', fix(P['2026-09-25']))",
        "def c(x):",
        "    if x == %r: os._exit(97)" % point,
        "s.commit_session('2026-09-28', '2026-09-28', fix(P['2026-09-28']), crash=c)",
    ]
    script = tmp_path / "crash.py"
    script.write_text("\n".join(lines) + "\n")
    r = subprocess.run([sys.executable, str(script)], cwd=str(tmp_path))
    assert r.returncode == 97                                                 # killed mid-transaction
    s = lc.Store(p)
    assert s.completed() == ["2026-09-25"]
    for t in lc.CONTENT_TABLES:
        assert s.c.execute(f"SELECT COUNT(*) FROM {t} WHERE date='2026-09-28'").fetchone()[0] == 0
    s.commit_session("2026-09-28", "2026-09-28", _payload("2026-09-28"))     # recomputed cleanly
    assert s.completed() == ["2026-09-25", "2026-09-28"]


# ── the explicit exchange pin set ────────────────────────────────────────────────────────────────
def test_exchange_pin_set_differs_from_v2c2_in_exactly_the_declared_three_values():
    v2 = json.loads(open(os.path.join(TOOLS, "..", "breadth_v2", "pinned", "breadth_v2c2_pins.json"), "rb").read()
                    .replace(b"\r\n", b"\n"))
    ex = json.load(open(os.path.join(TOOLS, "pinned", "breadth_exch_live_pins.json")))
    decl = ex.pop("exchange_live_pin_set")
    diffs = []
    for k in set(v2) | set(ex):
        if isinstance(v2.get(k), dict) and isinstance(ex.get(k), dict):
            diffs += [f"{k}.{kk}" for kk in set(v2[k]) | set(ex[k]) if v2[k].get(kk) != ex[k].get(kk)]
        elif v2.get(k) != ex.get(k):
            diffs.append(k)
    assert sorted(diffs) == sorted(decl["overrides"]) == ["modules_md5_lf.breadth_live.py",
                                                          "modules_md5_lf.breadth_metrics.py", "registries.metrics"]
    for k, o in decl["overrides"].items():
        sect, key = k.split(".", 1)
        assert v2[sect][key] == o["v2c2"] and ex[sect][key] == o["exchange"]


_PROBE = r"""
import sys, json
sys.path.insert(0, __ROOT__)
import api.services
api.services.__path__.insert(0, __PIN__)
from api.services import breadth_corrected_pass as cp
cp.PINS_PATH = __PINS__
pf = cp.preflight(__EMPTY__)
print(json.dumps([p for p in pf["problems"] if "mismatch" in p]))
"""


@pytest.mark.parametrize("pins,mutate,expect", [("exch", False, 0), ("v2c2", False, 3), ("exch", True, 1)])
def test_preflight_with_the_exchange_pin_set(tmp_path, pins, mutate, expect):
    pin_dir = os.path.join(TOOLS, "pinned")
    if mutate:                                   # any unrecognised change still refuses
        pin_dir = str(tmp_path / "pinned")
        shutil.copytree(os.path.join(TOOLS, "pinned"), pin_dir, ignore=shutil.ignore_patterns("__pycache__"))
        with open(os.path.join(pin_dir, "breadth_ticker.py"), "a") as f:
            f.write("\n# drift\n")
    pins_path = os.path.join(TOOLS, "pinned", "breadth_exch_live_pins.json") if pins == "exch" else \
        os.path.join(TOOLS, "..", "breadth_v2", "pinned", "breadth_v2c2_pins.json")
    code = (_PROBE.replace("__ROOT__", repr(ROOT)).replace("__PIN__", repr(pin_dir))
            .replace("__PINS__", repr(pins_path)).replace("__EMPTY__", repr(str(tmp_path))))
    env = {k: v for k, v in os.environ.items() if not k.startswith("BREADTH_")}
    out = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, env=env)
    problems = json.loads(out.stdout.strip().splitlines()[-1])
    assert len(problems) == expect, problems


def test_remap_shape_and_diff_rules_are_exact(tmp_path):
    arch, rr, prod = str(tmp_path / "arch"), str(tmp_path / "remap"), "/data/breadth_v2_producer/vintages"
    tag = "p202610012031"
    ip = os.path.join(arch, tag, "inputs_" + tag)
    os.makedirs(ip)
    g = {"dir": f"{prod}/{tag}/grouped_{tag}", "files": 2, "manifest": {"2026-09-30_0": {"sha256": "x"}}}
    gb = json.dumps(g, sort_keys=True).encode()
    m = {"tag": tag, "grouped_dir": f"{prod}/{tag}/grouped_{tag}",
         "objects_sha256": {"grouped_vintage_manifest.json": hashlib.sha256(gb).hexdigest(), "fx_ledger.json": "f"}}
    open(os.path.join(ip, "grouped_vintage_manifest.json"), "wb").write(gb)
    open(os.path.join(ip, "INPUT_MANIFEST.json"), "w").write(json.dumps(m, sort_keys=True))
    open(os.path.join(ip, "fx_ledger.json"), "w").write("{}")
    open(os.path.join(ip, "adjusted_guard_table.json"), "w").write(json.dumps({"input_key": "k1", "events": [1]}))
    if os.name == "nt":
        pytest.skip("fcntl (runner-only)")
    rep = lc.build_remap(arch, tag, rr)
    assert rep["changed_fields"] == {"grouped_vintage_manifest.json": ["dir"],
                                     "INPUT_MANIFEST.json": ["grouped_dir", "objects_sha256.grouped_vintage_manifest.json"]}
    m2 = json.load(open(os.path.join(rep["remap_inputs_dir"], "INPUT_MANIFEST.json")))
    assert m2["objects_sha256"]["grouped_vintage_manifest.json"] == lc.sha_file(
        os.path.join(rep["remap_inputs_dir"], "grouped_vintage_manifest.json"))
    open(os.path.join(rep["remap_inputs_dir"], "adjusted_guard_table.json"), "w").write(
        json.dumps({"input_key": "k2", "events": [1]}))           # the engine's rebuild: only the key differs
    assert lc.tables_equivalent(ip, rep["remap_inputs_dir"])["adjusted_guard_table.json"] == "equal"
    open(os.path.join(rep["remap_inputs_dir"], "adjusted_guard_table.json"), "w").write(
        json.dumps({"input_key": "k2", "events": [2]}))
    assert lc.tables_equivalent(ip, rep["remap_inputs_dir"])["adjusted_guard_table.json"] == "DIFFERENT"


def test_tables_equivalent_identity_may_differ_only_by_the_remapped_path(tmp_path):
    a, b = tmp_path / "a", tmp_path / "b"
    a.mkdir(), b.mkdir()
    old, new = "/data/breadth_v2_producer/vintages/pX/grouped_pX", "/data/_audit/archive/pX/grouped_pX"
    for d, ident in ((a, '{"dir": "%s", "n": 1}' % old), (b, '{"dir": "%s", "n": 1}' % new)):
        (d / "first_raw_session.json").write_text(json.dumps({"identity": ident, "first": {"A": "2005-10-24"}}))
    assert lc.tables_equivalent(str(a), str(b), (old, new))["first_raw_session.json"] == "equal"
    (b / "first_raw_session.json").write_text(json.dumps({"identity": '{"dir": "%s", "n": 2}' % new,
                                                          "first": {"A": "2005-10-24"}}))
    assert lc.tables_equivalent(str(a), str(b), (old, new))["first_raw_session.json"].startswith("DIFFERENT")


def test_archive_vintages_is_verified_append_only_and_reports_pruned(tmp_path):
    prod, arch = tmp_path / "prod", tmp_path / "arch"
    (prod / "pA" / "inputs_pA").mkdir(parents=True)
    (prod / "pA" / "inputs_pA" / "INPUT_MANIFEST.json").write_text('{"tag": "pA"}')
    r = lc.archive_vintages(str(prod), ["pA", "pGONE"], str(arch))
    assert r == {"pA": "archived", "pGONE": "MISSING at producer (pruned before archival)"}
    sums = (arch / "pA.SHA256SUMS").read_text()
    assert lc.sha_file(str(arch / "pA" / "inputs_pA" / "INPUT_MANIFEST.json")) in sums
    (prod / "pA" / "inputs_pA" / "INPUT_MANIFEST.json").write_text('{"tag": "pA", "changed": 1}')
    assert lc.archive_vintages(str(prod), ["pA"], str(arch)) == {"pA": "already archived"}   # never rewritten
    assert (arch / "pA" / "inputs_pA" / "INPUT_MANIFEST.json").read_text() == '{"tag": "pA"}'


# ── Phase 2: live venue evidence (the worker's classify_session) A–J ─────────────────────────────
import breadth_venue_ledger as vl  # noqa: E402


def _cls(us, dated, tapes, d="2026-10-02"):
    return {t: v["status"] for t, v in lc.classify_session(d, us, dated, tapes, vl).items()}


def test_A_B_supported_nyse_and_nasdaq_stay():
    assert _cls(["PEP", "AAPL"], {"XNYS": [["PEP"]], "XNAS": [["AAPL"]]}, {"PEP": 1, "AAPL": 3}) == {"PEP": "NYSE", "AAPL": "NASDAQ"}


def test_C_transfer_changes_venue_on_the_tape_session_only():
    before = _cls(["WMT"], {"XNYS": [["WMT"]]}, {"WMT": 1}, "2025-12-08")
    on = _cls(["WMT"], {"XNYS": [["WMT"]]}, {"WMT": 3}, "2025-12-09")      # dated list still lags: tape decides
    after = _cls(["WMT"], {"XNAS": [["WMT"]]}, {"WMT": 3}, "2025-12-10")
    assert (before["WMT"], on["WMT"], after["WMT"]) == ("NYSE", "NASDAQ", "NASDAQ")


def test_D_rename_venue_is_evidenced_independently_for_the_new_symbol():
    assert _cls(["HUCK"], {"XNAS": [["HUCK"]]}, {"HUCK": 3}) == {"HUCK": "NASDAQ"}
    assert _cls(["HUCK"], {}, {"HUCK": 1}) == {"HUCK": "UNRESOLVED"}       # no inherited venue from DOMO


def test_E_J_learned_metadata_or_later_evidence_cannot_rewrite_a_stored_session(tmp_path):
    s = lc.Store(str(tmp_path / "c.db"))
    p = _payload("2026-09-25")
    p["evidence"] = [("2026-09-25", "X", "X@2026", "NYSE", "XNYS", 1, "NYSE", "XNYS", "dated+tape")]
    s.commit_session("2026-09-25", "2026-09-25", p)
    q = _payload("2026-09-25")
    q["evidence"] = [("2026-09-25", "X", "X@2026", "NASDAQ", "XNAS", 3, "NASDAQ", "XNAS", "dated+tape")]
    with pytest.raises(lc.Refused):
        s.commit_session("2026-09-25", "2026-09-25", q)
    assert s.c.execute("SELECT status FROM venue_evidence WHERE date='2026-09-25'").fetchall() == [("NYSE",)]


def test_F_ticker_reuse_does_not_inherit_prior_venue():
    # yesterday the symbol was an XASE name; today a new listing of it trades on Nasdaq (UTP)
    assert _cls(["ADRX"], {"XNAS": [["ADRX"]]}, {"ADRX": 3}) == {"ADRX": "NASDAQ"}
    assert _cls(["ADRX"], {"XASE": [["ADRX"]]}, {"ADRX": 1}) == {"ADRX": "OTHER"}


def test_G_H_other_and_unresolved_never_enter_an_exchange():
    st = _cls(["A", "B", "C"], {"XASE": [["A"]], "ARCX": [["B"]]}, {"A": 1, "B": 2, "C": 1})
    assert st == {"A": "OTHER", "B": "OTHER", "C": "UNRESOLVED"}
    ny, na, _c = lc.partition(["A", "B", "C"], st, "2026-10-02", "2009-06-11", "2008-01-02")
    assert ny == na == []


def test_I_dual_class_securities_are_evidenced_independently():
    st = _cls(["BRK.A", "BRK.B"], {"XNYS": [["BRK.A"]], "XNAS": [["BRK.B"]]}, {"BRK.A": 1, "BRK.B": 3})
    assert st == {"BRK.A": "NYSE", "BRK.B": "NASDAQ"}
    assert _cls(["X"], {"XNYS": [["X"]], "XNAS": [["X"]]}, {"X": 1}) == {"X": "CONFLICT"}   # two listings: never guessed
