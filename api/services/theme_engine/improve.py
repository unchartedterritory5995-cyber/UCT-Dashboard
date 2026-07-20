"""Loop 2 — weekly self-improvement + co-movement audit + weekly report.

Heat-ordered theme review (~15/run): ONE Anthropic call per theme returns
{adds, retiers, drops, owner_concerns}. Adds pass the SAME gate as Loop 1
(orphans.passes_add_gate — extracted shared helper, documented there);
retiers/drops touch ONLY engine rows (owner rows are structurally unreachable:
they are never in store.engine_rows); owner concerns become suppress PROPOSALS
for the human owner. All helpers module-level + injectable (house pattern)."""
import json
import logging
import os
import re

from api.services.theme_engine import store
from api.services.theme_engine.invalidate import post_engine_run

_logger = logging.getLogger(__name__)
_MODEL = os.environ.get("THEME_ENGINE_LLM_MODEL", "claude-opus-4-8")
_TIERS = ("relevant", "peripheral")


def _env_f(name, dflt):
    try:
        return float(os.environ.get(name, dflt))
    except ValueError:
        return dflt


def _hy(sym):
    return (sym or "").strip().upper().replace(".", "-")


# ---------------------------------------------------------------- theme picking

def _all_theme_ids():
    from api.services import theme_db
    return [t["id"] for t in theme_db.get_all_themes().get("themes", [])]


def _rotation_heat():
    """Theme ids ordered by rotation heat: rotating_in first (by momentum delta),
    then the top 1w_rank movers from the rankings. Rotation signals are keyed by
    the theme's ETF ticker — map back to theme ids via the taxonomy's etf_ticker.
    Empty (cold caches / no signals) is fine: pick_themes falls back alpha."""
    try:
        from api.services import theme_db, theme_performance
        sig = theme_performance.compute_rotation_signals() or {}
        by_ticker = {}
        for t in theme_db.get_all_themes().get("themes", []):
            tk = (t.get("etf_ticker") or "").strip().upper()
            if tk:
                by_ticker.setdefault(tk, t["id"])
        out, seen = [], set()

        def add(ticker):
            tid = by_ticker.get((ticker or "").strip().upper())
            if tid and tid not in seen:
                seen.add(tid)
                out.append(tid)

        for e in sig.get("rotating_in") or []:
            add(e.get("ticker"))
        ranked = sorted((e for e in (sig.get("rankings") or {}).values()
                         if e.get("1w_rank") is not None),
                        key=lambda e: e["1w_rank"], reverse=True)
        for e in ranked[:10]:
            add(e.get("ticker"))
        return out
    except Exception as e:
        _logger.warning("rotation heat unavailable (alpha fallback): %s", e)
        return []


def pick_themes(n=15) -> list:
    """Hot themes first (rotation heat), then remaining themes alphabetically
    (v1 'coldest' ordering per brief), capped at n."""
    all_ids = _all_theme_ids()
    all_set = set(all_ids)
    out = [t for t in _rotation_heat() if t in all_set]
    seen = set(out)
    for t in sorted(all_ids):
        if t not in seen:
            seen.add(t)
            out.append(t)
    return out[:n]


# ---------------------------------------------------------------- LLM review

