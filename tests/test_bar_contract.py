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
          "verified_through", "sealed_through", "complete_through", "developing", "adj_basis")


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
    bs.reset_meta_state_for_tests()
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
    bs.put_bars("AAA", "5", [bar(t0, c=9)])                     # not sealed yet: provisional
    assert bs.series_meta("AAA", "5")["history_rev"] == h0
    bs.record_sealed("AAA", "5", float(t1 + 300), float(t0), float(t1 + 306))
    bs.put_bars("AAA", "5", [bar(t2, c=14)])                    # the unsealed tail
    assert bs.series_meta("AAA", "5")["history_rev"] == h0
    bs.put_bars("AAA", "5", [bar(t0, c=8)])                     # a correction of sealed rows
    h1 = bs.series_meta("AAA", "5")["history_rev"]
    assert h1 > h0
    bs.flush_meta()                                             # same answer from the store
    bs.put_bars("AAA", "5", [bar(t1, c=15)])
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


class _Clock:
    """`bars_fetch._time` stand-in: `time()` is the simulation clock."""
    def __init__(self, now):
        self.now = float(now)

    def time(self):
        return self.now

    def __getattr__(self, name):
        return getattr(time, name)


def _fake_provider(monkeypatch, answer):
    """Route `_heal_intraday_tail`'s provider delta to `answer(last_ts) -> (rows, wstart)`."""
    def _delta(ticker, tf, last_ts, status=None, tail_only=False):
        rows, wstart = answer(last_ts)
        if status is not None:
            status["ok"] = True
            status["window_start"] = wstart
        return rows
    monkeypatch.setattr(bf, "_delta_intraday", _delta)


def test_nothing_is_complete_until_a_provider_answer_seals_it(store):
    t = [et(*WED, 10, m) for m in (0, 5, 10)]
    bs.put_bars("AAA", "5", [bar(x) for x in t])
    _rows, c = _answer("AAA", "5", et(*WED, 10, 12, 30))
    assert c["complete_through"] is None                       # rows alone prove nothing
    assert c["developing"]["t"] == t[2]
    assert c["grid"] == "eth-clock" and c["cache_key"] == "b1:AAA:5:eth-clock"
    assert c["developing"]["rev"] == c["series_rev"] > 0


def test_a_heal_seals_every_bucket_that_ended_a_seal_lag_before_it(store, monkeypatch):
    t = [et(*WED, 10, m) for m in (0, 5, 10)]
    clock = _Clock(et(*WED, 10, 10, 2))                        # 2 s after 10:05 closed
    monkeypatch.setattr(bf, "_time", clock)
    _fake_provider(monkeypatch, lambda last: ([bar(x) for x in t], t[0]))
    bf._heal_intraday_tail("AAA", "5", t[0])
    _rows, c = _answer("AAA", "5", clock.now)
    assert c["complete_through"] == t[1]                       # 10:05 is inside the lag
    clock.now = et(*WED, 10, 11)
    bf._heal_intraday_tail("AAA", "5", t[2])
    _rows, c = _answer("AAA", "5", clock.now)
    assert c["complete_through"] == t[2]
    assert c["developing"]["t"] == t[2]


def test_a_heal_that_starts_past_the_seal_does_not_extend_it(store, monkeypatch):
    t = [et(*WED, 10, m) for m in range(0, 30, 5)]
    clock = _Clock(et(*WED, 10, 6))
    monkeypatch.setattr(bf, "_time", clock)
    _fake_provider(monkeypatch, lambda last: ([bar(x) for x in t[:2]], t[0]))
    bf._heal_intraday_tail("AAA", "5", t[0])                   # sealed through 10:00
    bs.put_bars("AAA", "5", [bar(x) for x in t[2:5]])          # live writes, unproven
    clock.now = et(*WED, 10, 26)
    _fake_provider(monkeypatch, lambda last: ([bar(t[4]), bar(t[5])], t[4]))
    bf._heal_intraday_tail("AAA", "5", t[4])                   # window starts 10:20
    _rows, c = _answer("AAA", "5", clock.now)
    assert c["complete_through"] == t[1]                       # the gap is not proven


