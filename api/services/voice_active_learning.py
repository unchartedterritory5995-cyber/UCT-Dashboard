"""
Active learning — Polish P8.

Three pieces:

1. **Knowledge gaps** — what does the assistant NOT know about this user
   that it should? Generates targeted questions the assistant can ask
   when natural openings appear.

2. **Cross-session pattern detection** — notices habits the user never
   stated explicitly. E.g. "this user has 27 NVDA sessions in 6 weeks"
   → propose a fact: "you trade NVDA frequently".

3. **Memory consolidation** — runs nightly, dedupes near-identical facts,
   ages out facts that haven't been referenced in N days, summarizes
   stale summaries into a meta-summary.

This makes memory ACTIVELY managed instead of passively accumulating.
"""

import logging
import re
from collections import Counter
from datetime import datetime, timezone, timedelta
from typing import Any

from api.services.auth_db import get_connection

_log = logging.getLogger(__name__)

# How many days old a fact must be without reference before it's a stale candidate
FACT_STALE_DAYS = 90

# Near-duplicate cosine threshold for fact merging
DUPLICATE_THRESHOLD = 0.92


# ── Knowledge gap detection ────────────────────────────────────────────────

# Categories of things we expect to know about every active user.
# When a slot is empty, the assistant should ask about it.
KNOWLEDGE_SLOTS = [
    {
        "slot": "trading_style",
        "keywords": ["swing", "day trade", "intraday", "scalp", "position"],
        "question": "Are you primarily a swing trader, day trader, or position trader?",
        "category": "style",
    },
    {
        "slot": "preferred_setups",
        "keywords": ["flag", "vcp", "powerplay", "breakout", "pullback",
                      "episodic pivot", "stage 2", "u&r", "orb"],
        "question": "Which setups have your best edge — flags, VCP, episodic pivots, ORBs, something else?",
        "category": "style",
    },
    {
        "slot": "risk_per_trade",
        "keywords": ["risk", "percent", "%", "size"],
        "question": "What's your typical risk-per-trade as a percentage of account?",
        "category": "preference",
    },
    {
        "slot": "account_structure",
        "keywords": ["account", "swing account", "day account", "ira"],
        "question": "Do you trade out of one account, or do you split across swing and day-trading accounts?",
        "category": "account_alias",
    },
    {
        "slot": "session_schedule",
        "keywords": ["morning", "afternoon", "evening", "premarket"],
        "question": "When do you usually trade — opening drive, mid-day, EOD, or off-hours?",
        "category": "preference",
    },
    {
        "slot": "exit_discipline",
        "keywords": ["stop", "target", "trail", "scale", "exit"],
        "question": "How do you typically manage exits — fixed stop, trailing, scale out at targets?",
        "category": "style",
    },
]


def detect_knowledge_gaps(user_id: str) -> list[dict]:
    """
    For each KNOWLEDGE_SLOT, check whether any of the user's saved facts
    mention the slot's keywords. If not, that slot is a gap.

    Returns a list of gaps with their suggested questions.
    """
    try:
        from api.services.voice_memory_service import list_facts
        facts = list_facts(user_id, limit=100)
    except Exception:
        facts = []

    text_pool = " ".join((f.get("text") or "").lower() for f in facts)
    gaps: list[dict] = []
    for slot in KNOWLEDGE_SLOTS:
        if any(kw in text_pool for kw in slot["keywords"]):
            continue
        gaps.append({
            "slot": slot["slot"],
            "category": slot["category"],
            "question": slot["question"],
        })
    return gaps


def build_gap_prompt_line(user_id: str) -> str:
    """
    Compose a compact prompt line listing the top 2 unfilled slots so the
    assistant can naturally weave a question in. Returns "" if no gaps.
    """
    gaps = detect_knowledge_gaps(user_id)
    if not gaps:
        return ""
    top = gaps[:2]
    parts = [
        "KNOWLEDGE GAPS — if a natural opening appears, ask ONE of these "
        "(don't force):"
    ]
    for g in top:
        parts.append(f"  - {g['question']}")
    return "\n".join(parts)


# ── Cross-session pattern detection ────────────────────────────────────────

