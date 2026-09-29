"""SECURITY IDENTITY for the current-universe UCT BACKTEST — a ticker is not a company.

⛔⛔ WHY. The retrospective UCT population was "today's 2,689 tickers ∩ whoever traded under
those strings on D". Ticker strings are reused: ABAT was Advanced Battery Technologies (CIK
745651) until 2011 and is American Battery Technology (CIK 1576873, ABML until 2023-09-21)
today; META was the Roundhill Metaverse ETF in 2021; B was Barnes Group until 2025.

⚠️ AND A CIK IS NOT A SECURITY LINEAGE EITHER. A holding-company reorganisation gives the
same traded shares a new CIK and FIGI (ExxonMobil Holdings 2026-07-02, BlackRock 2024-10-02,
Liberty Global, Qiagen, Pinnacle): a strict CIK rule would delete XOM's whole history.

⭐ THE RULE — per continuous trading segment of the ticker (gaps > 5 sessions split
segments), provider evidence only, first match wins:

  PIT_MATCH     the point-in-time details at the segment start carry the current CIK or
                composite FIGI → the whole segment is the current security.
  EVENT_COVER   the current company's ticker-change history says it used T at the segment
                start → whole segment.
  REORG         an adoption event E inside the segment, the raw close is continuous across E
                (|log| < log 1.25 — a 1:1 exchange, not a different company's price), and the
                current record's list_date is on/before the segment start → whole segment.
  HANDOVER      an adoption event E inside the segment otherwise → only [E, end].
  CHANGEPOINT   the holder at the segment start is a different CIK/FIGI but the holder at the
                segment END is the current company: point-in-time details are BISECTED to the
                identity change date X, then the REORG test (price continuity + list_date) is
                applied at X — REORG → whole segment, otherwise HANDOVER at X.
  LATEST_LINEAGE the segment reaching the present, no adoption event inside it, no
                point-in-time record CONTRADICTING the current company, and list_date on/before
                the segment start → whole segment (events history is incomplete, e.g. GPRE).
  EXCLUDED      everything else — a different security, or no evidence (fail closed).

A company's history under an EARLIER ticker (FB before META, AMRK before GOLD) is not
followed: the back-test is identity-safe, not rename-complete, and the census reports how
many names that leaves short.
"""
from __future__ import annotations

import json
import math

IDENTITY_RULE = "uct-backtest-identity-v3"
REORG_PRICE_TOL = math.log(1.25)


def _events(v, t):
    ev = (v.get("events") or {}).get("events") or []
    ev = sorted((e["date"], (e.get("ticker_change") or {}).get("ticker"))
                for e in ev if e.get("type") == "ticker_change" and e.get("date"))
    out = []
    for i, (d0, tk) in enumerate(ev):
        if tk == t:
            out.append((d0, ev[i + 1][0] if i + 1 < len(ev) else "9999-12-31"))
    return out


def classify_ticker(t: str, v: dict, raw_close, prev_session, last_session: str,
                    changepoints: dict = None) -> list:
    """[(start, end, allowed_from, rule, detail)] per segment. `raw_close(iso, t)` and
    `prev_session(iso)` read the SAME vintage raw files the pass uses."""
    cur = v.get("current") or {}
    cik, figi, lst = cur.get("cik"), cur.get("composite_figi"), cur.get("list_date")
    iv = _events(v, t)
    out = []
    segs = [tuple(s) for s in (v.get("segments") or [])]
    for s0, s1 in segs:
        a = (v.get("asof_at_segment_start") or {}).get(s0)
        same = bool(a) and ((cik and a.get("cik") == cik) or (figi and a.get("composite_figi") == figi))
        contradicts = bool(a) and not same and bool(a.get("cik") or a.get("composite_figi"))
        if same:
            out.append((s0, s1, s0, "PIT_MATCH", a.get("name"))); continue
        if any(b0 <= s0 < b1 for b0, b1 in iv):
            out.append((s0, s1, s0, "EVENT_COVER", None)); continue
        inside = sorted(b0 for b0, _b1 in iv if s0 < b0 <= s1)
        if inside:
            E = inside[0]
            p = prev_session(E)
            r1, r0 = raw_close(E, t), (raw_close(p, t) if p else None)
            cont = bool(r0 and r1) and abs(math.log(r1 / r0)) < REORG_PRICE_TOL
            if cont and lst and lst <= s0:
                out.append((s0, s1, s0, "REORG", "%s→%s raw %.4g→%.4g" % (p, E, r0, r1)))
            else:
                out.append((s0, s1, E, "HANDOVER", "at %s (prior: %s)" % (E, (a or {}).get("name"))))
            continue
        cp = ((changepoints or {}).get(s0) or {}).get("changepoint")
        if cp:
            p = prev_session(cp)
            r1, r0 = raw_close(cp, t), (raw_close(p, t) if p else None)
            cont = bool(r0 and r1) and abs(math.log(r1 / r0)) < REORG_PRICE_TOL
            if cont and lst and lst <= s0:
                out.append((s0, s1, s0, "CHANGEPOINT_REORG", "%s→%s raw %.4g→%.4g" % (p, cp, r0, r1)))
            else:
                out.append((s0, s1, cp, "CHANGEPOINT_HANDOVER", "at %s" % cp))
            continue
        if s1 >= last_session and not contradicts and lst:
            out.append((s0, s1, max(s0, lst), "LATEST_LINEAGE", "list_date %s" % lst)); continue
        out.append((s0, s1, None, "EXCLUDED",
                    ("different security: %s (cik %s)" % (a.get("name"), a.get("cik"))) if a
                    else "no point-in-time record"))
    return out


class Identity:
    def __init__(self, table: dict):
        self.rule = table["rule"]
        self.rows = table["tickers"]

    def allowed(self, t: str, day: str) -> bool:
        for s0, s1, frm, _rule, _d in self.rows.get(t, ()):
            if s0 <= day <= s1:
                return frm is not None and day >= frm
        return False

    def rule_for(self, t: str, day: str) -> str:
        for s0, s1, frm, rule, _d in self.rows.get(t, ()):
            if s0 <= day <= s1:
                return rule if (frm is not None and day >= frm) else (rule + "_BEFORE_ADOPTION" if frm else rule)
        return "NO_SEGMENT"


def build_table(ledger: dict, raw_close, prev_session, last_session: str, canon=lambda t: t,
                changepoints: dict = None) -> dict:
    rows = {}
    for t, v in (ledger.get("identity") or {}).items():
        rows[canon(t)] = classify_ticker(t, v, raw_close, prev_session, last_session,
                                         (changepoints or {}).get(t))
    return {"rule": IDENTITY_RULE, "tickers": rows}


def load(path: str) -> Identity:
    with open(path) as f:
        return Identity(json.load(f))
