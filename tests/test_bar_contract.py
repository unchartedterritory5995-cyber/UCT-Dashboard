"""THE SERVER BAR CONTRACT (docs/architecture/bar-contract.md) — invariant rails.

Groups:
  A. store meta: series_rev / history_rev / verified_through live in bars.db, survive a
     restart (a real second process), and are invalidated by deletes / wholesale changes.
  B. every serve branch (every `_mark_serve` label in the serve modules) answers with all
     contract fields, on full / since= / to= / session=eth paths.
  C. complete_through semantics: deterministic examples + a property test over random
     write / verify / clock sequences (never past the store, never backwards, and every
     row it calls final keeps its values unless history_rev moves).
  D. stream <-> REST consistency.
  E. census rail: every ohlcv writer accounts for series_rev.
"""
from __future__ import annotations

import ast
import json
import os
import random
import re
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import orjson
import pytest

from api.services import bar_contract as bc
from api.services import bars_fetch as bf
from api.services import bars_sqlite as bs

ROOT = Path(__file__).resolve().parents[1]
ET = ZoneInfo("America/New_York")
FIELDS = ("contract", "grid", "session", "cache_key", "series_rev", "history_rev",
          "verified_through", "complete_through", "developing")


def et(y, mo, d, h=0, mi=0, s=0):
    return int(datetime(y, mo, d, h, mi, s, tzinfo=ET).timestamp())


WED = (2026, 11, 11)


@pytest.fixture
def store(tmp_path, monkeypatch):
    """A private bars.db for the test (and every thread's connection re-opened on it)."""
    monkeypatch.setattr(bs, "_DB_PATH", str(tmp_path / "bars.db"))
    bs.bump_db_epoch()
    bs.init_db()
    with bf._tail_verified_lock:
        bf._tail_verified.clear()
    yield tmp_path
    bs.bump_db_epoch()
    with bf._tail_verified_lock:
        bf._tail_verified.clear()


def bar(t, c=10.0, v=100):
    return {"t": t, "o": c, "h": c + 1, "l": c - 1, "c": c, "v": v}


def _restart_in_process():
    """Forget everything this process holds: queued proofs, floors, its own copy of the
    proofs, and every connection."""
    with bs._pending_lock:
        bs._pending_verified.clear()
    with bs._floor_lock:
        for k in bs._mem_floors:
            bs._mem_floors[k] = 0.0
        bs._pending_floors.clear()
    with bf._tail_verified_lock:
        bf._tail_verified.clear()
    bs.bump_db_epoch()


# ── A. store meta ────────────────────────────────────────────────────────────

def test_every_row_writer_advances_series_rev(store):
    revs = []

    def rev():
        revs.append(bs.series_meta("AAA", "5")["rev"])
        return revs[-1]

    assert rev() == 0
    bs.put_bars("AAA", "5", [bar(et(*WED, 10, 0)), bar(et(*WED, 10, 5))])
    assert rev() > 0
    bs.put_bars("AAA", "5", [bar(et(*WED, 10, 5), c=11)])
    r2 = rev()
    bs.put_bars_many("5", {"AAA": [bar(et(*WED, 10, 10))]})
    r3 = rev()
    bs.replace_ticker_tf_rows("AAA", "5", [bar(et(*WED, 10, 0))])
    r4 = rev()
    bs.delete_bars("AAA", "5")
    r5 = rev()
    assert revs[1] < r2 < r3 < r4 < r5, revs


def test_a_write_that_changes_nothing_does_not_move_rev(store):
    bs.put_bars("AAA", "5", [bar(et(*WED, 10, 0))])
    r = bs.series_meta("AAA", "5")["rev"]
    bs.put_bars("AAA", "5", [bar(et(*WED, 10, 0), c=99)], on_conflict="ignore")
    assert bs.series_meta("AAA", "5")["rev"] == r


