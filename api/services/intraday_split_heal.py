"""HEAL a split CLIFF in the stored INTRADAY series — every row, one transaction.

🔴 THE DEFECT. Massive's intraday aggs are `adjusted=true` AS OF FETCH TIME. Rows the
store fetched before a split stay on the old scale forever; every delta after the split
lands on the new one. The trailing heal window (8h) and the gap-fill (2-14 days) only
re-write RECENT rows, so the pre-split body of the series was never re-adjusted: the
chart showed a 2x / 10x cliff at the split session on 1/5/15/30/60m.

⭐ ONE DETECTOR. The session-level judgement is `bars_sanitize.unadjusted_splits` asked of
the series' per-session closes (exactly what `intraday_unadjusted_splits` does): same
`_SPLIT_TOL`, same `adjudicable` guard, same ± window around the declared date.

⭐ WHY THE WRITE IS NOW SAFE (integrator review N1/N2, 2026-11-10, answered).
Two earlier write designs were withdrawn because they chose WHICH rows to divide by
POSITION (everything below a boundary / a cursor) without proof that those rows — and only
those — were on the old basis: a re-heal after a partial rewrite, or new-basis rows written
below a pending cursor, would be divided twice. This heal decides from the DATA and proves it
over the WHOLE series, at BAR resolution, before it writes anything:
  1. the session-level detector reports the cliff (boundary session B, ratio r);
  2. one streamed pass over every stored close of the series counts the bar-to-bar steps
     that match r (`close[k-1]/close[k]`, `_SPLIT_TOL`) and the steps that match 1/r. The
     plan stands only when r matches EXACTLY ONE step in the whole series, inside session B,
     and 1/r matches NONE. A mixed series (new-basis rows prepended below old-basis rows by a
     deep fetch after the split, a gap-fill that rewrote part of the old span) shows its
     junction as a 1/r step and is refused; a bad print or a real split-sized move anywhere
     makes the step count != 1 and is refused. Refused => detect + log only, `adj_basis`
     unknown — exactly the old behaviour;
  3. the rows strictly before that one bar are divided by r (volume x r) — the ONLY rows a
     single, proven old->new step can leave on the old basis;
  4. `bars_sqlite.apply_split_basis` writes every intraday tf of the ticker in ONE
     transaction (`BEGIN IMMEDIATE`) and only if no series changed since it was read
     (optimistic `series_meta.rev` check — a write that landed in between voids the plan,
     "raced", re-planned on a later serve); `history_rev` moves exactly once per rescaled
     series and `adj_basis` is stamped in the same commit.
Idempotent by construction: after the commit the step is gone (step 2 finds nothing), the
stamp equals the target basis (the check is not even scheduled again), and a concurrent or
repeated heal is stopped by the rev check.

`adj_basis` (adjustment_basis.basis_id): every check stamps the series with the set of
splits its rows are on — applied (no cliff over a fully observed window, or the split
predates the series) plus healed. A split whose window the series has not fully reached
cannot be judged: it stays out of the set while every row predates the split's date, and
makes the stamp unknown (None) once rows were written since; an unprovable cliff stamps None.

⛔ BOUNDED, OFF THE REQUEST PATH. `note_served` (called from the intraday serve chokepoint
`bars_fetch._fmt_sqlite_bars`) does only cache reads and one series_meta PK read; the check
runs on ONE background worker with a small dedup'd queue, and a (ticker, tf, target basis)
is checked at most once per `_CHECK_TTL_S`. Split metadata is read from `bars_sanitize`'s
cache only — never a synchronous vendor call on a serve path; a cache MISS checks nothing
(it never stamps "no split" for a ticker it could not ask about).
Write-lock cost: the scan reads closes in PK pages OUTSIDE the lock; the lock is held for
one indexed UPDATE per event per tf plus the meta upserts.
⚠️ (F5, known) A cache MISS in `note_served` schedules `bars_sanitize`'s metadata warm
for that ticker — the same bounded, deduped 2-worker warm the daily serve path already
triggers for every ticker it sanitizes.

Review of #1144 (D1-D4): a step claimed by two declared events is refused (never divided
twice); a rescale additionally needs `daily_proof` — the stored daily closes show the
intraday rows before the step are r x the same day's daily close while the rows after it
match (a real gap shows in BOTH series and is never written); the stamp is bound to the
history_rev and first row it was taken at (`bars_sqlite.series_meta` serves it only while
both still hold, so a later old-basis write makes it unknown and re-checked); each series is
its own bounded transaction (`_max_rows`, held_ms logged).

Modes: `INTRADAY_SPLIT_HEAL_MODE=report` (DEFAULT) plans and logs
`[intraday-split-heal] WOULD-RESCALE <tk> tfs=<tf> boundary=<ts> ratio=<r> rows=<n>` and
counts would-be stamps (`STATS`), writing NOTHING (no rows, no stamps: the served adj_basis
stays null, clients fall back to their ratio test); `write` applies. Hard off:
`INTRADAY_SPLIT_HEAL_ENABLED=0` — no checks at all.
"""
from __future__ import annotations

