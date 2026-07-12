# api/services/community_signals.py
"""UCT Signal auto-posts — curated live market signals dropped into #trading-floor as
'UCT Mentor' posts so the room breathes with real UCT data even when humans are quiet.
No generic community can do this — we own the feed.

Opt-in: gated on COMMUNITY_CHAT_ENABLED **and** COMMUNITY_SIGNALS_ENABLED (both must be
set), so the owner turns the firehose on deliberately. Heavily throttled/deduped to avoid
noise. Best-effort: never raises.

Signals in v1: top options-flow whale sweep + market-regime flip. Catalyst spotlight,
earnings-on-deck, and UCT20 changes are easy follow-ups (data getters mapped).
"""
import json
import logging
import os
import time
from datetime import datetime, timezone

_logger = logging.getLogger(__name__)

_last_flow_sig = None          # dedup: last posted (ticker,strike,exp,premium)
_last_flow_at = 0.0
_FLOW_MIN_GAP = int(os.environ.get("COMMUNITY_SIGNAL_FLOW_GAP", "2700"))   # 45 min between flow posts
_FLOW_MIN_PREMIUM = float(os.environ.get("COMMUNITY_SIGNAL_FLOW_MIN_PREMIUM", "250000"))


def _enabled() -> bool:
    return (os.environ.get("COMMUNITY_CHAT_ENABLED", "0") == "1"
            and os.environ.get("COMMUNITY_SIGNALS_ENABLED", "0") == "1")


def _data_dir() -> str:
    return os.environ.get("DATA_DIR") or ("/data" if os.path.isdir("/data") else ".")


def _para(nodes):
    return {"type": "paragraph", "content": nodes}


def _post_system(body_json, ticker_tags=None, card_json=None, channel="trading-floor"):
    from api.services import community_store as store
    mid = store.create_message(channel, None, body_json,
                               ticker_tags=ticker_tags or [], card_json=card_json,
                               bypass_rate_limit=True)
    try:
        from api import chat_stream
        msg = store.get_message(mid)
        msg["author"] = {"name": "UCT Mentor", "is_mentor": True}
        msg["card"] = json.loads(card_json) if card_json else None
        msg.pop("card_json", None)
        chat_stream.get_hub().broadcast(channel, "message", msg)
    except Exception:
        pass
    return mid


def post_flow_signal():
    """Post the day's top high-conviction options-flow sweep (deduped, throttled)."""
    global _last_flow_sig, _last_flow_at
    if time.time() - _last_flow_at < _FLOW_MIN_GAP:
        return {"posted": False, "reason": "throttled"}
    try:
        from api import live_alerts_db
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        alerts = live_alerts_db.query_alerts(today, today, limit=200) or []
    except Exception as e:
        return {"posted": False, "reason": f"no-alerts:{e}"}
    top = [a for a in alerts
           if a.get("grade") in ("A+", "A") and (a.get("alertPremium") or 0) >= _FLOW_MIN_PREMIUM]
    if not top:
        return {"posted": False, "reason": "no-high-grade"}
    top.sort(key=lambda a: a.get("alertPremium") or 0, reverse=True)
    a = top[0]
    sig = (a.get("ticker"), a.get("strike"), a.get("exp"), a.get("alertPremium"))
    if sig == _last_flow_sig:
        return {"posted": False, "reason": "duplicate"}

    from api.services import community_cards
    try:
        card = community_cards.build_card("flow", {
            "kind": "flow", "ticker": a.get("ticker"), "cp": a.get("cp"),
            "strike": a.get("strike"), "exp": a.get("exp"),
            "premium": a.get("alertPremium"), "grade": a.get("grade"),
            "dir": "BULL" if a.get("cp") == "C" else ("BEAR" if a.get("cp") == "P" else ""),
        }, user_id=None, load_trade=None)
    except ValueError:
        return {"posted": False, "reason": "bad-card"}
    body = json.dumps({"type": "doc", "content": [_para([
        {"type": "text", "marks": [{"type": "bold"}], "text": "Whale on the tape "},
        {"type": "text", "text": f"— grade {a.get('grade')} sweep just hit."}])]})
    _post_system(body, ticker_tags=[a.get("ticker")], card_json=json.dumps(card))
    _last_flow_sig = sig
    _last_flow_at = time.time()
    return {"posted": True, "ticker": a.get("ticker")}


