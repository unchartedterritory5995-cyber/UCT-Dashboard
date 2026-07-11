# api/services/community_ask.py
"""/ask Compass in chat — a member asks a trading question and the UCT brain answers
in-channel as 'UCT Mentor'. This is the AI-mentor moat no generic community has.

Path: brain_kb_service.ask_the_brain (cheap retrieval, one embedding) → one short Claude
synthesis → post as 'UCT Mentor'. Runs async so the send returns instantly; the answer
appears via SSE when ready. Gated on COMMUNITY_ASK_ENABLED (owner opt-in — it costs tokens)
and needs the Brain Pack installed (BRAIN_PACK_ENABLED) + ANTHROPIC/OpenAI keys. Never raises.
"""
import json
import logging
import os
import threading
import time

_logger = logging.getLogger(__name__)

_ask_lock = threading.Lock()
_ask_last = {}   # user_id -> epoch (per-user throttle)
_ASK_COOLDOWN = int(os.environ.get("COMMUNITY_ASK_COOLDOWN", "20"))
_ASK_MODEL = os.environ.get("COMMUNITY_ASK_MODEL", "claude-haiku-4-5-20251001")


def enabled() -> bool:
    return (os.environ.get("COMMUNITY_CHAT_ENABLED", "0") == "1"
            and os.environ.get("COMMUNITY_ASK_ENABLED", "0") == "1")


def allow(user_id) -> bool:
    now = time.time()
    with _ask_lock:
        if now - _ask_last.get(user_id, 0) < _ASK_COOLDOWN:
            return False
        _ask_last[user_id] = now
        return True


def _post_answer(slug, text):
    from api.services import community_store as store
    body = json.dumps({"type": "doc", "content": [
        {"type": "paragraph", "content": [
            {"type": "text", "marks": [{"type": "bold"}], "text": "Compass: "},
            {"type": "text", "text": text}]}]})
    mid = store.create_message(slug, None, body, bypass_rate_limit=True)
    try:
        from api import chat_stream
        msg = store.get_message(mid)
        msg["author"] = {"name": "UCT Mentor", "is_mentor": True}
        msg.pop("card_json", None)
        msg["card"] = None
        chat_stream.get_hub().broadcast(slug, "message", msg)
    except Exception:
        pass


def _generate(question):
    """Return a synthesized answer string, or None if the brain has nothing / is off."""
    try:
        from api.services import brain_kb_service
        res = brain_kb_service.ask_the_brain(question)
    except Exception as e:
        _logger.warning("[floor-ask] brain lookup failed: %s", e)
        return None
    if not res or not res.get("ok"):
        return None
    passages = res.get("passages") or []
    if not passages:
        return None
    context = "\n\n".join(
        f"[{p.get('title', '')}] {p.get('excerpt', '')}" for p in passages[:6])
    try:
        from api.services import engine
        client = engine._get_anthropic_client()
        prompt = (
            "You are UCT Mentor answering a trader's question in a live community chat. "
            "Answer ONLY from the knowledge-base passages below, in <=110 words, plain and "
            "direct, no fluff, no disclaimers. If the passages don't cover it, say so briefly.\n\n"
            f"QUESTION: {question}\n\nPASSAGES:\n{context}")
        resp = client.with_options(timeout=45).messages.create(
            model=_ASK_MODEL, max_tokens=320,
            messages=[{"role": "user", "content": prompt}])
        parts = [b.text for b in resp.content if getattr(b, "type", "") == "text"]
        return ("".join(parts)).strip() or None
    except Exception as e:
        _logger.warning("[floor-ask] synthesis failed: %s", e)
        return None


def answer_async(slug, question):
    """Fire-and-forget: generate + post the answer off the request path."""
    def _run():
        try:
            ans = _generate(question)
            if ans:
                _post_answer(slug, ans)
            else:
                _post_answer(slug, "I don't have a solid answer in the playbook for that yet — "
                                   "try rephrasing, or ask the desk.")
        except Exception as e:
            _logger.warning("[floor-ask] answer_async failed: %s", e)
    threading.Thread(target=_run, daemon=True).start()
