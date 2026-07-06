"""Compass grade_watchlist list-resolution — turn a `source` into a concrete,
deduped list of symbols + a human description of what was graded.

Sources: explicit (caller-supplied) | watchlist + flagged | positions | scan
(one bounded deterministic leading-sector pattern scan — wired in the scan
task). Never raises: a failing source yields ([], description). The list
RESOLUTION is a fixed query, never an LLM-planned DAG — that keeps
grade_watchlist a primitive on the correct side of the T3 boundary."""
from __future__ import annotations

import logging

_log = logging.getLogger("watchlist_source")


def _uniq_upper(syms) -> list[str]:
    out, seen = [], set()
    for s in syms or []:
        u = (s or "").upper().strip()
        if u and u not in seen:
            seen.add(u)
            out.append(u)
    return out


def _open_positions(user_id, account_id):
    from api.services.journal_two import positions as j2
    return j2.list_open_positions(user_id, account_id=account_id) or []


def _watchlist_syms(user_id, account_id):
    """Union of symbols across the user's non-flagged watchlists."""
    from api.services import watchlist_service as wls
    from api.services.auth_db import get_connection
    lists = wls.list_user_watchlists(user_id) or []
    syms: list[str] = []
    conn = get_connection()
    try:
        for wl in lists:
            if wl.get("is_flagged_list"):
                continue
            for it in (wls._get_items(conn, wl.get("id")) or []):
                if it.get("sym"):
                    syms.append(it["sym"])
    finally:
        conn.close()
    return syms


def _flagged_syms(user_id, account_id):
    from api.services import watchlist_service as wls
    from api.services.auth_db import get_connection
    lists = wls.list_user_watchlists(user_id) or []
    syms: list[str] = []
    conn = get_connection()
    try:
        for wl in lists:
            if not wl.get("is_flagged_list"):
                continue
            for it in (wls._get_items(conn, wl.get("id")) or []):
                if it.get("sym"):
                    syms.append(it["sym"])
    finally:
        conn.close()
    return syms


_SCAN_MAX = 15
_SCAN_MIN_CONF = 60


def _raw_scan(user_id, account_id):
    """ONE bounded deterministic scan: active pattern detections (fixed query,
    NOT an LLM-planned DAG) -> high-confidence names in leading sectors. Kept a
    primitive so it stays on the correct side of the T3 boundary."""
    from api.services.journal_two import coach_chat_tools as cct
    out = cct._exec_scan_active_patterns(user_id=user_id, account_id=account_id,
                                         args={"min_conf": _SCAN_MIN_CONF})
    dets = out.get("detections") or []
    # leading-sector membership (best-effort; if unavailable, keep all)
    leading = _leading_sectors()
    ranked = sorted(dets, key=lambda d: (d.get("confidence") or 0), reverse=True)
    picked, seen = [], set()
    for d in ranked:
        sym = (d.get("sym") or d.get("symbol") or "").upper()
        if not sym or sym in seen:
            continue
        if leading and not (_sectors_of(sym) & leading):
            continue
        seen.add(sym)
        picked.append(sym)
        if len(picked) >= _SCAN_MAX:
            break
    return picked


def _leading_sectors() -> set:
    try:
        from api.services.sector_strength import get_sector_strength
        rows = get_sector_strength() or []
        ranked = sorted(rows, key=lambda r: (r.get("pct") or r.get("return_pct") or 0), reverse=True)
        return {(r.get("sector") or r.get("name") or "").strip() for r in ranked[:4] if r.get("sector") or r.get("name")}
    except Exception:  # noqa: BLE001
        return set()


def _sectors_of(sym: str) -> set:
    try:
        from api.services.voice_position_sizing import _sectors_for_symbol
        return _sectors_for_symbol(sym) or set()
    except Exception:  # noqa: BLE001
        return set()


def _scan_syms(user_id, account_id):
    return _raw_scan(user_id, account_id)


def resolve(user_id, account_id, source, symbols=None):
    src = (source or "watchlist").lower().strip()
    try:
        if src == "explicit":
            names = _uniq_upper(symbols)
            return names, f"{len(names)} explicit name(s)"
        if src == "positions":
            names = _uniq_upper([p.get("symbol") for p in _open_positions(user_id, account_id)])
            return names, f"your {len(names)} open position(s)"
        if src == "flagged":
            names = _uniq_upper(_flagged_syms(user_id, account_id))
            return names, f"your {len(names)} flagged name(s)"
        if src == "watchlist":
            wl = _watchlist_syms(user_id, account_id)
            fl = _flagged_syms(user_id, account_id)
            names = _uniq_upper(list(fl) + list(wl))
            return names, f"your {len(fl)} flagged + {len(_uniq_upper(wl))} watchlist name(s)"
        if src == "scan":
            names = _uniq_upper(_scan_syms(user_id, account_id))
            return names, f"scan: {len(names)} fresh setup(s) in leading sectors"
    except Exception as e:  # noqa: BLE001
        _log.warning("[watchlist_source] resolve(%s) failed: %s", src, e)
        return [], f"could not resolve {src}"
    return [], f"unknown source '{src}'"