def test_a_stale_cached_answer_gets_the_store_tail_spliced_in(store):
    t = [et(*WED, 10, m) for m in (0, 5, 10)]
    bs.put_bars("AAA", "5", [bar(t[0]), bar(t[1], c=10)])
    stale = bf._fmt_sqlite_bars(_store_rows("AAA", "5"), "5")   # the cached snapshot
    bs.put_bars("AAA", "5", [bar(t[1], c=11), bar(t[2])])
    bs.record_sealed("AAA", "5", float(t[2] + 1), float(t[0]), float(t[2] + 6))
    _rows, c = _answer("AAA", "5", et(*WED, 10, 12), rows=stale)
    spliced = c.pop("_bars")
    assert [r["t"] for r in spliced] == t and spliced[1]["c"] == 11
    assert c["complete_through"] == t[2]


def test_a_delta_answer_states_the_store_tail(store):
    t = [et(*WED, 10, m) for m in (0, 5, 10)]
    bs.put_bars("AAA", "5", [bar(x) for x in t])
    bs.record_sealed("AAA", "5", float(t[2] + 2), float(t[0]), float(t[2] + 7))
    c = bc.compute("AAA", "5", None, [], delta=True, now=et(*WED, 10, 12))
    assert c["complete_through"] == t[2] and c["developing"]["t"] == t[2]


def test_daily_answers_carry_the_fields_and_claim_nothing_unsealed(store):
    bs.put_bars("AAA", "D", [bar("2026-11-09"), bar("2026-11-10")], date_tf=True)
    rows = bf._fmt_sqlite_bars(_store_rows("AAA", "D"), "D")
    rows = rows + [bar("2026-11-11")]                       # today's appended developing bar
    c = bc.compute("AAA", "D", None, rows, now=et(*WED, 11, 0))
    assert c["grid"] == "plain" and c["session"] is None
    assert c["complete_through"] is None                    # no daily seal recorded (deferred)
    assert c["developing"]["t"] == "2026-11-11"
    bs.record_sealed("AAA", "D", float(et(2026, 11, 10, 20, 0)), 0.0, float(et(2026, 11, 10, 20, 0)))
    c = bc.compute("AAA", "D", None, rows, now=et(*WED, 11, 0))
    assert c["complete_through"] == et(2026, 11, 10, 16, 0)


def test_not_store_backed_answers_say_so():
    c = bc.compute("UCTA50", "D", None, [bar("2026-11-10")], store_backed=False,
                   now=et(*WED, 11, 0))
    assert c["series_rev"] is None and c["complete_through"] is None
    assert set(FIELDS) <= set(c)


