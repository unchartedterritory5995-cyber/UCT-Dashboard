"""AI Search Phase 3 — house-view dossier synthesis.

Distils accumulated evergreen knowledge + existing desk data into evolving,
EVERGREEN "house-view" dossiers per ticker (and theme). Dossiers become the top
retrieval target in the Phase-2 memory, so answers lead with the desk's
synthesized view, then supporting Q&A, then live grounding.

Design: docs/superpowers/specs/2026-07-21-aisearch-brain-phase3-design.md
Storage/retrieval live in ai_search_memory (which owns the DB); this module owns
the synthesis pipeline. Best-effort throughout — never raises, never blocks an
answer. Flag-gated dark (AI_SEARCH_DOSSIER_ENABLED=0) — no LLM spend until flipped.

The freshness firewall: a dossier is EVERGREEN house-view only (business / moat /
competitive position / structural bull-bear debate / recurring setups). The
prompt FORBIDS prices, levels, and dated figures; live grounding owns all current
numbers.
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
import threading
import time
from datetime import datetime, timezone

log = logging.getLogger("ai_search_dossier")

_LOCK = threading.Lock()
_LAST_RUN = 0.0
_RUNNING = False
_spend_day = ""
_spend = 0.0

_SYNTH_SYSTEM = (
    "You are the UCT Intelligence research desk writing a DURABLE house-view "
    "dossier on a company or theme for the desk's own reference. Synthesize the "
    "material into a tight ~200-350 word brief covering: what it IS (business / "
    "what the theme captures), the moat / competitive position, the structural "
    "bull case and bear case, and any recurring setup or behavior the desk notes. "
    "HARD RULE — EVERGREEN ONLY: do NOT state any price, level, market cap, "
    "price target, or dated figure — those are fetched live elsewhere and would "
    "go stale here. Write durable structural knowledge that stays true for months. "
    "Reply as JSON: {\"title\": \"<Company/Theme name>\", \"dossier\": \"<the brief>\"}."
)


def _enabled() -> bool:
    return os.environ.get("AI_SEARCH_DOSSIER_ENABLED", "0") == "1"


def _model() -> str:
    return os.environ.get("AI_SEARCH_DOSSIER_MODEL", "claude-sonnet-4-6")


def _min_q() -> int:
    try:
        return max(1, int(os.environ.get("AI_SEARCH_DOSSIER_MIN_Q", "3")))
    except ValueError:
        return 3


def _batch() -> int:
    try:
        return max(1, int(os.environ.get("AI_SEARCH_DOSSIER_BATCH", "5")))
    except ValueError:
        return 5


def _et_day() -> str:
    try:
        from zoneinfo import ZoneInfo
        return datetime.now(ZoneInfo("America/New_York")).strftime("%Y-%m-%d")
    except Exception:
        return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def _reset_for_tests() -> None:
    global _LAST_RUN, _RUNNING, _spend_day, _spend
    with _LOCK:
        _LAST_RUN = 0.0
        _RUNNING = False
        _spend_day = ""
        _spend = 0.0


# ── cost gate (own daily cap; in-memory, resets on redeploy — lenient) ───────
def _cost_ok(est: float = 0.02) -> bool:
    global _spend_day, _spend
    day = _et_day()
    with _LOCK:
        if day != _spend_day:
            _spend_day, _spend = day, 0.0
        hard = float(os.environ.get("AI_SEARCH_DOSSIER_COST_HARD", "3.00"))
        return _spend + est <= hard


def _record_spend(est: float = 0.02) -> None:
    global _spend
    with _LOCK:
        _spend += est


# ── entity selection ─────────────────────────────────────────────────────────
def select_entities() -> list[tuple[str, str]]:
    """[(entity_key, entity_type)] to (re)synthesize this run — tickers asked
    about >= MIN_Q (evergreen) + the UCT20 seed, plus the themes those tickers
    belong to (demand-driven). Bounded to BATCH, most-asked first."""
    counts: dict[str, int] = {}
    try:
        import sqlite3
        from api.services import ai_search_log
        with sqlite3.connect(ai_search_log._db_path(), timeout=5) as c:
            for sym, n in c.execute(
                "SELECT primary_ticker, COUNT(*) FROM ai_search_log "
                "WHERE primary_ticker IS NOT NULL AND primary_ticker <> '' "
                "AND freshness='evergreen' GROUP BY primary_ticker"):
                counts[sym] = n
    except Exception:
        pass
    tickers = {s for s, n in counts.items() if n >= _min_q()}
    try:
        from api.services.engine import get_leadership
        for r in (get_leadership() or [])[:20]:
            s = (r.get("ticker") or r.get("sym") or "").upper() if isinstance(r, dict) else ""
            if s:
                tickers.add(s)
    except Exception:
        pass
    # Demand-driven themes: themes the asked-about tickers belong to.
    themes: dict[str, int] = {}
    try:
        from api.services.theme_db import get_themes_for_ticker
        for s in list(tickers):
            for th in (get_themes_for_ticker(s) or []):
                key = th.get("id") or th.get("name") if isinstance(th, dict) else str(th)
                if key:
                    themes[str(key)] = themes.get(str(key), 0) + 1
    except Exception:
        pass

    ranked_t = sorted(tickers, key=lambda s: -counts.get(s, 0))
    ranked_th = [k for k, _ in sorted(themes.items(), key=lambda kv: -kv[1])]
    out = [(s, "ticker") for s in ranked_t] + [(f"theme:{k}", "theme") for k in ranked_th]
    return out[:_batch()]


# ── source gathering ─────────────────────────────────────────────────────────
def _evergreen_qa(entity_ticker: str, limit: int = 8) -> list[str]:
    try:
        import sqlite3
        from api.services import ai_search_log
        with sqlite3.connect(ai_search_log._db_path(), timeout=5) as c:
            rows = c.execute(
                "SELECT query, answer FROM ai_search_log WHERE freshness='evergreen' "
                "AND answer_kind='ok' AND first_person=0 AND excluded=0 "
                "AND primary_ticker=? ORDER BY id DESC LIMIT ?", (entity_ticker, limit)).fetchall()
        return [f"Q: {q}\nA: {a}" for q, a in rows if a]
    except Exception:
        return []


def _gather_sources(entity_key: str, entity_type: str) -> tuple[str, str]:
    """Assemble the source bundle + its content hash. Ticker: desk data
    (fundamentals/analyst/insider) + KB + accumulated Q&A. Theme: KB + Q&A."""
    parts: list[str] = []
    if entity_type == "ticker":
        sym = entity_key
        for label, fn in (
            ("FUNDAMENTALS", lambda: _fund_line(sym)),
            ("ANALYST", lambda: _analyst_line(sym)),
            ("INSIDER", lambda: _insider_line(sym)),
        ):
            try:
                line = fn()
                if line:
                    parts.append(f"[{label}] {line}")
            except Exception:
                pass
        parts += _evergreen_qa(sym)
        kb_q = f"{sym} business moat competitive advantage"
    else:
        name = entity_key.split(":", 1)[-1]
        parts.append(f"[THEME] {name}")
        kb_q = f"{name} theme sector"
    try:
        from api.services.brain_kb_service import search as kb_search
        for h in (kb_search(kb_q, k=3) or []):
            parts.append(f"[KB {h.get('title', '')}] {(h.get('text') or '')[:400]}")
    except Exception:
        pass
    bundle = "\n".join(p for p in parts if p)[:6000]
    return bundle, hashlib.sha256(bundle.encode("utf-8", "ignore")).hexdigest()


def _fund_line(sym: str) -> str:
    from api.services.fundamentals import get_fundamentals
    f = get_fundamentals(sym) or {}
    bits = [f"{k} {f[k]}" for k in ("market_cap", "pe_forward", "profit_margin_pct",
            "revenue_growth_pct") if f.get(k) is not None]
    return ", ".join(bits)


def _analyst_line(sym: str) -> str:
    from api.services.analyst_intel import get_analyst_intel
    a = get_analyst_intel(sym) or {}
    cons = (a.get("consensus") or {}).get("rating")
    return f"consensus {cons}" if cons else ""


def _insider_line(sym: str) -> str:
    from api.services.insider import get_insider_activity
    rows = get_insider_activity(sym) or []
    buys = sum(1 for r in rows if (r.get("type") or "").lower() == "buy")
    sells = sum(1 for r in rows if (r.get("type") or "").lower() == "sell")
    return f"{buys} insider buys / {sells} sells (last ~90d)" if rows else ""


# ── synthesis ────────────────────────────────────────────────────────────────
def _call_llm(system: str, prompt: str) -> str:
    """One synthesis call. Thinking DISABLED (Sonnet-5 burns budget + returns empty
    otherwise) + explicit timeout. Monkeypatched in tests."""
    from api.services.engine import _get_anthropic_client
    client = _get_anthropic_client().with_options(
        timeout=float(os.environ.get("AI_SEARCH_DOSSIER_TIMEOUT", "60")))
    resp = client.messages.create(
        model=_model(), max_tokens=900,
        thinking={"type": "disabled"},
        system=system,
        messages=[{"role": "user", "content": prompt}])
    return "".join(getattr(b, "text", "") for b in resp.content)


def _parse(raw: str, entity_key: str) -> dict | None:
    raw = (raw or "").strip()
    if not raw:
        return None
    try:
        s = raw[raw.index("{"):raw.rindex("}") + 1]
        d = json.loads(s)
        text = (d.get("dossier") or "").strip()
        if text:
            return {"title": (d.get("title") or entity_key).strip()[:80], "dossier_text": text}
    except Exception:
        pass
    return {"title": entity_key[:80], "dossier_text": raw[:3000]} if len(raw) > 60 else None


def synthesize_entity(entity_key: str, entity_type: str, *, embed_fn=None) -> str:
    """Synthesize (or refresh) one dossier. Skip-if-stable + cost-gated. Returns a
    status string. Best-effort — never raises."""
    try:
        from api.services import ai_search_memory
        bundle, src_hash = _gather_sources(entity_key, entity_type)
        if not bundle.strip():
            return "no-sources"
        if ai_search_memory.get_source_hash(entity_key) == src_hash:
            return "unchanged"          # skip-if-stable — no LLM call
        if not _cost_ok():
            return "cost-capped"
        prompt = f"Entity: {entity_key} ({entity_type})\n\nSource material:\n{bundle}"
        raw = _call_llm(_SYNTH_SYSTEM, prompt)
        _record_spend()
        parsed = _parse(raw, entity_key)
        if not parsed:
            return "empty"
        from api.services.brain_kb_service import _default_embed
        embed_fn = embed_fn or _default_embed
        vec = embed_fn([f"{parsed['title']}\n{parsed['dossier_text']}"[:1800]])[0]
        ai_search_memory.upsert_dossier(
            entity_key=entity_key, entity_type=entity_type, title=parsed["title"],
            dossier_text=parsed["dossier_text"], source_hash=src_hash,
            embedding_vec=vec, model=_model())
        return "synthesized"
    except Exception:
        log.exception("synthesize_entity failed: %s", entity_key)
        return "error"


def run_batch(*, embed_fn=None) -> dict:
    """Select + synthesize a bounded batch. No-op when the flag is off. Best-effort."""
    if not _enabled():
        return {"enabled": False, "synthesized": 0, "results": {}}
    results: dict[str, str] = {}
    n = 0
    for entity_key, entity_type in select_entities():
        r = synthesize_entity(entity_key, entity_type, embed_fn=embed_fn)
        results[entity_key] = r
        if r == "synthesized":
            n += 1
        if not _cost_ok():
            break
    global _LAST_RUN
    _LAST_RUN = time.time()
    if n:
        log.info("ai_search_dossier run_batch: synthesized=%s results=%s", n, results)
    return {"enabled": True, "synthesized": n, "results": results}


def maybe_run(*, embed_fn=None) -> None:
    """Throttled background batch (daemon thread) — kicked opportunistically, no
    main.py wiring. Runs only when the flag is on."""
    global _LAST_RUN, _RUNNING
    if not _enabled():
        return
    throttle = int(os.environ.get("AI_SEARCH_DOSSIER_THROTTLE_S", "21600"))  # 6h
    now = time.time()
    with _LOCK:
        if _RUNNING or now - _LAST_RUN < throttle:
            return
        _RUNNING = True

    def _run():
        global _RUNNING
        try:
            run_batch(embed_fn=embed_fn)
        finally:
            with _LOCK:
                _RUNNING = False

    threading.Thread(target=_run, daemon=True).start()
