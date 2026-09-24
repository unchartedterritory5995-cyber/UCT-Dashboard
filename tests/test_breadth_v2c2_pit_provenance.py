"""PIT provenance gate — BAD provenance rejected AND legitimate collector behaviour kept."""
import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "tools", "breadth_v2cc"))
import pit_provenance as pp

LIVE = "2026-03-23"


def row(created, sha, n=100, pct=100, healed=False, uc=None):
    return {"created_at": created, "sha256": sha, "n": n, "items": n, "pct_populated": pct,
            "healed": healed, "universe_count": n if uc is None else uc}


def test_genuine_rows_are_pit():
    e = {"2026-03-23": row("2026-03-23 21:31:10", "a"), "2026-03-25": row("2026-03-25 21:31:26", "b")}
    assert all(v["pit"] for v in pp.classify(e, LIVE).values())


def test_hindsight_rerun_is_rejected():            # 03-24 shape
    e = {"2026-03-24": row("2026-03-26 00:48:46", "b"), "2026-03-25": row("2026-03-25 21:31:26", "b")}
    c = pp.classify(e, LIVE)["2026-03-24"]
    assert not c["pit"] and any(r.startswith("HINDSIGHT_RERUN") for r in c["reasons"])
    assert any(r.startswith("LATE_AFTER_NEXT_OPEN") for r in c["reasons"])


def test_healed_copy_is_rejected():                # 08-31 shape
    e = {"2026-08-28": row("2026-08-28 20:20:38", "k"),
         "2026-08-31": row("2026-09-01 15:50:54", "k", healed=True, uc=96)}
    c = pp.classify(e, LIVE)["2026-08-31"]
    assert not c["pit"] and any(r.startswith("HEALED_COPY") for r in c["reasons"])
    assert pp.classify(e, LIVE)["2026-08-28"]["pit"]


def test_self_heal_reconstruction_is_rejected():   # 09-23 shape: written before the open, still rejected
    e = {"2026-09-22": row("2026-09-22 20:27:05", "p"),
         "2026-09-23": row("2026-09-24 07:57:37", "q", n=2693, pct=232, healed=True)}
    c = pp.classify(e, LIVE)["2026-09-23"]
    assert not c["pit"] and [r.split(":")[0] for r in c["reasons"]] == ["SELF_HEAL_RECONSTRUCTION"]


def test_collector_fallback_to_the_previous_snapshot_is_kept():   # 08-13/08-14, 09-04/09-08
    e = {"2026-08-13": row("2026-08-13 20:21:36", "s"), "2026-08-14": row("2026-08-14 20:18:35", "s"),
         "2026-09-04": row("2026-09-04 20:28:16", "t"), "2026-09-08": row("2026-09-08 20:18:54", "t")}
    assert all(v["pit"] for v in pp.classify(e, LIVE).values())


def test_partial_pct_on_an_unhealed_collector_row_is_kept():     # 06-16, 07-27
    e = {"2026-06-16": row("2026-06-16 21:31:29", "u", n=2748, pct=2543)}
    assert pp.classify(e, LIVE)["2026-06-16"]["pit"]


def test_a_healed_row_that_preserved_the_collector_list_is_kept():   # the 26 self-heal scalar days
    e = {"2026-06-22": row("2026-06-22 21:31:47", "v", n=3703, pct=3703, healed=True, uc=2789)}
    assert pp.classify(e, LIVE)["2026-06-22"]["pit"]


def test_a_next_morning_rerun_before_the_open_with_its_own_list_is_kept():   # 07-09 shape
    e = {"2026-07-09": row("2026-07-10 12:50:17", "w"), "2026-07-10": row("2026-07-11 14:28:09", "x")}
    assert all(v["pit"] for v in pp.classify(e, LIVE).values())