@pytest.mark.parametrize("seed", range(12))
def test_property_complete_through_is_bounded_monotonic_and_final(store, monkeypatch, seed):
    """Random interleavings, driven through the REAL repair (`_heal_intraday_tail`) with a
    simulated provider that publishes a bucket's final aggregate a few seconds after it
    ends, whose rewritten window starts anywhere from the stored tail back a few buckets;
    plus live tail writes (no proof), idle clock steps and memory-cache snapshots.
    Invariants:
      I1 complete_through is None or the end of an answer row, <= now, and <= the end of
         the newest SEALED stored row;
      I2 it never moves backwards;
      I3 every row it has ever called final still has the same values at the end
         (no corrections happen here, and history_rev never moves)."""
    rng = random.Random(seed)
    tf, step = "5", 300
    clock = _Clock(et(*WED, 9, 30))
    monkeypatch.setattr(bf, "_time", clock)
    lag = bc.SEAL_LAG_S - 1           # the provider is late, but within the seal lag
    truth: dict[int, tuple] = {}
    claimed: dict[int, tuple] = {}
    last_ct = None
    h0 = None
    cached = None
    last_check = 0.0

    def true_bar(b):
        return truth.setdefault(b, (round(rng.uniform(5, 50), 4), rng.randint(1, 10_000)))

    def published(b):
        """What the provider returns for bucket b at the current instant."""
        c, v = true_bar(b)
        done = b + step <= clock.now - lag
        frac = 1.0 if done else min(0.99, max(0.0, (clock.now - lag - b) / step))
        return {"t": b, "o": c, "h": c + 1, "l": c - 1, "c": c, "v": max(1, int(v * frac))}

    def provider(last_ts):
        cur = int(clock.now) // step * step
        if last_ts is None or not last_ts:
            start = cur - 6 * step
        else:
            start = max(int(_store_rows("AAA", tf)[0][0]), int(last_ts) - rng.choice([0, 1, 3]) * step)
        return [published(b) for b in range(start, cur + 1, step)], start

    _fake_provider(monkeypatch, provider)
    for _ in range(160):
        clock.now += rng.choice([2, 4, 7, 31, 60, 120, 299, 301, 600])
        cur = int(clock.now) // step * step
        op = rng.random()
        last = bs.get_last_ts("AAA", tf)
        if op < 0.35 or last is None:
            bf._heal_intraday_tail("AAA", tf, int(last or 0))
            last_check = clock.now
        elif op < 0.6 and last >= cur - step:                  # live tail write
            bs.put_bars("AAA", tf, [published(cur)])
        elif op < 0.7:
            cached = bf._fmt_sqlite_bars(_store_rows("AAA", tf), tf)
        rows = cached if (cached and rng.random() < 0.3) else None
        served, c = _answer("AAA", tf, clock.now, rows=rows)
        served = c.pop("_bars", served)
        if h0 is None:
            h0 = c["history_rev"]
        ct = c["complete_through"]
        stored = _store_rows("AAA", tf)
        sealed_ends = [r[0] + step for r in stored if r[0] + step <= clock.now]
        if ct is not None:
            assert ct <= clock.now
            assert sealed_ends and ct <= max(sealed_ends)
            assert any(r["t"] + step == ct for r in served)
            if last_ct is not None:
                assert ct >= last_ct, (ct, last_ct)
            last_ct = ct
            for r in served:
                if r["t"] + step <= ct:
                    claimed.setdefault(r["t"], (r["c"], r["v"]))
        if c["developing"] is not None:
            assert c["developing"]["t"] <= clock.now < c["developing"]["t"] + step
        # I4 (integrator rule): a claim never outruns the rows it is attached to. Every
        # stored row inside the claimed-verified region is IN this payload with the
        # store's values — even when the payload began as an older cache snapshot — and
        # the claim is the raw proof (finality is sealed_through).
        vt = c["verified_through"]
        if vt is not None:
            assert vt <= last_check + 1e-6
            by_t = {r["t"]: (r["c"], r["v"]) for r in served}
            for r in stored:
                if r[0] + step <= vt:
                    assert by_t.get(r[0]) is not None and by_t[r[0]][1] == r[5], (r[0], vt)
    final_rows = {r[0]: (r[4], r[5]) for r in _store_rows("AAA", tf)}
    assert claimed, "the simulation never reached a sealed bucket — vacuous"
    assert bs.series_meta("AAA", tf)["history_rev"] == h0
    for t, val in claimed.items():
        assert final_rows[t][0] == pytest.approx(val[0]) and final_rows[t][1] == val[1], t
        assert val[1] == truth[t][1], ("a row called final was a partial", t)


# ── B. every serve branch carries the contract ──────────────────────────────

def _serve_labels() -> set[str]:
    """THE declared serve-label enum (P0 rail, `api/services/serve_labels.py`)."""
    from api.services.serve_labels import SERVE_LABELS
    return set(SERVE_LABELS)


def test_the_label_census_is_not_vacuous():
    labels = _serve_labels()
    assert {"sqlite", "mem", "delta", "stale-swr", "breadth", "index"} <= labels, labels


def _body(resp):
    return orjson.loads(resp.body)


#: Labels that never describe a 200 /api/bars answer with rows: the router's reset value,
#: the 503 shed, and the /api/bars-history literal (a different endpoint).
_NOT_A_BARS_ANSWER = {"entry", "warm-shed", "history-read"}


@pytest.mark.parametrize("label", sorted(_serve_labels() - _NOT_A_BARS_ANSWER))
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


