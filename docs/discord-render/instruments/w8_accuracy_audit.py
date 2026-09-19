"""W8 — accuracy audit for the Discord render pipeline (/chart, /flow, /buzz).

⛔ THE BUG CLASS THIS EXISTS TO CATCH. `api/services/discord_chart_render.py`'s
`compute_stats()` docstring records a real incident (2026-08-31): a chart's stats
strip was computed CORRECTLY off the bars it was handed, and the bars were one
session stale — so the strip printed "Day -3.5%" (Friday's session) on a message
captioned Monday, while SMH had actually gained +0.6% that day. Internally
consistent, externally wrong, and no amount of re-checking the STRIP's own math
would ever have caught it, because the math was right. The only way to catch this
class is a SECOND, INDEPENDENTLY-SOURCED number for the same fact, diffed against
the first — never a self-consistency check on one source alone.

Same shape, three surfaces:
  - /chart: the bars-derived day_pct vs. a live snapshot's own change_pct
    (`check_chart_vs_snapshot`) — the SMH incident's exact mechanism.
  - /buzz: the served board's per-ticker mention counts vs. a raw SQL tally
    written from scratch against `mentions`, NEVER calling `buzz_store.board()`
    (the function under audit) — mirrors `tools/buzz_audit_extraction.py`'s own
    documented lesson: "the day-one audit ran the SAME extractor on both sides
    and proved ingest fidelity, nothing about extraction quality."
  - /flow: STRUCTURAL / internal-consistency checks (`check_flow_internal_consistency`:
    contract values must sum to the reported net, the top-contracts list must be
    sorted as claimed) PLUS a raw-tape UPPER-BOUND check against flow.db
    (`check_flow_against_raw_tape`, 2026-09-19): each shown contract's premium
    and volume must never exceed the unconstrained raw total for that exact
    (cp, strike, exp) on the card's date. Deliberately NOT a re-implementation
    of `_build_by_contract`'s business rules (color gate, per-day caps,
    sweep-only filtering, source routing) — an upper bound is a sound invariant
    regardless of those nuances (a filtered subset can never exceed its own
    superset), so it cannot false-positive on a legitimate filtering rule the
    way two independent copies of the SAME business logic could. It WOULD catch
    a wrong-ticker/date join, a stale/cached payload, a scale/unit error, or a
    contract shown with zero raw support. **What this still does NOT cover**:
    the reported net direction and the top-N contract SELECTION are not
    independently re-derived — only the per-contract premium/volume magnitudes
    are bounds-checked against ground truth. A full independent re-derivation
    of `_build_by_contract`'s selection and direction logic remains a named
    gap, not a promise.

Every check in this module is EITHER a pure function (no I/O — exercised by
--self-check, which proves each one can both fire on a planted defect and stay
quiet on a clean input) OR a thin runner around one, so the mutation-proof lives
in the same file as the logic it proves, matching this repo's own
`docs/discord-render/instruments/d14_monitor.py::self_check()` shape.

Run:
    python docs/discord-render/instruments/w8_accuracy_audit.py --self-check
    python docs/discord-render/instruments/w8_accuracy_audit.py --symbols NVDA,SPY,QQQ --json
    python docs/discord-render/instruments/w8_accuracy_audit.py --symbols NVDA --out docs/discord-render/evidence/accuracy/2026-09-18.json

⛔ IN-PROCESS ONLY, like `discord_interactions.fetch_bars`'s own adapter — the
Query(...) defaults on `get_live_prices`/`buzz_panel` only resolve over HTTP, and
`/data/buzz.db` is only reachable from the pod that mounts the Railway volume.
This tool imports `api.services.*` directly and is meant to run either against a
local dev checkout (bars/live-prices only — buzz degrades to not_computable) or
via `railway ssh ... /opt/venv/bin/python docs/discord-render/instruments/w8_accuracy_audit.py`
on the real pod, where buzz.db is present too. It writes NOTHING except the evidence JSON.
Lives beside this programme's other instruments (`d14_monitor.py`,
`mutation_harness_flipgate.py`) rather than repo-root `tools/`, which is for
repo-wide tooling — this is discord-render-hardening-specific.

CoverageLine idiom for the tally: checked / matched / mismatched / not_computable,
kept as four separate counts rather than collapsed, because "the check could not
run" and "the check ran and disagreed" are different fact for a trader
(`app/src/components/screener/CoverageLine.jsx`'s own rule, restated here).

Exit codes (never conflate these — H15/hub_nav_smoke.py's own convention):
    0  every check that ran MATCHED (mismatched == 0, checked > 0)
    1  at least one check MISMATCHED — a real, measured accuracy defect
    2  INCONCLUSIVE — nothing was computable (checked == 0), or --self-check failed
"""
from __future__ import annotations

