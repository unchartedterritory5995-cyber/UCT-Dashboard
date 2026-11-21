"""U5: a member's browser replaces its cached history only when history_rev RISES. Every epoch term is per TICKER:
rev(ticker) = the component version at which THAT ticker last changed (payload bytes, newly listed, re-listed,
retired). So each term only rises, a publish that changes one ticker moves one ticker, and identical bytes move nothing.
Synthetic data only."""
import gzip
import json
import random
import subprocess
from pathlib import Path

import pytest

from api.services import bars_corrections as K
from api.services import bars_identity as I
from api.services import bars_rebuild as R
from tools.history_lake import daily_corrections as DC
from tools.history_lake import daily_publish as DP

REPO = Path(__file__).resolve().parents[1]


def _entry(sym, n):
    return [{"tf": "D", "src": "store", "d": "2005-10-05", "op": "set", "f": {"l": [100.0 + n, 101.0 + n]}, "chk": {}}]


@pytest.fixture()
def vol(tmp_path, monkeypatch):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.delenv(K.ENV_SERVE, raising=False)
    monkeypatch.delenv(R.ENV_SERVE, raising=False)
    K._state.update(version=0, symbols=frozenset(), retired=frozenset(), revs={}, loaded=False)
    K._cache.clear()
    R._state.update(version=0, end=None, symbols=frozenset(), retired=frozenset(), revs={}, loaded=False)
    R._cache.clear()
    yield tmp_path
    K._state.update(version=0, symbols=frozenset(), retired=frozenset(), revs={}, loaded=False)
    K._cache.clear()
    R._state.update(version=0, end=None, symbols=frozenset(), retired=frozenset(), revs={}, loaded=False)
    R._cache.clear()


def _publish_corrections(root, prev, version, content):
    """What `daily_corrections publish` does, on a local volume: payloads at v<rev> for changed tickers, manifest last."""
    hashes = {s: DC.entries_hash(e) for s, e in content.items()}
    m = DC.plan_manifest(prev, version, list(content), "test", hashes)
    for s, e in content.items():
        if m["revs"][s] == version:
            d = root / "bars_corrections" / f"v{version}"
            d.mkdir(parents=True, exist_ok=True)
            (d / f"{s}.json.gz").write_bytes(K.encode_payload(s, version, e))
    (root / "bars_corrections" / "manifest.json").write_text(json.dumps(m))
    assert K.load_local()
    return m


def _epochs(syms):
    return {s: K.history_epoch(s, "D") for s in syms}


def test_one_changed_ticker_moves_only_that_ticker(vol):
    m1 = _publish_corrections(vol, None, 1, {"SPY": _entry("SPY", 0), "AAPL": _entry("AAPL", 0)})
    e1 = _epochs(["SPY", "AAPL"])
    m2 = _publish_corrections(vol, m1, 2, {"SPY": _entry("SPY", 0), "AAPL": _entry("AAPL", 1)})
    e2 = _epochs(["SPY", "AAPL"])
    assert e2["SPY"] == e1["SPY"] and e2["AAPL"] > e1["AAPL"]
    assert K.apply("SPY", "D", [{"t": "2005-10-05", "o": 110, "h": 112, "l": 100.0, "c": 111, "v": 1}], "store")[0]["l"] == 101.0
    m3 = _publish_corrections(vol, m2, 3, {"SPY": _entry("SPY", 0), "AAPL": _entry("AAPL", 1)})   # identical bytes
    assert _epochs(["SPY", "AAPL"]) == e2 and m3["revs"] == m2["revs"]