def test_history_rev_moves_only_when_sealed_history_changes(store):
    t0, t1, t2 = et(*WED, 10, 0), et(*WED, 10, 5), et(*WED, 10, 10)
    bs.put_bars("AAA", "5", [bar(t0), bar(t1)])
    h0 = bs.series_meta("AAA", "5")["history_rev"]
    bs.put_bars("AAA", "5", [bar(t1, c=12), bar(t2)])          # tail update + growth
    assert bs.series_meta("AAA", "5")["history_rev"] == h0
    bs.put_bars("AAA", "5", [bar(t0)])                          # identical rewrite
    assert bs.series_meta("AAA", "5")["history_rev"] == h0
    bs.put_bars("AAA", "5", [bar(t0, c=9)])                     # a correction below the tail
    h1 = bs.series_meta("AAA", "5")["history_rev"]
    assert h1 > h0
    # the tail itself becomes history once it is proven complete
    bs.record_verified("AAA", "5", t2 + 300 + 1)
    bs.flush_meta()
    bs.put_bars("AAA", "5", [bar(t2, c=13)])
    assert bs.series_meta("AAA", "5")["history_rev"] > h1


def test_verified_through_survives_a_restart_and_reads_the_same_in_another_process(store):
    t = et(*WED, 10, 0)
    bs.put_bars("AAA", "5", [bar(t)])
    bf._mark_tail_verified("AAA", "5", float(t + 400))
    assert bs.flush_meta() >= 1
    _restart_in_process()
    assert bf.tail_verified_through("AAA", "5") == float(t + 400)
    # a genuinely separate process opening the same store
    code = ("import json; from api.services import bars_sqlite as b; "
            "print(json.dumps(b.series_meta('AAA', '5')))")
    env = dict(os.environ, DATA_DIR=str(store), BARS_META_FLUSH_SECONDS="0")
    out = subprocess.run([sys.executable, "-c", code], cwd=str(ROOT), env=env,
                         capture_output=True, text=True, timeout=120)
    assert out.returncode == 0, out.stderr[-2000:]
    meta = json.loads(out.stdout.strip().splitlines()[-1])
    assert meta["verified_through"] == float(t + 400)
    assert meta["rev"] == bs.series_meta("AAA", "5")["rev"] > 0


def test_unflushed_proof_is_visible_in_process_before_the_flush(store):
    bf._mark_tail_verified("AAA", "5", 1000.0)
    assert bs.series_meta("AAA", "5")["verified_through"] == 1000.0


def test_a_delete_voids_every_proof_taken_before_it(store):
    t = et(*WED, 10, 0)
    bs.put_bars("AAA", "5", [bar(t)])
    bs.record_verified("AAA", "5", time.time() - 5)          # taken before the delete
    taken_before = time.time() - 1
    bs.flush_meta()
    bs.delete_bars("AAA", "5")
    assert bs.series_meta("AAA", "5")["verified_through"] is None
    bs.record_verified("AAA", "5", taken_before)              # a late flush of an old proof
    bs.flush_meta()
    _restart_in_process()
    assert bs.series_meta("AAA", "5")["verified_through"] is None
    later = time.time() + 1
    bs.record_verified("AAA", "5", later)
    bs.flush_meta()
    assert bs.series_meta("AAA", "5")["verified_through"] == later


def test_a_wholesale_change_raises_every_rev_and_voids_every_proof(store):
    bs.put_bars("AAA", "5", [bar(et(*WED, 10, 0))])
    bs.record_verified("AAA", "5", time.time() - 10)
    bs.flush_meta()
    before = bs.series_meta("AAA", "5")
    bs.bump_store_floor("test")
    after = bs.series_meta("AAA", "5")
    assert after["rev"] > before["rev"] and after["history_rev"] >= after["rev"] - 0
    assert after["verified_through"] is None
    bs.flush_meta()
    _restart_in_process()                                      # floor persisted
    assert bs.series_meta("AAA", "5")["rev"] >= after["rev"]
    assert bs.series_meta("AAA", "5")["verified_through"] is None