def test_a_cached_payload_never_carries_a_newer_claim_than_its_rows(store, monkeypatch):
    """Router level: the rows come from a stale memory-cache payload, a repair has since
    landed newer rows AND a proof. The answer either carries those rows or does not
    claim them: here it carries them (reconciled to the store after the proof read),
    and tail_status judges the same lagged proof that is on the wire."""
    from api.routers import bars as br
    t = [et(*WED, 10, m) for m in (0, 5, 10, 15)]
    bs.put_bars("AAA", "5", [bar(x) for x in t[:2]])
    cached = bf._fmt_sqlite_bars(_store_rows("AAA", "5"), "5")
    bs.put_bars("AAA", "5", [bar(x, c=12) for x in t[1:]])     # the repair
    bf._mark_tail_verified("AAA", "5", time.time())
    monkeypatch.setattr(br, "_get_bars_inner", lambda *a, **k: br.JSONResponse(
        content={"ticker": "AAA", "tf": "5", "bars": cached}))
    body = _body(br._serve_bars_impl("AAA", "5", 200))
    assert [b["t"] for b in body["bars"]] == t and body["bars"][1]["c"] == 12
    assert body["verified_through"] <= time.time()
    assert body["tail_status"] in ("current", "verified", "unverified")


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

_WRITE_SQL = re.compile(r"(INTO\s+(main\.)?ohlcv\b|DELETE\s+FROM\s+(main\.)?ohlcv\b"
                        r"|UPDATE\s+(main\.)?ohlcv\b|DROP\s+TABLE[^\n]*ohlcv)", re.I)
_ACCOUNTS = ("bump_series_revs", "bump_store_floor", "_bump_merged_rev")
#: Writers that never touch the LIVE store (they build a separate export database).
_EXEMPT = {
    ("api/services/data_sync.py", "_export_delta_db"),
    # #1102: builds a PRIVATE clustered copy whose rows are verified identical to the
    # source and which carries series_meta / store_meta verbatim (so the copy's revs and
    # proofs describe exactly its rows); any install of it bumps the store floor.
    ("api/services/bars_cluster.py", "cluster_copy"),
}


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
        lines = src.splitlines()
        fn_types = (ast.FunctionDef, ast.AsyncFunctionDef)
        funcs = [n for n in ast.walk(tree) if isinstance(n, fn_types)]
        for n in funcs:
            # Line ranges, not ast.get_source_segment (O(file) per call: 30 s on main.py).
            if not _WRITE_SQL.search(chr(10).join(lines[n.lineno - 1:n.end_lineno])):
                continue
            own = set(range(n.lineno - 1, n.end_lineno))
            for m in ast.walk(n):
                if m is not n and isinstance(m, fn_types):
                    own -= set(range(m.lineno - 1, m.end_lineno))
            body = "\n".join(lines[i] for i in sorted(own))
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


# ── review #1098 fixes ───────────────────────────────────────────────────────

def test_F1_currentness_is_judged_on_the_RAW_proof(store):
    """A thin covered name proven 1 s after the 10:05 boundary is `verified` at once —
    the settle lag applies to finality (sealed_through), never to currentness."""
    t_old = et(*WED, 9, 30)
    bs.put_bars("AAA", "5", [bar(t_old)])
    proof = float(et(*WED, 10, 5, 1))
    bf._mark_tail_verified("AAA", "5", proof)
    now = et(*WED, 10, 5, 3)
    c = bc.compute("AAA", "5", None, bf._fmt_sqlite_bars(_store_rows("AAA", "5"), "5"), now=now)
    assert c["verified_through"] == proof
    st = bf.intraday_tail_status("AAA", "5", t_old, now=now, verified_through=c["verified_through"])
    assert st["tail_status"] == "verified"


def _seal(t, sealed, wstart, checked):
    bs.record_sealed("AAA", "5", float(sealed), float(wstart), float(checked))