import logging
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta
from typing import Optional, Sequence
from zoneinfo import ZoneInfo

_log = logging.getLogger(__name__)
_ET = ZoneInfo("America/New_York")

INTRADAY_TFS = ("1", "5", "15", "30", "60")
#: A (ticker, tf, target basis) is re-checked at most this often.
_CHECK_TTL_S = float(os.environ.get("INTRADAY_SPLIT_HEAL_CHECK_TTL_S", str(6 * 3600)))
_CHECK_MAX_KEYS = 50_000
_QUEUE_MAX = 32
#: A split-sized bar step seen more often than this in one series is never a single basis
#: junction — stop collecting (the plan is refused anyway).
_MAX_STEP_MATCHES = 8

_pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="intraday-split-heal")
_lock = threading.Lock()
_inflight: set[str] = set()
_checked: dict[tuple, float] = {}


#: D2: intraday RTH close / stored daily close for one date — the same price to this much.
_DAILY_TOL = 0.03
#: Process counters (ops / tests): plans logged in report mode and writes in write mode.
STATS = {"would_rescale": 0, "would_stamp": 0, "rescaled": 0, "stamped": 0}


def enabled() -> bool:
    """The HARD off: `INTRADAY_SPLIT_HEAL_ENABLED=0` — no checks, no logs, no writes."""
    return os.environ.get("INTRADAY_SPLIT_HEAL_ENABLED", "1") != "0"


def mode() -> str:
    """`INTRADAY_SPLIT_HEAL_MODE` = "report" (DEFAULT: plan + log `WOULD-RESCALE`, write
    nothing — no rows, no stamps) | "write" (rescale proven cliffs, stamp adj_basis)."""
    return "write" if os.environ.get("INTRADAY_SPLIT_HEAL_MODE", "report").strip().lower() == "write" else "report"


def _max_rows() -> int:
    """Rows one series' rescale may touch in ONE transaction (a deeper old-basis span is
    refused and logged "too-deep", never written in one huge UPDATE). ~240k 1m rows
    measured ~0.14 s under the lock on a dev store."""
    try:
        return int(os.environ.get("INTRADAY_SPLIT_HEAL_MAX_ROWS", "300000"))
    except ValueError:
        return 300000


def _session_date(t) -> Optional[date]:
    try:
        return datetime.fromtimestamp(int(t), _ET).date()
    except (TypeError, ValueError, OverflowError, OSError):
        return None


def _declared_or_none(ticker: str):
    """Declared splits from `bars_sanitize`'s CACHE, or None on a cold miss (which, outside
    tests, schedules its warm). None and [] are different facts: a basis is never stamped
    for a ticker whose splits could not be read."""
    from api.services import bars_sanitize as _san
    if os.environ.get("PYTEST_CURRENT_TEST"):
        # cache-only under pytest: no vendor warm thread from a serve-path unit test
        meta = _san._META_CACHE.get(_san._META_KEY.format(ticker.upper()))
    else:
        meta = _san._meta_cached(ticker.upper())
    if meta is None:
        return None
    return list(meta.get("splits") or [])


def _declared(ticker: str) -> list:
    return _declared_or_none(ticker) or []


def declared_splits_cached(ticker: str) -> list:
    """Declared splits from cache ONLY — never schedules a warm (for the R2 merge)."""
    try:
        from api.services import bars_sanitize as _san
        meta = _san._META_CACHE.get(_san._META_KEY.format(ticker.upper())) or {}
        return list(meta.get("splits") or [])
    except Exception:  # noqa: BLE001
        return []


