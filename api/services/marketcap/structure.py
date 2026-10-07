"""Capital-structure resolution (Gates F/G): which classes are economic components, priced by which listed ticker,
at which multiplier -- per REGIME (a run of filings reporting the same set of share classes).

Rules (owner rulings 5-7):
  * a class with its own listed ticker is priced by that ticker (GOOGL / GOOG, BRK-A / BRK-B);
  * an unlisted class counts at  ratio x listed price  only with an AUTHORITATIVE statement: an explicit conversion
    ratio into a listed class (chains allowed: PLTR F -> B -> A), or convertibility plus a statement that the
    classes' per-share dividend and liquidation rights are identical (ratio 1);
  * a voting-only class (no economic rights / no dividends) is not a component;
  * a class reported with zero shares throughout the regime is ignored;
  * any capital-structure COMPLEX marker (Up-C units, variable conversion, tracking stock, exchangeable shares,
    paired/stapled) -> COMPLEX_CAPITAL_STRUCTURE_UNRESOLVED;
  * anything else -> MULTI_CLASS_UNRESOLVED.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

from . import reasons as R
from .classecon import ClassEcon
from .engine import Component, Structure


GENERIC_COMMON = re.compile(r"^(?:common\s*stock|ordinary\s*shares?|common\s*shares?)(?:\s*\[?member\]?)?$", re.I)
# ⛔ not a share count of this issuer at all: a "$ / shares" COLUMN (par value / price per share rendered beside the
# count -- LGCL, WXM, GVH, DCX took a per-share column as 'shares'), an ADR/ADS member (SONY's dei_AdrMember row is the
# ADS line, a SUBSET of the ordinary shares, never a class), a depositary-share member.
INVALID_MEMBER = re.compile(r"\$|/\s*shares?\b|AdrMember|AmericanDepositar|American\s+Depositar|DepositaryShare|"
                            r"Depositary\s+Share|\bADSs?\b|\bADRs?\b", re.I)


def member_name(member: str) -> str:
    raw = member.split(":", 1)[-1]
    nm = raw.split("=")[-1]
    return re.sub(r"^[a-z][a-z0-9-]*_", "", nm)


def invalid_member(member: str | None, label: str | None) -> bool:
    return bool(member) and bool(INVALID_MEMBER.search(member.split(":", 1)[-1]) or INVALID_MEMBER.search(label or ""))


def filing_keys(rows) -> dict:
    """{(member, label): class key} for ONE filing's rows. ⛔ A DIMENSIONAL generic common member that sits beside other
    class members is a CLASS of its own, never the total: GTN reports "Common Stock" (93.1M, GTN) and "Class A"
    (9.9M, GTN.A) -- the old rule dropped COMMON as 'the total' and priced 9.9M class A shares at GTN. It becomes "CS".
    The non-dimensional (member-less) count stays COMMON (the total)."""
    keys = {(m, l): class_key(m, l) for m, l in rows}
    others = any(k != "COMMON" for (m, _l), k in keys.items() if m)
    if others:
        for (m, l), k in list(keys.items()):
            if m and k == "COMMON":
                keys[(m, l)] = "CS"
    return keys


def class_key(member: str | None, label: str | None) -> str:
    """Normalize an XBRL class member / column label to COMMON or a class letter (A, B, C ...).
    ⛔ Only a GENERIC common member is COMMON: "NonvotingCommonStockMember" (UHAL's listed Series N, UHAL.B) used to
    match a suffix rule and be thrown away as 'the total'."""
    if not member:
        return "COMMON"
    raw = member.split(":", 1)[-1]
    m = re.search(r"(?:Class|Series)([A-Z])(?:[A-Z][a-z]|Member|$|\d)", raw)
    if m:
        return m.group(1)
    if label:
        m = re.search(r"\bclass\s+([a-z])\b", label, re.I)
        if m:
            return m.group(1).upper()
    if GENERIC_COMMON.match(member_name(member)) or GENERIC_COMMON.match((label or "").strip()):
        return "COMMON"
    return "OTHER:" + raw


def ticker_letter(ticker: str) -> str | None:
    m = re.search(r"[-.]([A-Z])$", ticker)
    return m.group(1) if m else None


@dataclass
class Resolution:
    structure: Structure
    evidence: dict = field(default_factory=dict)     # class -> how it was resolved (+ snippet / accn)


def _ratio_to_listed(c: str, listed: dict, econ: ClassEcon, depth: int = 0) -> tuple[str, float, str] | None:
    if depth > 3:
        return None
    conv = econ.conversions.get(c)
    if conv:
        to, r, snip = conv
        if to in listed:
            return to, r, f"conversion {c}->{to} x{r}: {snip[:200]}"
        nxt = _ratio_to_listed(to, listed, econ, depth + 1)
        if nxt:
            return nxt[0], r * nxt[1], f"conversion {c}->{to} x{r}; " + nxt[2]
    nr = econ.convertible_no_ratio.get(c)
    if nr:
        to, snip = nr
        eq = econ.equal(c, to)
        if eq:
            if to in listed:
                return to, 1.0, f"convertible {c}->{to} with identical per-share rights: {eq[:200]}"
            nxt = _ratio_to_listed(to, listed, econ, depth + 1)
            if nxt:
                return nxt[0], nxt[1], f"convertible {c}->{to} identical rights; " + nxt[2]
    return None


def resolve(classes: dict, listed: dict, econ: ClassEcon | None, econ_accn: str = "") -> Resolution:
    """classes: letter -> max shares seen in the regime; listed: letter -> ticker (with bars)."""
    live = {c for c, n in classes.items() if n and n > 0}
    ev: dict = {}
    if live == {"COMMON"} or (len(live) == 1 and next(iter(live)) in listed):
        c = next(iter(live))
        t = listed.get(c) or listed.get("COMMON")
        if not t:
            return Resolution(Structure("UNRESOLVED", reason=R.NO_VALID_PRICE, note="no listed ticker for the class"))
        return Resolution(Structure("SINGLE", [Component(c, t)]), {c: "single class"})
    if any(k.startswith("OTHER:") and k not in listed for k in live):
        return Resolution(Structure("UNRESOLVED", reason=R.MULTI_CLASS, note=f"unrecognized class members {sorted(live)}"))
    if econ is not None and econ.complex:
        return Resolution(Structure("UNRESOLVED", reason=R.COMPLEX, note=f"complex markers {sorted(econ.complex)} ({econ_accn})"),
                          {"complex": {k: v[:300] for k, v in econ.complex.items()}})
    comps = []
    for c in sorted(live):
        if c in listed:
            comps.append(Component(c, listed[c], evidence="listed"))
            ev[c] = f"listed {listed[c]}"
            continue
        if econ is None:
            return Resolution(Structure("UNRESOLVED", reason=R.MULTI_CLASS, note=f"class {c} unlisted, no economics text"))
        if c in econ.voting_only:
            ev[c] = f"voting-only, excluded ({econ_accn}): {econ.voting_only[c][:200]}"
            continue
        r = _ratio_to_listed(c, listed, econ)
        if r is None:
            return Resolution(Structure("UNRESOLVED", reason=R.MULTI_CLASS, note=f"class {c}: no authoritative ratio to a listed class ({econ_accn})"), ev)
        to, ratio, why = r
        comps.append(Component(c, listed[to], multipliers=((None, None, ratio),), evidence=f"{econ_accn}: {why}"))
        ev[c] = f"{econ_accn}: {why}"
    if not comps:
        return Resolution(Structure("UNRESOLVED", reason=R.MULTI_CLASS, note="no economic listed component"), ev)
    # ⛔ two DIFFERENT listed classes priced by ONE ticker (anomaly G): each listed class carries its own price
    seen_px: dict = {}
    for x in comps:
        if x.evidence == "listed":
            if x.price_ticker in seen_px:
                return Resolution(Structure("UNRESOLVED", reason=R.MULTI_CLASS,
                                            note=f"classes {seen_px[x.price_ticker]} and {x.class_key} both map to {x.price_ticker}"), ev)
            seen_px[x.price_ticker] = x.class_key
    kind = "MULTI_LISTED" if sum(1 for x in comps if x.evidence == "listed") > 1 else "LISTED_PLUS_CONVERTIBLE"
    return Resolution(Structure(kind, comps), ev)