def test_retire_and_relist_both_raise_the_term(vol):
    m1 = _publish_corrections(vol, None, 1, {"SPY": _entry("SPY", 0), "AAPL": _entry("AAPL", 0)})
    e1 = _epochs(["SPY", "AAPL"])
    m2 = _publish_corrections(vol, m1, 2, {"AAPL": _entry("AAPL", 0)})          # SPY retires
    e2 = _epochs(["SPY", "AAPL"])
    assert e2["SPY"] > e1["SPY"] and e2["AAPL"] == e1["AAPL"]
    m3 = _publish_corrections(vol, m2, 3, {"AAPL": _entry("AAPL", 0)})          # still retired: no move
    assert _epochs(["SPY"])["SPY"] == e2["SPY"]
    _publish_corrections(vol, m3, 4, {"SPY": _entry("SPY", 0), "AAPL": _entry("AAPL", 0)})   # re-listed
    assert _epochs(["SPY"])["SPY"] > e2["SPY"]


def test_every_term_only_rises_over_random_publishes(vol):
    rng = random.Random(20261121)
    syms = ["S%d" % i for i in range(6)]
    content = {}
    prev, last = None, {s: 0 for s in syms}
    for v in range(1, 40):
        for s in syms:
            x = rng.random()
            if x < 0.15:
                content.pop(s, None)
            elif x < 0.35:
                content[s] = _entry(s, rng.randint(0, 3))
        prev = _publish_corrections(vol, prev, v, dict(content))
        now = _epochs(syms)
        for s in syms:
            assert now[s] >= last[s], (v, s, now[s], last[s])
        last = now


def test_a_manifest_without_revs_still_means_version_for_all(vol):
    d = vol / "bars_corrections" / "v4"
    d.mkdir(parents=True)
    (d / "SPY.json.gz").write_bytes(K.encode_payload("SPY", 4, _entry("SPY", 0)))
    (vol / "bars_corrections" / "manifest.json").write_text(json.dumps({"version": 4, "symbols": ["SPY"], "retired": ["QQQ"]}))
    assert K.load_local()
    assert K.history_epoch("SPY", "D") == 4 * K.EPOCH_STEP and K.history_epoch("QQQ", "D") == 4 * K.EPOCH_STEP


# ── the rebuild component ───────────────────────────────────────────────────────────────────────────────────
def test_rebuild_revs_per_ticker_and_versions_only_rise(vol):
    root = vol / "bars_rebuild"
    for v, syms in ((1, ["ASB", "MNST"]), (2, ["MNST"])):
        for s in syms:
            (root / f"v{v}").mkdir(parents=True, exist_ok=True)
            (root / f"v{v}" / f"{s}.json.gz").write_bytes(gzip.compress(json.dumps({"sym": s, "bars": [["2005-01-03", 1, 1, 1, 1, 1]]}).encode()))
    m = {"version": 2, "end": "2026-11-17", "symbols": ["ASB", "MNST"], "retired": ["BALL"], "revs": {"ASB": 1, "MNST": 2, "BALL": 2}}
    (root / "manifest.json").write_text(json.dumps(m))
    assert R.load_local()
    assert R.history_epoch("ASB", "D") == 1 * R.EPOCH_STEP          # unchanged at v2: its v1 term stays
    assert R.history_epoch("MNST", "D") == 2 * R.EPOCH_STEP
    assert R.history_epoch("BALL", "D") == 2 * R.EPOCH_STEP         # dropped from serving: its term still rose
    assert R.series("ASB") is not None                              # its file is found at v<rev>

    class _C:
        def get_object(self, Bucket, Key):
            import io
            return {"Body": io.BytesIO(json.dumps({"version": 1, "symbols": ["ASB"]}).encode())}
    out = R.sync(_C(), "b")
    assert not out["ok"] and "older" in out["reason"] and R._state["version"] == 2


def test_the_rebuild_publisher_derives_revs():
    p1 = DP.plan(None, 1, ["ASB", "MNST"], {"ASB": "a", "MNST": "m"})
    assert p1["revs"] == {"ASB": 1, "MNST": 1}
    p2 = DP.plan({"version": 1, **p1}, 2, ["ASB", "MNST"], {"ASB": "a", "MNST": "m2"})
    assert p2["revs"] == {"ASB": 1, "MNST": 2}
    p3 = DP.plan({"version": 2, **p2}, 3, ["MNST"], {"MNST": "m2"})
    assert p3["revs"] == {"MNST": 2, "ASB": 3} and p3["retired"] == ["ASB"]
    with pytest.raises(SystemExit):
        DP.plan({"version": 3, **p3}, 3, ["MNST"], {"MNST": "m2"})