def note_served(ticker: str, tf: str, bars: Sequence[dict]) -> bool:
    """Serve-path hook: schedule a background basis check of `ticker` when this series'
    stored `adj_basis` is not the ticker's target basis (a declared split it was not checked
    against yet, or never checked). Cheap (cache reads + one PK read), never raises, never
    blocks. Returns True when a check was scheduled."""
    try:
        if not enabled() or tf not in INTRADAY_TFS or not bars or len(bars) < 2:
            return False
        tk = ticker.upper()
        splits = _declared_or_none(tk)
        if splits is None:
            return False                   # cold metadata: nothing can be judged yet
        from api.services import adjustment_basis as _ab
        target = _ab.target_basis_id(splits)
        key = (tk, tf, target)
        now = time.monotonic()
        with _lock:
            exp = _checked.get(key)
            if exp is not None and now < exp:
                return False
        from api.services import bars_sqlite
        stamped = bars_sqlite.series_meta(tk, tf).get("adj_basis")
        with _lock:
            if len(_checked) >= _CHECK_MAX_KEYS:
                _checked.clear()           # bounded; a cleared memo costs one re-check
            _checked[key] = now + _CHECK_TTL_S
            if stamped == target:
                return False
            if tk in _inflight or len(_inflight) >= _QUEUE_MAX:
                _checked.pop(key, None)    # not scheduled: a later serve asks again
                return False
            _inflight.add(tk)
        # 🔴 Never from a test process: a daemon heal outliving a test would write into
        # whatever store the restored `_DB_PATH` points at (see bars_fetch deepfill).
        if os.environ.get("PYTEST_CURRENT_TEST"):
            with _lock:
                _inflight.discard(tk)
            return False

        def _job():
            try:
                res = heal_ticker(tk)
                if any(r.get("status") == "raced" for r in res):
                    with _lock:            # re-plan on a later serve, not in 6 h
                        for k in [k for k in _checked if k[0] == tk]:
                            _checked.pop(k, None)
            except Exception as e:  # noqa: BLE001
                _log.warning("[intraday-split-heal] %s failed: %s", tk, e)
            finally:
                with _lock:
                    _inflight.discard(tk)
        try:
            _pool.submit(_job)
        except Exception:  # noqa: BLE001
            with _lock:
                _inflight.discard(tk)
            return False
        return True
    except Exception:  # noqa: BLE001 — never into a serve
        return False


# ── the proof ────────────────────────────────────────────────────────────────

def _within(q: float, r: float, tol: float) -> bool:
    return r > 0 and abs(q / r - 1.0) <= tol


#: RTH bucket starts (ET minute of day) whose close is a session's RTH close: the daily
#: bar's close is the 16:00 close, never an after-hours print.
_RTH_FROM_MIN, _RTH_TO_MIN = 9 * 60 + 30, 16 * 60


def scan_series(rows, ratios: Sequence[float], tol: float) -> dict:
    """ONE streamed pass over `(ts, close)` rows (oldest first): per-session last closes,
    per-session last RTH closes, and — per ratio r — `(ts, rows_before)` of every bar whose
    step from the previous bar (`close[k-1] / close[k]`) matches r ("fwd") or 1/r ("inv")
    to `tol`. O(sessions) memory."""
    last: dict[str, float] = {}
    rth: dict[str, float] = {}
    fwd = {r: [] for r in ratios}
    inv = {r: [] for r in ratios}
    prev = None
    n = 0
    for ts, c in rows:
        try:
            c = float(c)
        except (TypeError, ValueError):
            continue
        if not (c > 0):
            continue
        try:
            dt = datetime.fromtimestamp(int(ts), _ET)
        except (TypeError, ValueError, OverflowError, OSError):
            continue
        iso = dt.date().isoformat()
        last[iso] = c
        if _RTH_FROM_MIN <= dt.hour * 60 + dt.minute < _RTH_TO_MIN:
            rth[iso] = c
        if prev is not None:
            q = prev / c
            for r in ratios:
                if _within(q, r, tol):
                    if len(fwd[r]) <= _MAX_STEP_MATCHES:
                        fwd[r].append((int(ts), n))
                elif _within(q, 1.0 / r, tol) and len(inv[r]) <= _MAX_STEP_MATCHES:
                    inv[r].append((int(ts), n))
        n += 1
        prev = c
    return {"closes": [{"t": d, "c": last[d]} for d in sorted(last)], "rth": rth,
            "fwd": fwd, "inv": inv, "rows": n}


