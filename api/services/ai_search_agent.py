"""Agent lane — ONE tool-calling brain for AI Search.

"One engine, three doors" all the way down: voice and Compass chat already
share one tool registry (voice_tools) so the surfaces can never diverge; this
lane gives the TYPED ask box the same brain. Instead of regex-gated context
packs guessing what to attach, the model itself decides which desk tools to
call — the same implementations, through the same dispatch(), that voice uses
— plus a web_search tool riding the hardened Perplexity wrapper.

READ-ONLY BY CONSTRUCTION: the allowlist below names only data-reading tools.
The voice registry also holds action tools (create_position, add_to_watchlist,
navigation…) with their own preview/confirm machinery — none are reachable
from this lane, ever. Actions from the ask box go through the PROPOSAL chips
(the member's tap is the consent), not through the model.

Cost rails: every Anthropic call records under surface 'ai_search_agent'
(cap AI_SEARCH_AGENT_COST_CAP_DAILY, default $15/day — over-cap asks fall
back to the fast tier in the router); web_search legs ledger under
pplx:ai_search via the wrapper. The router bills 2 quota units per agent ask.

The loop is BLOCKING (sync Anthropic calls) — the stream endpoint runs it in
an executor and bridges `emit` callbacks onto the event loop so the member
watches the agent work ("checking grade_ticker…").
"""
from __future__ import annotations

import json
import logging
import os
import re

log = logging.getLogger("ai_search_agent")

_MAX_STEPS = 6
_TOOL_RESULT_CAP = 3200
_MAX_TOKENS = 1400

# Read-only desk tools, shared verbatim with voice/Compass via the registry.
_AGENT_ALLOWED = [
    "get_quote", "get_regime", "get_breadth", "get_movers",
    "find_patterns_on_ticker", "grade_ticker", "ask_the_brain",
    "get_earnings_intel", "get_options_flow", "get_short_interest",
    "get_sector_strength", "get_bar_summary", "get_polygon_news",
    "get_scanner_candidates", "get_fundamentals", "get_insider_activity",
]


def _model() -> str:
    return os.environ.get("AI_SEARCH_AGENT_MODEL", "claude-sonnet-5").strip()


def _cost_cap() -> float:
    try:
        return float(os.environ.get("AI_SEARCH_AGENT_COST_CAP_DAILY", "15.0"))
    except ValueError:
        return 15.0


def available() -> bool:
    """Cheap gate the router checks before reserving the agent lane."""
    try:
        from api.services import narrative_cost_guard as guard
        if guard.spend_today_usd("ai_search_agent") >= _cost_cap():
            return False
    except Exception:
        pass
    try:
        from api.services.engine import _get_anthropic_client
        return _get_anthropic_client() is not None
    except Exception:
        return False


def _tool_schemas() -> list[dict]:
    from api.services import voice_tools
    from api.services import voice_tool_impls  # noqa: F401 — populates the registry
    out: list[dict] = []
    for name in _AGENT_ALLOWED:
        entry = voice_tools._REGISTRY.get(name)
        if not entry:
            continue
        out.append({
            "name": name,
            "description": str(entry["description"])[:400],
            "input_schema": {"type": "object", "properties": entry["parameters"]},
        })
    out.append({
        "name": "web_search",
        "description": ("Current financial journalism (curated finance domains, cited). "
                        "Use for news, catalysts, guidance, street commentary — anything "
                        "the desk tools don't hold. recency: hour|day|week|month."),
        "input_schema": {"type": "object", "properties": {
            "query": {"type": "string"},
            "recency": {"type": "string"},
        }},
    })
    return out


_AGENT_SYSTEM_TAIL = (
    "\n\nAGENT MODE: you have the desk's own tools. PREFER desk tools for live "
    "prices, regime, breadth, setups, flow, and verdicts — they are the house "
    "numbers. Use web_search for news/catalysts/street context. Call only the "
    "tools the question needs (2-5 calls is typical), then answer. When you "
    "cite a web_search result, use the [n] indices its result provides — never "
    "invent a source. Desk tool data needs no citation; attribute it to 'UCT "
    "desk data'. If a tool errors, work with what you have and say what's "
    "missing plainly. You are READ-ONLY research: you cannot place trades, "
    "create alerts or positions, or modify anything — when asked to act, say "
    "so in one phrase and give the read that would inform the action instead."
)


def _shrink(obj) -> str:
    try:
        s = json.dumps(obj, default=str)
    except Exception:
        s = str(obj)
    return s[:_TOOL_RESULT_CAP]