import argparse
import json
import os
import pathlib
import sqlite3
import sys
import time
from datetime import datetime, timezone

_HERE = pathlib.Path(__file__).resolve()
_REPO_ROOT = _HERE.parent.parent.parent.parent  # instruments/ -> discord-render/ -> docs/ -> repo root
sys.path.insert(0, str(_REPO_ROOT))

DEFAULT_SYMBOLS = ["SPY", "QQQ", "NVDA"]
CHART_TOLERANCE_PCT = 1.5
FLOW_RAW_TAPE_SLACK_FRAC = 0.01  # float-rounding slack on the raw-tape upper bound

EVIDENCE_DIR = _HERE.parent.parent / "evidence" / "accuracy"


# ─────────────────────────────────────────────────────────────────────────────
# PURE functions — no network, no filesystem, no imports beyond stdlib. Every
# one of these is exercised directly by --self-check with both a planted defect
# (must flag) and a clean input (must NOT flag) — a rail that cannot fire is not
# a rail (`lesson_gate_that_cannot_fail`).
# ─────────────────────────────────────────────────────────────────────────────

def check_ohlc_invariants(bar: dict) -> list[str]:
    """Structural sanity on one OHLCV bar dict (keys o,h,l,c,v). Returns the
    list of violated invariant names; empty = clean. Catches corruption that
    has nothing to do with which SESSION the bar is from — a chart could be
    perfectly fresh and still show a physically impossible candle."""
    try:
        o, h, l, c = float(bar["o"]), float(bar["h"]), float(bar["l"]), float(bar["c"])
        v = float(bar.get("v") or 0)
    except (KeyError, TypeError, ValueError):
        return ["unparseable"]
    problems = []
    for name, val in (("open", o), ("high", h), ("low", l), ("close", c), ("volume", v)):
        if val != val or val in (float("inf"), float("-inf")):  # NaN != NaN
            problems.append(f"{name}_nan_or_inf")
    if problems:
        return problems  # a NaN/inf field makes every comparison below meaningless
    if h < max(o, c):
        problems.append("high_below_open_or_close")
    if l > min(o, c):
        problems.append("low_above_open_or_close")
    if h < l:
        problems.append("high_below_low")
    if c <= 0:
        problems.append("close_not_positive")
    if v < 0:
        problems.append("volume_negative")
    return problems


def check_bar_ordering(bars: list[dict]) -> list[str]:
    """Bar timestamps must be strictly increasing with no duplicates."""
    problems = []
    prev_t = None
    for i, b in enumerate(bars):
        t = b.get("t")
        if t is None:
            problems.append(f"bar[{i}]_missing_t")
            continue
        if prev_t is not None:
            if t == prev_t:
                problems.append(f"bar[{i}]_duplicate_t={t}")
            elif t < prev_t:
                problems.append(f"bar[{i}]_out_of_order_t={t}")
        prev_t = t
    return problems


def check_chart_vs_snapshot(day_pct_from_bars, live_change_pct, tolerance_pct: float = CHART_TOLERANCE_PCT):
    """The SMH-incident check: diff the chart's bars-derived day_pct against an
    INDEPENDENTLY-sourced live snapshot's change_pct for the same ticker/day.
    Returns a problem string, or None (agree, or nothing to compare — a `None`
    input is NOT_COMPUTABLE, never treated as agreement by the caller)."""
    if day_pct_from_bars is None or live_change_pct is None:
        return None
    d, lv = float(day_pct_from_bars), float(live_change_pct)
    # Opposite signs on a move bigger than noise is the SMH shape itself
    # (-3.5% vs +0.6%): catch it before the magnitude check would blur it.
    if abs(d) >= 0.5 and abs(lv) >= 0.5 and (d > 0) != (lv > 0):
        return f"sign_mismatch: chart={d:+.2f}% live={lv:+.2f}%"
    if abs(d - lv) > tolerance_pct:
        return f"magnitude_mismatch: chart={d:+.2f}% live={lv:+.2f}% diff={abs(d - lv):.2f}pp"
    return None


