"""Loop 1 — nightly orphan absorption. All helpers module-level + injectable."""
import json
import logging
import os
import re

from api.services.theme_engine import store
from api.services.theme_engine.invalidate import post_engine_run

_logger = logging.getLogger(__name__)
_MODEL = os.environ.get("THEME_ENGINE_LLM_MODEL", "claude-opus-4-8")


def _env_f(name, dflt):
    try:
        return float(os.environ.get(name, dflt))
    except ValueError:
        return dflt


def _in_cap(sym_hy):
    from api.services.groups import cap_universe_set
    return sym_hy in cap_universe_set()


def _theme_exists(theme_id):
    from api.services import theme_db
    return any(t["id"] == theme_id for t in theme_db.get_all_themes().get("themes", []))


def _theme_roster(theme_id):
    from api.services import theme_db
    return {h["sym"].replace(".", "-") for h in theme_db.get_theme_holdings(theme_id)}


def _industry_cohort(sym_hy):
    from api.services import industry_map
    ind = (industry_map.get_industries([sym_hy]) or {}).get(sym_hy)
    if not ind:
        return set()
    return {t.upper().replace(".", "-") for t in industry_map.tickers_in_industry(ind)}


def _industry_matches_theme(sym_hy, theme_id):
    """Finviz-industry corroboration against tools/theme_curation/theme_finviz_industries.json."""
    try:
        from api.services import industry_map
        path = os.path.join(os.path.dirname(__file__), "..", "..", "..",
                            "tools", "theme_curation", "theme_finviz_industries.json")
        with open(os.path.abspath(path), encoding="utf-8") as f:
            tind = json.load(f)
        allowed = tind.get(theme_id) or []
        ind = (industry_map.get_industries([sym_hy]) or {}).get(sym_hy)
        return bool(ind and ind in allowed)
    except Exception:
        return False


def _is_liquid(sym_hy):
    """Swing-gate liquidity floor (px>=5, $vol>=20M). Missing metrics => treat as
    liquid (conservative: applies the HIGHER confidence bar)."""
    try:
        from api.services import groups_gates
        from api.services.groups import _rs_map, _today_map
        m = groups_gates.swing_metrics([sym_hy], _rs_map(), _today_map([sym_hy])).get(sym_hy) or {}
        px, dv = m.get("price"), m.get("dollar_vol")
        if px is None or dv is None:
            return True
        return px >= 5.0 and dv >= 20_000_000
    except Exception:
        return True


def _orphan_candidates_ordered():
    """cap_universe − merged-theme members − recent decisions, liquid/high-RS first."""
    from api.services import theme_db
    from api.services.groups import cap_universe_set, _rs_map
    member_hy = set()
    for t in theme_db.get_all_themes().get("themes", []):
        for h in t.get("holdings", []):
            member_hy.add((h.get("sym") or "").upper().replace(".", "-"))
    reeval = int(_env_f("THEME_ENGINE_REEVAL_DAYS", 35))
    orphans = cap_universe_set() - member_hy - store.decided_recent_syms(reeval)
    rs = _rs_map()

    def key(s):
        r = (rs.get(s) or {}).get("rs_rank")
        try:
            return -float(r) if r is not None else 1e9
        except (TypeError, ValueError):
            return 1e9
    return sorted(orphans, key=key)


def _adjudicate(ctx):
    """One grounded Anthropic call. ctx: {sym, industry, rs_rank, candidates:[{id,name,roster_syms}], narrative}.
    Returns {theme_id|None, tier, confidence, rationale}. Cost-logged. Never raises."""
    from api.services.engine import _get_anthropic_client
    cands = "\n".join(f"- {c['id']} ({c['name']}): {', '.join(sorted(c['roster_syms'])[:40])}"
                      for c in ctx["candidates"]) or "(none)"
    prompt = (
        f"You classify one US stock into the single best-fit trading THEME, or NONE.\n"
        f"Stock: {ctx['sym']} | Finviz industry: {ctx.get('industry') or 'unknown'} | RS rank: {ctx.get('rs_rank')}\n"
        f"Candidate themes with current member tickers:\n{cands}\n"
        f"Rules: pick a theme ONLY if the stock's business/market story is material to it and it fits "
        f"alongside the members shown. tier must be 'relevant' or 'peripheral' (peripheral default). "
        f"If nothing fits, theme_id null. Respond with ONLY JSON: "
        f'{{"theme_id": "..."|null, "tier": "relevant"|"peripheral", "confidence": 0.0-1.0, "rationale": "<=140 chars"}}')
    try:
        client = _get_anthropic_client().with_options(timeout=45)
        msg = client.messages.create(model=_MODEL, max_tokens=200,
                                     messages=[{"role": "user", "content": prompt}])
        u = getattr(msg, "usage", None)
        store.log_cost(ctx["run_id"], _MODEL, getattr(u, "input_tokens", 0) or 0,
                       getattr(u, "output_tokens", 0) or 0)
        text = "".join(b.text for b in msg.content if getattr(b, "type", "") == "text")
        m = re.search(r"\{.*\}", text, re.S)
        return json.loads(m.group(0)) if m else {"theme_id": None, "confidence": 0.0}
    except Exception as e:
        _logger.warning("adjudicate %s failed: %s", ctx["sym"], e)
        return {"theme_id": None, "confidence": 0.0, "rationale": f"error: {e}"}