def run_agent(query: str, system: str, history: list | None, user: dict | None,
              emit=None, cancel=None, capture: list | None = None) -> dict:
    """Blocking tool loop. Returns {answer, citations, tools_used, error?}.
    `emit(text)` (optional, thread-safe on the caller's side) surfaces live
    activity to the member; `cancel` (threading.Event) stops the loop early
    when the client disconnected — a dead stream must not keep burning the
    agent dollar cap. `capture` (optional list) receives one
    {name, args, result} per EXECUTED tool call — the report-card harness's
    ground truth; the member path never passes it and is unchanged."""
    from api.services import voice_tools
    from api.services import narrative_cost_guard as guard
    from api.services.engine import _get_anthropic_client

    client = _get_anthropic_client()
    if client is None:
        return {"answer": "", "error": "agent unavailable"}
    tools = _tool_schemas()
    model = _model()

    messages: list[dict] = []
    for h in (history or []):
        q, a = (h.get("q") or "").strip(), (h.get("a") or "").strip()
        if q and a:
            messages.append({"role": "user", "content": q})
            messages.append({"role": "assistant", "content": a})
    messages.append({"role": "user", "content": query})

    citations: list[str] = []
    tools_used: list[str] = []
    sys_prompt = system + _AGENT_SYSTEM_TAIL

    for _step in range(_MAX_STEPS):
        if cancel is not None and cancel.is_set():
            return {"answer": "", "error": "cancelled",
                    "citations": citations, "tools_used": tools_used}
        try:
            resp = client.with_options(timeout=50).messages.create(
                model=model, max_tokens=_MAX_TOKENS, system=sys_prompt,
                tools=tools, messages=messages)
        except Exception as e:
            log.warning("agent llm call failed: %s", e)
            return {"answer": "", "error": "agent llm error",
                    "citations": citations, "tools_used": tools_used}
        try:
            guard.record_from_response("ai_search_agent", model, resp)
        except Exception:
            pass

        tool_uses = [b for b in (resp.content or []) if getattr(b, "type", "") == "tool_use"]
        if not tool_uses:
            text = "".join(
                b.text for b in (resp.content or []) if getattr(b, "type", "") == "text"
            ).strip()
            if not text:
                return {"answer": "", "error": "empty agent answer",
                        "citations": citations, "tools_used": tools_used}
            return {"answer": text, "citations": citations[:12],
                    "tools_used": tools_used}

        # serialize the assistant turn, then answer every tool call
        messages.append({"role": "assistant", "content": resp.content})
        results = []
        for tu in tool_uses:
            name = tu.name
            args = dict(tu.input or {})
            if name not in tools_used:
                tools_used.append(name)
            if emit:
                try:
                    emit(_activity_line(name, args))
                except Exception:
                    pass
            if name == "web_search":
                from api.services import perplexity_search
                res = perplexity_search.web_search(
                    str(args.get("query") or query)[:400], max_tokens=600,
                    mode="fast", domain_pack="finance",
                    recency=(args.get("recency") if args.get("recency") in
                             ("hour", "day", "week", "month") else None),
                    related=False, cost_surface="ai_search") or {}
                idx = []
                for c in (res.get("citations") or [])[:8]:
                    url = str(c)
                    if url not in citations:
                        citations.append(url)
                    idx.append(citations.index(url) + 1)
                payload = {"answer": res.get("answer") or "",
                           "error": res.get("error"),
                           "cite_indices": idx,
                           "note": "cite these findings with the [n] indices above"}
            elif name in _AGENT_ALLOWED:
                try:
                    payload = voice_tools.dispatch(name, args, user=user)
                except Exception as e:
                    payload = {"ok": False, "error": f"tool failed: {type(e).__name__}"}
            else:   # the model asked for something off the allowlist
                payload = {"ok": False, "error": "tool not available in this lane"}
            if capture is not None:   # exam ground truth — covers all 3 branches
                capture.append({"name": name, "args": args, "result": payload})
            results.append({"type": "tool_result", "tool_use_id": tu.id,
                            "content": _shrink(payload)})
        messages.append({"role": "user", "content": results})

    return {"answer": "", "error": "agent step budget exhausted",
            "citations": citations, "tools_used": tools_used}


_HUMAN_TOOL = {
    "get_quote": "checking the live quote", "get_regime": "reading the regime",
    "get_breadth": "reading breadth", "get_movers": "scanning the movers",
    "find_patterns_on_ticker": "checking active setups",
    "grade_ticker": "running the desk verdict", "ask_the_brain": "consulting the playbook",
    "get_earnings_intel": "pulling earnings intel", "get_options_flow": "reading the flow tape",
    "get_short_interest": "checking short interest", "get_sector_strength": "ranking sectors",
    "get_bar_summary": "reading the chart", "get_polygon_news": "scanning the news",
    "get_scanner_candidates": "checking the scanner", "get_fundamentals": "pulling fundamentals",
    "get_insider_activity": "checking insider activity", "web_search": "searching the web",
}


def _activity_line(name: str, args: dict) -> str:
    base = _HUMAN_TOOL.get(name, f"running {name}")
    sym = args.get("symbol") or args.get("sym") or args.get("ticker")
    if isinstance(sym, str) and re.fullmatch(r"[A-Za-z.\-]{1,6}", sym):
        return f"{base} — {sym.upper()}…"
    return f"{base}…"