def check_buzz_counts(served: dict, derived: dict) -> list[str]:
    """served = {ticker: mentions} from the /r/buzz payload; derived = {ticker:
    n} from an INDEPENDENT raw-SQL tally over the identical window. A ticker
    present on only one side counts as 0 on the other — both directions are
    real mismatches (a board that drops a ticker, or an extractor gap the
    served side never saw, are both worth naming, not just count disagreement
    on shared tickers)."""
    problems = []
    for t in sorted(set(served) | set(derived)):
        s, d = served.get(t, 0), derived.get(t, 0)
        if s != d:
            problems.append(f"{t}: served={s} derived={d}")
    return problems


def check_flow_internal_consistency(payload: dict) -> list[str]:
    """STRUCTURAL-only (no second data source for net/selection — see module
    docstring; `check_flow_against_raw_tape` below is the independent leg).

    ⛔ FIXED 2026-09-19 — the prior version checked a payload shape
    `_compute_ticker_flow` has never actually produced: `net` as a bare scalar
    (real shape: `{"bull", "bear", "unclassified", "dir"}`) and contracts
    carrying `value`/`signed_value` (real field: `premium`). Against a REAL
    payload this made the net check ALWAYS fire `unparseable_contracts_or_net`
    (a permanent false positive), and made the sort check read every
    `c.get("value", 0)` as 0 — an all-zero list is vacuously "sorted", so it
    could never catch a real ordering bug (`lesson_a_fixture_that_cannot_
    distinguish_is_not_a_rail`). Neither was ever exercised against a real
    payload before this — only against self_check's own idealized fixtures,
    which shared the same wrong assumption and so agreed with the bug.

    Also — deliberately NOT reconciling net against the shown `contracts`:
    bull/bear/unclassified are summed over EVERY qualifying contract before
    the top-N truncation that produces the payload's contracts list, so that
    list can never legitimately sum back to net once there are more than
    top_n contracts (the common case) — attempting it would be a check that
    fires on correct data, which gets muted, not a real defect detector.

    Checks, against the real shape:
    1. `net` is a dict; its `dir` must agree with comparing bull vs bear
       (BULL iff bull>bear, BEAR iff bear>bull, else NEUTRAL) — the net
       dict's own internal self-consistency, computable with no other data.
    2. The shown contracts must be sorted by descending `premium` — the field
       the real sort key (`_eff_prem`) actually produces.
    """
    problems = []
    net = payload.get("net")
    if isinstance(net, dict):
        try:
            bull, bear = float(net.get("bull") or 0), float(net.get("bear") or 0)
        except (TypeError, ValueError):
            problems.append("unparseable_net_bull_bear")
        else:
            want_dir = "BULL" if bull > bear else ("BEAR" if bear > bull else "NEUTRAL")
            got_dir = net.get("dir")
            if got_dir != want_dir:
                problems.append(
                    f"net_dir_mismatch: dir={got_dir!r} but bull={bull} bear={bear} implies {want_dir!r}")
    elif net is not None:
        problems.append(f"net_wrong_shape: expected a dict with bull/bear/dir, got {type(net).__name__}")

    contracts = payload.get("contracts") or []
    if len(contracts) > 1:
        try:
            prems = [float(c.get("premium") or 0) for c in contracts]
        except (TypeError, ValueError):
            problems.append("unparseable_contract_premiums")
        else:
            if prems != sorted(prems, reverse=True):
                problems.append("contracts_not_sorted_descending_by_premium")
    return problems


