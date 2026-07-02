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

from . import store, chart_render, vision_judge
from .rubrics import FOCUSED_SETUPS

log = logging.getLogger(__name__)

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


def _signals_hash(ticker, setup, bars) -> str:
    # Key off the last CLOSED bar (bars[-2]), not the developing candle:
    # bars[-1] mutates every hour during the session, and hashing it made every
    # hourly run re-judge every open candidate (~8x daily Opus spend for the
    # same setup). A candidate is judged once when it first appears (no prior
    # verdict) and again only when a new bar actually closes.
    tail = bars[-2] if len(bars) >= 2 else (bars[-1] if bars else ())
    return hashlib.sha1(f"{ticker}|{setup}|{tail}".encode()).hexdigest()[:16]


def candidates_for(ticker, tf="D") -> list[dict]:
    bars = _read_bars(ticker, tf)
    if not bars or len(bars) < 30:
        return []
    # The pattern engine expects dict-shaped bars (the tuple form from get_bars
    # is what the renderer + signal hash use).
    bars_list = [{"t": r[0], "o": r[1], "h": r[2], "l": r[3], "c": r[4], "v": r[5]} for r in bars]
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
    today = datetime.date.today().isoformat()
    for d in raw:
        sid = d.get("pattern_id")
        if sid not in FOCUSED_SETUPS:
            continue
        conf = float(d.get("confidence") or 0)
        key_level = (d.get("levels") or {}).get("entry")
        if sid not in best or conf > best[sid]["raw_confidence"]:
            best[sid] = {"setup": sid, "raw_confidence": conf, "asof_date": today,
                         "key_level": key_level}
    return list(best.values())


def judge_ticker(ticker, tf="D", *, client=None, force=False) -> dict:
    store.init_db()
    if client is None:
        from api.services.engine import _get_anthropic_client
        client = _get_anthropic_client()
    day = datetime.date.today().isoformat()
    out = {"judged": 0, "confirmed": 0, "skipped": 0, "cost_capped": False}
    bars = _read_bars(ticker, tf)
    for cand in candidates_for(ticker, tf):
        setup = cand["setup"]
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
            continue
        try:
            examples = _example_pngs(setup)
            v = vision_judge.judge(setup, png, client=client,
                                   key_level=key_level, example_pngs=examples)
        except Exception as e:
            log.warning("[pv] judge %s/%s failed: %s", ticker, setup, e)
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