def _candidates_for(sym_hy):
    """Candidate themes: industry-mapped + themes holding >=2 of the sym's industry cohort."""
    from api.services import theme_db
    cohort = _industry_cohort(sym_hy)
    out = []
    for t in theme_db.get_all_themes().get("themes", []):
        roster = {(h.get("sym") or "").upper().replace(".", "-") for h in t.get("holdings", [])}
        if _industry_matches_theme(sym_hy, t["id"]) or len(roster & cohort) >= 2:
            out.append({"id": t["id"], "name": t["name"], "roster_syms": roster})
    return out[:6]


def run_orphan_batch(batch=None, dry_run=None) -> dict:
    batch = int(batch if batch is not None else _env_f("THEME_ENGINE_ORPHAN_BATCH", 200))
    dry = bool(int(os.environ.get("THEME_ENGINE_DRY_RUN", "0"))) if dry_run is None else bool(dry_run)
    cap = _env_f("THEME_ENGINE_DAILY_COST_CAP", 5.0)
    cmin = _env_f("THEME_ENGINE_CONFIDENCE_MIN", 0.75)
    cliq = _env_f("THEME_ENGINE_CONFIDENCE_LIQUID", 0.85)
    max_per_theme = int(_env_f("THEME_ENGINE_MAX_ADDS_PER_THEME_PER_RUN", 10))
    run_id = store.start_run("orphan_dry" if dry else "orphan")
    counts = {"examined": 0, "added": 0, "skipped": 0}
    cost_capped = False
    theme_adds = {}
    try:
        for sym in _orphan_candidates_ordered()[: batch * 2]:   # headroom for skips
            if counts["examined"] >= batch:
                break
            if store.day_cost_usd() >= cap:
                cost_capped = True
                break
            counts["examined"] += 1
            cands = _candidates_for(sym)
            verdict = _adjudicate({"sym": sym, "run_id": run_id,
                                   "industry": None, "rs_rank": None, "candidates": cands})
            tid = verdict.get("theme_id")
            conf = float(verdict.get("confidence") or 0.0)
            tier = verdict.get("tier") if verdict.get("tier") in ("relevant", "peripheral") else "peripheral"
            liquid = _is_liquid(sym)
            gate = cliq if liquid else cmin
            roster = _theme_roster(tid) if tid else set()
            cohort = _industry_cohort(sym)
            corroborated = bool(tid) and (_industry_matches_theme(sym, tid) or len(roster & cohort) >= 2)
            beats_incumbent = (not cohort) or len(roster & cohort) >= 2 or _industry_matches_theme(sym, tid or "")
            ok = (bool(tid) and _theme_exists(tid) and _in_cap(sym) and conf >= gate
                  and (corroborated if liquid else True) and beats_incumbent
                  and theme_adds.get(tid, 0) < max_per_theme
                  and sym.replace("-", ".") not in {s.replace("-", ".") for s in _theme_roster(tid)})
            if ok and not dry:
                store.upsert_add(tid, sym, tier, None, conf, verdict.get("rationale") or "", run_id)
                store.record_decision(sym, "add", tid, conf, run_id)
                theme_adds[tid] = theme_adds.get(tid, 0) + 1
                counts["added"] += 1
            else:
                store.record_decision(sym, "none" if not tid else "below_gate", tid, conf, run_id)
                counts["skipped"] += 1
    except Exception as e:
        store.finish_run(run_id, error=str(e), **counts)
        raise
    store.finish_run(run_id, cost_usd=store.day_cost_usd(),
                     error="cost_capped" if cost_capped else None, **counts)
    if counts["added"] and not dry:
        post_engine_run()
    return {**counts, "run_id": run_id, "cost_capped": cost_capped, "dry_run": dry}