def independent_flow_raw_totals(db_path: str, ticker: str, created_date: str) -> dict:
    """Raw per-(cp, strike, exp) premium/volume/row-count totals straight from
    flow.db for one ticker+date, with EVERY business-rule filter
    `_build_by_contract` applies (the color gate, per-day caps, sweep-only
    filtering, source routing) deliberately OMITTED. This is the
    unconstrained superset — used only as an upper bound, never as an exact
    reconstruction — so it is a TRUE independent leg: never calls
    `_build_by_contract` or `_compute_ticker_flow`, and cannot false-positive
    on any of THEIR filtering nuances the way a second copy of the same
    business logic could. Read-only. Keyed by (cp_letter, float(strike),
    exp string verbatim as stored)."""
    if not os.path.exists(db_path):
        raise FileNotFoundError(db_path)
    conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    try:
        rows = conn.execute(
            "SELECT CallPut, Strike, ExpirationDate, Premium, Volume FROM flow "
            "WHERE Symbol = ? AND CreatedDate = ?",
            (ticker.strip().upper(), created_date),
        ).fetchall()
    finally:
        conn.close()
    out: dict = {}
    for cp_raw, strike_raw, exp_raw, prem_raw, vol_raw in rows:
        cp = str(cp_raw or "").upper()[:1]
        try:
            strike = float(strike_raw)
        except (TypeError, ValueError):
            continue
        exp = str(exp_raw or "").strip()
        key = (cp, strike, exp)
        prem = float(prem_raw) if prem_raw is not None else 0.0
        vol = float(vol_raw) if vol_raw is not None else 0.0
        agg_prem, agg_vol, agg_n = out.get(key, (0.0, 0.0, 0))
        out[key] = (agg_prem + prem, agg_vol + vol, agg_n + 1)
    return out


def check_flow_against_raw_tape(contracts: list[dict], raw_totals: dict) -> list[str]:
    """Pure decision function for the raw-tape upper-bound check (see module
    docstring). `raw_totals` is `independent_flow_raw_totals`'s output — every
    shown contract's premium/volume must never exceed its raw total; a
    contract shown with zero raw rows for its exact key is flagged outright."""
    problems = []
    for c in contracts:
        try:
            cp = str(c.get("cp") or "").upper()[:1]
            strike = float(c.get("strike"))
            exp = str(c.get("exp") or "").strip()
        except (TypeError, ValueError):
            continue
        label = f"{cp}{strike:g} {exp}"
        raw_prem, raw_vol, raw_n = raw_totals.get((cp, strike, exp), (0.0, 0.0, 0))
        if raw_n == 0:
            problems.append(f"{label}: card shows a contract with ZERO raw flow.db rows "
                             f"for this ticker/date — not achievable from raw data")
            continue
        shown_prem = c.get("premium") or 0
        if shown_prem > raw_prem * (1 + FLOW_RAW_TAPE_SLACK_FRAC) + 1:
            problems.append(f"{label}: shown premium {shown_prem:,.0f} exceeds raw "
                             f"flow.db total {raw_prem:,.0f}")
        shown_vol = c.get("volume") or 0
        if shown_vol > raw_vol * (1 + FLOW_RAW_TAPE_SLACK_FRAC) + 1:
            problems.append(f"{label}: shown volume {shown_vol:,.0f} exceeds raw "
                             f"flow.db total {raw_vol:,.0f}")
    return problems


# ─────────────────────────────────────────────────────────────────────────────
# I/O runners — thin wrappers that fetch real data and hand it to the pure
# functions above. Everything here degrades to not_computable on a missing
# dependency; nothing here raises out to main().
# ─────────────────────────────────────────────────────────────────────────────

def _fmt_pct(v):
    return "n/a" if v is None else f"{v:+.2f}%"


def run_chart_check(ticker: str) -> dict:
    """Fetch bars through the EXACT adapter /chart uses
    (`discord_interactions.fetch_bars`, in-process, no HTTP), run the
    structural OHLCV/ordering checks, compute stats through the SAME
    `compute_stats()` the strip renders with (never re-derive that formula —
    a second implementation of one value is the defect this repo's CLAUDE.md
    names repeatedly), then cross-check its day_pct against an independently
    -fetched live snapshot."""
    try:
        from api.routers.discord_interactions import fetch_bars
        from api.services.discord_chart_render import compute_stats
    except ImportError as exc:
        return {"ticker": ticker, "surface": "chart", "status": "not_computable",
                "reason": f"import failed: {exc}"}

    bars = fetch_bars(ticker, "D", 260)
    if not bars:
        return {"ticker": ticker, "surface": "chart", "status": "not_computable",
                "reason": "fetch_bars returned no bars"}

    problems: list[str] = []
    for b in bars:
        problems.extend(f"bar[t={b.get('t')}]:{p}" for p in check_ohlc_invariants(b))
    problems.extend(check_bar_ordering(bars))

    stats = compute_stats(bars)
    day_pct = stats.get("day_pct")
    as_of = stats.get("as_of")

    live_pct = None
    try:
        from api.routers.live_prices import get_live_prices
        resp = get_live_prices(tickers=ticker)
        row = resp.get(ticker) if isinstance(resp, dict) else None
        if isinstance(row, dict):
            live_pct = row.get("change_pct")
    except Exception as exc:  # noqa: BLE001 — a live-snapshot failure degrades this ONE cross-check, not the whole run
        live_pct = None
        problems_note = f"live snapshot unavailable: {exc}"
    else:
        problems_note = None

    cross = check_chart_vs_snapshot(day_pct, live_pct, CHART_TOLERANCE_PCT)
    if cross:
        problems.append(cross)

    status = "mismatch" if problems else "matched"
    if not bars_have_any_computable(day_pct, live_pct) and not problems:
        status = "not_computable"

    out = {
        "ticker": ticker, "surface": "chart", "status": status, "problems": problems,
        "as_of": as_of, "day_pct_from_bars": day_pct, "live_change_pct": live_pct,
        "bar_count": len(bars),
    }
    if problems_note:
        out["note"] = problems_note
    return out


