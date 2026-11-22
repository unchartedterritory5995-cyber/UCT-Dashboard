"""The PC buyout sweep's confirmed targets reach the server (`deal_status.pc_confirmed`).

On 2026-11-14 nineteen targets the PC sweep had confirmed (BRZE, DV, PCRX, RXO among them,
all four in "Tight bases near highs") were excluded on the PC and served by every server
screen, because nothing on the server read the PC's `universe_exclude_auto.json`. The sweep
now pushes its whole confirmed set after each run.
"""
from __future__ import annotations

import pytest
from fastapi import HTTPException

from api.services import deal_status as ds


@pytest.fixture
def pc(tmp_path, monkeypatch):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.setenv("PUSH_SECRET", "s3cret")
    warmed = []
    monkeypatch.setattr(ds, "_warm_async", lambda: warmed.append(1))
    ds.reset_cache()
    from api.routers import catalysts

    def push(symbols, auth="Bearer s3cret", as_of="2026-11-14"):
        return catalysts.pc_confirmed_deals_internal({"symbols": symbols, "as_of": as_of},
                                                     authorization=auth)
    yield push
    ds.reset_cache()


def test_a_pushed_target_is_pending_for_every_consumer(pc, monkeypatch):
    monkeypatch.setenv("DEAL_STATUS_ENABLED", "1")
    assert "ZZPCA" not in ds.pending_deal_symbols(), "control: not pending before the push"
    out = pc(["zzpca", "ZZPCB", "ZZPCB"])
    assert out == {"ok": True, "stored": 2, "as_of": "2026-11-14"}
    assert {"ZZPCA", "ZZPCB"} <= ds.pending_deal_symbols()
    assert {"ZZPCA", "ZZPCB"} <= ds.screener_excludes()
    assert ds.is_pending("ZZPCA")


def test_a_push_replaces_the_set_so_an_unconfirm_clears_it(pc, monkeypatch):
    monkeypatch.setenv("DEAL_STATUS_ENABLED", "1")
    pc(["ZZPCA", "ZZPCB"])
    pc(["ZZPCB"])
    assert ds.pc_confirmed() == frozenset({"ZZPCB"})
    assert "ZZPCA" not in ds.pending_deal_symbols()


def test_a_push_that_lands_during_a_read_is_not_overwritten_by_that_read(pc, monkeypatch):
    """CART 2026-11-15: ten approvals pushed seconds apart. The read started for one push
    finished after the next push's reset and was stored as fresh, without the last name."""
    monkeypatch.setenv("DEAL_STATUS_ENABLED", "1")
    pc(["ZZPCA"])
    real = ds._stale_ref
    landed = []

    def slow_tail():
        # `_stale_ref` is read AFTER the PC list inside one snapshot build, so a push made
        # here lands after this build already holds the older list: the race itself.
        got = real()
        if not landed:                       # the NEXT push arrives mid-read, once
            landed.append(1)
            pc(["ZZPCA", "ZZPCB"])
        return got
    monkeypatch.setattr(ds, "_stale_ref", slow_tail)
    ds.pending_deal_symbols()                # the read that the second push interrupts
    assert landed == [1]
    assert {"ZZPCA", "ZZPCB"} <= ds.pending_deal_symbols()
    assert ds.is_pending("ZZPCB") and ds.deal_status("ZZPCB")["pending"] is True


def test_the_push_needs_the_secret(pc):
    with pytest.raises(HTTPException) as e:
        pc(["ZZPCA"], auth="Bearer wrong")
    assert e.value.status_code == 401
    assert ds.pc_confirmed() == frozenset()


@pytest.mark.parametrize("bad", ["ZZPCA", [1], ["not a ticker!"], [""], ["A" * 11]])
def test_a_malformed_push_is_refused_and_keeps_the_previous_set(pc, bad):
    pc(["ZZPCB"])
    with pytest.raises(HTTPException) as e:
        pc(bad)
    assert e.value.status_code == 400
    assert ds.pc_confirmed() == frozenset({"ZZPCB"})


def test_class_shares_are_kept_in_their_pushed_spelling(pc):
    pc(["BRK-B", "BF.B"])
    assert ds.pc_confirmed() == frozenset({"BRK-B", "BF.B"})


def test_an_unreadable_file_is_not_pending(pc, tmp_path):
    (tmp_path / ds.PC_CONFIRMED_FILENAME).write_text("{not json", encoding="utf-8")
    assert ds.pc_confirmed() == frozenset()


def test_nothing_pushed_yet_is_an_empty_set(pc):
    assert ds.pc_confirmed() == frozenset()


def test_with_the_flag_off_consumers_still_exclude_nothing_new(pc, monkeypatch):
    monkeypatch.delenv("DEAL_STATUS_ENABLED", raising=False)
    pc(["ZZPCA"])
    assert ds.consumer_pending() == frozenset()
    assert "ZZPCA" not in ds.screener_excludes()


def test_a_push_starts_the_rebuild_off_the_request_thread(tmp_path, monkeypatch):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    started = []

    class _T:
        def __init__(self, target=None, daemon=None, name=None):
            started.append((target, daemon))

        def start(self):
            started.append("started")
    monkeypatch.setattr(ds.threading, "Thread", _T)
    ds.store_pc_confirmed(["ZZPCA"])
    assert started == [(ds.pending_deal_symbols, True), "started"]