def post_regime_flip():
    """Post a market-regime flip (durable last-label ledger in a marker file)."""
    try:
        from api.services import voice_regime_classifier as vrc
        cur = (vrc.get_current_regime() or {})
        label = cur.get("label") or cur.get("regime")
    except Exception as e:
        return {"posted": False, "reason": f"no-regime:{e}"}
    if not label:
        return {"posted": False, "reason": "no-label"}
    marker = os.path.join(_data_dir(), ".floor_last_regime")
    prev = None
    try:
        if os.path.isfile(marker):
            prev = open(marker, encoding="utf-8").read().strip()
    except Exception:
        prev = None
    if prev == label:
        return {"posted": False, "reason": "unchanged"}
    try:
        with open(marker, "w", encoding="utf-8") as f:
            f.write(label)
    except Exception:
        pass
    if prev is None:
        return {"posted": False, "reason": "first-seen"}   # don't announce on cold start
    narration = cur.get("narration") or ""
    body = json.dumps({"type": "doc", "content": [
        _para([{"type": "text", "marks": [{"type": "bold"}], "text": "Regime shift "},
               {"type": "text", "text": f"— the tape moved from {prev} to {label}."}]),
    ] + ([_para([{"type": "text", "text": narration[:280]}])] if narration else [])})
    _post_system(body)
    return {"posted": True, "from": prev, "to": label}


def post_premarket_brief():
    """Morning brief → #pre-market: top catalysts + notable earnings reporters.
    Idempotent per day via a marker file."""
    if not _enabled():
        return {"posted": False, "reason": "disabled"}
    marker = os.path.join(_data_dir(), ".floor_last_premarket")
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    try:
        if os.path.isfile(marker) and open(marker, encoding="utf-8").read().strip() == today:
            return {"posted": False, "reason": "already_posted"}
    except Exception:
        pass

    paras = [_para([{"type": "text", "marks": [{"type": "bold"}],
                     "text": "Pre-market brief — what's on the tape today."}])]
    tickers = []
    try:
        from api.services.catalyst import store as cat_store
        cats = (cat_store.get_for_date(today) or [])[:3]
        for c in cats:
            t = str(c.get("ticker") or "").upper()[:8]
            if not t:
                continue
            tickers.append(t)
            thesis = (c.get("thesis_text") or "").strip()
            content = [{"type": "tickerChip", "attrs": {"ticker": t}},
                       {"type": "text", "text": f" — {thesis[:180]}" if thesis else f" — {c.get('tag', 'catalyst')}"}]
            paras.append(_para(content))
    except Exception:
        pass
    try:
        from api.services import engine
        bmo = (engine.get_earnings() or {}).get("bmo") or []
        syms = [str(e.get("sym") or e.get("symbol") or "").upper()[:8] for e in bmo[:5]]
        syms = [s for s in syms if s]
        if syms:
            content = [{"type": "text", "text": "Reporting this morning: "}]
            for s in syms:
                content.append({"type": "tickerChip", "attrs": {"ticker": s}})
                content.append({"type": "text", "text": " "})
                if s not in tickers:
                    tickers.append(s)
            paras.append(_para(content))
    except Exception:
        pass
    if len(paras) == 1:
        return {"posted": False, "reason": "no-content"}
    body = json.dumps({"type": "doc", "content": paras})
    _post_system(body, ticker_tags=tickers[:10], channel="pre-market")
    try:
        with open(marker, "w", encoding="utf-8") as f:
            f.write(today)
    except Exception:
        pass
    return {"posted": True, "tickers": tickers}


def run_signal_cycle():
    """Scheduler entry — one flow + one regime check per cycle."""
    if not _enabled():
        return {"ran": False, "reason": "disabled"}
    out = {}
    try:
        out["regime"] = post_regime_flip()
    except Exception as e:
        out["regime"] = {"posted": False, "reason": str(e)}
    try:
        out["flow"] = post_flow_signal()
    except Exception as e:
        out["flow"] = {"posted": False, "reason": str(e)}
    return out