def _review_theme(theme_id, run_id) -> dict:
    """ONE grounded Anthropic call reviewing a theme's merged roster (owner rows
    marked distinctly — the model may only FLAG them, never drop). Roster is
    syms-only + RS ranks, capped to keep the input under ~2.5k tokens. Returns a
    shape-sanitized {"adds": [...], "retiers": [...], "drops": [...],
    "owner_concerns": [...]} — per-ITEM sanitization lives in
    _apply_theme_verdict. Cost-logged via store.log_cost. Never raises."""
    empty = {"adds": [], "retiers": [], "drops": [], "owner_concerns": []}
    try:
        from api.services import theme_db
        from api.services.engine import _get_anthropic_client
        from api.services.groups import _rs_map
        holdings = theme_db.get_theme_holdings(theme_id) or []
        rs = _rs_map()

        def fmt(h):
            s = _hy(h.get("sym"))
            r = (rs.get(s) or {}).get("rs_rank")
            return f"{s}(RS{r})" if r is not None else s

        owner = [h for h in holdings if (h.get("source") or "owner") == "owner"][:60]
        engine = [h for h in holdings if h.get("source") == "engine"][:40]
        prompt = (
            f"You audit ONE trading theme's member roster for correctness.\n"
            f"Theme id: {theme_id}\n"
            f"OWNER members (curated by a human; you may FLAG concerns but NEVER drop/retier them):\n"
            f"{', '.join(fmt(h) for h in owner) or '(none)'}\n"
            f"ENGINE members (machine-added; you may retier or drop these):\n"
            f"{', '.join(fmt(h) for h in engine) or '(none)'}\n"
            f"RSnn = relative-strength percentile rank (higher = stronger).\n"
            f"Rules:\n"
            f"- adds: up to 5 strong US-listed stocks clearly on-theme but missing from the roster; "
            f'each {{"sym": "...", "tier": "relevant"|"peripheral", "confidence": 0.0-1.0, "rationale": "<=100 chars"}}. '
            f"Only high-conviction adds.\n"
            f'- retiers: ENGINE members whose tier is wrong: {{"sym": "...", "new_tier": "relevant"|"peripheral"}}.\n'
            f'- drops: ENGINE members that do not belong to this theme: ["SYM", ...].\n'
            f'- owner_concerns: OWNER members that look off-theme: {{"sym": "...", "reason": "<=100 chars"}} '
            f"(flagged for human review, never removed by you).\n"
            f'Respond with ONLY JSON: {{"adds": [], "retiers": [], "drops": [], "owner_concerns": []}}')
        client = _get_anthropic_client().with_options(timeout=60)
        msg = client.messages.create(model=_MODEL, max_tokens=700,
                                     messages=[{"role": "user", "content": prompt}])
        u = getattr(msg, "usage", None)
        store.log_cost(run_id, _MODEL, getattr(u, "input_tokens", 0) or 0,
                       getattr(u, "output_tokens", 0) or 0)
        text = "".join(b.text for b in msg.content if getattr(b, "type", "") == "text")
        m = re.search(r"\{.*\}", text, re.S)
        raw = json.loads(m.group(0)) if m else {}
        if not isinstance(raw, dict):
            return empty
        return {k: (raw.get(k) if isinstance(raw.get(k), list) else []) for k in empty}
    except Exception as e:
        _logger.warning("review %s failed: %s", theme_id, e)
        return empty


def _passes_add_gate(sym_hy, theme_id, conf) -> bool:
    """Injectable alias for the SHARED Loop-1 gate (orphans.passes_add_gate)."""
    from api.services.theme_engine.orphans import passes_add_gate
    return passes_add_gate(sym_hy, theme_id, conf)


def _apply_theme_verdict(run_id, theme_id, verdict, dry) -> dict:
    """Apply one theme's sanitized verdict with PER-ITEM failure isolation: a
    malformed item is warned + skipped, never killing the rest of the verdict.
    Adds pass the shared Loop-1 gate; retiers/drops apply ONLY to syms present
    in store.engine_rows(theme_id) (owner rows can never match — they are not
    engine rows); owner_concerns -> suppress PROPOSALS (owner decides)."""
    counts = {"added": 0, "retiered": 0, "dropped": 0, "suppressed": 0, "failed": 0}
    verdict = verdict if isinstance(verdict, dict) else {}
    max_per_theme = int(_env_f("THEME_ENGINE_MAX_ADDS_PER_THEME_PER_RUN", 10))
    try:
        engine_rows = {r["sym_hy"]: r for r in store.engine_rows(theme_id)}
    except Exception as e:
        _logger.warning("apply %s: engine_rows unavailable: %s", theme_id, e)
        engine_rows = {}

    for a in verdict.get("adds") or []:
        try:
            sym = _hy(a.get("sym")) if isinstance(a.get("sym"), str) else None
            if not sym:
                raise ValueError(f"bad add sym: {a!r}")
            try:
                conf = max(0.0, min(1.0, float(a.get("confidence") or 0.0)))
            except (TypeError, ValueError):
                conf = 0.0
            tier = a.get("tier") if a.get("tier") in _TIERS else "peripheral"
            if counts["added"] >= max_per_theme or sym in engine_rows:
                continue
            if not _passes_add_gate(sym, theme_id, conf):
                continue
            if not dry:
                store.upsert_add(theme_id, sym, tier, None, conf,
                                 str(a.get("rationale") or ""), run_id)
                store.record_decision(sym, "add", theme_id, conf, run_id)
                counts["added"] += 1
        except Exception as e:
            counts["failed"] += 1
            _logger.warning("improve add %s failed (verdict continues): %s", theme_id, e)

    for r in verdict.get("retiers") or []:
        try:
            sym = _hy(r.get("sym")) if isinstance(r.get("sym"), str) else None
            new_tier = r.get("new_tier")
            row = engine_rows.get(sym) if sym else None
            if not row or new_tier not in _TIERS or row.get("tier") == new_tier:
                continue
            if not dry:
                res = store.upsert_add(theme_id, sym, new_tier, row.get("sub_theme_id"),
                                       row.get("confidence"), row.get("rationale") or "", run_id)
                if res == "retiered":
                    counts["retiered"] += 1
        except Exception as e:
            counts["failed"] += 1
            _logger.warning("improve retier %s failed (verdict continues): %s", theme_id, e)

    for s in verdict.get("drops") or []:
        try:
            sym = _hy(s) if isinstance(s, str) else None
            if not sym or sym not in engine_rows:
                continue
            if not dry and store.drop(theme_id, sym, run_id):
                counts["dropped"] += 1
        except Exception as e:
            counts["failed"] += 1
            _logger.warning("improve drop %s failed (verdict continues): %s", theme_id, e)

    for c in verdict.get("owner_concerns") or []:
        try:
            sym = _hy(c.get("sym")) if isinstance(c.get("sym"), str) else None
            if not sym:
                continue
            if not dry:
                store.suppress_propose(theme_id, sym,
                                       str(c.get("reason") or "")[:300], run_id)
                counts["suppressed"] += 1
        except Exception as e:
            counts["failed"] += 1
            _logger.warning("improve concern %s failed (verdict continues): %s", theme_id, e)
    return counts