def _et_midnight_ms(iso: str) -> int:
    d = date.fromisoformat(iso)
    return int(datetime(d.year, d.month, d.day, tzinfo=_ET).timestamp() * 1000)


def daily_proof(ticker: str, boundary: date, r: float, rth_closes: dict) -> str:
    """D2 (review of #1144) — INDEPENDENT proof that the intraday rows before `boundary` are
    on the OLD basis. A unique bar step of the split's size is weak evidence on its own: a
    6:5 split's accept band (1.02-1.38) contains ordinary gaps, and a correctly adjusted
    series with an 8% gap near a declared 6:5 split looks exactly like a cliff.

    The stored DAILY closes (raw, as stored) are the reference: up to 3 sessions on each
    side of the boundary are compared with the intraday series' own RTH closes for the SAME
    dates. "old" only when every pre-boundary ratio intraday/daily ≈ r AND every
    post-boundary one ≈ 1 (`_DAILY_TOL`) — the step exists in the intraday rows and NOT in
    the daily rows, so it is a basis difference, not a price move. Anything else
    (a real gap: both series show it, ratios ≈ 1 on both sides; daily not stored; daily
    itself unadjusted; mixed) is "unknown" — never written. Reads one indexed window."""
    from api.services import bars_sqlite
    hi = boundary + timedelta(days=20)
    try:
        rows = bars_sqlite.get_bars_before(ticker.upper(), "D", 60,
                                           int(hi.strftime("%Y%m%d")))
    except Exception:  # noqa: BLE001
        return "unknown"
    daily = {}
    for row in rows:
        s = str(row[0])
        c = row[4]
        if c and c > 0:
            daily[f"{s[:4]}-{s[4:6]}-{s[6:8]}"] = float(c)
    b = boundary.isoformat()
    both = sorted(s for s in rth_closes if s in daily)
    pre = [s for s in both if s < b][-3:]
    post = [s for s in both if s >= b][:3]
    if not pre or not post:
        return "unknown"
    q_pre = [rth_closes[s] / daily[s] for s in pre]
    q_post = [rth_closes[s] / daily[s] for s in post]
    if all(_within(q, r, _DAILY_TOL) for q in q_pre) and all(_within(q, 1.0, _DAILY_TOL) for q in q_post):
        return "old"
    return "unknown"