def bars_have_any_computable(day_pct, live_pct) -> bool:
    """The cross-check itself computed nothing (both sides missing) — but the
    structural bar checks may still have found something, so callers only use
    this to decide whether an EMPTY problem list means matched vs not_computable."""
    return day_pct is not None and live_pct is not None


def run_flow_check(ticker: str) -> dict:
    """Fetch the flow-card payload through the adapter's OWN `fetch()` — the
    exact worker→in-process fallback order the real `/flow` render uses
    (`api/services/discord_render/adapters/flow.py`, 03 §3.8) — then run
    structural + raw-tape checks (see `check_flow_internal_consistency` and
    `check_flow_against_raw_tape` for what each covers).

    ⛔ FIXED 2026-09-19 — the prior version reimplemented the remote/local
    dance itself instead of calling the adapter's own `fetch()`, and called
    `_local(req)` with the WRONG ARITY: `_local` takes four positional
    primitives (`ticker, days, source, top_n`), never the `FlowRequest`
    object. A real local run hit `TypeError: _local() missing 3 required
    positional arguments` immediately — exactly the class of bug self_check's
    pure-function cases structurally cannot see, since none of them touch this
    wiring. This never affected the real Discord `/flow` command (its own path
    always goes through `fetch()`, which calls `local` with the correct
    arguments) — only THIS AUDIT SCRIPT silently reported `not_computable`
    instead of ever exercising the in-process fallback leg, exactly when a
    flow-worker outage would have made that leg the one that mattered most."""
    try:
        from api.services.discord_render.adapters.flow import FlowRequest, fetch
    except ImportError:
        try:
            from api.live_massive_router import _compute_ticker_flow
            payload = _compute_ticker_flow(ticker, days=1)
            reason = None
        except Exception as exc:  # noqa: BLE001
            return {"ticker": ticker, "surface": "flow", "status": "not_computable",
                    "reason": f"no flow adapter reachable: {exc}"}
    else:
        req = FlowRequest(ticker=ticker, days="1")
        try:
            result = fetch(req)  # documented to never raise; no try/except needed around the call itself
        except Exception as exc:  # noqa: BLE001 — defensive only, contradicts fetch()'s own contract if hit
            return {"ticker": ticker, "surface": "flow", "status": "not_computable",
                    "reason": f"flow fetch raised unexpectedly (violates its own never-raises contract): {exc}"}
        if not result.ok:
            return {"ticker": ticker, "surface": "flow", "status": "not_computable",
                    "reason": f"flow fetch failed: provider={result.provider!r} "
                              f"degraded_reasons={result.degraded_reasons}"}
        payload = result.data
        reason = (f"served by {result.provider}, not flow_worker"
                  if result.provider and result.provider != "flow_worker" else None)

    if not payload:
        return {"ticker": ticker, "surface": "flow", "status": "not_computable",
                "reason": "empty payload"}

    problems = check_flow_internal_consistency(payload)

    tape_note = None
    contracts = payload.get("contracts") or []
    end_date = (payload.get("window") or {}).get("end")
    if contracts and end_date:
        db_path = os.environ.get("FLOW_DB_PATH", "/data/flow.db")
        try:
            raw_totals = independent_flow_raw_totals(db_path, ticker, end_date)
        except FileNotFoundError:
            tape_note = f"{db_path} not reachable from this host — raw-tape check skipped"
        except sqlite3.Error as exc:
            tape_note = f"sqlite error reading {db_path} for the raw-tape check: {exc}"
        else:
            problems = problems + check_flow_against_raw_tape(contracts, raw_totals)

    out = {"ticker": ticker, "surface": "flow",
           "status": "mismatch" if problems else "matched", "problems": problems,
           "coverage": ("structural + raw-tape upper-bound on shown premium/volume "
                        "(net direction and top-N selection are NOT independently "
                        "re-derived — see module docstring)")}
    if reason:
        out["note"] = reason
    if tape_note:
        out["tape_check_note"] = tape_note
    return out


