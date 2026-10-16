"""The team archive as a LABELLED SECOND SOURCE for Compass and the Terminal's CHK.

Consumers: api/services/brain_service.py (lookup_playbook, setup_winrate, find_historical_analogs,
and grade_ticker through it) and the CHK route in api/routers/wisdom_archive.py.

⛔ THE ARCHIVE IS NEVER MIXED INTO ANOTHER SOURCE'S NUMBER. The engine (uct-intelligence) stays
the primary answer wherever it answers; what this module returns rides beside it under its own
key, labelled as the team archive, measured after the fact. A win rate here is the TEAM'S CALLS'
measured outcome, not the engine's book, and the two are never averaged or substituted.

⛔ NO PRICE LEVELS. Calls carry entry/stop/target in the store; nothing here returns them (the
member surfaces never show a call's levels).

THE GATE: WISDOM_ARCHIVE_ENABLED, read per call and FIRST. Off means None before any store read.
Every public function returns None on anything it cannot answer and never raises.
"""
from __future__ import annotations

import logging
from typing import Optional

from api.services.wisdom.core import flags

log = logging.getLogger(__name__)

LABEL = "UCT team archive (the team's own posted calls, outcomes measured after the fact; not advice)"
SOURCE = "team_archive"
MAX_EXAMPLES = 3
MAX_TICKER_CALLS = 10


def _thresholds() -> tuple[float, int]:
    from api.services.wisdom.archive import askai

    return askai.EDGE_Z, askai.MIN_CONTEXT_N


def _num(v) -> Optional[float]:
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def verdict(stats: Optional[dict]) -> str:
    """'measured edge' only at |z| >= EDGE_Z on at least MIN_CONTEXT_N scored calls."""
    edge_z, min_n = _thresholds()
    st = stats or {}
    n = int(st.get("n_scored") or 0)
    if not n:
        return "no scored calls"
    z = _num(st.get("edgeR_z"))
    if z is None:
        return "not proven"
    return "measured edge" if abs(z) >= edge_z and n >= min_n else "not proven"


def _brief_stats(st: Optional[dict]) -> Optional[dict]:
    if not st or not st.get("n_scored"):
        return None
    out = {k: st.get(k) for k in ("n_scored", "win20", "med_r20", "med_edge20", "mean_edgeR", "edgeR_z")}
    out["verdict"] = verdict(st)
    return out


def _example(e: dict) -> dict:
    from api.services.wisdom.archive.askai import _speaker

    return {"ticker": e.get("ticker"), "trader": _speaker(e.get("author_id")), "posted": e.get("posted"),
            "direction": e.get("direction"), "r20": e.get("r20"), "sim_R": e.get("sim_R"),
            "regime": e.get("regime"), "record_id": e.get("record_id")}


def resolve_setup(conn, name: Optional[str]) -> Optional[str]:
    """An archive setup id for an engine setup name, a pattern-engine id, an archive id or free
    text. Detector ids go through the vocabulary map; everything else through the stored aliases."""
    from api.services.wisdom.archive import service, setup_map

    raw = " ".join(str(name or "").split())
    if not raw:
        return None
    via_map = setup_map.setup_for_pattern(raw)
    if via_map:
        return via_map
    sid = raw.lower().replace(" ", "_")
    try:
        if service.playbook(conn, sid) is not None:
            return sid
    except service.ItemError:
        pass
    found = service.match_setups(conn, raw, limit=1)
    return found[0] if found else None


def _market() -> Optional[str]:
    from api.services.wisdom.archive import setup_map

    try:
        return setup_map.market_state()
    except Exception:  # noqa: BLE001
        return None


def _setup_payload(pb: dict, state: Optional[str]) -> dict:
    _, min_n = _thresholds()
    stats = pb.get("stats") or {}
    cut = ((pb.get("context") or {}).get("market") or {}).get(state) if state else None
    cut = cut if cut and int(cut.get("n_scored") or 0) >= min_n else None
    from api.services.wisdom.archive.askai import _speaker

    return {
        "source": SOURCE, "label": LABEL, "setup_id": pb.get("setup_id"), "name": pb.get("name"),
        "all_calls": _brief_stats(stats.get("all")),
        "entries_ideas_adds": _brief_stats(stats.get("trades")),
        "today": {"rule": "QQQ close vs its 50/200-day averages", "state": state,
                  "cut": _brief_stats(cut)},
        "best": [_example(e) for e in (pb.get("winners") or [])[:MAX_EXAMPLES]],
        "worst": [_example(e) for e in (pb.get("failures") or [])[:MAX_EXAMPLES]],
        "teachings": [{"record_id": t.get("record_id"), "trader": _speaker(t.get("author_id")),
                       "date": t.get("date")} for t in (pb.get("teachings") or [])[:2]],
    }


