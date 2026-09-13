"""Orchestrate the pattern-vision pipeline: focused rule candidates -> render ->
cost-gate -> Opus vision judge -> store. Skip-if-stable avoids re-judging an
unchanged chart; the daily cost cap pauses judging when exceeded.
"""
import datetime
import hashlib
import json
import logging
import os
import time
from zoneinfo import ZoneInfo

from . import store, chart_render, vision_judge
from .rubrics import FOCUSED_SETUPS

log = logging.getLogger(__name__)

_ET = ZoneInfo("America/New_York")

_PRICE = {"claude-opus-4-8": (5.0, 25.0)}  # ($/Mtok input, output)

# How many bars to frame per setup (single candles need less; bases need more).
_WINDOWS = {
    "hammer": 45, "bullish_engulfing": 45, "u_and_r": 60, "remount": 80,
    "bull_flag": 80, "pullback_to_10ema": 80, "pullback_to_21ema": 90,
    "episodic_pivot": 90, "power_earnings_gap": 90, "pullback_to_50sma": 120,
    "high_tight_flag": 120, "vcp": 140, "flat_base": 160, "cup_handle_uct": 220,
}


def _window_for(setup: str) -> int:
    return _WINDOWS.get(setup, 120)


def _example_pngs(setup: str) -> list:
    """Gold-standard reference charts for few-shot judging (fail-open).
    Wired to the Model Book examples module; returns [] when unavailable/disabled."""
    try:
        from . import modelbook_examples
        return modelbook_examples.example_pngs(setup, window=_window_for(setup))
    except Exception as e:
        log.debug("[pv] examples for %s unavailable: %s", setup, e)
        return []


def _cost(model, in_tok, out_tok) -> float:
    pin, pout = _PRICE.get(model, (5.0, 25.0))
    return (in_tok / 1e6) * pin + (out_tok / 1e6) * pout


def _read_bars(ticker, tf):
    from api.services import bars_sqlite
    return bars_sqlite.get_bars(ticker, tf, 400) or []


def _bar_ymd(bar):
    """The bar's session date as a YYYYMMDD int, or None when the ts is not
    daily-shaped (intraday timeframes store unix seconds, not YYYYMMDD)."""
    try:
        s = str(int(bar[0]))
    except (TypeError, ValueError, IndexError):
        return None
    return int(s) if len(s) == 8 else None


def _today_ymd_et():
    """Today's SESSION date in ET as a YYYYMMDD int.

    ⛔ ET, never UTC. After 20:00 ET the UTC date is already tomorrow, so a UTC
    "today" would judge the live session's own developing bar as if it had
    closed -- wrong for every late slot.
    """
    return int(datetime.datetime.now(_ET).strftime("%Y%m%d"))


def _evidence_bar(bars):
    """The last CLOSED bar -- identified BY DATE, not by position.

    The single source of truth for both the signals hash and the evidence date,
    so the two can never disagree about which bar is being judged.

    ⛔ THIS USED TO RETURN bars[-2] UNCONDITIONALLY, which assumed bars[-1] is
    always the developing candle. That assumption is false until today's bar has
    been ingested for THAT ticker, and ingestion is per-ticker and staggered
    through the session. Measured on prod 2026-09-10 at 10:10 ET: GILD held
    [09-08, 09-09, 09-10] while META/ASML/OXY/TGT/NVDA/XYZ all still ended at
    09-09. So for 83 of 84 tickers bars[-1] WAS a fully closed prior session,
    and returning bars[-2] threw it away and judged a bar one session older --
    2026-09-08 evidence on 2026-09-10, on every one of the 09:00 slot's 43 paid
    calls. Then, as each ticker's partial arrived, its hash changed and it was
    re-judged: the "10:00 re-judge wave" was this defect resolving itself one
    ticker at a time, not the market rolling over.

    By date, both states answer the same: bars[-1] when it has already closed,
    bars[-2] when bars[-1] is today's live candle. No trading calendar is
    needed -- a weekend or holiday simply makes bars[-1] older than today, which
    is exactly the condition being tested.
    """
    i = _evidence_index(bars)
    return None if i is None else bars[i]


