"""Ask-AI adapter for the TSDR trader archive — the "TRADER ARCHIVE" grounding block.

Consumer: `api/routers/ai_search.py::_grounded_system`, right after the "UCT SAID" block.

THE GATE: `WISDOM_ARCHIVE_ENABLED`, read FIRST and per call (owner ruling 2026-10-15: paid
members and every in-app tool). Off means this module never opens wisdom.db. There is no
cohort: the Ask AI route is already `require_paid`, which is exactly the audience the owner
named. (The older "UCT SAID" block keeps its own flag and cohort; this one does not use them.)

WHAT THE BLOCK SAYS — bounded: at most MAX_HITS records, each excerpt clipped to
EXCERPT_CHARS, the whole block capped at MAX_BLOCK_CHARS:
  [<trader> · <date> · <record id>] <excerpt> (calls: <TICKER> <dir> <setup> r20 +x.x%)
under a header telling the model to cite trader + date + record id, and never to present an
archived call or its outcome as current data or advice.

When the question names a setup (service.match_setups over the imported playbooks), ONE
playbook line goes first, clipped to PLAYBOOK_CHARS:
  [PLAYBOOK · <setup name>] <n> scored calls, win20 x%, median vs same stock x%, edge R x (z x, <verdict>);
  best context: ...; teachings: [<trader> · <date> · <record id>], ...
An edge is called measured only at |z| >= EDGE_Z; below that the line says "not proven".
"""
from __future__ import annotations

import logging
import re
from typing import Iterable, Optional

from api.services.wisdom.core import flags

log = logging.getLogger(__name__)

FLAG_ENV = "WISDOM_ARCHIVE_ENABLED"
SOURCE_KEY = "trader_archive"
SALT_SUFFIX = "|trader_archive"
MAX_HITS = 6
EXCERPT_CHARS = 280
MAX_BLOCK_CHARS = 2600
PLAYBOOK_CHARS = 700
PLAYBOOK_KIND = "trader_archive_playbook"
EDGE_Z = 3.0
MIN_CONTEXT_N = 30
HEADER = ("\n\nTRADER ARCHIVE (dated posts by the UCT trading team from the TSDR archive — cite the "
          "trader, the date and the record id, e.g. 'TSDR, 2025-01-02, t123'; these are historical "
          "posts, never current market data or a recommendation; a call's outcome is measured after "
          "the fact, r20 = return 20 sessions later; a PLAYBOOK line is a setup's measured record "
          "across all archived calls, edge = versus the same stock on a random day): ")


def _pct(v) -> Optional[str]:
    try:
        x = float(v) * 100
    except (TypeError, ValueError):
        return None
    return f"{'+' if x > 0 else ''}{x:.1f}%"


def _speaker(author_id: Optional[str]) -> str:
    try:
        from api.services.wisdom.publish.adapters import common

        return common.speaker(author_id)
    except Exception:
        return str(author_id or "Unknown")


def format_hit(h: dict) -> str:
    calls = []
    for c in h.get("calls") or []:
        o = c.get("outcome") or {}
        bits = [c.get("ticker") or "", c.get("direction") or "", c.get("setup") or ""]
        r20 = _pct(o.get("r20"))
        if r20:
            bits.append(f"r20 {r20}")
        calls.append(" ".join(b for b in bits if b))
    tail = f" (calls: {'; '.join(calls)})" if calls else ""
    return f"[{_speaker(h.get('author_id'))} · {h.get('stated_date') or 'undated'} · {h.get('record_id')}] " \
           f"{h.get('excerpt') or ''}{tail}"