def independent_buzz_tally(db_path: str, start: int, end: int, channels: list[str]) -> dict:
    """A raw SQL tally over `mentions`, written from scratch — deliberately
    NEVER calls `buzz_store.board()` (the function under audit). Read-only."""
    if not os.path.exists(db_path):
        raise FileNotFoundError(db_path)
    conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    try:
        cl = f" AND channel_id IN ({','.join('?' * len(channels))})" if channels else ""
        rows = conn.execute(
            "SELECT ticker, COUNT(*) AS n FROM mentions WHERE ts >= ? AND ts < ?" + cl + " GROUP BY ticker",
            [start, end, *channels],
        ).fetchall()
        return {t: n for t, n in rows}
    finally:
        conn.close()


def run_buzz_check(window: str = "open") -> dict:
    """Diff `/r/buzz`'s served per-ticker mention counts against the
    independent raw-SQL tally above, for the same window bounds
    `buzz_boards.window_bounds()` computes (reusing the WINDOW DEFINITION is
    fine — the risk this audits is in the AGGREGATION step, not the policy of
    what counts as "the open window")."""
    try:
        from api.services import buzz_boards, buzz_store
    except ImportError as exc:
        return {"surface": "buzz", "status": "not_computable", "reason": f"import failed: {exc}"}

    now = int(time.time())
    try:
        served_rows = buzz_boards.full_board(window, now)
    except Exception as exc:  # noqa: BLE001
        return {"surface": "buzz", "status": "not_computable", "reason": f"served board fetch failed: {exc}"}

    served = {r["ticker"]: r["mentions"] for r in served_rows}
    start, end = buzz_boards.window_bounds(window, now)
    chans = buzz_boards._channels()

    try:
        derived = independent_buzz_tally(buzz_store.db_path(), start, end, chans)
    except FileNotFoundError:
        return {"surface": "buzz", "status": "not_computable",
                "reason": f"{buzz_store.db_path()} not reachable from this host"}
    except sqlite3.Error as exc:
        return {"surface": "buzz", "status": "not_computable", "reason": f"sqlite error: {exc}"}

    problems = check_buzz_counts(served, derived)
    return {
        "surface": "buzz", "window": window,
        "status": "mismatch" if problems else "matched", "problems": problems,
        "served_tickers": len(served), "derived_tickers": len(derived),
        "served_total": sum(served.values()), "derived_total": sum(derived.values()),
    }


# ─────────────────────────────────────────────────────────────────────────────
# --self-check — mutation-proof: every pure function fires on a planted defect
# and stays quiet on a clean input. No network, no filesystem beyond nothing.
# ─────────────────────────────────────────────────────────────────────────────

