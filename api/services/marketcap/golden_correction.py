"""2026-10-02 correction pass goldens: one focused case per blocker class of the first shadow (63 securities whose
current V1 value was >= 10x wrong). Each must end CORRECT (current value within 2x of Massive -- an independent anomaly
detector, never truth) or REFUSED with an explicit reason. Plus the class-mapping, lineage and boundary goldens."""
from __future__ import annotations

import json


def _i(s: str) -> int:
    return int(s.replace("-", ""))


def _massive(data: str) -> dict:
    out = {}
    for line in open(f"{data}/ref.jsonl", encoding="utf-8"):
        t, d, _s, _e = json.loads(line)
        if d and d.get("market_cap"):
            out[t] = float(d["market_cap"])
    return out


def correction_pass_goldens(g) -> None:
    M = _massive(g.data)

    def now(t):
        c = g.cik(t)
        cv = g.cov(c) if c else None
        if not cv:
            return c, None, None, None
        last = g.db.execute("SELECT d, cap FROM cap_daily WHERE cik=? ORDER BY d DESC LIMIT 1", (c,)).fetchone()
        valued = bool(last and last[0] >= _i(cv["last_day"]))
        reason = None if valued else (g.db.execute("SELECT reason FROM gap_run WHERE cik=? ORDER BY end DESC LIMIT 1", (c,)).fetchone() or [None])[0]
        r = (last[1] / M[t]) if valued and t in M else None
        return c, valued, r, reason

    def correct_or_refused(case, t, why, allowed=None):
        c, valued, r, reason = now(t)
        ok = c is not None and ((valued and r is not None and 0.5 <= r <= 2.0) or (not valued and reason and (allowed is None or reason in allowed)))
        g.check(case, f"{t}: {why} -> CORRECT (<=2x) or REFUSED with a reason", ok, {"valued": valued, "ratio_vs_massive": r, "reason_now": reason})

    correct_or_refused("SCALE", "BNTX", "x1000 first cover count never anchors later correct counts")
    correct_or_refused("SCALE", "CLBK", "x1000 balance-sheet count")
    correct_or_refused("SCALE", "GFR", "balance sheet in thousands beside a cover in units")
    correct_or_refused("ADR_INVERSE", "DDI", "'each twenty ADSs representing one share' is 1/20")
    correct_or_refused("ADR_TERMINATED", "CD", "no ADS ratio once the listed security is ordinary shares")
    correct_or_refused("ADR_TERMINATED", "RCEL", "no ADS ratio after the 2020 redomicile")
    correct_or_refused("ADR_STALE_TITLE", "SQNS", "stale 'four ordinary shares' title across ADS ratio changes")
    correct_or_refused("ADR_SUBDIVISION", "DXF", "ratio statement across an ordinary-share subdivision")
    correct_or_refused("ADR_RELISTED", "LTM", "pre-bankruptcy 1:1 ratio never applied to the 2025 ADS of 2,000 shares")
    correct_or_refused("ADR_MEMBER", "SONY", "the ADR-member row is not a share class")
    correct_or_refused("PRE_LISTING", "ELVR", "pre-merger predecessor count not carried onto the new listing")
    correct_or_refused("INVALID_UNIT", "LGCL", "'$ / shares' column is not a count")
    correct_or_refused("INVALID_UNIT", "WXM", "'$ / shares' column is not a count")
    correct_or_refused("PLACEHOLDER", "HQ", "a reported count of 1 share", {"SUSPICIOUS_SHARE_COUNT", "PRE_FIRST_AUTHORITATIVE_SHARE_EVIDENCE"})
    correct_or_refused("RETRO_RESTATED", "PAVS", "count retroactively restated for a later reverse split")
    correct_or_refused("LEDGER_AFTER_PRICES", "KUST", "a split after the last bar is not applied to the shares")
    for t in ("INLF", "HKIT", "LBGJ", "RPGL", "VMAR", "NCT"):
        correct_or_refused("REVERSE_SPLIT_CARRY", t, "pre-reverse-split count with issuance registered before the split")
    for t in ("BMA", "TIGR", "FENG", "ZEPP"):
        correct_or_refused("FOREIGN_MULTI_CLASS", t, "ADS over several ordinary classes")
    for t in ("VTIX", "UFG"):
        correct_or_refused("CONVERSION_NARRATIVE", t, "a transaction count is never a conversion ratio")
    for t in ("TWG", "GDHG", "ZBAO", "BAOS"):
        correct_or_refused("ISSUANCE", t, "count superseded by registered issuance (offering-document counts)")
    c = g.cik("UHAL")
    comps = g.db.execute("SELECT components FROM regime WHERE issuer_id=? ORDER BY end DESC LIMIT 1", (f"cik:{c}",)).fetchone() if c else None
    tick = sorted({x[1] for x in json.loads(comps[0])}) if comps else []
    g.check("ONE_CLASS", "UHAL: voting (UHAL) AND Series N (UHAL.B) each at its own price", tick == ["UHAL", "UHAL.B"], tick)
    c = g.cik("GTN")
    comps = g.db.execute("SELECT kind, components FROM regime WHERE issuer_id=? ORDER BY end DESC LIMIT 1", (f"cik:{c}",)).fetchone() if c else None
    g.check("ONE_CLASS", "GTN: never class A alone at the common price",
            bool(comps) and (comps[0] == "UNRESOLVED" or any(x[0] == "CS" for x in json.loads(comps[1]))), comps)
    c = g.cik("RUSHA")
    comps = g.db.execute("SELECT components FROM regime WHERE issuer_id=? ORDER BY end DESC LIMIT 1", (f"cik:{c}",)).fetchone() if c else None
    tick = {x[1] for x in json.loads(comps[0])} if comps else set()
    g.check("MULTI_CLASS_G", "RUSHA: class A at RUSHA, class B at RUSHB (never both at one ticker)", tick == {"RUSHA", "RUSHB"}, sorted(tick))
    for t in ("HOV", "UNF", "AWX", "FLWS", "ASST"):
        c = g.cik(t)
        comps = g.db.execute("SELECT kind, components FROM regime WHERE issuer_id=? ORDER BY end DESC LIMIT 1", (f"cik:{c}",)).fetchone() if c else None
        listed = [x[1] for x in json.loads(comps[1]) if x[3] == "listed"] if comps else []
        g.check("MULTI_CLASS_G", f"{t}: no two classes priced as LISTED at one ticker", len(listed) == len(set(listed)), comps and comps[:1] + (listed,))
    c = g.cik("GOOGL")
    v13 = g.cap(c, "2013-12-31") if c else None
    g.check("LINEAGE", "Alphabet: Google Inc. history (pure 251(g) reorganization) valued; 2013-12-31 within $350-400B",
            v13 is not None and 350e9 <= v13 <= 400e9, v13)
    c = g.cik("XOM")
    n = g.db.execute("SELECT COUNT(*) FROM cap_daily WHERE cik=? AND d < 20260701", (c,)).fetchone()[0] if c else 0
    g.check("LINEAGE", "XOM: Exxon Mobil Corporation history before the 2026 redomiciliation is valued", n > 1000, n)
    for t, eff in (("DIS", 20190320), ("MDT", 20150127), ("DD", 20170901), ("ETN", 20121130)):
        c = g.cik(t)
        codes = {r[2] for r in g.gaps(c) if r[1] < eff} if c else set()
        vals = g.db.execute("SELECT COUNT(*) FROM cap_daily WHERE cik=? AND d < ?", (c, eff)).fetchone()[0] if c else None
        g.check("LINEAGE", f"{t}: merger boundary -- nothing valued before {eff}, coded PREDECESSOR_DIFFERENT_ECONOMIC_ENTITY",
                vals == 0 and "PREDECESSOR_DIFFERENT_ECONOMIC_ENTITY" in codes, {"values_before": vals, "codes": sorted(codes)})