def test_F2_an_older_check_never_overwrites_rows_a_newer_check_sealed(store):
    t = [et(*WED, 10, m) for m in (0, 5, 10)]
    bs.put_bars("AAA", "5", [bar(x, v=500) for x in t])              # final rows
    _seal(t, t[2], t[0], et(*WED, 10, 11))                           # check C2
    older = et(*WED, 10, 9)                                         # C1 < C2
    bs.put_bars("AAA", "5", [bar(t[0], v=10), bar(t[1], v=10), bar(t[2], v=10)],
                checked_at=older)
    vols = {r[0]: r[5] for r in _store_rows("AAA", "5")}
    assert vols[t[0]] == 500 and vols[t[1]] == 500                  # sealed span kept
    assert vols[t[2]] == 10                                          # beyond the seal: written
    with bs.provider_check(older):                                   # the repair's context
        bs.put_bars("AAA", "5", [bar(t[0], v=11)])
    assert {r[0]: r[5] for r in _store_rows("AAA", "5")}[t[0]] == 500
    bs.put_bars("AAA", "5", [bar(t[0], v=600)], checked_at=et(*WED, 10, 12))   # newer check
    assert {r[0]: r[5] for r in _store_rows("AAA", "5")}[t[0]] == 600


def test_F2_the_repair_writes_under_its_own_check_instant(store, monkeypatch):
    """`_heal_intraday_tail` persists inside `provider_check(checked_at)`."""
    seen = []
    real = bs.put_bars

    def spy(*a, **k):
        seen.append(getattr(bs._check_ctx, "at", None))
        return real(*a, **k)

    monkeypatch.setattr(bs, "put_bars", spy)
    clock = _Clock(et(*WED, 10, 7))
    monkeypatch.setattr(bf, "_time", clock)
    _fake_provider(monkeypatch, lambda last: ([bar(et(*WED, 10, 0))], et(*WED, 10, 0)))
    bf._heal_intraday_tail("AAA", "5", et(*WED, 10, 0))
    assert seen == [clock.now]


def test_F2_seal_lag_default_covers_late_minute_aggregates():
    assert bc.SEAL_LAG_S >= 30


def test_F3_a_seal_checked_before_a_wholesale_change_is_void(store):
    t0 = et(*WED, 10, 0)
    bs.put_bars("AAA", "5", [bar(t0)])
    now = time.time()
    bs.record_sealed("AAA", "5", now - 50, float(t0), now - 1)       # checked BEFORE the floor
    bs.flush_meta()
    bs.bump_store_floor("test")
    assert bs.series_meta("AAA", "5")["sealed_through"] is None
    later = time.time() + 1
    bs.record_sealed("AAA", "5", later - 45, float(t0), later)        # checked AFTER it
    assert bs.series_meta("AAA", "5")["sealed_through"] == later - 45


def test_F4_after_a_row_delete_a_seal_must_reach_back_to_the_deleted_point(store):
    t = [et(*WED, 10, m) for m in range(0, 30, 5)]
    bs.put_bars("AAA", "5", [bar(x) for x in t])
    c = bs._conn()
    with bs._WRITE_LOCK:
        c.execute("DELETE FROM ohlcv WHERE ticker='AAA' AND tf='5' AND ts=?", (t[1],))
        bs.bump_series_revs(c, [("AAA", "5")], deleted=True, deleted_from=t[1])
        c.commit()
    ck = time.time() + 1
    bs.record_sealed("AAA", "5", float(t[5]), float(t[3]), ck)        # window starts past the hole
    assert bs.series_meta("AAA", "5")["sealed_through"] is None
    bs.record_sealed("AAA", "5", float(t[5]), float(t[1]), ck + 1)    # reaches back to it
    assert bs.series_meta("AAA", "5")["sealed_through"] == float(t[5])
    bs.flush_meta()
    bs.reset_meta_state_for_tests()
    assert bs.series_meta("AAA", "5")["sealed_through"] == float(t[5])   # SQL agrees


# ── re-review follow-ups ─────────────────────────────────────────────────────

def _spy_check_instants(monkeypatch):
    seen = []
    real = bs.put_bars

    def spy(*a, **k):
        seen.append(getattr(bs._check_ctx, "at", None))
        return real(*a, **k)

    monkeypatch.setattr(bs, "put_bars", spy)
    return seen