def setup_record(name: Optional[str], *, for_request: bool = False) -> Optional[dict]:
    """The archive's measured record for one setup, or None (off, unmapped, not imported)."""
    if not flags.archive_enabled():  # the gate first: off touches no store
        return None
    try:
        from api.services.wisdom.archive import service
        from api.services.wisdom.core import store

        with store.read(for_request=for_request) as conn:
            sid = resolve_setup(conn, name)
            pb = service.playbook(conn, sid) if sid else None
        if not pb:
            return None
        return _setup_payload(pb, _market())
    except Exception:  # noqa: BLE001
        log.exception("[wisdom] team archive setup record failed")
        return None


def analogs(name: Optional[str], *, limit: int = 5) -> Optional[dict]:
    """The setup's cleanest team winners and failures, those posted in today's tape first."""
    rec = setup_record(name)
    if rec is None:
        return None
    state = rec["today"]["state"]
    n = max(1, min(int(limit or 5), MAX_EXAMPLES * 2))
    try:
        from api.services.wisdom.archive import service
        from api.services.wisdom.core import store

        with store.read() as conn:
            pb = service.playbook(conn, rec["setup_id"]) or {}
    except Exception:  # noqa: BLE001
        log.exception("[wisdom] team archive analogs failed")
        return None

    def ranked(rows):
        rows = list(rows or [])
        return sorted(rows, key=lambda e: 0 if (state and e.get("regime") == state) else 1)

    return {"source": SOURCE, "label": LABEL, "setup_id": rec["setup_id"], "name": rec["name"],
            "today_state": state,
            "winners": [_example(e) for e in ranked(pb.get("winners"))[:n]],
            "failures": [_example(e) for e in ranked(pb.get("failures"))[:n]]}


def ticker_record(symbol: Optional[str], *, setup: Optional[str] = None,
                  for_request: bool = False) -> Optional[dict]:
    """The team's calls on one ticker (and of one setup in it), without price levels."""
    if not flags.archive_enabled():
        return None
    from api.services.wisdom.archive import service

    try:
        from api.services.wisdom.archive.askai import _speaker
        from api.services.wisdom.core import store

        with store.read(for_request=for_request) as conn:
            sym = service.normalize_ticker(symbol or "")
            summary = service.ticker_summary(conn, sym)
            sid = resolve_setup(conn, setup) if setup else None
            calls = service.calls_for_ticker(conn, sym, setup=sid, limit=MAX_TICKER_CALLS)
        rows = [{"call_id": c["call_id"], "record_id": c["record_id"], "trader": _speaker(c.get("author_id")),
                 "posted": c.get("posted"), "setup": c.get("setup"), "direction": c.get("direction"),
                 "action": c.get("action"),
                 "r5": (c.get("outcome") or {}).get("r5"), "r20": (c.get("outcome") or {}).get("r20")}
                for c in calls]
        return {"source": SOURCE, "label": LABEL, "ticker": sym, "n_calls": summary["n_calls"],
                "n_scored": summary["n_scored"], "mean_r20": summary["mean_r20"],
                "setup_id": sid, "calls": rows}
    except service.ItemError:
        return None
    except Exception:  # noqa: BLE001
        log.exception("[wisdom] team archive ticker record failed")
        return None


def _pct(v) -> Optional[str]:
    x = _num(v)
    return None if x is None else f"{'+' if x * 100 > 0 else ''}{x * 100:.1f}%"


def sentence(setup_rec: Optional[dict], ticker_rec: Optional[dict] = None) -> str:
    """One plain sentence for a verdict's basis, "" when there is nothing to say. Labelled, so a
    reader can never take it for the engine's number."""
    bits = []
    st = (setup_rec or {}).get("all_calls")
    if st:
        win = _num(st.get("win20"))
        part = f"{setup_rec.get('name') or setup_rec.get('setup_id')}: {int(st['n_scored'])} scored team calls"
        if win is not None:
            part += f", {win * 100:.0f}% up after 20 sessions"
        part += f", edge {st['verdict']}"
        cut = ((setup_rec.get("today") or {}).get("cut"))
        if cut and _num(cut.get("mean_edgeR")) is not None:
            part += (f"; in today's tape (QQQ {setup_rec['today']['state']}) {int(cut['n_scored'])} calls, "
                     f"edge R {float(cut['mean_edgeR']):+.2f}")
        bits.append(part)
    if ticker_rec and ticker_rec.get("n_calls"):
        part = f"{ticker_rec['ticker']}: {int(ticker_rec['n_calls'])} team calls on record"
        last = (ticker_rec.get("calls") or [None])[0]
        if last:
            r20 = _pct(last.get("r20"))
            part += (f", latest {last.get('setup') or 'call'} by {last.get('trader')} on "
                     f"{str(last.get('posted') or '')[:10]}{f' (r20 {r20})' if r20 else ''}")
        bits.append(part)
    if not bits:
        return ""
    return "Team archive (measured after the fact, separate from the verdict): " + "; ".join(bits) + "."