def _num(v) -> Optional[float]:
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def format_playbook(pb: dict, market_state: Optional[str] = None) -> tuple[str, list]:
    """(one bounded playbook line, its citations). "" when the playbook has no scored calls.

    `market_state` is today's QQQ state under the archive's own rule (setup_map.market_state):
    when the playbook's `market` cut for it rests on MIN_CONTEXT_N scored calls, the line leads
    with "this tape" and keeps one best other cut; otherwise it shows the two best cuts."""
    st = ((pb.get("stats") or {}).get("all")) or {}
    n = st.get("n_scored")
    if not n:
        return "", []
    edge, z = _num(st.get("mean_edgeR")), _num(st.get("edgeR_z"))
    bits = [f"{int(n)} scored calls"]
    win = _num(st.get("win20"))
    if win is not None:
        bits.append(f"win20 {win * 100:.0f}%")
    med = _pct(st.get("med_edge20"))
    if med:
        bits.append(f"median vs same stock {med}")
    if edge is not None:
        verdict = "measured edge" if z is not None and abs(z) >= EDGE_Z else "not proven"
        bits.append(f"edge R {edge:+.2f} (z {z if z is not None else 'n/a'}, {verdict})")
    cuts = []
    for group, rows in (pb.get("context") or {}).items():
        for value, cst in (rows or {}).items():
            ce = _num((cst or {}).get("mean_edgeR"))
            if ce is not None and ((cst or {}).get("n_scored") or 0) >= MIN_CONTEXT_N:
                cuts.append((ce, f"{group.replace('_', ' ')} {value} (n {int(cst['n_scored'])}, edge R {ce:+.2f})"))
    cuts.sort(key=lambda c: -c[0])
    text = f"[PLAYBOOK · {pb.get('name') or pb.get('setup_id')}] " + ", ".join(bits)
    tape = ((pb.get("context") or {}).get("market") or {}).get(market_state) if market_state else None
    tape_edge = _num((tape or {}).get("mean_edgeR"))
    if tape_edge is not None and ((tape or {}).get("n_scored") or 0) >= MIN_CONTEXT_N:
        tape_label = f"market {market_state} (n {int(tape['n_scored'])}, edge R {tape_edge:+.2f})"
        text += f"; this tape, QQQ {market_state}: n {int(tape['n_scored'])}, edge R {tape_edge:+.2f}"
        others = [c for c in cuts if c[1] != tape_label]
        if others:
            text += "; best other context: " + others[0][1]
    elif cuts:
        text += "; best context: " + "; ".join(c[1] for c in cuts[:2])
    cites = []
    teach = []
    for t in (pb.get("teachings") or [])[:2]:
        who = _speaker(t.get("author_id"))
        teach.append(f"[{who} · {t.get('date') or 'undated'} · {t.get('record_id')}]")
        cites.append({"record_id": t.get("record_id"), "trader": who, "date": t.get("date"),
                      "setup": pb.get("setup_id"), "kind": PLAYBOOK_KIND, "flag_env": FLAG_ENV})
    if teach:
        text += "; teachings: " + ", ".join(teach)
    if len(text) > PLAYBOOK_CHARS:
        text = text[:PLAYBOOK_CHARS - 1].rstrip() + "…"
    return text, cites


#: A question about what is setting up today gets ONE bounded "this rhymes" line: today's scanner
#: hits beside the archive's precedent (archive/rhymes.py). Display only, cited, never a level.
RHYMES_KIND = "trader_archive_rhymes"
RHYMES_CHARS = 900
_RHYMES_RE = re.compile(r"\brhym|what'?s setting up|setting up today|today'?s (?:setups?|scan|scanner|hits)"
                        r"|scanner (?:hits|today)", re.I)


def asks_for_rhymes(query: Optional[str]) -> bool:
    return bool(_RHYMES_RE.search(query or ""))


def rhymes_line() -> tuple[str, list]:
    """The bounded rhymes line and its citations (the newest team call on each named ticker)."""
    from api.services.wisdom.archive import rhymes

    payload = rhymes.today()
    line = rhymes.format_line(payload, max_chars=RHYMES_CHARS)
    if not line:
        return "", []
    cites = []
    for h in (payload or {}).get("hits", [])[:5]:
        last = (h.get("ticker_history") or {}).get("last_call")
        if last and last.get("record_id"):
            cites.append({"record_id": last["record_id"], "trader": last.get("trader"),
                          "date": (last.get("posted") or "")[:10], "ticker": h.get("ticker"),
                          "kind": RHYMES_KIND, "flag_env": FLAG_ENV})
    return line, cites


def archive_block(query: Optional[str], *, query_tickers: Iterable[str] = ()) -> tuple[str, list]:
    """(block text, citations) or ("", []). Never raises."""
    try:
        if not flags.archive_enabled():  # the gate first: off touches no store
            return "", []
        from api.services.wisdom.archive import service
        from api.services.wisdom.core import store

        with store.read() as conn:
            hits = service.retrieval_hits(conn, query or "", tickers=list(query_tickers or ()),
                                          limit=MAX_HITS, excerpt_chars=EXCERPT_CHARS)
            pb = None
            for sid in service.match_setups(conn, query or "", limit=1):
                pb = service.playbook(conn, sid)
        parts, cites, used = [], [], len(HEADER)
        if asks_for_rhymes(query):
            rline, rcites = rhymes_line()
            if rline:
                parts.append(rline)
                cites.extend(rcites)
                used += len(rline) + 3
        if pb:
            from api.services.wisdom.archive import setup_map

            line, pcites = format_playbook(pb, setup_map.market_state())
            if line:
                parts.append(line)
                cites.extend(pcites)
                used += len(line) + 3
        if not hits and not parts:
            return "", []
        for h in hits:
            line = format_hit(h)
            if used + len(line) + 3 > MAX_BLOCK_CHARS:
                break
            parts.append(line)
            used += len(line) + 3
            cites.append({"record_id": h["record_id"], "trader": _speaker(h.get("author_id")),
                          "date": h.get("stated_date"), "kind": "trader_archive", "flag_env": FLAG_ENV})
        if not parts:
            return "", []
        return HEADER + " | ".join(parts), cites
    except Exception:
        log.exception("[wisdom] Ask-AI trader-archive block failed; answering without it")
        return "", []
