"""UCT Agent COACH (Wave 3, owner-authorized 2026-11-03) -- the intelligent trading coach, DARK by default.

Everything under this package is behind ONE server flag, `UCT_AGENT_COACH` (default off; reported by
/api/agent/config as `coach`), on top of the Agent's own admin-dark gate. Off, nothing here runs: the browser
registers no coach capability, the model gets no coach block, the concepts route is 404 and the guard is never
consulted (an ordinary turn is served exactly as before).

  concepts.py   the curated knowledge base (docs/agent/coach/concepts/*.md), parsed once, served to the browser
  guard.py      the deterministic evaluation suite: every coach reply is checked server-side (unsupported claims,
                order language, untraceable figures, missing uncertainty); a violating reply is REPLACED
  prompt.py     the `coach` prompt block: use the concept text, explain -> what to check -> one question back
  review.py     descriptive statistics over the member's own journal rows (W3-3): counts and stats only

Hard rules (PROGRAM.md Wave 3): no autonomous trading, no orders, no price targets, no guarantee; every figure in a
coach answer comes from an envelope or the member's own journal rows; "Educational, not advice" on every coach
answer; the journal is read only after the member's explicit per-conversation consent (store.STATE_KEYS
`coachConsent`); journal writes are limited to a PROPOSED note; telemetry is value-free (codes and counts).
"""
from __future__ import annotations

import os
from typing import Any

FLAG_ENV = "UCT_AGENT_COACH"


def enabled() -> bool:
    return str(os.environ.get(FLAG_ENV) or "").strip().lower() in ("1", "true", "on", "yes")


def is_coach_turn(context: Any) -> bool:
    """A turn is the coach's when the browser's coach context provider published its entry (it does so only
    while the server reports `coach` on) AND the flag is on here. Both, so a stale browser cannot make the
    server coach while the flag is off."""
    if not enabled() or not isinstance(context, dict):
        return False
    sec = context.get("coach")
    return isinstance(sec, list) and any(isinstance(x, dict) and x.get("ref") for x in sec)


def coach_entry(context: Any) -> dict | None:
    """The coach context entry (the first one), or None."""
    if not isinstance(context, dict):
        return None
    sec = context.get("coach")
    if not isinstance(sec, list):
        return None
    return next((x for x in sec if isinstance(x, dict) and x.get("ref")), None)


CONSENT_STATES = ("granted", "revoked", "unknown")
MAX_CONCEPT_CHARS = 4000
MAX_OBSERVATION_CHARS = 300


