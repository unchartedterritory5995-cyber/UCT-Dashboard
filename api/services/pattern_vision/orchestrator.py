"""Orchestrate the pattern-vision pipeline: focused rule candidates -> render ->
cost-gate -> Opus vision judge -> store. Skip-if-stable avoids re-judging an
unchanged chart; the daily cost cap pauses judging when exceeded.
"""
import datetime
import hashlib
import logging
import time

from . import store, chart_render, vision_judge
from .rubrics import FOCUSED_SETUPS

log = logging.getLogger(__name__)

_PRICE = {"claude-opus-4-8": (5.0, 25.0)}  # ($/Mtok input, output)


def _cost(model, in_tok, out_tok) -> float:
    pin, pout = _PRICE.get(model, (5.0, 25.0))
    return (in_tok / 1e6) * pin + (out_tok / 1e6) * pout


def _read_bars(ticker, tf):
    from api.services import bars_sqlite
    return bars_sqlite.get_bars(ticker, tf, 400) or []


def _signals_hash(ticker, setup, bars) -> str:
    tail = bars[-1] if bars else ()
    return hashlib.sha1(f"{ticker}|{setup}|{tail}".encode()).hexdigest()[:16]


def candidates_for(ticker, tf="D") -> list[dict]:
    bars = _read_bars(ticker, tf)
    if not bars:
        return []
    try:
        from api.services.pattern_engine import detect_all
        from api.services.pattern_engine.primitives.context import build_context
        ctx = build_context(bars, ticker)
        raw = detect_all(bars, ctx, pattern_ids=FOCUSED_SETUPS) or []
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
        if sid not in best or conf > best[sid]["raw_confidence"]:
            best[sid] = {"setup": sid, "raw_confidence": conf, "asof_date": today}
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
        png = chart_render.render_chart(bars)
        if not png:
            continue
        try:
            v = vision_judge.judge(setup, png, client=client)
        except Exception as e:
            log.warning("[pv] judge %s/%s failed: %s", ticker, setup, e)
            continue
        u = v.get("usage", {})
        model = v.get("model", "claude-opus-4-8")
        cost = _cost(model, u.get("input_tokens", 0), u.get("output_tokens", 0))
        store.log_cost(day, ticker, model, u.get("input_tokens", 0), u.get("output_tokens", 0), cost)
        store.put_verdict({
            "ticker": ticker.upper(), "tf": tf, "setup": setup, "asof_date": cand["asof_date"],
            "confirmed": 1 if v["confirmed"] else 0, "vision_confidence": float(v["confidence"]),
            "rationale": v["reason"], "key_level": v.get("key_level"),
            "raw_confidence": cand["raw_confidence"], "model": model,
            "signals_hash": sig, "judged_at": int(time.time()),
        })
        out["judged"] += 1
        if v["confirmed"]:
            out["confirmed"] += 1
    return out