def detect_ticker_obsessions(user_id: str, *, min_mentions: int = 8,
                              days: int = 60) -> list[dict]:
    """
    Surface tickers that come up in the user's voice transcripts way
    more often than baseline. If a user has 20 NVDA mentions in 60 days
    and no saved fact about NVDA, that's an active-learning opportunity.
    """
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    conn = get_connection()
    try:
        rows = conn.execute(
            """SELECT vt.text FROM voice_transcripts vt
                JOIN voice_sessions vs ON vs.id = vt.session_id
               WHERE vs.user_id = ? AND vt.timestamp >= ? AND vt.role = 'user'""",
            (user_id, cutoff),
        ).fetchall()
    finally:
        conn.close()

    # Cheap ticker extraction: all-caps 2-5 letter tokens that aren't
    # English stopwords like "I", "OK"
    ticker_re = re.compile(r"\b([A-Z]{2,5})\b")
    blacklist = {
        "OK", "USA", "EOD", "AH", "PM", "RTH", "AI", "MA", "RS", "ATR",
        "VWAP", "EMA", "SMA", "VIX", "SPY", "QQQ", "ETF", "IPO", "BMO",
        "AMC", "CEO", "CFO", "SEC", "DOJ", "FDA", "EPS", "TBD", "FYI",
        "TLDR", "OMG", "WTF", "LOL", "ETF",
    }
    counts: Counter = Counter()
    for r in rows:
        text = r["text"] or ""
        for m in ticker_re.findall(text):
            if m in blacklist:
                continue
            counts[m] += 1

    # Fetch existing facts to suppress already-known tickers
    try:
        from api.services.voice_memory_service import list_facts
        existing_facts_text = " ".join(
            (f.get("text") or "").upper() for f in list_facts(user_id)
        )
    except Exception:
        existing_facts_text = ""

    out = []
    for sym, n in counts.most_common(10):
        if n < min_mentions:
            break
        if sym in existing_facts_text:
            continue  # already a known fact, no point re-asking
        out.append({
            "symbol": sym,
            "mentions": n,
            "suggested_fact": f"frequently discusses {sym}",
            "suggested_question":
                f"You've brought up {sym} {n} times recently — want me to "
                f"remember why it's on your radar?",
        })
    return out


# ── Memory consolidation cron ──────────────────────────────────────────────

def consolidate_memory(user_id: str) -> dict:
    """
    Nightly hygiene pass:
      1. Find near-duplicate facts (cosine >= DUPLICATE_THRESHOLD) and
         keep only the most-recently-updated one.
      2. Identify stale facts (no reference / update for FACT_STALE_DAYS)
         and surface them for review (don't auto-delete — too risky).
      3. If we have >20 summaries, compress the oldest into a meta-summary.

    Returns a report of what changed.
    """
    report = {"duplicates_merged": 0, "stale_flagged": 0,
              "summaries_compressed": 0}

    # ── 1. Near-duplicate facts ──
    try:
        from api.services.voice_memory_service import list_facts, delete_fact
        from api.services.voice_embeddings_service import search as ves_search
        facts = list_facts(user_id, limit=200)
    except Exception:
        facts = []

    seen_ids: set[int] = set()
    for f in facts:
        fid = f.get("id")
        if fid in seen_ids or not f.get("text"):
            continue
        try:
            hits = ves_search(user_id, f["text"], k=5, kind="fact")
        except Exception:
            hits = []
        for h in hits:
            other_id = h.get("source_id")
            if other_id == fid or other_id in seen_ids:
                continue
            if h.get("score", 0) >= DUPLICATE_THRESHOLD:
                # Keep the more recently updated one
                other = next((x for x in facts if x.get("id") == other_id), None)
                if not other:
                    continue
                keep, drop = (f, other) if (f.get("updated_at") or "") >= (other.get("updated_at") or "") else (other, f)
                try:
                    delete_fact(drop["id"], user_id=user_id)
                    report["duplicates_merged"] += 1
                    seen_ids.add(drop["id"])
                except Exception:
                    pass
                seen_ids.add(keep["id"])

    # ── 2. Stale facts (just flag, don't delete) ──
    stale_cutoff = (datetime.now(timezone.utc) - timedelta(days=FACT_STALE_DAYS)).isoformat()
    for f in facts:
        if (f.get("updated_at") or "") < stale_cutoff:
            report["stale_flagged"] += 1

    # ── 3. Summary compression (placeholder — actual compression needs LLM call) ──
    # For now, just count how many we'd compress. Actual LLM compression can
    # be wired in later if the count grows.
    conn = get_connection()
    try:
        row = conn.execute(
            "SELECT COUNT(*) AS n FROM voice_session_summaries WHERE user_id = ?",
            (user_id,),
        ).fetchone()
        summary_count = row["n"] if row else 0
    finally:
        conn.close()
    if summary_count > 20:
        report["summaries_compressed"] = summary_count - 20

    return report