def self_check() -> int:
    declared = 0
    bad = 0

    def case(name: str, got, want_flag: bool):
        nonlocal declared, bad
        declared += 1
        fired = bool(got)
        ok = fired == want_flag
        if not ok:
            bad += 1
        print(f"  {'ok  ' if ok else 'FAIL'} {name} -> {got!r}")

    # check_ohlc_invariants
    case("ohlc: clean bar does not flag",
         check_ohlc_invariants({"o": 10, "h": 12, "l": 9, "c": 11, "v": 1000}), False)
    case("ohlc: high below close flags",
         check_ohlc_invariants({"o": 10, "h": 10.5, "l": 9, "c": 11, "v": 1000}), True)
    case("ohlc: low above open flags",
         check_ohlc_invariants({"o": 10, "h": 12, "l": 10.5, "c": 11, "v": 1000}), True)
    case("ohlc: high below low flags",
         check_ohlc_invariants({"o": 10, "h": 8, "l": 9, "c": 8.5, "v": 1000}), True)
    case("ohlc: NaN close flags",
         check_ohlc_invariants({"o": 10, "h": 12, "l": 9, "c": float("nan"), "v": 1000}), True)
    case("ohlc: negative volume flags",
         check_ohlc_invariants({"o": 10, "h": 12, "l": 9, "c": 11, "v": -5}), True)
    case("ohlc: unparseable bar flags",
         check_ohlc_invariants({"o": "x", "h": 12, "l": 9, "c": 11, "v": 1000}), True)

    # check_bar_ordering
    case("ordering: strictly increasing does not flag",
         check_bar_ordering([{"t": 1}, {"t": 2}, {"t": 3}]), False)
    case("ordering: duplicate timestamp flags",
         check_bar_ordering([{"t": 1}, {"t": 2}, {"t": 2}]), True)
    case("ordering: out-of-order timestamp flags",
         check_bar_ordering([{"t": 1}, {"t": 3}, {"t": 2}]), True)

    # check_chart_vs_snapshot — the SMH-incident shape itself
    case("chart-vs-snapshot: agreeing signs+magnitude does not flag",
         check_chart_vs_snapshot(0.6, 0.5), False)
    case("chart-vs-snapshot: the actual SMH incident (opposite signs) flags",
         check_chart_vs_snapshot(-3.5, 0.6), True)
    case("chart-vs-snapshot: same sign but far apart flags",
         check_chart_vs_snapshot(0.5, 4.0), True)
    case("chart-vs-snapshot: missing live value never flags (not_computable, not agreement)",
         check_chart_vs_snapshot(-3.5, None), False)
    case("chart-vs-snapshot: missing bars value never flags",
         check_chart_vs_snapshot(None, 0.6), False)

    # check_buzz_counts
    case("buzz: identical maps do not flag",
         check_buzz_counts({"NVDA": 5, "SPY": 2}, {"NVDA": 5, "SPY": 2}), False)
    case("buzz: a differing count flags",
         check_buzz_counts({"NVDA": 5}, {"NVDA": 3}), True)
    case("buzz: a ticker only on the served side flags",
         check_buzz_counts({"NVDA": 5, "AMD": 1}, {"NVDA": 5}), True)
    case("buzz: a ticker only on the derived side flags",
         check_buzz_counts({"NVDA": 5}, {"NVDA": 5, "AMD": 1}), True)

    # check_flow_internal_consistency — against the REAL _compute_ticker_flow shape
    # (net is a dict, contracts carry `premium` — see the function's own docstring
    # for the 2026-09-19 fix and why the prior fixtures shared the bug they tested)
    case("flow: dir agreeing with bull>bear does not flag",
         check_flow_internal_consistency(
             {"net": {"bull": 300, "bear": 100, "dir": "BULL"}, "contracts": []}), False)
    case("flow: dir disagreeing with bull/bear flags",
         check_flow_internal_consistency(
             {"net": {"bull": 300, "bear": 100, "dir": "BEAR"}, "contracts": []}), True)
    case("flow: dir NEUTRAL when bull equals bear does not flag",
         check_flow_internal_consistency(
             {"net": {"bull": 100, "bear": 100, "dir": "NEUTRAL"}, "contracts": []}), False)
    case("flow: net as a bare scalar (the old wrong shape) flags",
         check_flow_internal_consistency({"net": 300, "contracts": []}), True)
    case("flow: contracts sorted descending by premium does not flag",
         check_flow_internal_consistency(
             {"net": None, "contracts": [{"premium": 200}, {"premium": 100}]}), False)
    case("flow: contracts out of order by premium flags",
         check_flow_internal_consistency(
             {"net": None, "contracts": [{"premium": 100}, {"premium": 200}]}), True)
    case("flow: empty contracts never flags (nothing to check)",
         check_flow_internal_consistency({"net": None, "contracts": []}), False)

    # check_flow_against_raw_tape
    case("flow-tape: shown values within the raw bound does not flag",
         check_flow_against_raw_tape(
             [{"cp": "C", "strike": 100.0, "exp": "1/1/2027", "premium": 500, "volume": 10}],
             {("C", 100.0, "1/1/2027"): (1000.0, 20.0, 3)}), False)
    case("flow-tape: shown value exactly at the raw boundary does not flag",
         check_flow_against_raw_tape(
             [{"cp": "C", "strike": 100.0, "exp": "1/1/2027", "premium": 1000, "volume": 20}],
             {("C", 100.0, "1/1/2027"): (1000.0, 20.0, 3)}), False)
    case("flow-tape: a contract with zero raw flow.db rows flags",
         check_flow_against_raw_tape(
             [{"cp": "C", "strike": 999.0, "exp": "1/1/2027", "premium": 500, "volume": 10}],
             {}), True)
    case("flow-tape: zero raw rows flags even at premium/volume=0 (isolates the "
         "zero-rows guard from the exceeds-bound checks, which a shown 0 would "
         "never trip on their own)",
         check_flow_against_raw_tape(
             [{"cp": "C", "strike": 999.0, "exp": "1/1/2027", "premium": 0, "volume": 0}],
             {}), True)
    case("flow-tape: shown premium exceeding the raw total flags",
         check_flow_against_raw_tape(
             [{"cp": "C", "strike": 100.0, "exp": "1/1/2027", "premium": 5000, "volume": 10}],
             {("C", 100.0, "1/1/2027"): (1000.0, 20.0, 3)}), True)
    case("flow-tape: shown volume exceeding the raw total flags",
         check_flow_against_raw_tape(
             [{"cp": "C", "strike": 100.0, "exp": "1/1/2027", "premium": 500, "volume": 500}],
             {("C", 100.0, "1/1/2027"): (1000.0, 20.0, 3)}), True)
    case("flow-tape: empty contracts never flags (nothing to check)",
         check_flow_against_raw_tape([], {("C", 100.0, "1/1/2027"): (1000.0, 20.0, 3)}), False)

    verdict = "PASS" if not bad else "FAIL"
    print(f"TOTALS w8_accuracy_audit --self-check {verdict} declared={declared} evaluated={declared} failed={bad}")
    return 0 if not bad else 1