def run_improve(dry_run=None) -> dict:
    """Weekly self-improvement pass: review ~15 heat-ordered themes, one LLM call
    each, apply verdicts. Cost-cap checked between themes; per-theme isolation."""
    dry = (os.environ.get("THEME_ENGINE_DRY_RUN", "0").strip().lower()
           in ("1", "true", "yes")) if dry_run is None else bool(dry_run)
    cap = _env_f("THEME_ENGINE_DAILY_COST_CAP", 5.0)
    n = int(_env_f("THEME_ENGINE_IMPROVE_THEMES", 15))
    run_id = store.start_run("improve_dry" if dry else "improve")
    counts = {"examined": 0, "added": 0, "retiered": 0, "dropped": 0, "skipped": 0}
    cost_capped = False
    try:
        for tid in pick_themes(n):
            if store.day_cost_usd() >= cap:
                cost_capped = True
                break
            counts["examined"] += 1
            try:
                verdict = _review_theme(tid, run_id)
                applied = _apply_theme_verdict(run_id, tid, verdict, dry)
                counts["added"] += applied["added"]
                counts["retiered"] += applied["retiered"]
                counts["dropped"] += applied["dropped"]
            except Exception as e:
                counts["skipped"] += 1
                _logger.warning("improve theme %s failed (run continues): %s", tid, e)
                continue
    except Exception as e:
        store.finish_run(run_id, error=str(e), **counts)
        raise
    store.finish_run(run_id, cost_usd=store.day_cost_usd(),
                     error="cost_capped" if cost_capped else None, **counts)
    if (counts["added"] or counts["retiered"] or counts["dropped"]) and not dry:
        post_engine_run()
    return {**counts, "run_id": run_id, "cost_capped": cost_capped, "dry_run": dry}


# ---------------------------------------------------------------- co-movement audit

def _corr_vs_theme(sym_hy, theme_id):
    """comovement.corr60 vs the theme's OWNER roster ONLY (an engine add must
    prove co-movement against the human-curated basket, not other engine adds).
    None = no signal (cold bars / thin roster) — callers must skip, not strike."""
    try:
        from api.services import theme_db
        from api.services.theme_engine import comovement
        owner = [_hy(h["sym"]) for h in (theme_db.get_theme_holdings(theme_id) or [])
                 if h.get("sym") and (h.get("source") or "owner") == "owner"]
        if not owner:
            return None
        return comovement.corr60(sym_hy, owner)
    except Exception as e:
        _logger.warning("corr_vs_theme %s/%s failed: %s", sym_hy, theme_id, e)
        return None