def validate_consent(value: Any) -> dict:
    """The stored shape of `coachConsent`: {granted: bool, at: ISO-8601 UTC seconds}. The browser sends
    {granted: true|false}; anything else is a ValueError (a 400). `at` is the SERVER's clock, never the browser's."""
    import datetime as _dt
    if not isinstance(value, dict) or not isinstance(value.get("granted"), bool):
        raise ValueError("consent must be {granted: true | false}")
    return {"granted": value["granted"],
            "at": _dt.datetime.now(_dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")}


def consent_state(stored: Any) -> str:
    """'granted' | 'revoked' | 'unknown' from a stored value (store.get_state(...)['value'])."""
    if isinstance(stored, dict) and isinstance(stored.get("granted"), bool):
        return "granted" if stored["granted"] else "revoked"
    return "unknown"


def stored_consent(user_id: Any, conversation_id: str) -> str:
    """The member's consent for THIS conversation as the server stored it (store.STATE_KEYS `coachConsent`):
    granted | revoked | unknown. Fails closed (unknown) on any error."""
    try:
        from api.services.uct_agent import store
        row = store.get_state(user_id, conversation_id, "coachConsent")
    except Exception:  # noqa: BLE001 -- unreadable: nothing is granted
        return "unknown"
    v = (row or {}).get("value")
    if isinstance(v, dict) and v.get("granted") is True:
        return "granted"
    if isinstance(v, dict) and v.get("granted") is False:
        return "revoked"
    return "unknown"


def with_stored_consent(context: Any, consent: str) -> Any:
    """Review fix: the coach entry's `consent` is the SERVER's stored record, never the browser's claim."""
    if not isinstance(context, dict) or not isinstance(context.get("coach"), list):
        return context
    c = consent if consent in CONSENT_STATES else "unknown"
    return {**context, "coach": [({**e, "consent": c} if isinstance(e, dict) else e) for e in context["coach"]]}


def sanitize_context(context: Any) -> Any:
    """What the MODEL may see of the coach entry: the concept text and observation (bounded), the consent state,
    the concept ids, and the review ONLY through review.model_view (counts and stats; never a trade's prices,
    symbols or dates -- whatever a browser sent). Every other key of the entry is dropped. Non-coach context is
    returned as is."""
    from api.services.uct_agent.coach import review as _review
    if not isinstance(context, dict) or not isinstance(context.get("coach"), list):
        return context
    out: list[dict] = []
    for e in context["coach"]:
        if not isinstance(e, dict) or not e.get("ref"):
            continue
        clean: dict[str, Any] = {"ref": str(e["ref"]), "label": str(e.get("label") or "Trading coach")[:200]}
        if isinstance(e.get("conceptId"), str):
            clean["conceptId"] = e["conceptId"][:80]
        if isinstance(e.get("concept"), str) and e["concept"].strip():
            clean["concept"] = e["concept"][:MAX_CONCEPT_CHARS]
        if isinstance(e.get("observation"), str) and e["observation"].strip():
            clean["observation"] = e["observation"][:MAX_OBSERVATION_CHARS]
        if isinstance(e.get("concepts"), str):
            clean["concepts"] = e["concepts"][:1000]
        clean["consent"] = e.get("consent") if e.get("consent") in CONSENT_STATES else "unknown"
        mv = _review.model_view(e.get("review")) if clean["consent"] == "granted" else None
        if mv:
            clean["review"] = mv
        out.append(clean)
    return {**context, "coach": out}


def guard_inputs(context: Any, message: str) -> list[str]:
    """The texts a coach reply's figures may come from: the concept text REBUILT from the entry's `conceptId` (the
    server's own knowledge base -- the browser's `concept` copy is never trusted; an unknown id adds nothing), the
    observation and review stats (as the browser computed them), and the member's own message."""
    import json
    entry = coach_entry(context) or {}
    out: list[str] = []
    cid = entry.get("conceptId")
    if isinstance(cid, str) and cid:
        from api.services.uct_agent.coach import concepts
        c = concepts.by_id(cid)
        if c:
            out.append(c["text"])
    for k in ("observation", "review"):
        v = entry.get(k)
        if v:
            out.append(v if isinstance(v, str) else json.dumps(v, ensure_ascii=False))
    out.append(str(message or ""))
    return out


def guard_envelope(envelope: dict, context: Any, message: str, usage: dict | None = None,
                   history: list | None = None) -> dict:
    """Apply guard.enforce to a coach turn's reply (and a clarify question's text). A violating text is REPLACED
    by the fixed sentence; the codes are logged value-free and noted in `usage['coach_guard']` (codes only)."""
    import logging
    from api.services.uct_agent.coach import guard
    log = logging.getLogger(__name__)
    if not isinstance(envelope, dict):
        return envelope
    inputs = guard_inputs(context, message)
    out = dict(envelope)
    codes: list[str] = []
    reply = out.get("reply")
    if isinstance(reply, str) and reply.strip():
        res = guard.enforce(reply, inputs)
        codes += res["violations"]
        out["reply"] = res["text"] if (res["violations"] or out.get("disposition") == "answer") else reply
        # review B4 / N5: the model never writes its own definition of a UCT setup -- an uncited definition-like
        # sentence about a named setup replaces the reply (code `definition`)
        from api.services.uct_agent.coach import setups
        # (cited ONLY by coach.explain's own stored setup.playbook citation marker in this conversation's history)
        if not res["violations"] and setups.uncited_setup_definitions(reply, setups.cited_templates(history)):
            codes.append("definition")
            out["reply"] = setups.DEFINITION_FIXED
    q = out.get("question")
    if isinstance(q, dict) and isinstance(q.get("text"), str) and q["text"].strip():
        qcodes = guard.check(q["text"], inputs)
        if qcodes:
            codes += qcodes
            out["question"] = {**q, "text": guard.FIXED}
    if codes:
        log.info("[uct-agent] coach guard replaced text codes=%s", sorted(set(codes)))
    if usage is not None:
        usage["coach_guard"] = sorted(set(codes))
    return out