def plan_series(ticker: str, tf: str, events: Sequence, *, rows=None,
                meta: Optional[dict] = None) -> dict:
    """Judge ONE stored (ticker, tf) against the adjudicable `events` [(iso, ratio)] and
    return its plan: {"tf", "rev", "stamped", "adj_basis", "rescale": [(boundary_ts, r)],
    "cliffs", "refused", "pending", "rows"}. Reads only (series meta first, then the closes,
    so the plan is never newer than the rev it is checked against).

    A rescale is planned only when ALL hold: the session detector reports the cliff; r
    matches exactly one bar step in the whole series, inside that session, and 1/r none;
    no OTHER declared event claims the same step (D1: one split listed twice — two dates,
    two sources — must never divide the rows twice); `daily_proof` says the rows before it
    are on the old basis (D2); and the rows before it fit one bounded write (`_max_rows`)."""
    from api.services import adjustment_basis as _ab
    from api.services import bars_sanitize as _san
    from api.services import bars_sqlite

    tk = ticker.upper()
    meta = meta if meta is not None else bars_sqlite.series_meta(tk, tf)
    out = {"tf": tf, "rev": int(meta.get("rev") or 0), "stamped": meta.get("adj_basis"),
           "adj_basis": None, "adj_events": None, "rescale": [], "cliffs": [], "refused": [],
           "pending": [], "rows": 0}
    #: events an earlier check or heal of THIS series established as applied (its stamp —
    #: bound to the history_rev and first row it was taken at, see bars_sqlite.series_meta).
    known = {(d, f"{float(r):.6g}") for d, r in (meta.get("adj_events") or ())}
    if rows is None:
        # No split after the series' first session: nothing can be on another basis, and
        # the whole check is one PK seek (never a scan).
        first = bars_sqlite.get_first_ts(tk, tf)
        if first is None:
            out["empty"] = True
            return out
        fs = _session_date(first)
        if fs is not None and all(d <= fs.isoformat() for d, _r in events):
            out["adj_events"] = list(events)
            out["adj_basis"] = _ab.basis_id(events)
            return out
    ratios = sorted({float(r) for _d, r in events})
    scan = scan_series(rows if rows is not None else bars_sqlite.iter_ts_close(tk, tf),
                       ratios, _san._SPLIT_TOL)
    out["rows"] = scan["rows"]
    closes = scan["closes"]
    if not closes:
        out["empty"] = True
        return out
    sessions = [c["t"] for c in closes]
    first_s = sessions[0]
    applied, unknown = [], False
    win = _san._SPLIT_BOUNDARY_WINDOW
    candidates = []                      # (event, step_ts, rows_before, boundary_session)

    def refuse(d, r, why, boundary=None):
        out["refused"].append({"split": d, "ratio": r, "boundary": boundary, "why": why,
                               "fwd_steps": len(scan["fwd"].get(r, [])),
                               "inv_steps": len(scan["inv"].get(r, []))})

    for d, r in events:
        r = float(r)
        if d <= first_s:
            applied.append((d, r))           # every stored row is already after it
            continue
        anchor = next((i for i, s in enumerate(sessions) if s >= d), None)
        cliff = _san.unadjusted_splits(closes, [(d, r)])
        if cliff:
            b = cliff[0][0]
            out["cliffs"].append((b.isoformat(), r))
            steps, inv = scan["fwd"].get(r, []), scan["inv"].get(r, [])
            if len(steps) == 1 and not inv and _session_date(steps[0][0]) == b:
                candidates.append(((d, r), steps[0][0], steps[0][1], b))
            else:
                refuse(d, r, "step-not-unique", b.isoformat())
                unknown = True
            continue
        if scan["fwd"].get(r) or scan["inv"].get(r):
            # A split-sized BAR step the session closes do not show at the declared window —
            # hidden by a same-session move, or anywhere else in the series (an old-basis
            # span prepended far from the split's date): neither "applied" nor provable.
            refuse(d, r, "hidden-step")
            unknown = True
            continue
        if (d, f"{r:.6g}") in known and anchor is not None:
            applied.append((d, r))           # established earlier; no cliff since
            continue
        if anchor is None or len(sessions) - anchor <= win:
            # The series has not reached (all of) the window the step can fall in: not
            # judgeable yet. Rows all written before the split's date are not adjusted for
            # it; once rows were written since, they may be on either basis.
            out["pending"].append(d)
            if out["rev"] >= _et_midnight_ms(d):
                unknown = True
            continue
        applied.append((d, r))               # the whole window observed, no cliff: applied

    # D1: a step claimed by more than one declared event is one split listed twice (or two
    # ratios inside one tolerance band) — it is never divided once per listing: refused.
    claims: dict[int, list] = {}
    for cand in candidates:
        claims.setdefault(cand[1], []).append(cand)
    for step_ts, group in claims.items():
        if len(group) > 1:
            for (d, r), _ts, _n, b in group:
                refuse(d, r, "step-claimed-twice", b.isoformat())
            unknown = True
            continue
        (d, r), _ts, n_before, b = group[0]
        proof = daily_proof(tk, b, r, scan["rth"])
        if proof != "old":
            refuse(d, r, f"daily-proof-{proof}", b.isoformat())
            unknown = True
            continue
        if n_before > _max_rows():
            refuse(d, r, "too-deep", b.isoformat())
            unknown = True
            continue
        out["rescale"].append((step_ts, r))
        out.setdefault("rescale_rows", {})[step_ts] = n_before
        applied.append((d, r))
    out["adj_events"] = None if unknown else applied
    out["adj_basis"] = None if unknown else _ab.basis_id(applied)
    return out


def _invalidate_served_caches(tk: str, tfs) -> None:
    """Every cached /api/bars payload of a rescaled series is on the old basis."""
    try:
        from api.services import bars_disk_cache as _disk
        for tf in tfs:
            _disk.delete(tk, tf)
    except Exception:  # noqa: BLE001 — a stale disk JSON is re-validated on read anyway
        pass
    try:
        from api.services.cache import cache as _mem
        _mem.delete_prefix(f"bars_{tk}_")
        _mem.delete_prefix(f"histfull_{tk}_")
    except Exception:  # noqa: BLE001
        pass