def comovement_audit(run_id=None) -> dict:
    """Audit engine adds older than 30d against their theme's owner basket.
    corr None -> skip untouched (cold bars are NOT a strike); corr < floor ->
    bump strike counter, drop at >= 2 strikes; else reset the counter.
    Ledgered via its own engine run when run_id isn't supplied."""
    floor = _env_f("THEME_ENGINE_CORR_FLOOR", 0.25)
    own_run = run_id is None
    if own_run:
        run_id = store.start_run("audit")
    out = {"checked": 0, "skipped_cold": 0, "low": 0, "dropped": 0, "reset": 0}
    try:
        for row in store.adds_older_than(30):
            try:
                corr = _corr_vs_theme(row["sym_hy"], row["theme_id"])
                if corr is None:
                    out["skipped_cold"] += 1
                    continue
                out["checked"] += 1
                if corr < floor:
                    out["low"] += 1
                    strikes = store.bump_audit_low(row["theme_id"], row["sym_hy"])
                    if strikes >= 2 and store.drop(row["theme_id"], row["sym_hy"], run_id):
                        out["dropped"] += 1
                else:
                    store.reset_audit_low(row["theme_id"], row["sym_hy"])
                    out["reset"] += 1
            except Exception as e:
                _logger.warning("audit %s/%s failed (audit continues): %s",
                                row.get("theme_id"), row.get("sym_hy"), e)
                continue
    except Exception as e:
        if own_run:
            store.finish_run(run_id, error=str(e), examined=out["checked"],
                             dropped=out["dropped"])
        raise
    if own_run:
        store.finish_run(run_id, examined=out["checked"], dropped=out["dropped"],
                         skipped=out["skipped_cold"])
    if out["dropped"]:
        post_engine_run()
    return {**out, "run_id": run_id}


# ---------------------------------------------------------------- weekly report

def weekly_report_text() -> str:
    """Plain-text weekly digest: pending owner-review suppressions + last-7-day
    engine_runs stats + LLM cost totals. Posting (Discord) lives in T7."""
    lines = ["THEME ENGINE — WEEKLY REPORT", ""]
    try:
        pend = store.pending_suppressions()
    except Exception as e:
        pend = []
        _logger.warning("weekly report: suppressions unavailable: %s", e)
    lines.append(f"Owner-review queue (pending suppress proposals): {len(pend)}")
    for p in pend[:25]:
        reason = (p.get("rationale") or "").strip()
        lines.append(f"  - {p.get('theme_id')}/{p.get('sym')}"
                     + (f": {reason}" if reason else ""))
    if len(pend) > 25:
        lines.append(f"  ... and {len(pend) - 25} more")
    lines.append("")
    try:
        with store._conn() as c:
            rows = c.execute(
                "SELECT kind, COUNT(*) AS runs, COALESCE(SUM(examined),0) AS examined, "
                "COALESCE(SUM(added),0) AS added, COALESCE(SUM(retiered),0) AS retiered, "
                "COALESCE(SUM(dropped),0) AS dropped, COALESCE(SUM(skipped),0) AS skipped, "
                "SUM(CASE WHEN error IS NOT NULL THEN 1 ELSE 0 END) AS errored "
                "FROM engine_runs WHERE started_at > datetime('now','-7 days') "
                "GROUP BY kind ORDER BY kind").fetchall()
        lines.append("Engine runs (last 7 days):")
        if not rows:
            lines.append("  (none)")
        for r in rows:
            d = dict(r)
            lines.append(f"  {d['kind']}: {d['runs']} runs — examined {d['examined']}, "
                         f"added {d['added']}, retiered {d['retiered']}, "
                         f"dropped {d['dropped']}, skipped {d['skipped']}, "
                         f"errors {d['errored']}")
    except Exception as e:
        lines.append(f"Engine runs (last 7 days): unavailable ({e})")
    lines.append("")
    try:
        with store._conn() as c:
            row = c.execute("SELECT COALESCE(SUM(cost_usd),0) FROM engine_cost_log "
                            "WHERE at > datetime('now','-7 days')").fetchone()
        lines.append(f"LLM spend: ${float(row[0] or 0.0):.2f} last 7 days · "
                     f"${store.day_cost_usd():.2f} today "
                     f"(cap ${_env_f('THEME_ENGINE_DAILY_COST_CAP', 5.0):.2f}/day)")
    except Exception as e:
        lines.append(f"LLM spend: unavailable ({e})")
    return "\n".join(lines)