def test_meta_flush_is_one_short_transaction_for_a_batch(store):
    for i in range(500):
        bs.record_verified(f"T{i}", "5", 1000.0 + i)
    n0 = bs.meta_flush_stats()["flushes"]
    assert bs.flush_meta() == 500
    st = bs.meta_flush_stats()
    assert st["flushes"] == n0 + 1 and st["pending"] == 0
    assert bs.series_meta("T499", "5")["verified_through"] == 1499.0


# ── C. complete_through semantics ────────────────────────────────────────────

def _store_rows(ticker, tf):
    return bs.get_bars(ticker, tf, 100000)


def _answer(ticker, tf, now, rows=None, **kw):
    if rows is None:
        rows = bf._fmt_sqlite_bars(_store_rows(ticker, tf), tf)
    meta = bc.snapshot_meta(ticker, tf, kw.get("session"))
    return rows, bc.compute(ticker, tf, kw.pop("session", None), rows, now=now, meta=meta, **kw)


def test_unproven_tail_is_developing_and_the_bucket_before_it_is_complete(store):
    t = [et(*WED, 10, m) for m in (0, 5, 10)]
    bs.put_bars("AAA", "5", [bar(x) for x in t])
    _rows, c = _answer("AAA", "5", et(*WED, 10, 12, 30))
    assert c["complete_through"] == t[2]                       # end of the 10:05 bucket
    assert c["developing"]["t"] == t[2]
    assert c["grid"] == "eth-clock" and c["cache_key"] == "b1:AAA:5:eth-clock"
    assert c["developing"]["rev"] == c["series_rev"] > 0


def test_a_proof_after_the_tail_closed_completes_the_tail(store):
    t = [et(*WED, 10, m) for m in (0, 5, 10)]
    bs.put_bars("AAA", "5", [bar(x) for x in t])
    bf._mark_tail_verified("AAA", "5", float(et(*WED, 10, 15, 2)))
    _rows, c = _answer("AAA", "5", et(*WED, 10, 16))
    assert c["complete_through"] == et(*WED, 10, 15)
    assert c["developing"] is None


def test_a_stale_cached_answer_gets_the_store_tail_spliced_in(store):
    t = [et(*WED, 10, m) for m in (0, 5, 10)]
    bs.put_bars("AAA", "5", [bar(t[0]), bar(t[1], c=10)])
    stale = bf._fmt_sqlite_bars(_store_rows("AAA", "5"), "5")   # the cached snapshot
    bs.put_bars("AAA", "5", [bar(t[1], c=11), bar(t[2])])
    _rows, c = _answer("AAA", "5", et(*WED, 10, 12), rows=stale)
    spliced = c.pop("_bars")
    assert [r["t"] for r in spliced] == t and spliced[1]["c"] == 11
    assert c["complete_through"] == t[2]


def test_a_delta_answer_states_the_store_tail(store):
    t = [et(*WED, 10, m) for m in (0, 5, 10)]
    bs.put_bars("AAA", "5", [bar(x) for x in t])
    c = bc.compute("AAA", "5", None, [], delta=True, now=et(*WED, 10, 12))
    assert c["complete_through"] == t[2] and c["developing"]["t"] == t[2]


def test_daily_rows_complete_through_the_session_before_the_store_tail(store):
    bs.put_bars("AAA", "D", [bar("2026-11-09"), bar("2026-11-10")], date_tf=True)
    rows = bf._fmt_sqlite_bars(_store_rows("AAA", "D"), "D")
    rows = rows + [bar("2026-11-11")]                       # today's appended developing bar
    c = bc.compute("AAA", "D", None, rows, now=et(*WED, 11, 0))
    assert c["grid"] == "plain" and c["session"] is None
    assert c["complete_through"] == et(2026, 11, 9, 16, 0)
    assert c["developing"]["t"] == "2026-11-11"


def test_not_store_backed_answers_say_so():
    c = bc.compute("UCTA50", "D", None, [bar("2026-11-10")], store_backed=False,
                   now=et(*WED, 11, 0))
    assert c["series_rev"] is None and c["complete_through"] is None
    assert set(FIELDS) <= set(c)


