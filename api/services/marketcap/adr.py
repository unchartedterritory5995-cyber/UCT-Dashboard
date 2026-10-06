"""ADR / ADS ratios (Gate F) and the ADS-equivalent share conversion.

Units. bars are adjusted for EVERY ADS-level event (an ordinary split passing through the ADS and a depositary
ratio change look identical in the ADS price). With R(a) = ordinary shares per ADS in effect at the as-of date `a`
of an ordinary-share count N, and F(a) = the ADS ticker's split factor after `a`:

    ADS-equivalent shares, today's ADS basis  =  N * F(a) / R(a)

Proof sketch: an ordinary split k after `a` leaves R unchanged and appears in F; a ratio change s = R_old/R_new
after `a` appears in F as s; either way N * F(a) / R(a) * adjusted_close(t) = N_t * price_t / R_t.

R(a) must come from a STATEMENT (filing text: "American Depositary Shares, each representing N ordinary shares")
with no ADS ledger event between the statement's date and `a` -- otherwise the ratio at `a` is not known and the
observation is refused (ADR_RATIO_UNRESOLVED). Never ADS price x ordinary shares.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date

from api.services.fundamentals_pit.splits import Ledger

from .textcover import for_matching

FRAC = {"one-half": 0.5, "one half": 0.5, "one-third": 1 / 3, "one-quarter": 0.25, "one-fourth": 0.25, "one-fifth": 0.2,
        "one-tenth": 0.1, "one-twentieth": 0.05, "one-fortieth": 0.025, "two-thirds": 2 / 3, "three-quarters": 0.75}
WORD = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10,
        "eleven": 11, "twelve": 12, "fifteen": 15, "twenty": 20, "twenty-five": 25, "thirty": 30, "forty": 40, "fifty": 50,
        "one hundred": 100, "a": 1, "an": 1}
# M3.1 (SOGP 20-F 0001493152-26-019716: "each ADS represents two hundred (200) Class A ordinary shares"): N hundred
WORD.update({f"{w} hundred": 100 * n for w, n in (("two", 2), ("three", 3), ("four", 4), ("five", 5), ("six", 6),
                                                    ("seven", 7), ("eight", 8), ("nine", 9))})
ADS = r"(?:american\s+depositary\s+shares?|american\s+depository\s+shares?|ADSs?|ADRs?|depositary\s+shares?)"
SH = r"(?:ordinary\s+shares?|common\s+shares?|shares?\s+of\s+common\s+stock|shares?(?:\s+of\s+the\s+company)?|equity\s+shares?|class\s+a\s+ordinary\s+shares?)"
NUMW = r"(one-half|one half|one-third|one-quarter|one-fourth|one-fifth|one-tenth|one-twentieth|one-fortieth|two-thirds|three-quarters|\d{1,3}(?:,\d{3})+|\d+(?:_\d+)?|(?:one|two|three|four|five|six|seven|eight|nine)\s+hundred|twenty-five|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|an?)"
# M3 (accepted) reading, kept EXACTLY for accepted evidence: no "N hundred" (other than one hundred), no numeral check
NUMW_M3 = r"(one-half|one half|one-third|one-quarter|one-fourth|one-fifth|one-tenth|one-twentieth|one-fortieth|two-thirds|three-quarters|\d{1,3}(?:,\d{3})+|\d+(?:_\d+)?|one hundred|twenty-five|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|an?)"
RX = [
    # "American Depositary Shares, each representing one-fifth of one ordinary share" / "each representing 5 ordinary shares"
    re.compile(rf"{ADS}[^.;]{{0,60}}?(?:each\s+)?(?:representing|represents|represent|evidencing|equal\s+to)\s+{NUMW}(?:\s*\((\d+(?:_\d+)?)\))?\s+(?:of\s+(?:one|an?)\s+)?{SH}", re.I),
    # "each ADS represents 5 ordinary shares"
    re.compile(rf"each\s+{ADS}\s+(?:represents|representing|evidences)\s+{NUMW}(?:\s*\((\d+(?:_\d+)?)\))?\s+(?:of\s+(?:one|an?)\s+)?{SH}", re.I),
    # "5 ordinary shares per ADS"
    re.compile(rf"{NUMW}(?:\s*\((\d+(?:_\d+)?)\))?\s+{SH}\s+per\s+{ADS}", re.I),
]


def _rx(numw: str, cap: bool) -> tuple[list, re.Pattern]:
    par = r"(?:\s*\((\d+(?:_\d+)?)\))?" if cap else r"(?:\s*\(\d+(?:_\d+)?\))?"
    rx = [re.compile(rf"{ADS}[^.;]{{0,60}}?(?:each\s+)?(?:representing|represents|represent|evidencing|equal\s+to)\s+{numw}{par}\s+(?:of\s+(?:one|an?)\s+)?{SH}", re.I),
          re.compile(rf"each\s+{ADS}\s+(?:represents|representing|evidences)\s+{numw}{par}\s+(?:of\s+(?:one|an?)\s+)?{SH}", re.I),
          re.compile(rf"{numw}{par}\s+{SH}\s+per\s+{ADS}", re.I)]
    inv = re.compile(rf"each\s+{numw}{par}\s+{ADS}\s*(?:representing|represents|represent|evidencing)\s+"
                     rf"(?:one|an?|1)(?:\s*\(1\))?\s+{SH}", re.I)
    return rx, inv


# ⛔ INVERSE statements: "ADSs, each twenty (20) ADSs representing one (1) Common Share" (DDI) is 1/20 ordinary per
# ADS. The forward rule read "ADSs representing one (1) Common Share" as 1:1 and DDI's cap came out 20x low.
INVERSE = re.compile(rf"each\s+{NUMW}(?:\s*\((\d+(?:_\d+)?)\))?\s+{ADS}\s*(?:representing|represents|represent|evidencing)\s+"
                     rf"(?:one|an?|1)(?:\s*\(1\))?\s+{SH}", re.I)


@dataclass(frozen=True)
class RatioStatement:
    as_of: date                 # the date the statement speaks for (filing date / cover date)
    ords_per_ads: float
    accn: str
    snippet: str


def _val(tok: str) -> float | None:
    t = re.sub(r"\s+", " ", tok.lower()).replace("_", ".").replace(",", "")
    if t in FRAC:
        return FRAC[t]
    if t in WORD:
        return float(WORD[t])
    try:
        return float(t)
    except ValueError:
        return None


RX_M3, INVERSE_M3 = _rx(NUMW_M3, False)


def parse_ratio(text: str, legacy: bool = False) -> tuple[float | None, str, str]:
    """-> (ordinary shares per ADS, status, snippet). status OK | NOT_FOUND | CONFLICT.
    `legacy`: the ACCEPTED (M3) reading -- evidence accepted under it keeps it (M3.1: a parser improvement re-reads
    accepted evidence only through an explicit historical correction)."""
    if legacy:
        return _parse_m3(text)
    t = for_matching(text)
    vals = {}
    inverse_spans = []
    disagree = []

    def agrees(m, v):
        # M3.1: a number word with its numeral ("two hundred (200)") must state ONE value; otherwise fail closed
        num = m.group(2)
        if num is not None and _val(num) is not None and abs(_val(num) - v) > 1e-9:
            disagree.append(t[max(0, m.start() - 20):m.end() + 20][:300])
            return False
        return True
    for m in INVERSE.finditer(t):
        v = _val(m.group(1))
        if v is not None and not agrees(m, v):
            continue
        if v and v > 1:
            inverse_spans.append((m.start(), m.end()))
            vals.setdefault(round(1 / v, 9), t[max(0, m.start() - 20):m.end() + 20][:300])
    for rx in RX:
        for m in rx.finditer(t):
            if any(a <= m.start() < b or a < m.end() <= b for a, b in inverse_spans):
                continue
            tok = m.group(1)
            v = _val(tok)
            if v is None or v <= 0:
                continue
            if not agrees(m, v):
                continue
            seg = m.group(0).lower()
            frac_of_one = re.search(r"of\s+(?:one|an?)\s+", seg[seg.find(tok.lower()) + len(tok):][:12]) is not None
            if frac_of_one and v >= 1 and tok.lower() not in FRAC:
                continue            # "one of one" style noise
            vals.setdefault(round(v, 9), t[max(0, m.start() - 20):m.end() + 20][:300])
    if disagree:
        return None, "CONFLICT", "WORD_NUMERAL_DISAGREE: " + " || ".join(disagree[:3])
    if not vals:
        return None, "NOT_FOUND", ""
    if len(vals) > 1:
        return None, "CONFLICT", " || ".join(list(vals.values())[:3])
    v, s = next(iter(vals.items()))
    return v, "OK", s


COVER_12B = re.compile(r"(?:registered|to\s+be\s+registered)\s+pursuant\s+to\s+section\s+12\s*\(\s*b\s*\)", re.I)
COVER_WINDOW = 2500


def parse_cover_ratio(text: str) -> tuple[float | None, str, str]:
    """M3.1 (SOGP): the 12(b) REGISTRATION TABLE of the cover ("Title of each class ... American depositary shares,
    each ADS represents two hundred (200) Class A ordinary shares") -- the ratio the filing registers AS OF its date.
    Only the bounded window after the first 12(b) heading is read: the body of a 20-F also narrates superseded ratios
    ("prior to the ratio change ... 20"), which a whole-document read reports as a CONFLICT."""
    t = for_matching(text)
    m = COVER_12B.search(t)
    if not m:
        return None, "NOT_FOUND", ""
    v, st, snip = parse_ratio(t[m.end():m.end() + COVER_WINDOW])
    return v, st, ("COVER_12B: " + snip) if snip else ""


def _parse_m3(text: str) -> tuple[float | None, str, str]:
    t = for_matching(text)
    vals = {}
    inverse_spans = []
    for m in INVERSE_M3.finditer(t):
        v = _val(m.group(1))
        if v and v > 1:
            inverse_spans.append((m.start(), m.end()))
            vals.setdefault(round(1 / v, 9), t[max(0, m.start() - 20):m.end() + 20][:300])
    for rx in RX_M3:
        for m in rx.finditer(t):
            if any(a <= m.start() < b or a < m.end() <= b for a, b in inverse_spans):
                continue
            tok = m.group(1)
            v = _val(tok)
            if v is None or v <= 0:
                continue
            seg = m.group(0).lower()
            frac_of_one = re.search(r"of\s+(?:one|an?)\s+", seg[seg.find(tok.lower()) + len(tok):][:12]) is not None
            if frac_of_one and v >= 1 and tok.lower() not in FRAC:
                continue
            vals.setdefault(round(v, 9), t[max(0, m.start() - 20):m.end() + 20][:300])
    if not vals:
        return None, "NOT_FOUND", ""
    if len(vals) > 1:
        return None, "CONFLICT", " || ".join(list(vals.values())[:3])
    v, s = next(iter(vals.items()))
    return v, "OK", s


BACKWARD_DAYS = 400       # a LATER statement speaks for an earlier as-of only this far back (the next annual report)
ORD_JUMP = 3.0            # an ordinary-share count moving >= 3x between statement and as-of breaks the ratio's basis


def ads_title(text: str) -> bool:
    # an ADS of the ORDINARY / COMMON shares -- never a depositary share of a PREFERRED stock (Alphabet's GOOGN title,
    # "Depositary Shares representing a 1/20th Interest in a Share of Series B ... Preferred Stock", made Alphabet an
    # 'ADS issuer' and its whole history FOREIGN_MULTI_CLASS)
    t = text or ""
    return bool(re.search(r"american\s+deposit[ao]ry|global\s+deposit[ao]ry|\bADSs?\b|\bADRs?\b", t, re.I)) and not re.search(r"preferred", t, re.I)


def ads_listed_fn(titled: list[tuple[date, bool]], fallback: bool):
    """-> f(d): is the listed security an ADS at date d? From the 12(b) titles of each filing (dei:Security12bTitle):
    the latest titled filing on/before d decides; before the first one, `fallback` (issuer-level evidence).
    ⛔ RCEL (2019 ADS of 20 ordinary shares -> 2020 US common stock) and CD (ADS 1:360 -> ordinary shares) kept the old
    ADS ratio for counts of a security that was no longer an ADS: caps 20x and 360x low."""
    rows = sorted(titled)

    def f(d: date) -> bool:
        cur = None
        for t, v in rows:
            if t <= d:
                cur = v
            else:
                break
        return fallback if cur is None else cur
    return f


def ads_transitions(titled: list[tuple[date, bool]]) -> list[date]:
    out, prev = [], None
    for t, v in sorted(titled):
        if prev is not None and v != prev:
            out.append(t)
        prev = v
    return out


def valid_statements(statements: list[RatioStatement], ads_ledger: Ledger, ord_points: list[tuple[date, float]]) -> list[RatioStatement]:
    """Drop a statement whose ratio is UNCHANGED from the previous one across an ADS ledger event although the
    ordinary-share count did not move by that event's factor: the event was a RATIO CHANGE and the statement is a
    STALE title (SQNS 2025/2026 20-F covers still say 'each representing four ordinary shares' after the ADS went
    4 -> 10 -> 100 ordinary shares; Massive's ADS name says 100). Unconfirmable -> dropped (fail closed)."""
    import math
    out, prev = [], None
    pts = sorted(x for x in ord_points if x[1] and x[1] > 0)
    # a statement filed up to 120 days BEFORE an ADS event whose ratio is already the POST-event ratio (the previous
    # statement's ratio / the event factor) speaks from the event on: Rio Tinto's F-6 of 2010-03-31 ("each ADS
    # representing one ordinary share") registered the ADSs of the 4:1 ADS split effective 2010-04-30
    from dataclasses import replace as _rep
    shifted = []
    srt = sorted(statements, key=lambda x: x.as_of)
    for i, st in enumerate(srt):
        nxt_ev = next((e for e in ads_ledger.splits if st.as_of < e.ex_date <= st.as_of + __import__("datetime").timedelta(days=120)), None)
        before = [x for x in srt[:i] if x.as_of < st.as_of]
        if nxt_ev is not None and before and abs(st.ords_per_ads / (before[-1].ords_per_ads / nxt_ev.ratio) - 1) < 0.01:
            st = _rep(st, as_of=nxt_ev.ex_date)
        shifted.append(st)
    for st in sorted(shifted, key=lambda x: x.as_of):
        if prev is not None:
            evs = [e for e in ads_ledger.splits if prev.as_of < e.ex_date <= st.as_of]
            if evs and abs(st.ords_per_ads / prev.ords_per_ads - 1) < 0.01:
                q = 1.0
                for e in evs:
                    q *= e.ratio
                before = [v for d, v in pts if d <= evs[0].ex_date]
                after = [v for d, v in pts if d >= evs[-1].ex_date]
                if not (before and after) or not (before[-1] > 0 and after[0] > 0) or                         abs(math.log(after[0] / before[-1]) - math.log(q)) > math.log(1.25):
                    continue
        out.append(st)
        prev = st
    return out


def ratio_at(a: date, statements: list[RatioStatement], ads_ledger: Ledger, value: float | None = None,
             ord_points: list | tuple = (), breaks: list | tuple = ()) -> RatioStatement | None:
    """The statement valid at `a`: the latest one ON/BEFORE `a`, else the nearest LATER one within BACKWARD_DAYS -- in
    both cases with no ADS ledger event between it and `a`, and with the ordinary-share basis continuous between them
    (no >= 3x move in the ordinary count: DXF's ordinary shares were subdivided 100:1 in 2025 while its last ratio
    statement, 2024, still said 480 per ADS -> 60x too many ADS-equivalents)."""
    def ok(st):
        lo, hi = sorted((a, st.as_of))
        if any(lo < s.ex_date <= hi for s in ads_ledger.splits):
            return False
        if st.as_of > a and (st.as_of - a).days > BACKWARD_DAYS:
            return False
        # ⛔ a break in trading (> 90 days without bars: delisted, later re-listed) ends an ADS program -- LATAM's
        # 1:1 ADS (to 2020) and its 2025 ADS of 2,000 shares share one ticker and no ledger event
        if any(lo < b <= hi for b in breaks):
            return False
        vals = [v for d, v in ord_points if lo <= d <= hi]
        near = min(ord_points, key=lambda x: abs((x[0] - st.as_of).days), default=None)
        if near is not None and abs((near[0] - st.as_of).days) <= BACKWARD_DAYS:
            vals.append(near[1])
        if value:
            vals.append(value)
        vals = [v for v in vals if v and v > 0]
        return not (vals and max(vals) / min(vals) >= ORD_JUMP)
    before = [st for st in statements if st.as_of <= a and ok(st)]
    if before:
        return max(before, key=lambda st: st.as_of)
    after = [st for st in statements if st.as_of > a and ok(st)]
    return min(after, key=lambda st: st.as_of) if after else None
