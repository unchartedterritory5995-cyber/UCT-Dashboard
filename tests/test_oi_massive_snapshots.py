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


def test_get_deltas_uses_per_contract_prior_across_a_gap(tmp_path, monkeypatch):
    """A contract that SKIPPED the globally-2nd date must still read its own nearest
    prior snapshot — not 0. This is the NIO-style bug: the global 2nd date exists (for
    other contracts) but this one is missing from it, so the old code reported the full
    current OI as the overnight build."""
    monkeypatch.setattr(oms, "DB_PATH", str(tmp_path / "oim.db"))
    oms.init_db()
    kN = oms.make_key("NIO", "C", 5, "1/15/2027")
    kO = oms.make_key("OTHER", "C", 10, "1/15/2027")
    oms.record_batch([(kN, 70772), (kO, 1)], "2026-09-01")   # NIO baseline here
    oms.record_batch([(kO, 2)], "2026-09-03")                # NIO absent this day
    oms.record_batch([(kN, 75034), (kO, 3)], "2026-09-04")   # latest
    deltas, d_last, d_prior = oms.get_deltas([kN])
    # global 2nd date is 09-03 (which NIO lacks); per-contract prior is 09-01.
    assert d_last == "2026-09-04" and d_prior == "2026-09-03"
    assert deltas[kN] == (70772, 75034)          # ΔOI +4,262, NOT +75,034


def test_capture_job_stores_full_chain(tmp_path, monkeypatch):
    """The whole fetched chain (OI>0) is stored, not just the flow-universe strikes —
    so a strike that first gets flow tomorrow already has today's baseline. OI==0 is
    dropped (absence == genuinely-new next day)."""
    monkeypatch.setattr(oms, "DB_PATH", str(tmp_path / "oim.db"))
    monkeypatch.setattr(oms, "_KEY", "test")
    kA = oms.make_key("PFE", "P", 27, "9/18/2026")
    kB = oms.make_key("PFE", "C", 30, "9/18/2026")
    kX = oms.make_key("PFE", "C", 99, "9/18/2026")   # not in flow set, but OI>0 → stored
    kZ = oms.make_key("PFE", "C", 5, "9/18/2026")    # OI==0 → dropped
    monkeypatch.setattr(oms, "_flow_universe", lambda days_back: {"PFE": {kA, kB}})
    monkeypatch.setattr(oms, "_fetch_chain_oi",
                        lambda sym: {kA: 74259, kB: 1200, kX: 5, kZ: 0})
    monkeypatch.setattr(oms, "_today_iso", lambda: "2026-08-21")

    res = oms.capture_job(force=True)
    assert res["ok"] and res["contracts"] == 3 and res["inserted"] == 3   # kA,kB,kX (not kZ)
    assert res["flow_contracts"] == 2                                     # kA,kB had flow
    assert oms.get_history(kX)[-1]["oi"] == 5      # the non-flow strike now has a baseline
    assert oms.get_history(kZ) == []               # zero-OI strike not stored


def test_latest_snap_date(tmp_path, monkeypatch):
    monkeypatch.setattr(oms, "DB_PATH", str(tmp_path / "oim.db"))
    oms.init_db()
    assert oms.latest_snap_date() is None
    k = oms.make_key("AAA", "C", 10, "1/15/2027")
    oms.record_batch([(k, 100)], "2026-09-03")
    oms.record_batch([(k, 200)], "2026-09-04")
    assert oms.latest_snap_date() == "2026-09-04"


def test_prune_keeps_only_recent_dates(tmp_path, monkeypatch):
    monkeypatch.setattr(oms, "DB_PATH", str(tmp_path / "oim.db"))
    oms.init_db()
    k = oms.make_key("AAA", "C", 10, "1/15/2027")
    for d in ["2026-08-18", "2026-08-19", "2026-08-20", "2026-08-21"]:
        oms.record_batch([(k, 100)], d)
    deleted = oms.prune(keep_days=2)
    assert deleted == 2                            # the two oldest dates dropped
    assert [h["date"] for h in oms.get_history(k)] == ["2026-08-20", "2026-08-21"]
    assert oms.prune(keep_days=2) == 0             # idempotent