def _evidence_index(bars):
    """INDEX of the last closed bar -- the single authority for "which bar".

    `_evidence_bar` and `candidates_for` must never disagree about where the
    closed history ends: one returns the bar, the other slices up to it, and two
    separate answers to that question is the second-authority defect this file
    has already paid for once.
    """
    if not bars:
        return None
    if len(bars) == 1:
        return 0
    ymd = _bar_ymd(bars[-1])
    # A non-daily ts keeps the original positional behaviour rather than
    # guessing at a format this orchestrator never runs on.
    if ymd is not None and ymd < _today_ymd_et():
        return len(bars) - 1
    return len(bars) - 2


def _evidence_date(bars) -> str:
    """The actual session date the evidence bar represents -- NOT wall-clock
    today. `bars_sqlite.get_bars`'s own docstring: daily/weekly/monthly `ts`
    is a YYYYMMDD int, so this is a direct read, no timezone math. Falls back
    to today only when there are no bars at all (candidates_for already
    returns [] in that case, so this branch is defensive, not load-bearing).

    Fixes a real defect (owner-authorized, 2026-09-05): asof_date used to be
    datetime.date.today().isoformat(), so on a weekday market holiday (no new
    session, the evidence bar unchanged from the prior real trading day) the
    calendar date still advanced, minting a dedup key that never matched the
    prior verdict -- causing a real paid re-judgment of unchanged evidence,
    persisted under a misleading holiday date. The dedup contract must follow
    evidence identity (this bar), not scheduler wall-clock date.
    """
    bar = _evidence_bar(bars)
    if not bar:
        return datetime.date.today().isoformat()
    ts = bar[0]
    s = str(int(ts))
    if len(s) == 8:  # YYYYMMDD -- daily/weekly/monthly bars (this orchestrator's only tf)
        return f"{s[:4]}-{s[4:6]}-{s[6:8]}"
    # Defensive: an intraday tf's ts is unix seconds, not YYYYMMDD -- convert
    # from the bar's own timestamp rather than guessing a format that doesn't apply.
    return datetime.datetime.fromtimestamp(int(ts), tz=datetime.timezone.utc).date().isoformat()


def _signals_hash(ticker, setup, bars) -> str:
    # Key off the last CLOSED bar (bars[-2]), not the developing candle:
    # bars[-1] mutates every hour during the session, and hashing it made every
    # hourly run re-judge every open candidate (~8x daily Opus spend for the
    # same setup). A candidate is judged once when it first appears (no prior
    # verdict) and again only when a new bar actually closes.
    tail = _evidence_bar(bars) or ()
    return hashlib.sha1(f"{ticker}|{setup}|{tail}".encode()).hexdigest()[:16]


def candidates_for(ticker, tf="D") -> list[dict]:
    bars = _read_bars(ticker, tf)
    if not bars or len(bars) < 30:
        return []
    # ⛔ DETECTION STOPS AT THE EVIDENCE BAR. Detectors index `bars[-1]`
    # directly as "the current bar" (bull_flag, donchian_breakout's
    # `breakout_close`, and roughly ten others), and this used to hand them the
    # FULL series -- so on any ticker holding today's partial intraday candle,
    # a "breakout" could be measured on a bar that had not finished forming and
    # could un-happen before the close, while the recorded `asof_date` named the
    # prior session. Detection and the evidence date disagreed about which bar
    # was being described.
    #
    # Slicing here makes them agree BY CONSTRUCTION: the detectors' `bars[-1]`
    # IS `_evidence_bar`'s answer. No detector is touched -- there are ~50 of
    # them and they are shared with the screener.
    #
    # ⭐ Measured before it was written. Replaying 82 tickers x 10 sessions with
    # and without the last bar moved total detections by -0.9%; the largest
    # per-setup move was pullback_to_50sma at +25%, which is FOUR detections
    # becoming five and a base-rate artifact rather than a sensitivity shift.
    # The cost that is real: a setup only visible once today's partial forms is
    # now detected the session that bar CLOSES.
    ev_i = _evidence_index(bars)
    closed = bars[:ev_i + 1] if ev_i is not None else []
    if len(closed) < 30:
        return []
    # The pattern engine expects dict-shaped bars (the tuple form from get_bars
    # is what the renderer + signal hash use).
    bars_list = [{"t": r[0], "o": r[1], "h": r[2], "l": r[3], "c": r[4], "v": r[5]} for r in closed]
    try:
        # Detectors self-register as a side effect of importing the patterns
        # router; the registry is empty until then (CLAUDE.md). Same trick the
        # universe scan uses.
        from api.routers import patterns as _patterns  # noqa: F401
        from api.services.pattern_engine import detect_all
        from api.services.pattern_engine.primitives.context import build_context
        ctx = build_context(bars_list, sym=ticker)
        raw = detect_all(bars_list, ctx, pattern_ids=FOCUSED_SETUPS) or []
    except Exception as e:
        log.warning("[pv] candidates_for %s failed: %s", ticker, e)
        return []
    best = {}
    asof = _evidence_date(bars)
    for d in raw:
        sid = d.get("pattern_id")
        if sid not in FOCUSED_SETUPS:
            continue
        conf = float(d.get("confidence") or 0)
        key_level = (d.get("levels") or {}).get("entry")
        if sid not in best or conf > best[sid]["raw_confidence"]:
            best[sid] = {"setup": sid, "raw_confidence": conf, "asof_date": asof,
                         "key_level": key_level}
    return list(best.values())