def heal_ticker(ticker: str, *, splits: Optional[Sequence] = None,
                tfs: Sequence[str] = INTRADAY_TFS, as_of: Optional[date] = None) -> list[dict]:
    """Check every intraday tf of one ticker and, in WRITE mode, rescale every PROVEN cliff
    and stamp `adj_basis` (`bars_sqlite.apply_split_basis`: one bounded transaction per
    series). In REPORT mode (the default) the same plan is only LOGGED — no row, no stamp is
    written. A tf whose read fails is simply not part of the write."""
    from api.services import adjustment_basis as _ab
    from api.services import bars_sqlite
    if not enabled():
        return []
    tk = ticker.upper()
    declared = list(splits) if splits is not None else _declared_or_none(tk)
    if declared is None:
        return []
    events = _ab.adjudicable_events(declared, as_of)
    plans, res = {}, []
    for tf in tfs:
        try:
            p = plan_series(tk, tf, events)
        except Exception as e:  # noqa: BLE001
            _log.warning("[intraday-split-heal] %s tf=%s: %s", tk, tf, e)
            res.append({"ticker": tk, "tf": tf, "error": str(e), "written": 0, "cliffs": []})
            continue
        p["ticker"] = tk
        p["written"] = 0
        res.append(p)
        if p.get("empty"):
            continue
        if p["refused"]:
            _log.warning("[intraday-split-cliff] %s tf=%s split boundary(ies) %s NOT rewritten: %s",
                         tk, tf, [c[0] for c in p["cliffs"]],
                         [(x["why"], x["fwd_steps"], x["inv_steps"]) for x in p["refused"]])
        if p["rescale"] or p["adj_basis"] != p["stamped"]:
            plans[tf] = {"rev": p["rev"], "adj_events": p["adj_events"], "rescale": p["rescale"]}
    if not plans:
        for p in res:
            p.setdefault("status", "unchanged")
        return res
    per = {p["tf"]: p for p in res}
    if mode() != "write":
        # ⛔ REPORT: nothing is written — not the rows, not even a stamp. A stamp is what the
        # client trusts to keep a cached copy; stamping from a heal whose decisions are still
        # being validated would make the clients trust them first.
        for tf, plan in plans.items():
            per[tf]["status"] = "report"
            for step_ts, r in plan["rescale"]:
                STATS["would_rescale"] += 1
                _log.warning("[intraday-split-heal] WOULD-RESCALE %s tfs=%s boundary=%d ratio=%.6g rows=%d",
                             tk, tf, step_ts, r, per[tf].get("rescale_rows", {}).get(step_ts, 0))
            if not plan["rescale"]:
                STATS["would_stamp"] += 1
        for p in res:
            p.setdefault("status", "unchanged")
        return res
    out = bars_sqlite.apply_split_basis(tk, plans)
    for tf, r in out["by_tf"].items():
        per[tf]["status"] = r["status"]
        if r["status"] != "applied":
            continue
        if r["rows"]:
            per[tf]["written"] = int(r["rows"])
            STATS["rescaled"] += 1
            _log.warning("[intraday-split-heal] RESCALED %s tf=%s boundaries=%s rows=%d held_ms=%.0f",
                         tk, tf, [b for b, _r in plans[tf]["rescale"]], r["rows"], r["held_ms"])
        else:
            STATS["stamped"] += 1
            _log.info("[intraday-split-heal] STAMP %s tf=%s adj_basis=%s held_ms=%.0f", tk, tf,
                      per[tf]["adj_basis"], r["held_ms"])
    if out["rescaled"]:
        _invalidate_served_caches(tk, out["rescaled"])
    if any(r["status"] == "raced" for r in out["by_tf"].values()):
        _log.info("[intraday-split-heal] %s: a write landed after the plan -- re-planned "
                  "on a later serve", tk)
    for p in res:
        p.setdefault("status", "unchanged")
    return res


def heal_series(ticker: str, tf: str, *, splits: Optional[Sequence] = None,
                as_of: Optional[date] = None) -> dict:
    """`heal_ticker` for one tf (tests / ops)."""
    res = heal_ticker(ticker, splits=splits, tfs=(tf,), as_of=as_of)
    return res[0] if res else {"ticker": ticker.upper(), "tf": tf, "cliffs": [], "written": 0}
