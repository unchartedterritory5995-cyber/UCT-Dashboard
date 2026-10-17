"""Which saved-scan alert subscriptions no longer follow the formula they name.

A0 (Indicators Phase A, 2026-10-13) — DETECTION ONLY. Nothing here writes, deletes,
re-keys or delivers anything; `run_nightly` is untouched.

⛔ WHY IT EXISTS. A subscription (`screen_alert_subs`) is keyed by the result identity
the member subscribed to, `(user_id, def_hash)`. The nightly diff reads scan results
filed under exactly that string. Two things move the identity a definition's results
are filed under, and neither moves the subscription:

  * an EDIT of the formula's maths — the definition keeps its `def_id`, its results are
    filed under the new tree's hash, and the subscription keeps reading the old one:
    it goes silent, or keeps firing on a tree another member still holds;
  * DEFINITION SEMANTICS 2 (since 2026-10-06) files results under `<hash>~s2`
    (`user_definitions.result_identity`), so a subscription made with the bare tree
    hash reads a key nothing is written to.

The live answer is always `user_definitions.result_identity(<newest stored version>)`.
A subscription whose key differs from it is DISCONNECTED. Re-keying is Phase A2 work
(owner decision D11); this module is the measurement that work is checked against.
"""
from __future__ import annotations

from typing import Optional

from api.services import user_definitions

from . import screen_alerts, snapshot_db

#: Why a subscription is disconnected. Closed set.
DELETED = "deleted"        # the definition is gone (or the id never belonged to one)
SEMANTICS = "semantics"    # same tree, but the semantics suffix differs
EDITED = "edited"          # the scan tree itself has changed since subscribing
REASONS = (DELETED, SEMANTICS, EDITED)


def _bare(identity: str) -> str:
    return identity.split(user_definitions.SEMANTICS_IDENTITY_SUFFIX, 1)[0]


def classify(subscribed: str, current: Optional[str]) -> Optional[str]:
    """`None` when `subscribed` IS the live identity; otherwise one of `REASONS`."""
    if current is None:
        return DELETED
    if subscribed == current:
        return None
    if _bare(subscribed) == _bare(current):
        return SEMANTICS
    return EDITED


def disconnected_subscriptions() -> list:
    """Every subscription whose key is not its definition's live result identity.

    Read-only: one SELECT, then one `user_definitions.get` per subscription.
    """
    screen_alerts._ensure()
    with snapshot_db.connect() as conn:
        rows = conn.execute(
            "SELECT user_id, def_hash, def_id, name FROM screen_alert_subs "
            "ORDER BY user_id, def_id").fetchall()
    out = []
    for user_id, def_hash, def_id, name in rows:
        try:
            doc = user_definitions.get(user_id, def_id)
        except ValueError:
            doc = None
        current = (user_definitions.result_identity(doc["definition"])
                   if doc is not None else None)
        reason = classify(def_hash, current)
        if reason is not None:
            out.append({"user_id": user_id, "def_id": def_id, "name": name,
                        "subscribed": def_hash, "current": current, "reason": reason})
    return out


def summary() -> dict:
    """Counts only — safe to print anywhere (no ids, no names, no market data)."""
    found = disconnected_subscriptions()
    counts = {r: 0 for r in REASONS}
    for item in found:
        counts[item["reason"]] += 1
    return {"disconnected": len(found), **counts}
