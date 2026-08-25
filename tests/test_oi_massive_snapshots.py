"""Tests for the isolated Massive/OCC OI capture (api/oi_massive_snapshots.py)."""
import api.oi_massive_snapshots as oms


def test_occ_to_key():
    assert oms._occ_to_key("O:PFE260918P00027000") == "PFE|P|27.0|9/18/2026"
    assert oms._occ_to_key("O:NVDA260828C00232500") == "NVDA|C|232.5|8/28/2026"
    assert oms._occ_to_key("garbage") is None


def test_record_and_get_deltas(tmp_path, monkeypatch):
    monkeypatch.setattr(oms, "DB_PATH", str(tmp_path / "oim.db"))
    oms.init_db()
    kA = oms.make_key("PFE", "P", 27, "9/18/2026")
    kB = oms.make_key("AAA", "C", 10, "1/15/2027")
    oms.record_batch([(kA, 53028), (kB, 100)], "2026-08-20")   # prior day
    oms.record_batch([(kA, 74259), (kB, 900)], "2026-08-21")   # latest day

    deltas, d_last, d_prior = oms.get_deltas([kA, kB])
    assert d_last == "2026-08-21" and d_prior == "2026-08-20"
    assert deltas[kA] == (53028, 74259)          # (prior, last) → ΔOI 21,231 (matches UW)
    assert deltas[kB] == (100, 900)
    # only-latest contract → prior 0; absent-from-latest → omitted
    oms.record_batch([(oms.make_key("NEW", "C", 5, "1/15/2027"), 500)], "2026-08-21")
    d2, _, _ = oms.get_deltas([oms.make_key("NEW", "C", 5, "1/15/2027")])
    assert d2[oms.make_key("NEW", "C", 5, "1/15/2027")] == (0, 500)


def test_capture_job(tmp_path, monkeypatch):
    monkeypatch.setattr(oms, "DB_PATH", str(tmp_path / "oim.db"))
    monkeypatch.setattr(oms, "_KEY", "test")
    kA = oms.make_key("PFE", "P", 27, "9/18/2026")
    kB = oms.make_key("PFE", "C", 30, "9/18/2026")
    monkeypatch.setattr(oms, "_flow_universe", lambda days_back: {"PFE": {kA, kB}})
    # chain returns OI for the flow contracts (+ an extra the flow set ignores)
    monkeypatch.setattr(oms, "_fetch_chain_oi",
                        lambda sym: {kA: 74259, kB: 1200, oms.make_key("PFE", "C", 99, "9/18/2026"): 5})
    monkeypatch.setattr(oms, "_today_iso", lambda: "2026-08-21")

    res = oms.capture_job(force=True)
    assert res["ok"] and res["contracts"] == 2 and res["inserted"] == 2
    hist = oms.get_history(kA)
    assert hist and hist[-1]["oi"] == 74259
