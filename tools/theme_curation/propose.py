"""Stage 2 orchestrator — one grounded Anthropic call per theme."""
import json
import os

from tools.theme_curation import proposals as P
from tools.theme_curation import loaders

_RUBRIC = (
    "A ticker BELONGS in a theme only if the theme is MATERIAL to its business or "
    "market story (a real revenue segment, or a name traders associate with the theme). "
    "Tangential exposure = mis-mapped -> propose DROP. tier reflects centrality "
    "(core/relevant/peripheral). Do NOT add names merely to enlarge the theme."
)
_BOOST = 0.15


def _client():
    from api.services.engine import _get_anthropic_client
    return _get_anthropic_client()


def _prompt(theme: dict, candidates: list, corrob: dict, current_syms: list, audit_flags: dict) -> str:
    subs = [s.get("id") for s in theme.get("sub_themes", [])]
    cand_lines = [f"{c} (finviz_match={corrob.get(c, False)})" for c in candidates]
    af = audit_flags or {}
    # dead (not chartable) + dups are DROP/REMAP grounding; 'thin' is deliberately NEVER rendered.
    flagged = sorted(set(af.get("dead", []) or []) | set(af.get("dups", []) or []))
    flagged_line = (
        f"FLAGGED (not chartable / duplicate — propose DROP or REMAP): {', '.join(flagged)}\n"
        if flagged else "")
    return (
        f"{_RUBRIC}\n\nTHEME: {theme['name']} (id={theme['id']})\n"
        f"Valid sub_theme_id values: {subs or 'none'}\n"
        f"CURRENT holdings: {', '.join(current_syms) or 'none'}\n"
        f"{flagged_line}"
        f"CANDIDATE tickers (from web search; finviz_match = industry corroborated): "
        f"{', '.join(cand_lines) or 'none'}\n\n"
        "Return ONLY JSON: {\"proposals\":[{\"action\":\"add|drop|remap|retier\","
        "\"sym\":\"TICKER\",\"new_sym\":\"(remap only)\",\"tier\":\"core|relevant|peripheral\","
        "\"new_tier\":\"(retier only)\",\"sub_theme_id\":\"one of the valid ids or null\","
        "\"rationale\":\"...\",\"reason\":\"(drop only)\",\"confidence\":0.0}]}. No prose.")


def propose_theme(theme, candidates, corrob, current_syms, audit_flags, model, cap_set=None):
    # NOTE: audit_flags['dead']/['dups'] ground the prompt; ['thin'] is deliberately NOT passed.
    prompt = _prompt(theme, candidates, corrob, current_syms, audit_flags)
    resp = _client().messages.create(
        model=model, max_tokens=2000,
        messages=[{"role": "user", "content": prompt}])
    raw_text = resp.content[0].text if resp.content else "{}"
    try:
        data = json.loads(raw_text[raw_text.find("{"): raw_text.rfind("}") + 1])
    except Exception:
        data = {"proposals": []}
    props, rejects = P.parse_llm_proposals(theme["id"], data, cap_set or set())
    boost_confidence(props, corrob)
    return {"proposals": props, "rejects": rejects, "raw": raw_text}


def boost_confidence(props, corrob) -> None:
    for p in props:
        if corrob.get(p.sym):
            p.confidence = min(1.0, p.confidence + _BOOST)


def suppress_rejected(props, ledger):
    rej = ledger.rejected_keys()
    return [p for p in props if (p.theme_id, p.sym, p.action) not in rej]