# ── the identity component ──────────────────────────────────────────────────────────────────────────────────
def test_every_identity_symbol_carries_its_own_rev():
    doc = json.loads((REPO / "api" / "data" / "bars_identity.json").read_text(encoding="utf-8"))
    names = set(doc["symbols"]) | set(doc.get("retired") or ())
    assert names and set(doc["revs"]) == names
    assert all(1 <= int(v) <= int(doc["version"]) for v in doc["revs"].values())


def test_the_identity_table_never_loses_a_symbol():
    """Removing a symbol would drop its epoch to 0: it moves to `retired` instead. Compared with master's table."""
    try:
        old = subprocess.run(["git", "show", "origin/master:api/data/bars_identity.json"], cwd=REPO, capture_output=True,
                             text=True, encoding="utf-8", timeout=30)
    except Exception:  # noqa: BLE001
        pytest.skip("no git")
    if old.returncode != 0:
        pytest.skip("no origin/master copy of the table here")
    prev = json.loads(old.stdout)
    now = json.loads((REPO / "api" / "data" / "bars_identity.json").read_text(encoding="utf-8"))
    lost = (set(prev["symbols"]) | set(prev.get("retired") or ())) - (set(now["symbols"]) | set(now.get("retired") or ()))
    assert not lost, f"removed from the identity table (move them to `retired`): {sorted(lost)}"


def test_identity_epoch_is_per_entry():
    I._table.cache_clear()
    t = I._table()
    some = next(iter(t["symbols"]))
    assert I.history_epoch(some, "D") == int(t["revs"].get(some) or t["version"]) * I.EPOCH_STEP
    assert I.history_epoch("NOT-IN-TABLE", "D") == 0


# ── the sum the client compares ─────────────────────────────────────────────────────────────────────────────
def test_the_contract_sum_only_rises_as_components_change(vol):
    from api.services import bar_contract as C
    revs = []
    m1 = _publish_corrections(vol, None, 1, {"SPY": _entry("SPY", 0)})
    revs.append(C.compute("SPY", "D", None, [], meta={"rev": 1, "history_rev": 5})["history_rev"])
    m2 = _publish_corrections(vol, m1, 2, {"AAPL": _entry("AAPL", 0)})     # SPY retires
    revs.append(C.compute("SPY", "D", None, [], meta={"rev": 1, "history_rev": 5})["history_rev"])
    _publish_corrections(vol, m2, 3, {"AAPL": _entry("AAPL", 1)})          # only AAPL changes
    revs.append(C.compute("SPY", "D", None, [], meta={"rev": 1, "history_rev": 5})["history_rev"])
    assert revs[0] < revs[1] == revs[2]


def test_identity_terms_come_from_each_entrys_own_rev(tmp_path, monkeypatch):
    """A table at version 5 whose entries changed at 2 and 5, and one retired at 4."""
    t = {"version": 5, "symbols": {"AAA": [{"from": None, "until": "2010-01-04", "source": None}],
                                   "BBB": [{"from": None, "until": "2011-01-03", "source": None}]},
         "revs": {"AAA": 2, "BBB": 5, "CCC": 4}, "retired": ["CCC"]}
    p = tmp_path / "bars_identity.json"
    p.write_text(json.dumps(t))
    monkeypatch.setattr(I, "TABLE", p)
    I._table.cache_clear()
    try:
        assert I.history_epoch("AAA", "D") == 2 * I.EPOCH_STEP
        assert I.history_epoch("BBB", "W") == 5 * I.EPOCH_STEP
        assert I.history_epoch("CCC", "D") == 4 * I.EPOCH_STEP          # retired: its term stays, never 0
        assert I.history_epoch("DDD", "D") == 0
    finally:
        I._table.cache_clear()