def judge_ticker(ticker, tf="D", *, client=None, force=False) -> dict:
    store.init_db()
    if client is None:
        from api.services.engine import _get_anthropic_client
        client = _get_anthropic_client()
    day = datetime.date.today().isoformat()
    # `render_failed`, `errored`, `problems` and `asof_dates` exist so the slot
    # logger can testify about paths that otherwise write nothing anywhere:
    # a failed chart render logs NOTHING at all, and a judge exception reaches
    # only stdout. `asof_dates` is collected per ticker because _evidence_bar()
    # is per ticker -- bars-ingestion lag can be partial within one slot.
    out = {"judged": 0, "confirmed": 0, "skipped": 0, "cost_capped": False,
           "render_failed": 0, "errored": 0, "problems": [], "asof_dates": []}
    bars = _read_bars(ticker, tf)
    for cand in candidates_for(ticker, tf):
        setup = cand["setup"]
        out["asof_dates"].append(cand["asof_date"])
        sig = _signals_hash(ticker, setup, bars)
        if not force:
            prev = store.get_verdict(ticker, tf, setup, cand["asof_date"])
            if prev and prev.get("signals_hash") == sig:
                out["skipped"] += 1
                continue
        if not store.may_judge(day):
            out["cost_capped"] = True
            break
        key_level = cand.get("key_level")
        png = chart_render.render_chart(bars, window=_window_for(setup), key_level=key_level)
        if not png:
            # Previously the ONLY completely unlogged path in the loop.
            out["render_failed"] += 1
            out["problems"].append({"ticker": ticker, "tf": tf, "setup": setup,
                                    "asof_date": cand["asof_date"], "path": "render_failed",
                                    "message": "chart_render returned no png"})
            continue
        try:
            examples = _example_pngs(setup)
            v = vision_judge.judge(setup, png, client=client,
                                   key_level=key_level, example_pngs=examples)
        except Exception as e:
            log.warning("[pv] judge %s/%s failed: %s", ticker, setup, e)
            out["errored"] += 1
            out["problems"].append({"ticker": ticker, "tf": tf, "setup": setup,
                                    "asof_date": cand["asof_date"], "path": "errored",
                                    "message": repr(e)})
            continue
        u = v.get("usage", {})
        model = v.get("model", "claude-opus-4-8")
        cost = _cost(model, u.get("input_tokens", 0), u.get("output_tokens", 0))
        store.log_cost(day, ticker, model, u.get("input_tokens", 0), u.get("output_tokens", 0), cost)
        # Calibration knob: require the model's confirm AND confidence >= floor.
        min_conf = float(os.environ.get("PATTERN_VISION_MIN_CONFIDENCE", "60"))
        confirmed = bool(v["confirmed"]) and float(v["confidence"]) >= min_conf
        store.put_verdict({
            "ticker": ticker.upper(), "tf": tf, "setup": setup, "asof_date": cand["asof_date"],
            "confirmed": 1 if confirmed else 0, "vision_confidence": float(v["confidence"]),
            "rationale": v["reason"], "key_level": v.get("key_level") if v.get("key_level") is not None else key_level,
            "raw_confidence": cand["raw_confidence"], "model": model,
            "signals_hash": sig, "judged_at": int(time.time()),
            "checks": json.dumps(v.get("checks") or []),
        })
        out["judged"] += 1
        if confirmed:
            out["confirmed"] += 1
    return out