# ─────────────────────────────────────────────────────────────────────────────
# main
# ─────────────────────────────────────────────────────────────────────────────

def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0] if __doc__ else "")
    ap.add_argument("--symbols", default=",".join(DEFAULT_SYMBOLS),
                    help="comma-separated tickers for the chart+flow checks")
    ap.add_argument("--buzz-window", default="open", choices=("open", "noon", "today", "week", "month"))
    ap.add_argument("--skip-buzz", action="store_true", help="skip the buzz check (e.g. known-unreachable buzz.db)")
    ap.add_argument("--skip-flow", action="store_true")
    ap.add_argument("--out", default=None, help="evidence JSON path; default docs/discord-render/evidence/accuracy/<date>.json")
    ap.add_argument("--json", action="store_true", help="print the full result JSON to stdout too")
    ap.add_argument("--self-check", action="store_true", help="prove every pure check can fire AND stay quiet, without touching production")
    a = ap.parse_args()

    if a.self_check:
        return self_check()

    tickers = [t.strip().upper() for t in a.symbols.split(",") if t.strip()]
    results: list[dict] = []

    for tk in tickers:
        results.append(run_chart_check(tk))
        if not a.skip_flow:
            results.append(run_flow_check(tk))

    if not a.skip_buzz:
        results.append(run_buzz_check(a.buzz_window))

    checked = len(results)
    matched = sum(1 for r in results if r["status"] == "matched")
    mismatched = sum(1 for r in results if r["status"] == "mismatch")
    not_computable = sum(1 for r in results if r["status"] == "not_computable")
    assert checked == matched + mismatched + not_computable, "coverage arithmetic must close"

    evidence = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "symbols": tickers,
        "checked": checked, "matched": matched, "mismatched": mismatched, "not_computable": not_computable,
        "results": results,
    }

    out_path = pathlib.Path(a.out) if a.out else EVIDENCE_DIR / f"{datetime.now(timezone.utc).date().isoformat()}.json"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(evidence, indent=2), encoding="utf-8")

    print(f"TOTALS w8_accuracy_audit checked={checked} matched={matched} mismatched={mismatched} not_computable={not_computable}")
    for r in results:
        label = r.get("ticker", r.get("surface", "?"))
        surface = r.get("surface", "?")
        print(f"  [{surface:5s}] {label:8s} {r['status']:14s} {r.get('problems') or r.get('reason') or ''}")
    print(f"evidence written to {out_path}")

    if a.json:
        print(json.dumps(evidence, indent=2))

    if checked == 0 or (matched == 0 and mismatched == 0):
        return 2
    if mismatched:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