@pytest.mark.parametrize("seed", range(12))
def test_property_complete_through_is_bounded_monotonic_and_final(store, seed):
    """Random interleavings of provider heals (rewrite from the stored tail bucket
    inclusive, then prove), live tail writes, idle clock advances and memory-cache
    snapshots. Invariants:
      I1 complete_through is None or the end of an answer row, <= now, and <= the end
         of the newest SEALED stored row;
      I2 it never moves backwards;
      I3 every row it has ever called final still has the same values at the end,
         unless history_rev moved (here no corrections happen, so it never may)."""
    rng = random.Random(seed)
    tf, step = "5", 300
    now = float(et(*WED, 9, 30))
    truth: dict[int, tuple] = {}
    claimed: dict[int, tuple] = {}
    last_ct = None
    h0 = None
    cached = None

    def true_bar(b):
        return truth.setdefault(b, (rng.uniform(5, 50), rng.randint(1, 10_000)))

    def partial(b):
        c, v = true_bar(b)
        frac = min(1.0, max(0.0, (now - b) / step))
        return {"t": b, "o": c, "h": c + 1, "l": c - 1, "c": c, "v": int(v * frac) or 1}

    def final(b):
        c, v = true_bar(b)
        return {"t": b, "o": c, "h": c + 1, "l": c - 1, "c": c, "v": v}

    for _ in range(160):
        now += rng.choice([7, 31, 60, 120, 299, 301, 600])
        cur = int(now) // step * step
        op = rng.random()
        last = bs.get_last_ts("AAA", tf)
        if op < 0.35:                                         # provider heal
            start = last if last is not None else cur - 6 * step
            bs.put_bars("AAA", tf, [final(b) if b + step <= now else partial(b)
                                    for b in range(int(start), cur + 1, step)])
            bf._mark_tail_verified("AAA", tf, now)
        elif op < 0.6 and last is not None and last >= cur - step:   # live tail write
            bs.put_bars("AAA", tf, [partial(cur)] if last <= cur else [])
        elif op < 0.7:
            cached = bf._fmt_sqlite_bars(_store_rows("AAA", tf), tf)
        if bs.get_last_ts("AAA", tf) is None:
            continue
        rows = cached if (cached and rng.random() < 0.3) else None
        served, c = _answer("AAA", tf, now, rows=rows)
        served = c.pop("_bars", served)
        if h0 is None:
            h0 = c["history_rev"]
        ct = c["complete_through"]
        stored = _store_rows("AAA", tf)
        sealed = [r[0] + step for r in stored if r[0] + step <= now]
        if ct is not None:
            assert ct <= now
            assert sealed and ct <= max(sealed)
            assert any(r["t"] + step == ct for r in served)
            if last_ct is not None:
                assert ct >= last_ct, (ct, last_ct)
            last_ct = ct
            for r in served:
                if r["t"] + step <= ct:
                    claimed.setdefault(r["t"], (r["c"], r["v"]))
        if c["developing"] is not None:
            assert c["developing"]["t"] <= now < c["developing"]["t"] + step
    final_rows = {r[0]: (r[4], r[5]) for r in _store_rows("AAA", tf)}
    assert bs.series_meta("AAA", tf)["history_rev"] == h0
    for t, val in claimed.items():
        assert final_rows[t][0] == pytest.approx(val[0]) and final_rows[t][1] == val[1], t


# ── B. every serve branch carries the contract ──────────────────────────────

def _serve_labels() -> set[str]:
    labels = set()
    for p in ("api/services/bars_fetch.py", "api/routers/bars.py"):
        labels |= set(re.findall(r'_mark_serve\(\s*"([^"]+)"', (ROOT / p).read_text(encoding="utf-8")))
    return labels


def test_the_label_census_is_not_vacuous():
    labels = _serve_labels()
    assert {"sqlite", "mem", "delta", "stale-swr", "breadth", "index"} <= labels, labels


def _body(resp):
    return orjson.loads(resp.body)


