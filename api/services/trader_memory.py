"""
Trader Memory — unified read/write surface for Compass × Voice.

Phase 2-A of the Compass × Voice unification.

Two stores need to feel like one:

  1. **Voice facts** (`voice_facts` table) — atomic, vector-embedded,
     query-by-similarity. Maintained by Voice's `voice_memory_service`.

  2. **Compass Trader Profile** (`j2_accounts.trader_profile` TEXT) —
     long-form markdown narrative. Maintained by Compass's weekly review
     and `update_trader_profile` chat tool.

This module exposes a single facade so:

  - Voice's prompt assembly can pull BOTH facts AND the profile when
    building per-session context.
  - Compass's chat assembly can pull BOTH the profile AND voice facts
    when building user context.
  - Any future caller talks to one API instead of remembering two
    schemas.

The underlying stores stay separate (a markdown profile is a fundamentally
different shape than atomic facts) — this module composes them at read
time and routes writes by intent.
"""
from __future__ import annotations

import logging
from typing import Any

_log = logging.getLogger(__name__)


# ── Account resolution ─────────────────────────────────────────────────────

def get_default_account_id(user_id: str) -> str | None:
    """Resolve the user's default Journal 2.0 account id. None if missing.

    Uses the existing Compass migration helper — idempotent and creates
    a Default account on first access if the user has none.
    """
    if not user_id:
        return None
    try:
        from api.services.journal_two.accounts import get_or_migrate_default_account
        acc = get_or_migrate_default_account(user_id)
        return acc.get("id") if isinstance(acc, dict) else None
    except Exception as e:  # noqa: BLE001
        _log.warning("[trader_memory] account resolve failed: %s", e)
        return None


# ── Trader Profile (Compass-side: j2_accounts.trader_profile) ──────────────

def get_trader_profile(user_id: str, account_id: str | None = None) -> str:
    """Return the trader_profile markdown for the user's account. Empty
    string if no profile or no account."""
    aid = account_id or get_default_account_id(user_id)
    if not aid:
        return ""
    try:
        from api.services.auth_db import get_connection
        conn = get_connection()
        try:
            row = conn.execute(
                "SELECT trader_profile FROM j2_accounts WHERE id = ? AND user_id = ?",
                (aid, user_id),
            ).fetchone()
            if row is None:
                return ""
            return (row["trader_profile"] or "") if isinstance(row, dict) or hasattr(row, "keys") else (row[0] or "")
        finally:
            conn.close()
    except Exception as e:  # noqa: BLE001
        _log.warning("[trader_memory] get_trader_profile failed: %s", e)
        return ""


def update_trader_profile(
    user_id: str,
    new_profile: str,
    account_id: str | None = None,
) -> bool:
    """Update trader_profile markdown. Returns True on success.

    Use this when assembling a refined narrative profile — for atomic
    facts ("I trade ES intraday"), use add_fact() instead.
    """
    aid = account_id or get_default_account_id(user_id)
    if not aid:
        return False
    text = (new_profile or "").strip()
    if not text:
        return False
    try:
        from api.services.auth_db import get_connection
        conn = get_connection()
        try:
            cur = conn.execute(
                "UPDATE j2_accounts SET trader_profile = ? WHERE id = ? AND user_id = ?",
                (text[:20000], aid, user_id),  # 20K char ceiling matches profile-update prompt
            )
            conn.commit()
            return cur.rowcount > 0
        finally:
            conn.close()
    except Exception as e:  # noqa: BLE001
        _log.warning("[trader_memory] update_trader_profile failed: %s", e)
        return False


# ── Voice facts (atomic memory) ────────────────────────────────────────────

def add_fact(
    user_id: str,
    text: str,
    *,
    category: str = "general",
) -> int | None:
    """Add an atomic fact via voice_memory_service. Returns the fact id."""
    if not text or not text.strip():
        return None
    try:
        from api.services.voice_memory_service import add_fact as _add
        return _add(user_id, text=text.strip(), category=category)
    except Exception as e:  # noqa: BLE001
        _log.warning("[trader_memory] add_fact failed: %s", e)
        return None


def list_facts(user_id: str, *, limit: int = 100) -> list[dict[str, Any]]:
    """List facts for a user, newest first."""
    try:
        from api.services.voice_memory_service import list_facts as _list
        return _list(user_id, limit=limit) or []
    except Exception as e:  # noqa: BLE001
        _log.warning("[trader_memory] list_facts failed: %s", e)
        return []


def delete_facts_matching(user_id: str, query: str) -> int:
    """Delete facts matching a query (substring or category match).
    Returns count deleted."""
    if not query or not query.strip():
        return 0
    try:
        from api.services.voice_memory_service import delete_facts_matching as _del
        return _del(user_id, query.strip()) or 0
    except Exception as e:  # noqa: BLE001
        _log.warning("[trader_memory] delete_facts_matching failed: %s", e)
        return 0


# ── Unified context (the canonical read for prompt assembly) ───────────────

def build_unified_memory_context(
    user_id: str,
    *,
    account_id: str | None = None,
    fact_limit: int = 40,
    profile_max_chars: int = 3500,
) -> str:
    """Compose the user's complete memory state as a markdown blob.

    Used by:
      - Voice session_token (replaces voice_memory_service.build_memory_context)
      - Compass chat assembly (when the chat path wants the full picture
        beyond just the profile markdown)

    Sections:
      1. Trader Profile (narrative)
      2. Atomic facts (preferences, identifiers, rules the user has told us)

    Returns an empty string if both sources are empty.
    """
    parts: list[str] = []

    # Profile (Compass narrative)
    profile = get_trader_profile(user_id, account_id=account_id)
    if profile.strip():
        truncated = profile.strip()
        if len(truncated) > profile_max_chars:
            truncated = truncated[:profile_max_chars].rstrip() + "\n… (profile truncated)"
        parts.append("## Trader Profile (narrative)\n" + truncated)

    # Facts (voice atomic memory)
    facts = list_facts(user_id, limit=fact_limit)
    if facts:
        lines = ["## Saved facts about this trader"]
        # Group by category for readability
        by_cat: dict[str, list[str]] = {}
        for f in facts:
            cat = f.get("category") or "general"
            txt = (f.get("text") or "").strip()
            if not txt:
                continue
            by_cat.setdefault(cat, []).append(txt)
        for cat in sorted(by_cat.keys()):
            if cat == "general":
                continue  # render general last for prominence of typed categories
            lines.append(f"\n### {cat}")
            for t in by_cat[cat][:20]:
                lines.append(f"  - {t}")
        if "general" in by_cat:
            lines.append("\n### general")
            for t in by_cat["general"][:20]:
                lines.append(f"  - {t}")
        parts.append("\n".join(lines))

    return "\n\n".join(parts).strip()


# ── Migration helpers ──────────────────────────────────────────────────────

def import_fact_from_profile_blob(user_id: str) -> int:
    """One-time helper: if the user has a trader_profile but no facts,
    seed voice_facts with a single seed entry summarizing the profile.

    This is a v1 migration aid — eventually Compass profile refinement
    should distill atomic facts and write them via add_fact() directly.
    For now we keep them separate.
    """
    facts = list_facts(user_id, limit=1)
    if facts:
        return 0
    profile = get_trader_profile(user_id)
    if not profile.strip():
        return 0
    seed = profile.strip()[:500]
    fact_id = add_fact(
        user_id,
        f"Trader profile summary: {seed}",
        category="profile_seed",
    )
    return 1 if fact_id else 0