@pytest.mark.parametrize("site", ["cold", "deepfill"])
def test_untimed_provider_writes_now_carry_their_check_instant(store, monkeypatch, site):
    """The cold fetch and the deep-fill persist under `provider_check(t0)` (t0 taken
    BEFORE the fetch), so an older full fetch cannot overwrite rows a newer check sealed;
    and a full fetch COVERS the series from its oldest row (`record_cover`)."""
    seen = _spy_check_instants(monkeypatch)
    clock = _Clock(et(*WED, 10, 7))
    monkeypatch.setattr(bf, "_time", clock)
    rows = [bar(et(*WED, 10, m)) for m in (0, 5)]
    monkeypatch.setattr(bf, "_fetch_intraday", lambda *a, **k: list(rows))
    monkeypatch.setattr(bf, "_is_intraday_stale", lambda raw: False)
    covered = []
    monkeypatch.setattr(bs, "record_cover", lambda t, tf, frm, ck: covered.append((frm, ck)))
    if site == "cold":
        bf._do_cold_fetch("AAA", "5", 200, False)
    else:
        bf._deepfill_once("AAA", "5", 200)
    assert seen and all(x == clock.now for x in seen)
    assert covered == [(rows[0]["t"], clock.now)]


def test_alert_and_live_store_backfill_write_inside_provider_check():
    """Source rail: the two out-of-module provider writers persist inside a
    `provider_check(...)` block."""
    for rel, call in (("api/services/alert_bars_freshness.py", "rows = _sqlite.put_bars(sym_up"),
                      ("api/services/bars_live_store.py", 'bars_sqlite.put_bars(sym, "5", closed)')):
        src = (ROOT / rel).read_text(encoding="utf-8")
        i = src.index(call)
        assert "provider_check" in src[max(0, i - 300):i], rel


def test_bulk_delete_point_blocks_sealing_until_a_repair_reaches_back(store):
    t = [et(*WED, 10, m) for m in range(0, 30, 5)]
    bs.put_bars("AAA", "5", [bar(x) for x in t])
    bs.bump_store_floor("boot heal", deleted_from=t[1])
    ck = time.time() + 1
    bs.record_sealed("AAA", "5", float(t[5]), float(t[3]), ck)        # does not reach back
    assert bs.series_meta("AAA", "5")["sealed_through"] is None
    bs.record_sealed("AAA", "5", float(t[5]), float(t[1]), ck + 1)    # reaches the point
    assert bs.series_meta("AAA", "5")["sealed_through"] == float(t[5])
    bs.flush_meta()
    bs.reset_meta_state_for_tests()                                   # persisted, SQL path
    assert bs.series_meta("AAA", "5")["sealed_through"] == float(t[5])
    # another series has not been covered since the bulk delete: still blocked
    bs.record_sealed("BBB", "5", float(t[5]), float(t[3]), ck + 2)
    assert bs.series_meta("BBB", "5")["sealed_through"] is None


def test_a_full_fetch_or_gap_fill_clears_the_delete_point(store):
    """F4 follow-up: a series must not lose complete_through forever after a delete —
    a full fetch (`record_cover`) or a gap-fill (`covers_from`) that restores rows from
    at or before the delete point clears it; the tail repair's 8 h window then seals."""
    t = [et(*WED, 10, m) for m in range(0, 30, 5)]
    bs.put_bars("AAA", "5", [bar(x) for x in t])
    c = bs._conn()
    with bs._WRITE_LOCK:
        c.execute("DELETE FROM ohlcv WHERE ticker='AAA' AND tf='5' AND ts=?", (t[1],))
        bs.bump_series_revs(c, [("AAA", "5")], deleted=True, deleted_from=t[1])
        c.commit()
    ck = time.time() + 1
    bs.record_cover("AAA", "5", float(t[0]), ck)
    bs.record_sealed("AAA", "5", float(t[5]), float(t[4]), ck + 1)
    assert bs.series_meta("AAA", "5")["sealed_through"] == float(t[5])
    # the same through a gap-fill seal (covers_from below the delete, window above it)
    with bs._WRITE_LOCK:
        c.execute("DELETE FROM ohlcv WHERE ticker='AAA' AND tf='5' AND ts=?", (t[2],))
        bs.bump_series_revs(c, [("AAA", "5")], deleted=True, deleted_from=t[2])
        c.commit()
    ck2 = time.time() + 5
    bs.record_sealed("AAA", "5", float(t[5]), float(t[4]), ck2, covers_from=float(t[0]))
    assert bs.series_meta("AAA", "5")["sealed_through"] == float(t[5])
    bs.flush_meta()
    bs.reset_meta_state_for_tests()
    assert bs.series_meta("AAA", "5")["sealed_through"] == float(t[5])