@pytest.mark.parametrize("label", sorted(_serve_labels() - {"entry", "warm-shed"}))
@pytest.mark.parametrize("tf", ["5", "60", "D"])
def test_every_serve_branch_answers_with_the_contract(store, monkeypatch, label, tf):
    """Whatever branch served the rows (named by its Server-Timing label), the answer
    carries every contract field with the right identity. `warm-shed` is a 503 (no
    rows) and `entry` is the reset value, never a serve."""
    from api.routers import bars as br
    ticker = "AAA"
    t0 = et(*WED, 10, 0) if tf != "D" else "2026-11-10"
    rows = [bar(t0)]
    if tf == "D":
        bs.put_bars(ticker, "D", rows, date_tf=True)
    else:
        bs.put_bars(ticker, tf, rows)

    def _serve(*_a, **_k):
        bf._mark_serve(label)
        return br.JSONResponse(content={"ticker": ticker, "tf": tf, "bars": rows})

    def _delta(*_a, **_k):
        bf._mark_serve(label)
        return br.JSONResponse(content={"ticker": ticker, "tf": tf, "bars": [], "delta": True})

    monkeypatch.setattr(br, "_get_bars_inner", _serve)
    monkeypatch.setattr(br, "_get_bars_since_response", _delta)
    monkeypatch.setattr(br, "_get_bars_to_response", _serve)
    monkeypatch.setattr(br, "_augment_daily_with_today", lambda r, t: r)
    for kw in ({}, {"since": "1"}, {"to": "2026-11-10"}):
        body = _body(br._serve_bars_impl(ticker, tf, 200, **kw))
        missing = [f for f in FIELDS if f not in body]
        assert not missing, (label, tf, kw, missing)
        assert body["contract"] == bc.CONTRACT_VERSION
        assert body["cache_key"] == bc.cache_key(ticker, tf, None)
        assert body["grid"] == bc.grid_for(tf)
        if label == "yf-only":            # not served from bars.db: no store claims
            assert body["series_rev"] is None and body["complete_through"] is None
        else:
            assert isinstance(body["series_rev"], int) and body["series_rev"] > 0
        assert body["bars"] == rows or kw.get("since")


def test_session_eth_60_is_restated_on_the_clock_hour_grid(store, monkeypatch):
    from api.routers import bars as br
    rows15 = [bar(et(*WED, 10, m)) for m in (0, 15, 30, 45)] + [bar(et(*WED, 11, 0))]
    bs.put_bars("AAA", "15", rows15)
    monkeypatch.setattr(br, "_get_bars_inner",
                        lambda *a, **k: br.JSONResponse(content={"ticker": "AAA", "tf": "15",
                                                                 "bars": rows15}))
    body = _body(br.serve_bars("AAA", "60", 50, session="eth"))
    assert body["grid"] == "eth-clock" and body["session"] == "eth"
    assert body["cache_key"] == "b1:AAA:60:eth-clock"
    assert body["series_rev"] == bs.series_meta("AAA", "15")["rev"]
    ct = body["complete_through"]
    assert ct is None or any(b["t"] + 3600 == ct for b in body["bars"])


def test_non_store_branches_carry_identity_but_no_store_claims(monkeypatch):
    from api.routers import bars as br
    from api.services import breadth_symbols
    monkeypatch.setattr(breadth_symbols, "is_breadth_symbol", lambda t: True)
    monkeypatch.setattr(breadth_symbols, "build_breadth_bars",
                        lambda t, tf, n: {"ticker": t, "tf": tf, "bars": [bar("2026-11-10")]})
    body = _body(br._serve_bars_impl("UCTA50", "D", 10))
    assert set(FIELDS) <= set(body)
    assert body["series_rev"] is None and body["complete_through"] is None


# ── D. stream <-> REST ───────────────────────────────────────────────────────

