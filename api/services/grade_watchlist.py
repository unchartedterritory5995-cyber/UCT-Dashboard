"""Compass grade_watchlist — grade a RESOLVED list of names through the firm's
verdict engine AND the trader's own edge, then apply a MANDATORY list-level
synthesis. The Rung-4 moat.

A funnel (cheap filter -> grade_ticker on survivors) with compute-once market
context. A failed name is returned inline, never dropped or fabricated.
Regime-first: no regime, no GO — and a hostile regime mutes the whole book to
watch-only. The list-level synthesis (0-GO on RED, same-sector correlation
collapse, behavioral note) is what makes it a mentor, not a grid. Never raises."""
from __future__ import annotations

import logging

_log = logging.getLogger("grade_watchlist")
_MAX_NAMES = 20
#: Bands (from voice_regime_classifier.band_of) under which every GO is muted to
#: HOLD — "a hostile regime mutes the whole book to watch-only".
_WATCH_ONLY_BANDS = ("ORANGE", "RED")


def _default_resolve(user_id, account_id, source, symbols):
    from api.services import watchlist_source as wsrc
    return wsrc.resolve(user_id, account_id, source, symbols)


def _default_grade(symbol, account_size=None, account_size_is_default=None, account_size_note=None):
    from api.services.grade_ticker import grade_ticker
    return grade_ticker(symbol, account_size=account_size,
                        account_size_is_default=account_size_is_default,
                        account_size_note=account_size_note)


def _default_regime():
    from api.services.portfolio_heat import _default_regime_fn
    return _default_regime_fn()


def _default_edge(user_id, account_id):
    from api.services.personal_edge import edge_for_setups
    return edge_for_setups(user_id, account_id)


def _default_sector(sym):
    from api.services.portfolio_heat import _sectors_for
    return _sectors_for(sym)


def _regime_ceiling(regime: dict) -> float:
    from api.services.portfolio_heat import _regime_ceiling_pct
    return _regime_ceiling_pct((regime or {}).get("exposure_rating"))


def grade_watchlist(user_id, account_id=None, symbols=None, source="watchlist",
                    account_size=None, *, resolve_fn=None, grade_fn=None,
                    regime_fn=None, edge_fn=None, sector_fn=None) -> dict:
    resolve_fn = resolve_fn or _default_resolve
    grade_fn = grade_fn or _default_grade
    regime_fn = regime_fn or _default_regime
    edge_fn = edge_fn or _default_edge
    sector_fn = sector_fn or _default_sector

    try:
        regime = regime_fn() or {}
    except Exception:  # noqa: BLE001
        regime = {}
    if not regime.get("regime"):
        return {"ok": False, "reason": "regime unavailable — cannot grade a list without the gate"}

    try:
        names, described = resolve_fn(user_id, account_id, source, symbols)
    except Exception:  # noqa: BLE001
        return {"ok": False, "reason": f"could not resolve list for source={source}"}
    names = [n.upper() for n in (names or [])][:_MAX_NAMES]
    if not names:
        return {"ok": True, "regime": regime.get("regime"),
                "source_described": described or source, "graded": [],
                "list_verdict": "no names to grade", "correlated_blocks": [],
                "behavioral_note": ""}

    try:
        edge = edge_fn(user_id, account_id) or {}
    except Exception:  # noqa: BLE001
        edge = {}

    # The member's own size when the caller did not give one (finding 7); the no-member default
    # stays grade_ticker's own (UNSET_ACCOUNT_SIZE).
    # `size_flag` goes to every name (R2-1): resolved here it says whether the size is the default;
    # None (a size the caller gave, or no member) leaves grade_ticker's own rule.
    size_flag = size_note = None
    if not account_size and user_id:
        from api.services.journal_two import accounts as _acc
        account_size, size_flag, size_note = _acc.grading_account_size(user_id, account_id=account_id)
    size_is_default = bool(size_flag)
    # The note goes only when it is not grade_ticker's own default wording (a non-positive size,
    # R2-2), so an injected grade_fn need not take it.
    from api.services.voice_position_sizing import default_size_sentence
    note_kw = {"account_size_note": size_note} if size_note and size_note != default_size_sentence() else {}

    graded = []
    for sym in names:
        try:
            v = grade_fn(sym, account_size=account_size, account_size_is_default=size_flag,
                         **note_kw) or {}
        except Exception as e:  # noqa: BLE001
            v = {"ok": False, "reason": str(e)}
        if not v.get("ok"):
            graded.append({"symbol": sym, "failed": True, "verdict": "SKIP", "grade": None,
                           "entry": None, "stop": None, "size_pct": None,
                           "account_risk_pct": None, "edge_annotation": None, "muted": False,
                           "reason": v.get("reason") or "couldn't grade"})
            continue
        e = edge.get(v.get("setup") or "", {})
        graded.append({"symbol": sym, "failed": False, "verdict": v.get("verdict"),
                       "grade": v.get("grade"), "entry": v.get("entry"), "stop": v.get("stop"),
                       "size_pct": v.get("size_pct"), "account_risk_pct": v.get("account_risk_pct"),
                       "setup": v.get("setup"), "edge_annotation": e.get("note"),
                       "muted": bool(e.get("muted")),
                       "account_size_is_default": bool(v.get("account_size_is_default"))})

    # ── MANDATORY list-level synthesis ────────────────────────────────────────
    # The label -> band derivation is the authority's (TERM-071); this module
    # only decides which BANDS mute the book (bear_trend -> RED and
    # distribution -> ORANGE, exactly the two labels it used to spell here).
    from api.services.voice_regime_classifier import band_of
    red = band_of(regime.get("regime")) in _WATCH_ONLY_BANDS or _regime_ceiling(regime) <= 20
    if red:
        for r in graded:
            if r["verdict"] == "GO":
                r["verdict"], r["downgraded_by_regime"] = "HOLD", True
    go = [r for r in graded if r["verdict"] == "GO"]
    list_verdict = (f"{len(go)}-GO"
                    if go else
                    "0-GO — regime says watch-only, sit on your hands" if red else
                    "0-GO — nothing clean enough to buy right now")

    blocks: dict[str, list] = {}
    for r in graded:
        if r.get("failed"):
            continue
        for sec in (sector_fn(r["symbol"]) or set()):
            blocks.setdefault(sec, []).append(r["symbol"])
    correlated_blocks = [{"sector": s, "symbols": syms}
                         for s, syms in blocks.items() if len(syms) >= 2]

    strengths = [k for k, e in (edge or {}).items() if e.get("verdict") == "edge"]
    weak = [k for k, e in (edge or {}).items() if e.get("muted")]
    behavioral_note = ""
    if strengths:
        behavioral_note += f"You're strongest on {', '.join(strengths[:3])}. "
    if weak:
        behavioral_note += f"Careful with {', '.join(weak[:3])} — your stats there are red."
    behavioral_note = behavioral_note.strip() or "Not enough journal history yet to weight by your edge."

    return {"ok": True, "regime": regime.get("regime"),
            "source_described": described or source, "graded": graded,
            "list_verdict": list_verdict, "correlated_blocks": correlated_blocks,
            "behavioral_note": behavioral_note,
            "sources": ["grade_ticker per name", "personal edge", f"regime {regime.get('regime')}"],
            "account_size_is_default": size_is_default}