# ── #1102 composition: clustered store, adoption, write tracking ─────────────

def test_cluster_copy_carries_series_meta_and_store_meta(tmp_path):
    """The offline clustered copy keeps the meta tables (same rows, same WITHOUT ROWID
    layout), so a clustered snapshot states the same revs / proofs as its source."""
    import sqlite3
    from api.services import bars_cluster
    src, dst = tmp_path / "src.db", tmp_path / "dst.db"
    c = sqlite3.connect(str(src))
    c.execute("CREATE TABLE ohlcv (ticker TEXT NOT NULL, tf TEXT NOT NULL, ts INTEGER NOT NULL, "
              "o REAL, h REAL, l REAL, c REAL, v INTEGER, PRIMARY KEY (ticker, tf, ts))")
    c.executemany("INSERT INTO ohlcv VALUES (?,?,?,?,?,?,?,?)",
                  [("AAA", "5", 1_700_000_100 + k * 300, 1, 2, 0.5, 1.5, 10) for k in range(20)])
    bs._create_meta_tables(c)
    c.execute("INSERT INTO series_meta(ticker, tf, rev, history_rev, verified_through, "
              "sealed_through, sealed_checked_at, unsealed_from, covered_at, proof_floor) "
              "VALUES ('AAA', '5', 123, 100, 1.5, 2.5, 3.5, 7, 4.5, 0.5)")
    c.execute("INSERT INTO store_meta(k, v) VALUES ('rev_floor_ms', 99.0)")
    c.commit(); c.close()
    bars_cluster.cluster_copy(str(src), str(dst))
    d = sqlite3.connect(str(dst))
    try:
        assert d.execute("SELECT ticker, tf, rev, history_rev, verified_through, sealed_through, "
                         "sealed_checked_at, unsealed_from, covered_at, proof_floor "
                         "FROM series_meta").fetchall() == [
            ("AAA", "5", 123, 100, 1.5, 2.5, 3.5, 7, 4.5, 0.5)]
        assert d.execute("SELECT k, v FROM store_meta").fetchall() == [("rev_floor_ms", 99.0)]
        ddl = d.execute("SELECT sql FROM sqlite_master WHERE name='series_meta'").fetchone()[0]
        assert "WITHOUT ROWID" in ddl.upper()
        assert bs.ohlcv_layout(d) == "clustered"
    finally:
        d.close()


def test_every_write_is_both_tracked_and_revved(store):
    """#1102 adoption's write tracking and the contract's series_rev both happen on every
    put_bars / put_bars_many write (and a fully-refused stale write is neither)."""
    bs.start_write_tracking()
    try:
        r0 = bs.series_meta("AAA", "5")["rev"]
        bs.put_bars("AAA", "5", [bar(et(*WED, 10, 0))])
        bs.put_bars_many("5", {"BBB": [bar(et(*WED, 10, 0))]})
        assert bs.series_meta("AAA", "5")["rev"] > r0 and bs.series_meta("BBB", "5")["rev"] > 0
        bs.record_sealed("AAA", "5", float(et(*WED, 10, 5)), float(et(*WED, 10, 0)), 2e9)
        r1 = bs.series_meta("AAA", "5")["rev"]
        assert bs.put_bars("AAA", "5", [bar(et(*WED, 10, 0), v=1)], checked_at=1e9) == 0
        assert bs.series_meta("AAA", "5")["rev"] == r1
    finally:
        tracked = bs.stop_write_tracking()
    assert {("AAA", "5"), ("BBB", "5")} <= tracked