def test_stream_frames_carry_the_rest_identity_and_a_strictly_increasing_rev(store):
    from api.routers import stream as st
    from api.services import bar_broadcaster as bb_mod
    bs.put_bars("AAA", "5", [bar(et(*WED, 10, 0))])
    clock = {"ms": et(*WED, 10, 6) * 1000}
    bb = bb_mod.BarBroadcaster(clock_ms=lambda: clock["ms"], scheduler=lambda d, fn: None,
                               seed_fetcher=lambda s: [])
    sent = []

    class _Loop:
        def call_soon_threadsafe(self, fn, q, msg):
            sent.append(msg)

    bb._subscribers[("AAA", "5")] = {(None, _Loop(), True)}
    t_ms = et(*WED, 10, 5) * 1000
    for i in range(5):
        bb._dispatch("AAA", "5", [{"t": t_ms, "o": 1, "h": 2, "l": 1, "c": 1.5, "v": i,
                                   "final": i == 4}], list(bb._subscribers[("AAA", "5")]))
    frames = [st._contract_event(bc, m, "rth") for m in sent]
    revs = [f["rev"] for f in frames]
    assert revs == sorted(revs) and len(set(revs)) == len(revs)
    rest = bc.compute("AAA", "5", "rth", [], delta=True, now=et(*WED, 10, 6))
    for f in frames:
        for k in ("contract", "grid", "cache_key", "series_rev"):
            assert f[k] == rest[k], k
        assert f["t_s"] == t_ms // 1000 and f["final"] == f["bar"]["final"]
    assert [f["final"] for f in frames] == [False] * 4 + [True]


def test_stream_and_rest_agree_on_the_60m_grid_per_session():
    assert bc.stream_fields("AAA", "60", "rth")["cache_key"] == bc.cache_key("AAA", "60", None)
    assert bc.stream_fields("AAA", "60", "eth")["cache_key"] == bc.cache_key("AAA", "60", "eth")
    assert bc.stream_fields("AAA", "5", "eth")["cache_key"] == bc.cache_key("AAA", "5", "rth")


# ── E. census: every ohlcv writer accounts for series_rev ───────────────────

_WRITE_SQL = re.compile(r"(INTO\s+(main\.)?ohlcv\b|DELETE\s+FROM\s+(main\.)?ohlcv\b|DROP\s+TABLE[^\n]*ohlcv)",
                        re.I)
_ACCOUNTS = ("bump_series_revs", "bump_store_floor", "_bump_merged_rev")
#: Writers that never touch the LIVE store (they build a separate export database).
_EXEMPT = {("api/services/data_sync.py", "_export_delta_db")}


def _writer_sites():
    for path in sorted((ROOT / "api").rglob("*.py")):
        rel = path.relative_to(ROOT).as_posix()
        if "/tests/" in rel or rel.endswith("_test.py"):
            continue
        src = path.read_text(encoding="utf-8", errors="replace")
        if not _WRITE_SQL.search(src):
            continue
        tree = ast.parse(src)
        module_accounts = any(a in src for a in _ACCOUNTS)
        funcs = [n for n in ast.walk(tree) if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))]
        for n in funcs:
            body = ast.get_source_segment(src, n) or ""
            inner = [m for m in ast.walk(n) if m is not n and isinstance(m, (ast.FunctionDef, ast.AsyncFunctionDef))]
            for m in inner:
                body = body.replace(ast.get_source_segment(src, m) or "", "")
            if _WRITE_SQL.search(body):
                yield rel, n.name, any(a in body for a in _ACCOUNTS), module_accounts


def test_every_ohlcv_writer_bumps_series_rev_or_the_store_floor():
    sites = list(_writer_sites())
    assert len(sites) >= 8, sites
    bad = [(rel, name) for rel, name, ok, _m in sites if not ok and (rel, name) not in _EXEMPT]
    assert not bad, ("ohlcv writers that do not advance series_rev (call "
                     "bars_sqlite.bump_series_revs in the write transaction, or "
                     f"bump_store_floor for a wholesale change): {bad}")


def test_the_retired_freshness_duplicates_stay_retired():
    for name in ("intraday_session_complete", "intraday_ext_session_complete",
                 "_ext_session_verified", "_ext_session_end_ts"):
        assert not hasattr(bf, name), name
