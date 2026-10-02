"""Build MARKET CAP / PIT SHARE STATE V1: one immutable, versioned SQLite dataset.

    python -m api.services.marketcap.build --data C:/mcapdata --out C:/mcapdata/builds [--ciks 320193,1973239]

Inputs (all local, all hashed into the manifest): inputs.db (companyfacts + submissions staging), covers.db
(rendered cover facts), text.db (pre-XBRL covers, IPO prospectuses, class economics, ADS ratios), prices.db
(bars export), ref.jsonl (Massive ticker reference: list/delist dates, types, splits -- NEVER share counts).

Per issuer: identity -> observations -> class regimes -> structure -> per-class PIT states -> daily company
capitalization with a reason code for every trading day without a value. Nothing is written anywhere but the
build file.
"""
from __future__ import annotations

import argparse
import math
import bisect
import re
import hashlib
import json
import os
import sqlite3
import subprocess
import sys
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone

from api.services.fundamentals_pit.splits import Ledger, Split

from . import DATASET, reasons as R
from .adr import RatioStatement, ads_listed_fn, ads_title, ads_transitions, ratio_at, valid_statements
from .classecon import ClassEcon
from .cover import num as cover_num
from .engine import Component, Listing, Structure, company_cap
from .identity import EDGAR_DOMESTIC, EDGAR_FOREIGN, Ref, decide, segments
from .state import ET, Checked, Obs, timeline, validate
from .structure import class_key, filing_keys, invalid_member, resolve, ticker_letter

EQUITY_TYPES = {"CS", "ADRC", "OS", "NYRS", "GDR", "ADRS", None}
# ⛔ Massive types some PREFERRED / hybrid instruments "CS": GOOGN = "Alphabet Inc. Depositary Shares representing a
# 1/20th Interest in a Share of Series B Mandatory Convertible Preferred Stock" (listed 2026-06-03) was taken as
# Alphabet's listed CLASS B -- class B was priced at ~$49 and the company had 82 valued sessions of 5,563.
# Only UNAMBIGUOUS non-common instruments. MEASURED over-exclusion of a broader first version: "Brookdale Senior Living",
# MLP "Common Units representing limited partner interests" (the issuer's equity), "Our Bond, Inc. Common Stock",
# ADSs "each representing the right to receive 20 Series B Shares" (AMX) and ADSs over foreign ECONOMIC preferred
# shares (Braskem, Bancolombia) are all equity and stay in.
NOT_COMMON_EQUITY = re.compile(r"\bpreferred\s+stock\b|\bwarrants?\b|\brights?\b(?!\s+to\s+receive)"
                               r"|\bunits?,?\s+each\s+consisting\b|\bnotes?\s+due\b|\bsenior\s+(?:notes?|secured|unsecured|debentures?)\b"
                               r"|\bsubordinated\b|\bdebentures?\b|\bmortgage\s+bonds?\b|\bbonds?\s+due\b|\d%", re.I)
FPI_FORMS = ("20-F", "40-F", "20-F/A", "40-F/A", "6-K")
# equity issuance registered (424B2 / automatic shelves are overwhelmingly DEBT for large issuers and are not counted)
OFFERING_FORMS = frozenset({"424B1", "424B3", "424B4", "424B5", "424B7", "S-1", "S-1/A", "F-1", "F-1/A", "S-3", "S-3/A",
                            "F-3", "F-3/A", "S-4", "S-4/A", "F-4", "F-4/A", "S-1MEF", "F-1MEF"})

SCHEMA = """
CREATE TABLE manifest(key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE security(security_id TEXT, issuer_id TEXT, cik INTEGER, class_key TEXT, economic_type TEXT,
  price_ticker TEXT, multiplier REAL, regime_start TEXT, regime_end TEXT, evidence TEXT, PRIMARY KEY(security_id, regime_start));
CREATE TABLE ticker_map(ticker TEXT, cik INTEGER, security_id TEXT, start TEXT, end TEXT, basis TEXT, pre_reason TEXT,
  pre_bars INTEGER, notes TEXT);
CREATE TABLE observation(obs_id INTEGER PRIMARY KEY, issuer_id TEXT, security_id TEXT, class_key TEXT, as_of TEXT,
  public_at TEXT, known_from TEXT, raw_value REAL, normalized_value REAL, unit TEXT, split_basis TEXT, ads_ratio REAL,
  source_type TEXT, accession TEXT, form TEXT, tag TEXT, snippet TEXT, precedence INTEGER, validation_status TEXT,
  flags TEXT, confidence TEXT, note TEXT, build_id TEXT);
CREATE TABLE state_run(issuer_id TEXT, class_key TEXT, start TEXT, end TEXT, shares REAL, obs_accession TEXT,
  as_of TEXT, source_type TEXT);
CREATE TABLE regime(issuer_id TEXT, start TEXT, end TEXT, classes TEXT, kind TEXT, reason TEXT, note TEXT, components TEXT);
CREATE TABLE cap_daily(cik INTEGER, d INTEGER, cap REAL, PRIMARY KEY(cik, d)) WITHOUT ROWID;
CREATE TABLE gap_run(cik INTEGER, start INTEGER, end INTEGER, reason TEXT, n_days INTEGER);
CREATE TABLE econ_request(cik INTEGER, accn TEXT, regime_start TEXT, regime_end TEXT);
CREATE INDEX observation_issuer ON observation(issuer_id, class_key);
CREATE INDEX state_run_issuer ON state_run(issuer_id, class_key);
CREATE INDEX gap_run_cik ON gap_run(cik);
CREATE TABLE split_gap(cik INTEGER, d TEXT, k INTEGER, direction TEXT, cls TEXT, prev_asof TEXT, next_asof TEXT,
  status TEXT, ex_date TEXT, ratio REAL, source TEXT, accn TEXT, snippet TEXT);
CREATE TABLE lineage_applied(cik INTEGER, kind TEXT, status TEXT, effective TEXT, pred_cik INTEGER, accn TEXT, days INTEGER, note TEXT);
CREATE TABLE coverage(cik INTEGER PRIMARY KEY, primary_ticker TEXT, foreign_filer INTEGER, first_bar TEXT,
  listing_start TEXT, first_value TEXT, last_day TEXT, listed_days INTEGER, valued_days INTEGER,
  evidence_span_days INTEGER, evidence_span_valued INTEGER, internal_gap_days INTEGER, unexplained_days INTEGER,
  structure TEXT, reasons TEXT);
"""


def _d(i: int) -> date:
    return date(i // 10000, i // 100 % 100, i % 100)


def _i(d: date) -> int:
    return d.year * 10000 + d.month * 100 + d.day


def _ts(s: str | None) -> datetime | None:
    if not s:
        return None
    return datetime.fromisoformat(s).astimezone(timezone.utc)


def _late(d: str) -> datetime:
    """Unknown acceptance: public only by the END of the date (late, never early)."""
    return datetime.combine(date.fromisoformat(d), datetime.max.time().replace(microsecond=0), tzinfo=ET).astimezone(timezone.utc)


# Dimensional cover axes that name ANOTHER ENTITY (combined filings: AEP's utility subsidiaries since 2019 tag their
# counts on dei:LegalEntityAxis). Their rows are other registrants' capitalization, never a share class of this one.
ENTITY_AXES = frozenset({"dei_LegalEntity", "srt_ConsolidatedEntities"})


# ⛔ every US exchange's CONTINUED-listing standard requires at least 500,000 publicly held shares (Nasdaq Capital Market;
# NYSE / NYSE American more): a count below 100,000 cannot be the outstanding count of the LISTED security -- it is a
# pre-combination shell (Viatris/Upjohn 2020: "100 shares", priced for ten months at the stitched Mylan bars), a sponsor
# stake, or a truncated parse. Not a universal rule: an unlisted class (a convertible class B) may hold any count.
LISTED_MINIMUM_SHARES = 100_000

CAPITAL_EVENT_FORMS = OFFERING_FORMS | frozenset({"424B2", "425", "8-K12B", "8-K12G3", "SC TO-I", "SC TO-I/A", "DEFM14A",
                                                   "PREM14A", "DEF 14C", "10-12B"})
COMMON_SPLIT_FACTORS = (2, 3, 4, 5, 6, 7, 8, 10, 12, 15, 16, 20, 25, 30, 35, 40, 50, 60, 75, 80, 100)


def extreme_step_decisions(caps: dict, pclose: dict, runs_by_class: dict, obs_rows: list, ev_forms: list,
                           known_splits: list) -> dict:
    """{day: (reason, note)} to withhold for the FIRST unexplained >= 10x cap step that the evidence does not support.

    For consecutive valued days a < b whose cap ratio, after removing the price move, is >= 10x:
      1. each side's share state (every class run in force) must be CORROBORATED -- another filing's observation of the
         same class within 400 days agrees within 1.5x. An uncorroborated side is refused (HR 2006: 15,200 shares of a
         non-traded REIT's sponsor stake against the 227M-share NYSE common; RJF 1995: "1,249,014 shares", the leading
         digit lost, 20.6M three months later; GNLN 2025: 223 split-adjusted shares).
      2. a step BRIDGED by intermediate issuer counts (each move < 10x), or with a capital-event filing (offering, merger,
         tender, registration) between the two counts or as the source of the later count, is a real capital change.
      3. otherwise a state ratio within 3% of a common split factor with no ledger / evidence split between is a split
         the ledger lacks: every earlier day is withheld (CMCL: 487.9M ordinary in 2007 against 19.2M in 2023 across a
         consolidation, no capital event on file); any other such step is unproven and the earlier state is withheld.
      Otherwise the step is a real capital change (issuance, conversion, recapitalization) and is served."""
    days = sorted(caps)
    if len(days) < 2:
        return {}

    def side(d):
        out = []
        for (_iss, ck), rs in runs_by_class.items():
            for r in rs:
                if r[0] <= d.isoformat() <= r[1]:
                    out.append((ck, r))
        return out

    def corroborated(ck, r) -> bool:
        a = date.fromisoformat(r[4])
        for o in obs_rows:
            if o[3] != ck or o[13] == r[3] or not o[8]:
                continue
            if abs((date.fromisoformat(o[4]) - a).days) <= 400 and abs(math.log(o[8] / r[2])) < math.log(1.5):
                return True
        return False

    for a, b in zip(days, days[1:]):
        if not (pclose.get(a) and pclose.get(b) and caps[a] > 0 and caps[b] > 0):
            continue
        q = (caps[b] / caps[a]) / (pclose[b] / pclose[a])
        if abs(math.log(q)) < math.log(10):
            continue
        sa, sb = side(a), side(b)
        if not sa or not sb:
            continue
        bad = [(ck, r) for ck, r in sa + sb if not corroborated(ck, r)]
        if bad:
            hold = {}
            for ck, r in bad:
                for d in days:
                    if r[0] <= d.isoformat() <= r[1]:
                        hold[d] = (R.SCALE_UNRESOLVED, f"ISOLATED_EXTREME_STATE {ck} {r[2]:.0f} (as of {r[4]}, {r[3]}): no "
                                                       f"independent filing agrees within 400 days; cap step x{q:.3g}")
            return hold
        tot_a, tot_b = sum(r[2] for _c, r in sa), sum(r[2] for _c, r in sb)
        ratio = tot_b / tot_a
        asof_a = max(r[4] for _c, r in sa)
        asof_b = min(r[4] for _c, r in sb)
        k = max(ratio, 1 / ratio)
        if len(sa) == 1 and len(sb) == 1 and sa[0][0] == sb[0][0]:
            ck = sa[0][0]
            mids = sorted((o[4], o[8]) for o in obs_rows if o[3] == ck and asof_a <= o[4] <= asof_b
                          and o[18] in (R.ACCEPTED, R.ACCEPTED_RESTATED_BASIS))
            vals = [sa[0][1][2]] + [v for _d, v in mids] + [sb[0][1][2]]
            bridged = all(abs(math.log(y / x)) < math.log(10) for x, y in zip(vals, vals[1:]))
        else:
            bridged = False
        if bridged:
            continue                                     # gradual: every move between issuer counts is < 10x
        src_b_form = next((o[14] for o in obs_rows if o[13] == sb[0][1][3]), None)
        event = any(asof_a < fd <= asof_b for fd, _f in ev_forms) or (src_b_form in CAPITAL_EVENT_FORMS)
        if event:
            continue                                     # an offering / combination / tender between: a capital change
        split_between = any(asof_a < s.isoformat() <= asof_b for s in known_splits)
        if not split_between and any(abs(math.log(k / f)) < 0.03 for f in COMMON_SPLIT_FACTORS):
            return {d: (R.HIST_SPLIT_UNRESOLVED, f"SPLIT_LIKE_EXTREME_STEP x{ratio:.4g} between {asof_a} and {asof_b}: "
                                                 "no ledger or issuer split, no capital event")
                    for d in days if d < b}
        return {d: (R.SCALE_UNRESOLVED, f"UNPROVEN_EXTREME_STEP x{ratio:.4g} between {asof_a} and {asof_b}: not "
                                        "bridged by issuer counts, no capital-event filing")
                for d in days if any(r[0] <= d.isoformat() <= r[1] for _c, r in sa)}
    return {}


def _sym(s: str) -> str:
    return re.sub(r"[^A-Z0-9]", "", (s or "").upper())


def symbol_reports(D, cik: int, filings: dict) -> list[tuple[str, set]]:
    """[(filing_date, {symbols the filing's cover reports as THIS registrant's trading symbols})] (dei:TradingSymbol,
    2019+). Debt / note symbols (digits) and placeholders are dropped."""
    if getattr(D, "cov", None) is None:
        return []
    by: dict = {}
    for accn, text in D.cov.execute("SELECT accn, text FROM cover_fact WHERE cik=? AND concept='dei:TradingSymbol'", (cik,)):
        f = filings.get(accn)
        if not f:
            continue
        for part in re.split(r"[,;/ ]+", text or ""):
            s = _sym(part)
            if s and not re.search(r"\d", s) and s not in ("NA", "NONE"):
                by.setdefault((f["filing_date"], accn), set()).add(s)
    return sorted((fd, v) for (fd, _a), v in by.items())


def reported_symbol_switch(ticker: str, reports: list, issuer_tickers: list, event_symbols: list,
                           counts: list) -> tuple[date, str] | None:
    """⛔ THE ISSUER SAYS ITS SECURITY TRADED UNDER ANOTHER SYMBOL. When the registrant's own covers report symbol(s) S
    that are neither `ticker` nor any symbol it is known to have used (its tickers, its Massive ticker history -- a
    rename of THIS security keeps its stitched history: FB -> META, RIMM -> BB), and the share count jumps across the
    switch to `ticker` (a combination, not a rename: Healthcare Trust of America reported "HTA" until 2022-05 and became
    Healthcare Realty "HR" through the 2022-07-20 merger, 230M -> 380M shares), the bars of `ticker` before the switch
    are another security's. Returns (first day the issuer is `ticker`, note) or None."""
    T = _sym(ticker)
    own = {_sym(x) for x in list(issuer_tickers) + list(event_symbols) if x}
    own_roots = {o for o in own if len(o) >= 2}

    def is_own(s):
        return s == T or s in own or any(s.startswith(o) for o in own_roots)
    other = [fd for fd, ss in reports if not any(is_own(s) for s in ss)]
    if not other:
        return None
    last_other = max(other)
    firsts = [fd for fd, ss in reports if fd > last_other and T in ss]
    if not firsts:
        return None
    switch = date.fromisoformat(min(firsts))
    lo = date.fromisoformat(last_other)
    # the counts must be contemporaneous with the switch (within 150 days on each side), or a jump is just time
    pre = [x for x in counts if lo - timedelta(days=150) <= x[0] <= lo]
    post = [x for x in counts if lo < x[0] <= switch + timedelta(days=150)]
    if not pre or not post or (switch - lo).days > 300:
        return None
    a = max(pre, key=lambda x: x[0])[1]
    b = min(post, key=lambda x: x[0])[1]
    if abs(math.log(b / a)) < math.log(1.25):
        return None                                  # a rename: the count carries through
    return switch, f"registrant reported {sorted({s for fd, ss in reports if fd == last_other for s in ss})} until {last_other}; {ticker} from {switch}; count {a:.0f} -> {b:.0f}"


def split_in_trading_break(days: list, ex: date) -> bool:
    """The ex date falls inside a > 90-day break in the bars: whether the bars before the break carry the split cannot
    be seen (ALT 2007-07-25 1:50 -- the SPAC's last bar 07-24, the next bar 2009-11; AIM 2016/2019 -- bars 2013 -> 2019)."""
    i = bisect.bisect_left(days, ex)
    return 0 < i < len(days) and (days[i] - days[i - 1]).days > 90 and days[i - 1] < ex


def own_counts_continuous(obs: list, eff: date, factor=lambda d: 1.0) -> bool:
    """A successor's OWN periodic history before the effective date is the listed security's only when its share count
    carries through (a holding-company formation keeps the count: MDU 2019, O-I 2019). A pre-merger SHELL's counts do not
    (Linde plc: 25,000 shares on its 2017-2018 covers, 551M after the 2018-10-31 combination) -- that is a boundary."""
    pre = sorted(o.value * factor(o.as_of) for _k, o, _m in obs if eff - timedelta(days=400) <= o.as_of < eff and o.value > 0)
    post = sorted(o.value * factor(o.as_of) for _k, o, _m in obs if eff <= o.as_of <= eff + timedelta(days=400) and o.value > 0)
    if not pre or not post:
        return True
    med = lambda v: v[len(v) // 2]
    # medians, not extremes: one mis-scaled cover must not turn a holding-company formation into a boundary
    return abs(math.log(med(post) / med(pre))) < math.log(10)


def merge_evidence_splits(ledger_splits: list, evidence_splits: list) -> list:
    """⛔ An evidence split is the SAME event as a ledger split of the same factor (2%) within 60 days (OTEX 2014 2-for-1:
    issuer XBRL dates it 2014-01-23, the ledger 2014-02-19; adding both doubled every earlier count; CYRX 2015 1:12).
    The evidence date stands -- it was confirmed where the bars step."""
    kept = [s for s in ledger_splits
            if not any(abs(math.log(s.ratio / e.ratio)) < 0.02 and abs((s.ex_date - e.ex_date).days) <= 60 for e in evidence_splits)]
    return kept + list(evidence_splits)


def ads_after_form_switch(forms: list, titled: dict, is_adr: bool) -> tuple[dict, date | None]:
    """⛔ FOREIGN -> DOMESTIC FORM SWITCH (RCEL: 20-F with "ADS, each representing 20 ordinary shares" in 2019; from
    2020-08 10-K/10-Q of a redomiciled US common stock -- every count was divided by 20 until a 2026 title). A 12(b)
    title filed before the switch does not speak after it: the first title filed AFTER the switch decides from the
    switch on; with none, the ADS status after the switch is unresolved (returned: withheld from that date).
    `forms`: [(filing_date, form)]; `titled`: {filing_date: is_ads_title}. Returns (titled', unresolved_from)."""
    fper = sorted((d, f) for d, f in forms if f in ("20-F", "40-F", "10-K", "10-Q", "10-KT"))
    last_foreign = max((d for d, f in fper if f in ("20-F", "40-F")), default=None)
    switch = min((d for d, f in fper if f in ("10-K", "10-Q", "10-KT") and last_foreign and d > last_foreign), default=None)
    out = dict(titled)
    if switch is None or not titled:
        return out, None
    before = [v for t, v in sorted(titled.items()) if t < switch]
    after = [v for t, v in sorted(titled.items()) if t >= switch]
    if (before and before[-1]) or (not before and is_adr):
        if after:
            out[switch] = after[0]
            return out, None
        return out, switch
    return out, None


def unapplied_post_state_splits(rows: list, last_asof: str, known: list, last_bar: date) -> list[tuple[date, float]]:
    """⛔ THE ISSUER STATES A SPLIT AFTER ITS LAST SHARE STATE that no ledger carries (SGRX: XBRL 1-for-60 2026-01-20 and
    1-for-5 2026-08-21, filed 2026-09-18, under a renamed ticker whose ledger is empty; the bars carry both, so every
    earlier day was 300x high). With no count across it no transition can expose it: every earlier day is withheld.
    `rows`: issuer XBRL (ex_date, ratio) statements; `known`: the splits already in force. A statement within 60 days of
    a known split, or of the same ratio within 400 days (an XBRL comparative period restating it: JAGX's 2025-06-30
    "0.028" is the 2026-04-30 1-for-35), is that split."""
    out = []
    for exd, r in rows:
        try:
            ed = date.fromisoformat(exd)
        except (TypeError, ValueError):
            continue
        if exd <= last_asof or not r or abs(math.log(r)) < math.log(2) or not clean_factor(r) or ed > last_bar:
            continue
        if any(abs((ed - s.ex_date).days) <= 60 or (abs(math.log(r / s.ratio)) < 0.05 and abs((ed - s.ex_date).days) <= 400)
               for s in known):
            continue
        out.append((ed, r))
    return out


def clean_factor(r: float) -> bool:
    """A split factor (k or 1/k = n/m, m in 1, 2, 4, within 1%) as opposed to a price-only adjustment factor (a spin-off
    or special distribution: EBAY 2015 x2.376, SLM 2014 x2.798) -- which never moves the share count, so the issuer's
    counts can neither confirm nor contradict it."""
    k = max(r, 1 / r)
    return any(abs(k * m - round(k * m)) < 0.01 * k * m for m in (1, 2, 4))


def _px_step(s, days: list, closes: dict) -> float | None:
    i = bisect.bisect_left(days, s.ex_date)
    if i == 0 or i >= len(days) or not closes.get(days[i - 1]) or not closes.get(days[i]):
        return None
    return closes[days[i]] / closes[days[i - 1]]


def price_only_verdict(s, days: list, closes: dict) -> str:
    step = _px_step(s, days, closes)
    if step is None:
        return "UNRESOLVED"
    return "CONFIRMED" if abs(math.log(step)) < abs(math.log(step * s.ratio)) else "CONTRADICTED"


def price_splice_before(s, days: list, closes: dict) -> date | None:
    """The latest ONE-SESSION adjusted-price step >= 2x before a price-only factor's ex date: the bars before it are
    spliced on another basis (WY: 61.84 -> 24.08 on 2003-09-10, no corporate action) -- a factor the bars carry from
    the ex date back to the splice says nothing about the bars before it."""
    i = bisect.bisect_left(days, s.ex_date)
    for j in range(i - 1, 0, -1):
        a, b = closes.get(days[j - 1]), closes.get(days[j])
        if a and b and abs(math.log(b / a)) >= math.log(2):
            return days[j]
    return None


def issuer_states_split(D, cik: int, s) -> bool:
    """An issuer statement (XBRL split-ratio fact or filing text) of this split: the same ratio within 5%, dated from
    60 days before to 92 days after the ledger's ex date."""
    if getattr(D, "splitev", None) is None:
        return False
    for exd, r in D.splitev.execute("SELECT ex_date, ratio FROM split_evidence WHERE cik=?", (cik,)):
        if not r or abs(math.log(r / s.ratio)) >= 0.05:
            continue
        for d_ in re.findall(r"\d{4}-\d{2}-\d{2}", exd or ""):
            # an XBRL context ends at the PERIOD end: up to a quarter after the event (JAGX: "0.0285" ending 2026-06-30
            # for the 2026-04-30 1-for-35)
            if -60 <= (date.fromisoformat(d_) - s.ex_date).days <= 92:
                return True
    return False


def ledger_split_verdict(s, obs: list) -> str:
    """Whether the issuer's own RAW counts speak to a ledger split (`obs` are one class's raw observations).

    CONFIRMED     a count dated within 400 days before the split sits on the PRE-split basis (first post count / ratio
                  within 1.3x): INTC 1999 1,667M -> 3,318M. A count dated before the split that already equals the post
                  count is an ANTICIPATORY restatement (the 10-K cover after the record date), never a contradiction.
    CONTRADICTED  counts dated within 120 days on BOTH sides agree (1.5x) and none is on the pre-split basis: INVA 2013
                  99.45M (04-25) -> 100.77M (06-30) against a 1:100 ledger entry.
    UNRESOLVED    neither: no contemporaneous count on one side (JAGX 2026: the nearest counts are 211 days before and
                  71 days after a 1:35 the bars carry back to 2015).
    """
    post = sorted((o for o in obs if s.ex_date <= o.as_of), key=lambda o: o.as_of)
    pre = [o for o in obs if s.ex_date - timedelta(days=120) <= o.as_of < s.ex_date and o.known_from <= s.ex_date]
    win = [o for o in obs if s.ex_date - timedelta(days=400) <= o.as_of < s.ex_date and o.known_from <= s.ex_date]
    if not post:
        return "UNRESOLVED"
    b0 = post[0].value
    if any(abs(math.log(o.value * s.ratio / b0)) < math.log(1.3) for o in win):
        return "CONFIRMED"
    # ...or a count dated within 400 days AFTER it sits on the post-split basis of the last pre-split count (CGNX 2017
    # 2-for-1: a stale 85.9M repeated after the split, then 172M)
    if win:
        a_last = max(win, key=lambda o: o.as_of).value
        if any(s.ex_date <= o.as_of <= s.ex_date + timedelta(days=400) and abs(math.log(o.value / (a_last * s.ratio))) < math.log(1.3)
               for o in obs):
            return "CONFIRMED"
    # the SAME count on both sides (CBAT 12,619,597 from 2013-12-31 to 2014-12-31 across a 1:100): no split plus
    # issuance reproduces a count to the share
    if any(o.as_of >= s.ex_date - timedelta(days=400) and o.as_of < s.ex_date and o.known_from <= s.ex_date
           and abs(o.value / b0 - 1) < 0.001 for o in obs) and any(o.as_of > post[0].as_of and abs(o.value / b0 - 1) < 0.001 for o in post):
        return "CONTRADICTED"
    near = [o for o in post[:3] if o.as_of <= s.ex_date + timedelta(days=120)]
    agree = [o for o in pre + near if abs(math.log(o.value / b0)) < math.log(1.5)]
    if pre and near and len(agree) * 3 >= 2 * len(pre + near) and any(o in agree for o in pre):
        return "CONTRADICTED"
    return "UNRESOLVED"


def split_like_gaps(runs_by_class: dict, caps: dict, obs_rows: list, ev_dates: list, known_splits: list, seen: set) -> list[dict]:
    """Consecutive SERVED states of one class whose ratio is within 2% of a split factor (2..100) with no ledger or
    evidence split between their as-of dates, NOT bridged by intermediate issuer counts and with no capital-event filing
    between: a split the ledger lacks, whatever the price did over the hold between (AMGN 1999-2000: 510M -> 1,027M
    across the 1999 2-for-1 the pre-2003 ledger does not list). Returned as split-ledger gaps (confirmed by issuer split
    evidence, otherwise every earlier day is withheld)."""
    out = []
    served = lambda r: any(r[0] <= d.isoformat() <= r[1] for d in caps)
    for (_iss, ck), rs in runs_by_class.items():
        rs = [r for r in rs if r[2] and served(r)]
        for p, n in zip(rs, rs[1:]):
            r = n[2] / p[2]
            k = max(r, 1 / r)
            f = next((f for f in COMMON_SPLIT_FACTORS if abs(math.log(k / f)) < 0.02), None)
            ev_lo = (date.fromisoformat(p[4]) - timedelta(days=365)).isoformat()
            # a capital event up to a year before (DCH 2026: the AXL/Dowlais combination doubled the count; its S-4 and
            # 425s precede the last pre-closing count) makes a split-like ratio a combination, not a missing split
            if f is None or any(p[4] < s <= n[4] for s in known_splits) or any(ev_lo < d <= n[4] for d in ev_dates):
                continue
            # only USABLE counts bridge (AMGN 1999: a rejected, truncated "51,710,608" is not an intermediate state)
            mids = [o[8] for o in obs_rows if o[3] == ck and p[4] < o[4] < n[4] and o[18] in (R.ACCEPTED, R.ACCEPTED_RESTATED_BASIS)]
            if any(min(abs(math.log(v / p[2])), abs(math.log(v / n[2]))) > math.log(1.15) for v in mids):
                continue                              # the move happened gradually through issuer counts
            ds = date.fromisoformat(n[0])
            if ds in seen:
                continue
            out.append({"date": ds, "k": f, "direction": "FORWARD" if r > 1 else "REVERSE", "cls": ck,
                        "prev_asof": date.fromisoformat(p[4]), "next_asof": date.fromisoformat(n[4]),
                        "prev_accn": p[3], "next_accn": n[3]})
    return out


def split_ledger_gaps(runs_by_class: dict, pclose: dict, caps: dict) -> list[dict]:
    """Every transition between consecutive share states that looks like a split the ledger lacks: the state ratio is
    a clean split factor k or 1/k (k = 2..100, within 2%), the primary's adjusted close is CONTINUOUS from the last
    valued day of the old state to the first valued day of the new one (< 1.5x), and the cap jumps (> 1.9x).
    DETECTION ONLY: no factor is inferred, nothing is re-based."""
    pdays_sorted = sorted(pclose)
    out = []
    for (_iss, ck), rs in runs_by_class.items():
        for p, n in zip(rs, rs[1:]):
            if not (p[2] and n[2]):
                continue
            r = n[2] / p[2]
            rr = r if r > 1 else 1 / r
            k = round(rr)
            # within 5%: the first post-split count has usually moved a little (USIO 2015 1:15 -> x14.59).
            # ⛔ A share count never FALLS 10x overnight with a continuous price except through a reverse split: a drop
            # >= 10x is a split-like gap whatever its factor (ATLX 2017 /183, GPUS 2023 /300, BESS 2025 /140 -- reverse
            # splits the ledger lacks, factors beyond the clean-factor rule).
            big_drop = r < 1 / 10
            if not big_drop and (rr < 1.9 or not (2 <= k <= 100 and abs(math.log(rr) - math.log(k)) < 0.05)):
                continue
            ds = date.fromisoformat(n[0])
            a_ = date.fromisoformat(p[1])
            i0 = bisect.bisect_left(pdays_sorted, ds)
            if i0 >= len(pdays_sorted):
                continue
            b_ = pdays_sorted[i0]
            if a_ in caps and pclose.get(a_) and pclose.get(b_):
                pr = pclose[b_] / pclose[a_]
                if abs(math.log(pr)) >= math.log(1.5):
                    # the bars may be DEFECTIVE right at the corporate action (IVT 2021-08-06: /10 for six weeks, then
                    # back): continuity is judged on the first day within 60 sessions of the new state whose price is
                    # back within 1.5x of the last pre-transition close
                    n_end = date.fromisoformat(n[1])
                    for b2 in pdays_sorted[i0:i0 + 60]:
                        if b2 > n_end:
                            break
                        if pclose.get(b2) and abs(math.log(pclose[b2] / pclose[a_])) < math.log(1.5):
                            pr = pclose[b2] / pclose[a_]
                            break
                cr = r * pr
                if abs(math.log(pr)) < math.log(1.5) and abs(math.log(cr)) > math.log(1.9):
                    out.append({"date": ds, "k": k, "direction": "FORWARD" if r > 1 else "REVERSE", "cls": ck,
                                "prev_asof": date.fromisoformat(p[4]), "next_asof": date.fromisoformat(n[4]),
                                "prev_accn": p[3], "next_accn": n[3]})
    # ⛔ a STOCK DIVIDEND IN A NEW CLASS (Google 2014-04-03: one class C share per A/B share) leaves the old class's
    # count unchanged while its adjusted price halves -- the per-class rule cannot see it. Company level: where a class
    # FIRST appears, the company cap jumping by a clean factor with the primary's price continuous is the same gap.
    firsts = {ck: rs[0] for (_iss, ck), rs in runs_by_class.items() if rs and rs[0][2]}
    if len(firsts) > 1:
        earliest = min(r[0] for r in firsts.values())
        for ck, r0 in firsts.items():
            if r0[0] == earliest:
                continue
            ds = date.fromisoformat(r0[0])
            i0 = bisect.bisect_left(pdays_sorted, ds)
            if i0 <= 0 or i0 >= len(pdays_sorted):
                continue
            b_ = pdays_sorted[i0]
            # the LAST VALUED day before the new class (Google: C's first state 2014-04-25, a held day in between)
            a_ = next((x for x in reversed(pdays_sorted[max(0, i0 - 30):i0]) if x in caps), None)
            if not (a_ and b_ in caps and pclose.get(a_) and pclose.get(b_)):
                continue
            cr, pr = caps[b_] / caps[a_], pclose[b_] / pclose[a_]
            q = cr / pr                                  # the SHARE-implied step (the price moved over the held days)
            rr = q if q > 1 else 1 / q
            k = round(rr)
            if abs(math.log(pr)) < math.log(1.5) and rr >= 1.9 and 2 <= k <= 100 and abs(math.log(rr) - math.log(k)) < 0.03:
                prev_asof = max((date.fromisoformat(x[4]) for rs in runs_by_class.values() for x in rs if x[0] < r0[0]), default=ds)
                out.append({"date": ds, "k": k, "direction": "FORWARD" if cr > 1 else "REVERSE", "cls": f"COMPANY:new class {ck}",
                            "prev_asof": prev_asof, "next_asof": date.fromisoformat(r0[4]), "prev_accn": None, "next_accn": r0[3]})
    return out


def split_ledger_gap_hold(runs_by_class: dict, pclose: dict, caps: dict):
    """The latest date D such that every capitalization BEFORE D must be withheld (a split the ledger lacks), or None."""
    g = split_ledger_gaps(runs_by_class, pclose, caps)
    return max((x["date"] for x in g), default=None)


def _runs_by_class(w: dict, issuer_id: str) -> dict:
    """This issuer's state runs from the build rows being written: {(issuer, class): [(start, end, shares, accn, as_of, src)]}."""
    out: dict = {}
    for iss, ck, s, e, sh, accn, as_of, src in w.get("state_run", []):
        if iss == issuer_id:
            out.setdefault((iss, ck), []).append((s, e, sh, accn, as_of, src))
    for v in out.values():
        v.sort()
    return out


def _authority(D):
    if D.acc is None:
        from .acceptance import Authority
        D.acc = Authority(None)
    return D.acc


class _Filing(dict):
    """A filing row whose public time is resolved through the acceptance authority only when evidence asks for it
    (an issuer can have 100k+ filings -- bank 424B2s -- of which a few hundred are share evidence)."""

    def __init__(self, D, accn: str, acc_raw, **kw):
        super().__init__(**kw)
        self._D, self._a, self._raw = D, accn, acc_raw

    def __missing__(self, k):
        if k in ("public_at", "acc_source"):
            pa, src = _authority(self._D).resolve(self._a, self._raw, self["filing_date"])
            self["public_at"], self["acc_source"] = pa.isoformat(), src
            return self[k]
        raise KeyError(k)


def _evidence_public(D, accn: str, filed: str) -> datetime:
    """An evidence filing absent from inputs.filing: its EDGAR acceptance record if known, else the END of its date."""
    hit = _authority(D).lookup(accn) if accn else None
    if hit is not None:
        from .acceptance import public_at as _pub
        return _pub(hit[0], date.fromisoformat(filed))
    return _late(filed)


@dataclass
class Data:
    inp: sqlite3.Connection
    cov: sqlite3.Connection | None
    txt: sqlite3.Connection | None
    px: sqlite3.Connection
    ref: dict = field(default_factory=dict)     # ticker -> (Ref, splits)
    ipo: sqlite3.Connection | None = None       # each text harvest mode writes its own file (no writer contention)
    econ: sqlite3.Connection | None = None
    adr: sqlite3.Connection | None = None
    acc: object = None                          # acceptance.Authority (the ONE source of evidence public times)
    prosp: sqlite3.Connection | None = None     # offering-document actual counts (prosp.db)
    splitev: sqlite3.Connection | None = None   # authoritative historical split statements (splitev.db)
    lineage: sqlite3.Connection | None = None   # successor-issuer relationships (lineage.db)
    pred: object = None                         # Data over the PREDECESSOR registrants' evidence (pure reorganizations)


def load_ref(path: str) -> dict:
    out = {}
    if not os.path.exists(path):
        return out
    for line in open(path, encoding="utf-8"):
        t, d, splits, events = json.loads(line)
        if not d:
            continue
        def dd(x):
            try:
                return date.fromisoformat(x[:10]) if x else None
            except ValueError:
                return None
        r = Ref(t, int(d["cik"]) if d.get("cik") else None, dd(d.get("list_date")), d.get("active"),
                dd(d.get("delisted_utc")), d.get("type"), d.get("composite_figi"), d.get("share_class_figi"),
                [(dd(e.get("date")), e.get("type"), (e.get("ticker_change") or {}).get("ticker")) for e in events or []],
                d.get("share_class_shares_outstanding"), d.get("weighted_shares_outstanding"), d.get("name"))
        sp = []
        for ex, frm, to in splits:
            try:
                if ex and frm and to and float(frm) > 0:
                    sp.append(Split(date.fromisoformat(ex), float(to) / float(frm)))
            except (TypeError, ValueError):
                pass
        out[t] = (r, sp)
    return out


def bars_days(px, ticker: str) -> tuple[list[date], dict]:
    rows = px.execute("SELECT d, c FROM bar WHERE ticker=? ORDER BY d", (ticker,)).fetchall()
    return [_d(d) for d, _c in rows], {_d(d): c for d, c in rows}


def filing_key_maps(cov, cik: int) -> dict:
    """{accession: {(member, label): class key}} over EVERY cover row of the filing (counts, symbols, titles) so a
    class is keyed identically wherever it appears."""
    if cov is None:
        return {}
    rows: dict = defaultdict(set)
    for accn_, mem, lab in cov.execute(
            "SELECT DISTINCT accn, member, label FROM cover_fact WHERE cik=? AND concept IN "
            "('dei:EntityCommonStockSharesOutstanding','dei:TradingSymbol','dei:Security12bTitle')", (cik,)):
        # ⛔ a listings-exchange axis member or a DEBT / preferred row (TAK's "Ordinary shares | 0.750% Senior Notes due
        # 2027" symbols) is not a share class: it turned TAK's ordinary shares into a second 'class' with no economics
        if invalid_member(mem, lab) or (mem and "EntityListingsExchange" in mem) or NOT_COMMON_EQUITY.search(lab or ""):
            continue
        rows[accn_].add((mem, lab))
    return {a_: filing_keys(sorted(v, key=str)) for a_, v in rows.items()}


# ---------------------------------------------------------------- observations
def observations(D: Data, cik: int, filings: dict) -> tuple[list[tuple], dict, list]:
    """-> ([(class_key, Obs, meta)], per-filing class sets {accn: (known_from, frozenset)}, [invalid Obs])."""
    out = []
    invalid = []
    fsets: dict = {}

    def pub(accn, filed):
        f = filings.get(accn)
        return (_ts(f["public_at"]) if f else None) or _evidence_public(D, accn, filed)

    seen = set()
    fkm = filing_key_maps(D.cov, cik)
    # 1. per-class and non-dimensional rendered covers
    if D.cov is not None:
        byacc = defaultdict(list)
        # ⛔ COMBINED FILINGS (AEP + six utility subsidiaries, one cover): the cover is a sequence of ENTITY BLOCKS,
        # each opening with dei:EntityCentralIndexKey. A share row belongs to the block it sits in; only the
        # FILER's own block is this issuer's capitalization (AEP 2011-07-29: parent 482,273,829, subsidiaries
        # 1,400,000 ... 27,952,473 -- a subsidiary was selected before this rule).
        cur_cik: dict[tuple, int | None] = {}
        has_cik_rows: dict[tuple, bool] = {}
        rows_all = D.cov.execute(
            "SELECT accn, file, member, label, concept, as_of, text, share_scale FROM cover_fact WHERE cik=? AND "
            "concept IN ('dei:EntityCommonStockSharesOutstanding','dei:EntityCentralIndexKey') ORDER BY rowid", (cik,)).fetchall()
        for accn, fil, mem, lab, concept, as_of, text, scale in rows_all:
            if concept == "dei:EntityCentralIndexKey":
                has_cik_rows[(accn, fil)] = True
        for accn, fil, mem, lab, concept, as_of, text, scale in rows_all:
            if concept == "dei:EntityCentralIndexKey":
                try:
                    cur_cik[(accn, fil)] = int(str(text).strip().lstrip("0") or 0)
                except ValueError:
                    cur_cik[(accn, fil)] = None
                continue
            if has_cik_rows.get((accn, fil)) and cur_cik.get((accn, fil)) != cik:
                continue                                    # another registrant's block in a combined filing
            if mem and "=" in mem and mem.split("=")[0] in ENTITY_AXES:
                continue                                    # another ENTITY (LegalEntityAxis), never a share class
            byacc[accn].append((mem, lab, as_of, text, scale))
        for accn, rows in byacc.items():
            f = filings.get(accn)
            if not f:
                continue
            keys = set()
            fk = fkm.get(accn) or filing_keys([(m_, l_) for m_, l_, *_r in rows if not invalid_member(m_, l_)])
            for mem, lab, as_of, text, scale in rows:
                v = cover_num(text)
                if v is None or not as_of:
                    continue
                if mem and ("EntityListingsExchange" in mem or NOT_COMMON_EQUITY.search(lab or "")):
                    continue
                if invalid_member(mem, lab):
                    # ⛔ a "$ / shares" column or an ADR-member row is not a share count of any class: never evidence
                    invalid.append(Obs(date.fromisoformat(as_of), pub(accn, f["filing_date"]), v * (scale or 1.0), R.COVER_XBRL,
                                       accn, f["form"], f"dei:EntityCommonStockSharesOutstanding[{mem}]", "INVALID", lab or ""))
                    continue
                k = fk[(mem, lab)]
                keys.add(k)
                o = Obs(date.fromisoformat(as_of), pub(accn, f["filing_date"]), v * (scale or 1.0), R.COVER_XBRL, accn,
                        f["form"], f"dei:EntityCommonStockSharesOutstanding[{mem or 'entity'}]", k)
                out.append((k, o, {}))
                seen.add((accn, k, round(o.value)))
            if keys:
                fsets[accn] = (pub(accn, f["filing_date"]), frozenset(keys))
    # 2. companyfacts non-dimensional facts
    for tag, as_of, val, accn, form, filed in D.inp.execute(
            "SELECT tag, as_of, value, accn, form, filed FROM fact WHERE cik=? AND tag IN "
            "('dei:EntityCommonStockSharesOutstanding','us-gaap:CommonStockSharesOutstanding','ifrs-full:NumberOfSharesOutstanding')",
            (cik,)):
        src = R.COVER_XBRL if tag.startswith("dei:") else R.BALANCE_SHEET_XBRL
        if src == R.COVER_XBRL and (accn, "COMMON", round(val)) in seen:
            continue
        f = filings.get(accn)
        o = Obs(date.fromisoformat(as_of), pub(accn, filed), float(val), src, accn, f["form"] if f else (form or ""), tag, "COMMON")
        out.append(("COMMON", o, {}))
        if accn not in fsets and src == R.COVER_XBRL:
            fsets[accn] = (o.public_at, frozenset({"COMMON"}))
    # 3. pre-XBRL text covers
    if D.txt is not None:
        for accn, form, fd, status, complete, cls, cnt, as_of, rule, off, snip, classes in D.txt.execute(
                "SELECT accn, form, filing_date, status, complete, class, count, as_of, rule, offset, snippet, classes "
                "FROM text_obs WHERE cik=?", (cik,)):
            f = filings.get(accn)
            p = pub(accn, fd)
            if status == "OK" and cnt:
                out.append(("COMMON", Obs(date.fromisoformat(as_of), p, cnt, R.COVER_TEXT, accn, form, f"text:{rule}@{off}",
                                          "COMMON", snip or ""), {}))
                fsets.setdefault(accn, (p, frozenset({"COMMON"})))
            elif status == "MULTI_CLASS":
                letters = frozenset(json.loads(classes or "[]"))
                if letters:
                    fsets.setdefault(accn, (p, letters))
                if complete and cls and cnt:
                    out.append((cls, Obs(date.fromisoformat(as_of), p, cnt, R.COVER_TEXT, accn, form, f"text:{rule}@{off}",
                                         cls, snip or ""), {}))
    # 4. offering documents: ACTUAL counts at a recent stated date (prospectus.py) -- never pro-forma figures
    if D.prosp is not None:
        for accn, form, fd, status, cls, cnt, as_of, rule, snip in D.prosp.execute(
                "SELECT accn, form, filing_date, status, class, count, as_of, rule, snippet FROM prosp_obs "
                "WHERE cik=? AND status IN ('OK','MULTI_CLASS') AND count IS NOT NULL", (cik,)):
            p = pub(accn, fd)
            out.append((cls or "COMMON", Obs(date.fromisoformat(as_of), p, cnt, R.OFFERING_TEXT, accn, form, f"offering:{rule}",
                                             cls or "COMMON", snip or "", "MEDIUM"), {}))
    return out, fsets, invalid


def ipo_observations(D: Data, cik: int, filings: dict, listing_start: date) -> tuple[list[tuple], str]:
    """IPO capitalization valid from the listing date, known from each prospectus's public time."""
    src = D.ipo or D.txt
    if src is None:
        return [], "NO_IPO_DATA"
    rows = src.execute("SELECT accn, form, filing_date, status, class, count, snippet FROM ipo_obs WHERE cik=? AND listing_start=?",
                         (cik, listing_start.isoformat())).fetchall()
    good = [r for r in rows if r[3] in ("OK", "MULTI_CLASS") and r[5]]
    if not good:
        return [], ("IPO_NOT_FOUND" if rows else "NO_IPO_FILINGS")
    out = []
    for accn, form, fd, status, cls, cnt, snip in good:
        if cls == "TOTAL":
            continue
        f = filings.get(accn)
        p = (_ts(f["public_at"]) if f else None) or _evidence_public(D, accn, fd)
        out.append((cls, Obs(listing_start, p, cnt, R.IPO_PROSPECTUS, accn, form, "ipo:to_be_outstanding", cls, snip or "",
                             "MEDIUM"), {}))
    return out, "OK"


def unlisted_split_events(days: list, closes: dict, ledger_splits, counts: list | None = None) -> list[tuple]:
    """Split-LIKE one-day price steps the split ledger does not explain: the close moves by a clean factor k or 1/k
    (k = 2..100, within 3%) with no ledger split within 7 days.

    ⛔ MEASURED 2026-10-02 (trial build): a price step alone is a GLITCH far more often than a split -- of 1,904
    decidable steps 1,445 had a CONTINUOUS share count on both sides (ASB's one-day x16..x65 ticks), 42 had the share
    count move by the inverse factor. So with `counts` [(as_of, shares)] a step is an event only when the authoritative
    counts on either side CONFIRM it (next / previous within 30% of 1/step). The event only WITHHOLDS the days between
    the step and the next count; no factor is ever inferred and nothing is re-based."""
    out = []
    ex = [s_.ex_date for s_ in ledger_splits]
    for a_, b_ in zip(days, days[1:]):
        ca, cb = closes.get(a_), closes.get(b_)
        if not ca or not cb or ca <= 0 or cb <= 0:
            continue
        r = cb / ca
        rr = r if r > 1 else 1 / r
        if rr < 1.9:
            continue
        k = round(rr)
        if not (2 <= k <= 100 and abs(rr / k - 1) < 0.03):
            continue
        if any(abs((e - b_).days) <= 7 for e in ex):
            continue
        if counts is not None:
            before = [v for a_d, v in counts if a_d < b_]
            after = [v for a_d, v in counts if a_d >= b_]
            if not (before and after and before[-1] > 0 and after[0] > 0
                    and abs(math.log(after[0] / before[-1]) + math.log(r)) < math.log(1.3)):
                continue
        out.append((b_, R.UNLISTED_SPLIT_SUSPECTED))
    return out


# ---------------------------------------------------------------- per issuer
def build_issuer(D: Data, cik: int, build_id: str, w, extra_splits: list | None = None) -> dict:
    iss = D.inp.execute("SELECT name, tickers_json, exchanges_json FROM issuer WHERE cik=?", (cik,)).fetchone()
    tickers = json.loads(iss[1] or "[]")
    # ⛔ public times come ONLY from the acceptance authority (submissions' acceptanceDateTime can be Eastern labelled
    # UTC -- a one-day lookahead at the daily close). See acceptance.py.
    filings = {}
    for a, f, fd, acc_raw, rd in D.inp.execute("SELECT accn, form, filing_date, accepted, report_date FROM filing WHERE cik=?", (cik,)):
        filings[a] = _Filing(D, a, acc_raw, form=f, filing_date=fd, report_date=rd)
    foreign = any(v["form"] in FPI_FORMS for v in filings.values())
    first_filing = min((date.fromisoformat(v["filing_date"]) for v in filings.values()), default=None)
    edgar = EDGAR_FOREIGN if foreign else EDGAR_DOMESTIC
    issuer_id = f"cik:{cik}"

    # identity: every equity ticker with bars
    listings, bars, decisions = {}, {}, {}
    for t in tickers:
        ref, sp = D.ref.get(t, (None, []))
        if ref is not None and (ref.type not in EQUITY_TYPES or NOT_COMMON_EQUITY.search(ref.name or "")):
            continue
        days, closes = bars_days(D.px, t.replace(".", "-"))
        if not days:
            continue
        dec = decide(t, cik, days, ref, first_filing, foreign)
        if dec is None:
            continue
        listings[t], bars[t], decisions[t] = dec.listing, (days, closes), dec
        w["ticker_map"].append((t, cik, None, dec.listing.start.isoformat(), dec.listing.end.isoformat() if dec.listing.end else None,
                                dec.basis, dec.pre_reason, dec.pre_bars, json.dumps(dec.notes)))
    if not listings:
        return {"cik": cik, "status": "NO_PRICED_TICKER"}
    primary = next(t for t in tickers if t in listings)

    obs, fsets, invalid_obs = observations(D, cik, filings)
    for o in invalid_obs:
        w["observation"].append((None, issuer_id, None, "INVALID", o.as_of.isoformat(), o.public_at.isoformat(), o.known_from.isoformat(),
                                 o.value, None, "not shares", None, None, o.source, o.accn, o.form, o.tag, o.snippet[:400], o.rank,
                                 R.REJ_INVALID_UNIT, "[]", o.confidence, "invalid unit / ADR-member row", build_id))
    ipo_status = "NOT_APPLICABLE"
    lstart = min(l.start for l in listings.values())
    if lstart >= edgar and (first_filing is None or lstart >= first_filing):
        io, ipo_status = ipo_observations(D, cik, filings, lstart)
        obs += io

    # ⭐ SUCCESSOR-ISSUER LINEAGE (owner decision C, lineage.py). Bars before the successor's effective date belong to
    # the PREDECESSOR. A proven PURE reorganization (one predecessor by file number, 1:1 conversion, same assets /
    # proportional ownership, no merger) carries the predecessor's own evidence up to the effective date; a merger /
    # spin-off / new entity is a BOUNDARY; anything else is unresolved and held. Never stitched by ticker or name.
    lin = None
    if D.lineage is not None:
        lin = D.lineage.execute("SELECT kind, status, effective, pred_cik, accn, each_class, ratio FROM lineage WHERE succ_cik=? "
                                "AND effective IS NOT NULL ORDER BY effective LIMIT 1", (cik,)).fetchone()
    lin_eff = date.fromisoformat(lin[2]) if lin else None
    # own history = periodic filings at least a YEAR before the effective date (MDU since 1994); one 10-Q filed by the
    # new holding company 20 days before the effective date (Eaton plc 2012-11-14) is not a history
    if lin and any(v["form"] in ("10-K", "10-Q", "20-F", "40-F", "10-K405", "10-KSB", "10-QSB")
                   and v["filing_date"] < (date.fromisoformat(lin[2]) - timedelta(days=365)).isoformat() for v in filings.values()) \
            and own_counts_continuous(obs, date.fromisoformat(lin[2]), Ledger(D.ref.get(primary, (None, []))[1]).factor_after):
        # the successor's OWN registrant record already carries periodic evidence before the effective date (the new
        # holding company kept the CIK: MDU 2019, O-I 2019, FirstCash 2021): nothing to stitch, nothing to bound
        w["lineage_applied"].append((cik, lin[0], "OWN_REGISTRANT_HISTORY", lin[2], None, lin[4], 0, "own periodic filings before effective"))
        lin = None
    lin_reason, lin_note, pred_cik_used = None, "", None
    pred_listed_rows = []
    if lin:
        kind, lstatus, _e, pred_cik, laccn, each_cls, lratio = lin
        if kind == "PURE_REORGANIZATION" and lstatus == "OK" and pred_cik and lratio == 1.0:
            pf = {}
            if D.pred is not None:
                for a, f, fd, acc_raw, rd in D.pred.inp.execute(
                        "SELECT accn, form, filing_date, accepted, report_date FROM filing WHERE cik=?", (pred_cik,)):
                    pf[a] = _Filing(D, a, acc_raw, form=f, filing_date=fd, report_date=rd)
            if not pf:
                lin_reason, lin_note = R.SUCCESSOR_UNRESOLVED, f"predecessor {pred_cik} evidence not staged"
            else:
                pobs, pfsets, _pinv = observations(D.pred, pred_cik, pf)
                pobs = [(k_, o_, m_) for k_, o_, m_ in pobs if o_.as_of < lin_eff]
                pfsets = {a_: v for a_, v in pfsets.items() if v[0].astimezone(ET).date() < lin_eff}
                obs = [(k_, o_, m_) for k_, o_, m_ in obs if o_.as_of >= lin_eff]
                if any(len(v[1]) > 1 for v in pfsets.values()) and not each_cls:
                    lin_reason, lin_note = R.SUCCESSOR_UNRESOLVED, "multi-class predecessor without a class-for-class conversion statement"
                else:
                    obs += pobs
                    fsets.update({f"pred:{a_}": v for a_, v in pfsets.items()})
                    pred_cik_used = pred_cik
                    lin_note = f"predecessor {pred_cik}: {len(pobs)} observations before {lin_eff}"
                    if D.pred.cov is not None:
                        pfk = filing_key_maps(D.pred.cov, pred_cik)
                        for accn_, mem, lab, text in D.pred.cov.execute(
                                "SELECT accn, member, label, text FROM cover_fact WHERE cik=? AND concept='dei:TradingSymbol'", (pred_cik,)):
                            if not invalid_member(mem, lab):
                                pred_listed_rows.append((pfk.get(accn_, {}).get((mem, lab)) or class_key(mem, lab), text))
        elif kind in ("MERGER", "SPINOFF", "NEW_ENTITY"):
            lin_reason, lin_note = R.PREDECESSOR_DIFFERENT_ENTITY, f"{kind} ({laccn})"
        else:
            lin_reason, lin_note = R.SUCCESSOR_UNRESOLVED, f"{kind}/{lstatus} ({laccn})"
        if lin_reason:
            # ⛔ the successor's OWN counts dated before the effective date are a pre-closing SHELL's ("5 shares" ICE
            # 2013, "1,000 shares" RBBN 2017): never the listed security's capitalization
            obs = [(k_, o_, m_) for k_, o_, m_ in obs if o_.as_of >= lin_eff]

    # listed class map (letter -> ticker)
    listed: dict = {}
    if D.cov is not None:
        sym_rows = D.cov.execute(
            "SELECT accn, member, label, concept, text FROM cover_fact WHERE cik=? AND concept IN ('dei:TradingSymbol','dei:Security12bTitle') "
            "ORDER BY accn DESC", (cik,)).fetchall()                # the LATEST filing's class -> symbol mapping wins
        fk_by_accn = filing_key_maps(D.cov, cik)
        for accn_, mem, lab, concept, text in sym_rows:
            if invalid_member(mem, lab) or (mem and "EntityListingsExchange" in mem) or NOT_COMMON_EQUITY.search(lab or ""):
                continue
            k = fk_by_accn.get(accn_, {}).get((mem, lab)) or class_key(mem, lab)
            if concept == "dei:TradingSymbol":
                # ⛔ 2009-2012 XBRL tagged the FILER's lowercase entity symbol ("rusha", "hov", "unf") under EVERY class
                # context: it is not a class's exchange listing (anomaly G: class B priced at the class A ticker)
                if not text or text.strip() == text.strip().lower():
                    continue
                sym = text.strip().upper().replace(".", "-")
                for t in listings:
                    if t.upper().replace(".", "-") == sym:
                        listed.setdefault(k, t)
    for k_, text in pred_listed_rows:                    # the predecessor's symbols, never overriding the successor's
        if not text or text.strip() == text.strip().lower():
            continue
        sym = text.strip().upper().replace(".", "-")
        for t in listings:
            if t.upper().replace(".", "-") == sym:
                listed.setdefault(k_, t)
    for t in listings:                                   # BRK-A / BRK-B style suffixes
        L = ticker_letter(t)
        if L:
            listed.setdefault(L, t)
    if "COMMON" in listed and len(listings) == 1:
        pass
    # default-section symbol + 12(b) title naming the class (META: symbol META, title "Class A Common Stock")
    if D.cov is not None and "COMMON" in listed:
        titles = [x for (x,) in D.cov.execute("SELECT text FROM cover_fact WHERE cik=? AND member IS NULL AND concept='dei:Security12bTitle'", (cik,))]
        import re as _re
        letters = {m.group(1).upper() for t_ in titles for m in [_re.search(r"\bclass\s+([a-z])\b", t_, _re.I)] if m}
        if len(letters) == 1:
            listed.setdefault(next(iter(letters)), listed["COMMON"])

    # regimes from per-filing class sets (ordered by knowledge time)
    seq = sorted(fsets.values(), key=lambda x: x[0])
    regimes = []
    for p, ks in seq:
        ks = frozenset(k for k in ks if k != "COMMON") or frozenset({"COMMON"}) if len(ks) > 1 else ks
        if not regimes or regimes[-1][1] != ks:
            regimes.append([p, ks, p])
        else:
            regimes[-1][2] = p
    if not regimes:
        regimes = [[datetime(1900, 1, 1, tzinfo=timezone.utc), frozenset({"COMMON"}), None]]

    # class economics: every parsed annual report, chosen PER REGIME (time-aware)
    econs = []
    if (D.econ or D.txt) is not None:
        for accn, fd, res in (D.econ or D.txt).execute("SELECT accn, filing_date, result FROM econ WHERE cik=? ORDER BY filing_date", (cik,)):
            j = json.loads(res)
            if j.get("status") == "NO_FILE":
                continue
            econs.append((fd, accn, ClassEcon({k: tuple(v) for k, v in j["conversions"].items()},
                                              {k: tuple(v) for k, v in j["convertible_no_ratio"].items()},
                                              [(frozenset(c), s_) for c, s_ in j["equal_rights"]], j["voting_only"],
                                              j["not_convertible"], j["complex"])))
    if pred_cik_used and D.pred is not None and D.pred.econ is not None:
        for accn, fd, res in D.pred.econ.execute("SELECT accn, filing_date, result FROM econ WHERE cik=? AND filing_date < ? ORDER BY filing_date",
                                                 (pred_cik_used, lin_eff.isoformat())):
            j = json.loads(res)
            if j.get("status") == "NO_FILE":
                continue
            econs.append((fd, accn, ClassEcon({k: tuple(v) for k, v in j["conversions"].items()},
                                              {k: tuple(v) for k, v in j["convertible_no_ratio"].items()},
                                              [(frozenset(c), s_) for c, s_ in j["equal_rights"]], j["voting_only"],
                                              j["not_convertible"], j["complex"])))
        econs.sort(key=lambda e: e[0])
    annual = sorted((v["filing_date"], a) for a, v in filings.items() if v["form"] in ("10-K", "10-K405", "20-F", "40-F", "10-KT"))

    def econ_for(lo: date, hi: date):
        """The latest parsed annual report filed inside the regime (+400 days: the report describing its last year),
        else the nearest parsed one before it; also the annual report the regime WANTS (for the econ harvest)."""
        lo_s, hi_s = lo.isoformat(), (hi + timedelta(days=400)).isoformat()
        inside = [e for e in econs if lo_s <= e[0] <= hi_s]
        want = [a for fd, a in annual if lo_s <= fd <= hi_s]
        pick = inside[-1] if inside else next((e for e in reversed(econs) if e[0] <= hi_s), None)
        return (pick[2], pick[1]) if pick else (None, ""), (want[-1] if want else (annual[-1][1] if annual else None))

    # ADR: ordinary shares -> ADS-equivalent
    ptype = D.ref.get(primary, (None, []))[0]
    is_adr = bool(ptype and ptype.type in ("ADRC", "ADRS"))
    ratio_stmts = []
    if (D.adr or D.txt) is not None:
        for accn, fd, st, ratio, snip in (D.adr or D.txt).execute("SELECT accn, filing_date, status, ratio, snippet FROM adr_ratio WHERE cik=?", (cik,)):
            if st == "OK" and ratio:
                ratio_stmts.append(RatioStatement(date.fromisoformat(fd), ratio, accn, snip or ""))
    titled: dict = {}
    if D.cov is not None:
        from .adr import parse_ratio
        for accn, text in D.cov.execute("SELECT accn, text FROM cover_fact WHERE cik=? AND concept='dei:Security12bTitle'", (cik,)):
            if accn not in filings:
                continue
            fdate = date.fromisoformat(filings[accn]["filing_date"])
            titled[fdate] = titled.get(fdate, False) or ads_title(text)
            v, st, snip = parse_ratio(text)
            if st == "OK":
                is_adr = True
                ratio_stmts.append(RatioStatement(fdate, v, accn, snip))
    # ⭐ the listed security is an ADS only while the filings' 12(b) titles say so (issuer-level evidence before the
    # first titled filing); a count is converted to ADS-equivalents only for those periods
    # ⛔ FOREIGN -> DOMESTIC FORM SWITCH (RCEL: 20-F with "ADS, each representing 20 ordinary shares" in 2019; from
    # 2020-08 10-K/10-Q of a redomiciled US common stock -- every count was divided by 20 until a 2026 title). A 12(b)
    # title filed before the switch does not speak after it: the first title filed AFTER the switch decides from the
    # switch on; with none, the ADS status after the switch is unresolved (withheld).
    titled, ads_unresolved_from = ads_after_form_switch(
        [(date.fromisoformat(v["filing_date"]), v["form"]) for v in filings.values()], titled, is_adr)
    ads_at = ads_listed_fn(list(titled.items()), is_adr)
    ads_changes = ads_transitions(list(titled.items()))

    # multi-class SUSPECT: never price a non-dimensional (possibly all-class) total at one class's price
    pref = D.ref.get(primary, (None, []))[0]
    diverge = bool(pref and pref.share_class_shares and pref.weighted_shares
                   and abs(pref.share_class_shares / pref.weighted_shares - 1) > 0.05)
    # ⛔ Massive's WEIGHTED figure is a stale period average (APH: 2.47B weighted vs 1.23B current after its 2024 2:1
    # split): weighted vs share-class divergence flagged 207 single-class issuers as multi-class suspects (2026-10-01).
    # The divergence counts only if Massive's CURRENT share-class figure also disagrees (> 5%) with OUR latest
    # authoritative non-dimensional count -- equal means the total IS that one class. (Detection only, never a value.)
    if diverge and pref.share_class_shares:
        latest = max(((o.as_of, o.value) for k_, o, _m in obs if k_ == "COMMON"
                      and o.source in (R.COVER_XBRL, R.BALANCE_SHEET_XBRL) and o.value > 0), default=None)
        if latest and abs(latest[1] / pref.share_class_shares - 1) <= 0.05:
            diverge = False
    multi_suspect = not is_adr and (len(listings) >= 2 or diverge)

    # per regime: structure, component class states, capitalization
    all_days = sorted({d for t in listings for d in bars[t][0]})
    day_regime = {}
    ri = 0
    for d in all_days:
        while ri + 1 < len(regimes) and regimes[ri + 1][0].astimezone(ET).date() <= d:
            ri += 1
        day_regime[d] = ri

    caps: dict = {}
    reasons_by_day: dict = {}
    struct_summary = []
    obs_rows_written = set()
    ledger_unresolved: list = []          # ledger splits the counts neither confirm nor contradict (all regimes)
    price_splices: list = []              # price-only factors carried back to a bar splice
    ledgers_used: list = []               # (kind, Ledger) per class, for the post-state evidence check
    for ri, (p0, ks, p1) in enumerate(regimes):
        rdays = [d for d in all_days if day_regime[d] == ri]
        if not rdays:
            continue
        maxn = defaultdict(float)
        for k, o, _m in obs:
            if k in ks:
                maxn[k] = max(maxn[k], o.value)
        classes = {k: maxn.get(k, 0.0) for k in ks}
        if ks == frozenset({"COMMON"}):
            classes = {"COMMON": 1.0}
            lmap = {"COMMON": primary}
        else:
            lmap = {k: v for k, v in listed.items() if k in ks}
        (econ, econ_accn), wanted = econ_for(rdays[0], rdays[-1])
        if ks != frozenset({"COMMON"}) and wanted:
            w["econ_request"].append((cik, wanted, rdays[0].isoformat(), rdays[-1].isoformat()))
        res = resolve(classes, lmap, econ, econ_accn)
        st = res.structure
        # ⛔ a COMMON-only regime BETWEEN multi-class regimes is a filing that reported only one class's count without
        # a class dimension (ZDGE 2021-11: class A's 524,775 priced at the class B ticker) -- never a single class
        sandwiched = ks == frozenset({"COMMON"}) and any(len(x[1]) > 1 for x in regimes[:ri]) and any(len(x[1]) > 1 for x in regimes[ri + 1:])
        if sandwiched:
            res = resolve({"COMMON": 1.0, "?": 1.0}, {}, None)
            st = Structure("UNRESOLVED", reason=R.MULTI_CLASS, note="common-only report between multi-class regimes")
        if ks == frozenset({"COMMON"}) and multi_suspect:
            st = Structure("UNRESOLVED", reason=R.MULTI_CLASS,
                           note=f"multi-class suspect ({len(listings)} equity tickers, share-class/total divergence={diverge}): "
                                "per-class evidence required for this period")
        regime_ads = any(ads_at(d) for d in (rdays[0], rdays[-1])) or any(rdays[0] <= t_ <= rdays[-1] for t_ in ads_changes)
        if regime_ads and st.kind in ("MULTI_LISTED", "LISTED_PLUS_CONVERTIBLE"):
            # ⛔ an ADS over SEVERAL ordinary classes (BMA, CCM, FENG, TIGR, ZEPP ... priced every class at the ADS
            # price, 10-48x high): which classes the ADS represents and at what ratio is not established -> refused
            st = Structure("UNRESOLVED", reason=R.FOREIGN_MULTI_CLASS,
                           note=f"ADS-listed issuer with classes {sorted(ks)}: ADS-to-class relationship not established")
        if regime_ads and st.kind == "SINGLE":
            st = Structure("ADR", st.components, note="ADS-equivalent shares")
        struct_summary.append(st.kind if st.kind != "UNRESOLVED" else f"UNRESOLVED:{st.reason}")
        w["regime"].append((issuer_id, rdays[0].isoformat(), rdays[-1].isoformat(), json.dumps(sorted(ks)), st.kind, st.reason,
                            st.note, json.dumps([(c.class_key, c.price_ticker, c.multiplier(rdays[-1]), c.evidence[:300]) for c in st.components])))
        for c in st.components:
            w["security"].append((f"{issuer_id}:{c.class_key}", issuer_id, cik, c.class_key,
                                  "LISTED" if c.evidence == "listed" or st.kind in ("SINGLE", "ADR") else "CONVERTIBLE",
                                  c.price_ticker, c.multiplier(rdays[-1]), rdays[0].isoformat(), rdays[-1].isoformat(), c.evidence[:500]))
        states = {}
        if st.kind != "UNRESOLVED":
            for c in st.components:
                ref_c = D.ref.get(c.price_ticker, (None, []))
                lst = listings[c.price_ticker]
                cdays_all, ccloses = bars[c.price_ticker]
                # ⛔ only splits the PRICES reflect: a split after the last bar (KUST 1:10 on 2026-10-01, bars end
                # 09-29) was applied to the shares but not to the prices -> cap 10x low
                cand_splits = [s_ for s_ in ref_c[1] if lst.start <= s_.ex_date <= cdays_all[-1]]
                # ⛔ a ledger split dated INSIDE a > 90-day break in the bars (ALT 2007-07-25 1:50: the last bar of the
                # SPAC is 07-24, the next one 2008-05): whether the bars before the break carry it cannot be seen
                for s_ in cand_splits:
                    i_ = bisect.bisect_left(cdays_all, s_.ex_date)
                    if split_in_trading_break(cdays_all, s_.ex_date):
                        ledger_unresolved.append(s_.ex_date)
                        w["split_gap"].append((cik, s_.ex_date.isoformat(), None, "LEDGER", c.class_key, None, None,
                                               "HELD_LEDGER_SPLIT_IN_TRADING_BREAK", s_.ex_date.isoformat(), s_.ratio,
                                               "LEDGER", None, f"bars {cdays_all[i_ - 1]} -> {cdays_all[i_]}"))
                cobs_raw = [o for k, o, _m in obs if k == c.class_key and o.value > 0]
                kept_splits = []
                for s_ in cand_splits:
                    # ⛔ INVA 2013: the ticker's ledger lists a 1:100 split on 2013-06-17 while Theravance's own counts
                    # went 99.45M (2013-04-25, published 05-02) -> 100.77M (2013-06-30): the split did not happen to
                    # this issuer's shares. A split is dropped when the last count dated AND published before it and the
                    # first count dated on/after it agree within 1.5x although the factor is >= 2x.
                    pre = [o for o in cobs_raw if o.as_of < s_.ex_date and o.known_from <= s_.ex_date]
                    post = [o for o in cobs_raw if o.as_of >= s_.ex_date]
                    # (never for an ADS: an ADS ratio change leaves the ORDINARY count unchanged by design)
                    if st.kind != "ADR" and pre and post and abs(math.log(s_.ratio)) >= math.log(2):
                        a0 = max(pre, key=lambda o: o.as_of).value
                        b0 = min(post, key=lambda o: o.as_of).value
                        # ...unless the issuer RESTATED a pre-split date by exactly that factor after the split (CTNT:
                        # its 2025-12-31 balance sheet, 3,418,587 when first filed, re-filed as 17,096 after the 2026
                        # 1-for-200): the split happened; post-split issuance merely offset it
                        restated = any(x.as_of == y.as_of and x.as_of < s_.ex_date and x.known_from <= s_.ex_date < y.known_from
                                       and x.value > 0 and y.value > 0 and abs(math.log(y.value / x.value) - math.log(s_.ratio)) < 0.05
                                       for _k1, x, _m1 in obs for _k2, y, _m2 in obs if _k1 == _k2)
                        if restated or abs(math.log(b0 / a0)) >= math.log(1.5):
                            verdict = "CONFIRMED"
                        elif clean_factor(s_.ratio):
                            step_ = _px_step(s_, cdays_all, ccloses)
                            if step_ and abs(math.log(step_ / s_.ratio)) < abs(math.log(step_)):
                                # the count did not move and the ADJUSTED price steps by the factor: the bars carry a
                                # split the shares did not undergo (ASPS 2025 2.0: x2.336). Units must cancel -> applied
                                verdict = "CONFIRMED"
                            else:
                                verdict = ledger_split_verdict(s_, cobs_raw)
                            if verdict == "UNRESOLVED" and issuer_states_split(D, cik, s_):
                                # the issuer's OWN filings state this split (JAGX: XBRL 1-for-35 "0.0285", 2026): the
                                # counts around it are far apart and the issuance between them offset it
                                verdict = "CONFIRMED"
                        else:
                            # a PRICE-ONLY factor (spin-off / distribution) never moves the count; whether the bars
                            # carry it is visible in the PRICE: a real distribution drops the raw close by ~1/factor, so
                            # bars that carry it are continuous at the ex date (EBAY 2015 x2.376: 1.024) and bars that
                            # do not show the drop
                            verdict = price_only_verdict(s_, cdays_all, ccloses)
                            sp_ = price_splice_before(s_, cdays_all, ccloses) if verdict == "CONFIRMED" else None
                            if sp_ is not None:
                                price_splices.append(sp_)
                                w["split_gap"].append((cik, sp_.isoformat(), None, "PRICE_SPLICE", c.class_key, None, None,
                                                       "HELD_PRICE_SPLICE", s_.ex_date.isoformat(), s_.ratio, "LEDGER",
                                                       None, f"price-only factor {s_.ratio:g} carried back to a one-session "
                                                             f"step on {sp_}"))
                        if verdict == "CONTRADICTED":
                            w["split_gap"].append((cik, s_.ex_date.isoformat(), None, "LEDGER", c.class_key, None, None,
                                                   "LEDGER_SPLIT_CONTRADICTED", s_.ex_date.isoformat(), s_.ratio, "LEDGER",
                                                   None, f"raw {a0:.0f} -> {b0:.0f}"))
                            continue
                        if verdict == "UNRESOLVED":
                            # the counts neither confirm nor contemporaneously contradict it: the ledger (= the price
                            # basis) is kept and every earlier day is withheld
                            ledger_unresolved.append(s_.ex_date)
                            w["split_gap"].append((cik, s_.ex_date.isoformat(), None, "LEDGER", c.class_key, None, None,
                                                   "HELD_LEDGER_SPLIT_UNRESOLVED", s_.ex_date.isoformat(), s_.ratio, "LEDGER",
                                                   None, f"raw {a0:.0f} -> {b0:.0f}; no contemporaneous count on either side"))
                    kept_splits.append(s_)
                extra_c = [s_ for s_ in (extra_splits or []) if s_.ex_date <= cdays_all[-1]]
                ledger = Ledger(merge_evidence_splits(kept_splits, extra_c))
                ledgers_used.append((st.kind, ledger, cand_splits))
                cobs = [o for k, o, _m in obs if k == c.class_key]
                pre_listing = []
                if lst.start:
                    # ⛔ a count dated before this security began trading describes a capitalization that the listing
                    # itself may have changed (ELVR: Sayona's 11.5B pre-merger ordinary shares carried onto the post-
                    # merger, post-consolidation Elevra ADS -> 60x). Only the IPO prospectus speaks for the listing.
                    pre_listing = [o for o in cobs if o.as_of < lst.start and o.source != R.IPO_PROSPECTUS]
                    cobs = [o for o in cobs if not (o.as_of < lst.start and o.source != R.IPO_PROSPECTUS)]
                blocked = []
                trade_breaks = [d2 for d1, d2 in zip(cdays_all, cdays_all[1:]) if (d2 - d1).days > 90]
                if st.kind == "ADR":
                    ord_points = sorted((o.as_of, o.value * ledger.factor_after(o.as_of)) for o in cobs)
                    # ⛔ a ratio statement speaks for the ADS program of THIS listing (registered up to 120 days before
                    # it trades): LATAM's 2023 statements (1 ADS = 1 share, the pre-bankruptcy program, delisted 2020)
                    # were applied to the 2025 re-listed ADS of 2,000 shares -> cap 2,000x
                    # the stale-title test compares RAW ordinary counts: a pass-through split (SONY 5:1, 2024) moves the
                    # raw count by the ADS event's factor; a ratio change (SQNS) does not
                    ord_raw = sorted((o.as_of, o.value) for o in cobs)
                    stmts = valid_statements([s_ for s_ in ratio_stmts if s_.as_of >= lst.start - timedelta(days=120)],
                                             ledger, ord_raw)
                    conv = []
                    adr_type = bool(ptype and ptype.type in ("ADRC", "ADRS"))
                    for o in cobs:
                        if not ads_at(o.known_from) and not adr_type:
                            conv.append(o)                      # the listed security is not an ADS at this time
                            continue
                        # ⛔ a count is on the basis of the filing that reports it: when that filing states the ADS ratio
                        # itself, it is that ratio (ATHM: the 20-F filed 2021-03-02 reports 479M ordinary shares as of
                        # 2020-12-31 AFTER the 4:1 subdivision and titles "each ADS representing four ordinary shares";
                        # the 2020 title "one ordinary share" made the state 4x for a year)
                        rs = next((st_ for st_ in stmts if st_.accn == o.accn), None) or \
                            ratio_at(o.as_of, stmts, ledger, o.value * ledger.factor_after(o.as_of), ord_points, trade_breaks)
                        if rs is None:
                            # a NEWER count we cannot convert still supersedes the older state: it BLOCKS
                            blocked.append(Checked(o, "REJECTED_ADR_RATIO_UNRESOLVED", note="no ADS ratio valid at as-of",
                                                   block=(o.known_from, None, R.ADR_RATIO)))
                            continue
                        conv.append(Obs(o.as_of, o.public_at, o.value / rs.ords_per_ads, o.source, o.accn, o.form,
                                        o.tag + f"/ADS{rs.ords_per_ads:g}@{rs.accn}", o.class_key, o.snippet, o.confidence))
                    cobs = conv
                listed_c = c.evidence == "listed" or st.kind in ("SINGLE", "ADR")
                checked = validate(cobs, ledger, min_listed=LISTED_MINIMUM_SHARES if listed_c else 0) + blocked
                for o in pre_listing:
                    checked.append(Checked(o, R.REJ_PRE_LISTING, note=f"as-of before listing start {lst.start}"))
                cdays = [d for d in rdays if d in ccloses]
                # corporate actions across which a count dated BEFORE them is never carried
                # a count dated before a reverse split is carried across it UNLESS share issuance was registered
                # between the count and the split (an equity offering / registration: the hyper-diluter pattern of the
                # 63 blockers -- PAVS, INLF, HKIT ... -- never GE's 2021 1-for-8 with a current count)
                offer_days = sorted(date.fromisoformat(v["filing_date"]) for v in filings.values() if v["form"] in OFFERING_FORMS)
                events = []
                for s_ in ledger.splits:
                    if s_.ratio < 1:
                        last_off = next((x for x in reversed(offer_days) if x <= s_.ex_date), None)
                        if last_off is not None:
                            events.append((s_.ex_date, R.REVERSE_SPLIT_RECOUNT, last_off))
                counts_ = sorted((ch.obs.as_of, ch.obs.value) for ch in checked if ch.usable and "REDUNDANT" not in ch.flags)
                events += unlisted_split_events(cdays_all, ccloses, ref_c[1], counts_)
                if st.kind == "ADR":
                    events += [(t_, R.ADR_RATIO) for t_ in ads_changes] + [(b_, R.ADR_RATIO) for b_ in trade_breaks]
                else:
                    # ⛔ a count is never carried across a > 90-day break in trading: the security that resumes is a
                    # reorganized / relisted capitalization (LEA: delisted 2009-07-01 in Chapter 11, the NEW common
                    # began trading 2009-11-20 -- the cancelled 77.4M pre-petition shares were carried onto it)
                    events += [(b_, R.RELISTING_RECOUNT) for b_ in trade_breaks]
                # ⛔ REGISTERED ISSUANCE that dwarfs the state in force (ZBAO 2026: F-1s registering the resale of up to
                # 414,275,709 Class A shares while the last count was 16.2M): the state is superseded by authoritative
                # evidence of issuance -> withheld from the registration's public close until a newer count (never an
                # estimate). Only registrations >= 3x the state; large issuers never register 3x their count.
                if D.prosp is not None and st.kind != "ADR":
                    usable_ = [ch for ch in checked if ch.usable and "REDUNDANT" not in ch.flags and ch.effective_from]
                    for raccn, rfd, rcls, rcnt in D.prosp.execute(
                            "SELECT accn, filing_date, class, count FROM prosp_obs WHERE cik=? AND status='REGISTERED' AND count IS NOT NULL",
                            (cik,)):
                        if (rcls or "COMMON") != c.class_key:
                            continue
                        f_ = filings.get(raccn)
                        kd = Obs(date.fromisoformat(rfd), _ts(f_["public_at"]) if f_ else _evidence_public(D, raccn, rfd), 1.0,
                                 R.OFFERING_TEXT, raccn, "").known_from
                        cur_ = max((ch for ch in usable_ if ch.effective_from <= kd and (ch.valid_until is None or ch.valid_until > kd)),
                                   key=lambda ch: (ch.obs.as_of, -ch.obs.rank, ch.obs.public_at), default=None)
                        if cur_ and cur_.normalized and rcnt * ledger.factor_after(date.fromisoformat(rfd)) >= 3 * cur_.normalized:
                            events.append((kd, R.ISSUANCE_EXCEEDS_STATE, kd))
                tl = timeline(checked, cdays, edgar, events=events)
                states[c.class_key] = dict(zip(cdays, tl))
                for ch in checked:
                    key = (c.class_key, ch.obs.accn, ch.obs.as_of, ch.obs.source, ch.obs.value)
                    if key in obs_rows_written:
                        continue
                    obs_rows_written.add(key)
                    w["observation"].append((None, issuer_id, f"{issuer_id}:{c.class_key}", c.class_key, ch.obs.as_of.isoformat(),
                                             ch.obs.public_at.isoformat(), ch.obs.known_from.isoformat(), ch.obs.value, ch.normalized,
                                             "shares" if st.kind != "ADR" else "ADS-equivalent", ch.basis, None, ch.obs.source,
                                             ch.obs.accn, ch.obs.form, ch.obs.tag, ch.obs.snippet[:400], ch.obs.rank, ch.status,
                                             json.dumps(ch.flags), ch.obs.confidence, ch.note[:300], build_id))
                # state runs
                run = None
                for d, s in zip(cdays, tl):
                    k = (s.value, s.obs.accn if s.obs else None) if s.value is not None else None
                    if run and run[0] == k:
                        run[2] = d
                    else:
                        if run and run[0]:
                            w["state_run"].append((issuer_id, c.class_key, run[1].isoformat(), run[2].isoformat(), run[0][0], run[0][1],
                                                   run[3].as_of.isoformat(), run[3].source))
                        run = [k, d, d, s.obs]
                if run and run[0]:
                    w["state_run"].append((issuer_id, c.class_key, run[1].isoformat(), run[2].isoformat(), run[0][0], run[0][1],
                                           run[3].as_of.isoformat(), run[3].source))
        closes = {t: bars[t][1] for t in listings}
        pdays = [d for d in rdays if d in bars[primary][1]]
        for cd in company_cap(pdays, st, states, closes, listings, primary):
            if cd.value is not None:
                caps[cd.d] = cd.value
            else:
                reasons_by_day[cd.d] = cd.reason

    # pre-listing / reuse days of the PRIMARY ticker, before its first regime day, and IPO-window refinement
    pdays_all, _ = bars[primary]
    for d in pdays_all:
        if d not in caps and d not in reasons_by_day:
            reasons_by_day[d] = R.BUG
    lst = listings[primary]
    first_val = min(caps) if caps else None
    for d in pdays_all:
        if d in reasons_by_day and reasons_by_day[d] in (R.PRE_FIRST,) and d >= lst.start and first_val and d < first_val:
            if ipo_status != "NOT_APPLICABLE" and (d - lst.start).days < 200:
                reasons_by_day[d] = R.IPO_UNRESOLVED
    # ⛔ SPLIT-LEDGER GAP HOLD (fail closed). The bars are adjusted for splits the Massive split ledger does not list
    # (MEASURED: ABT 1998, AMAT 1995/1998/2002, MSFT pre-2003, KO 1992/1996, BXMT 2013 1:10): share states before such
    # a split stay on the OLD basis while prices are on today's -> the cap is k x wrong for every earlier day. Signature:
    # consecutive states whose ratio is a clean split factor k or 1/k (2..100), the primary's adjusted price
    # CONTINUOUS across the transition and the cap jumping. No factor is inferred: every earlier day is withheld
    # (CORPORATE_ACTION_HOLD) until authoritative split evidence exists.
    if lin:
        n_aff = 0
        for d in pdays_all:
            if d < lin_eff and d not in caps and lin_reason and reasons_by_day.get(d) not in (R.TICKER_REUSE,):
                reasons_by_day[d] = lin_reason
                n_aff += 1
        w["lineage_applied"].append((cik, lin[0], lin[1], lin[2], pred_cik_used or lin[3], lin[4], n_aff, lin_note[:300]))
    gaps = split_ledger_gaps(_runs_by_class(w, issuer_id), bars[primary][1], caps)
    gaps += split_like_gaps(_runs_by_class(w, issuer_id), caps,
                            [r_ for r_ in w["observation"] if r_[1] == issuer_id and r_[8] and r_[18] not in
                             (R.REJ_CONFLICT, R.REJ_INVALID_UNIT, R.REJ_NONPOSITIVE)],
                            sorted(v["filing_date"] for v in filings.values() if v["form"] in CAPITAL_EVENT_FORMS),
                            sorted({s_.ex_date.isoformat() for _k, l_, c_ in ledgers_used for s_ in list(l_.splits) + list(c_)}),
                            {g_["date"] for g_ in gaps})
    if ledger_unresolved:
        lu = max(ledger_unresolved)
        for d in [d for d in caps if d < lu]:
            del caps[d]
            reasons_by_day[d] = R.LEDGER_SPLIT_UNRESOLVED
        first_val = min(caps) if caps else None
    # ⛔ THE ISSUER STATES A SPLIT AFTER ITS LAST SHARE STATE that no ledger carries (SGRX: XBRL 1-for-60 2026-01-20 and
    # 1-for-5 2026-08-21, filed 2026-09-18, under a renamed ticker whose ledger is empty; the bars carry both, so every
    # earlier day was 300x high). With no count across it no transition can expose it: every earlier day is withheld.
    if D.splitev is not None and ledgers_used and all(k_ != "ADR" for k_, _l, _c in ledgers_used):
        last_asof = max((r_[4] for rs_ in _runs_by_class(w, issuer_id).values() for r_ in rs_), default=None)
        known = [s_ for _k, l_, c_ in ledgers_used for s_ in list(l_.splits) + list(c_)]
        if last_asof:
            rows_ = D.splitev.execute("SELECT DISTINCT ex_date, ratio FROM split_evidence WHERE cik=? AND source LIKE 'XBRL%' "
                                      "AND ex_date > ?", (cik, last_asof)).fetchall()
            for ed_, r_ in unapplied_post_state_splits(rows_, last_asof, known, pdays_all[-1]):
                w["split_gap"].append((cik, ed_.isoformat(), None, "EVIDENCE", None, None, last_asof, "HELD_SPLIT_AFTER_LAST_STATE",
                                       ed_.isoformat(), r_, "XBRL", None, f"issuer split {r_:g} on {ed_} after the last share "
                                                                         f"state ({last_asof}); no ledger carries it"))
                for d in [d for d in caps if d < ed_]:
                    del caps[d]
                    reasons_by_day[d] = R.HIST_SPLIT_UNRESOLVED
            first_val = min(caps) if caps else None
    sym_switch = reported_symbol_switch(primary, symbol_reports(D, cik, filings), tickers,
                                        [e_[2] for e_ in (D.ref.get(primary, (None, []))[0].events if D.ref.get(primary, (None, []))[0] else [])],
                                        [(o.as_of, o.value * Ledger(D.ref.get(primary, (None, []))[1]).factor_after(o.as_of))
                                         for k_, o, _m in obs if o.value > 0])
    if sym_switch is not None:
        w["lineage_applied"].append((cik, "SYMBOL_SWITCH", "REPORTED_SYMBOL", sym_switch[0].isoformat(), None, None,
                                     len([d for d in caps if d < sym_switch[0]]), sym_switch[1][:300]))
        for d in [d for d in caps if d < sym_switch[0]]:
            del caps[d]
            reasons_by_day[d] = R.TICKER_REUSE
        first_val = min(caps) if caps else None
    if ads_unresolved_from is not None:
        for d in [d for d in caps if d >= ads_unresolved_from]:
            del caps[d]
            reasons_by_day[d] = R.ADR_RATIO
        first_val = min(caps) if caps else None
    if price_splices:
        ps = max(price_splices)
        for d in [d for d in caps if d < ps]:
            del caps[d]
            reasons_by_day[d] = R.PRICE_BASIS_INCONSISTENT
        first_val = min(caps) if caps else None
    hold_before = max((g_["date"] for g_ in gaps), default=None)
    if hold_before is not None:
        for d in [d for d in caps if d < hold_before]:
            del caps[d]
            reasons_by_day[d] = R.HIST_SPLIT_UNRESOLVED
        first_val = min(caps) if caps else None
    # ⛔ PRICE SERIES CONTRADICTS THE CORPORATE ACTION: a >= 3x share-state step and a >= 3x price step on the same
    # transition IN THE SAME DIRECTION (IVT 2021-08-06: 1-for-10 reverse split, shares /10 AND the bars /10, then x10
    # back on 2021-09-24). Neither basis can be trusted: the days are withheld from the step until the price steps
    # back (>= 3x the other way) or a new share state begins (at most 250 sessions). Nothing is re-based.
    pcl = bars[primary][1]
    pdays_s = sorted(pcl)
    for (_iss, _ck), rs in _runs_by_class(w, issuer_id).items():
        for p_, n_ in zip(rs, rs[1:]):
            if not (p_[2] and n_[2]):
                continue
            sr = n_[2] / p_[2]
            a_ = date.fromisoformat(p_[1])
            i0 = bisect.bisect_left(pdays_s, date.fromisoformat(n_[0]))
            if i0 >= len(pdays_s) or not pcl.get(a_):
                continue
            b_ = pdays_s[i0]
            pr_ = pcl[b_] / pcl[a_]
            if abs(math.log(sr)) >= math.log(3) and abs(math.log(pr_)) >= math.log(3) and (sr > 1) == (pr_ > 1):
                end_ = date.fromisoformat(n_[1])
                for j_ in range(i0, min(len(pdays_s), i0 + 250)):
                    d_ = pdays_s[j_]
                    if d_ > end_:
                        break
                    if j_ > i0 and pcl.get(pdays_s[j_ - 1]) and pcl[d_] / pcl[pdays_s[j_ - 1]] and \
                            abs(math.log(pcl[d_] / pcl[pdays_s[j_ - 1]])) >= math.log(3) and \
                            ((pcl[d_] / pcl[pdays_s[j_ - 1]]) > 1) != (pr_ > 1):
                        break
                    if d_ in caps:
                        del caps[d_]
                        reasons_by_day[d_] = R.PRICE_BASIS_INCONSISTENT
    first_val = min(caps) if caps else None
    # ⛔ EXTREME CAPITAL STEPS: a >= 10x cap step between consecutive VALUED days that the price does not explain is a
    # DETECTOR, never authority. Each one is settled by the EVIDENCE behind the two share states (extreme_step_decisions):
    # an uncorroborated extreme state is refused, a split-like ratio the ledger lacks is a split gap, an unbridged step
    # with no capital-event filing between is unproven -- otherwise it is a real capital change and is served.
    ev_forms = sorted((v["filing_date"], v["form"]) for v in filings.values() if v["form"] in CAPITAL_EVENT_FORMS)
    known_splits = sorted({s_.ex_date for _k, l_, c_ in ledgers_used for s_ in list(l_.splits) + list(c_)})
    obs_rows = [r_ for r_ in w["observation"] if r_[1] == issuer_id and r_[8] and r_[18] not in
                (R.REJ_CONFLICT, R.REJ_INVALID_UNIT, R.REJ_NONPOSITIVE)]
    for _pass in range(6):
        dec_ = extreme_step_decisions(caps, bars[primary][1], _runs_by_class(w, issuer_id), obs_rows, ev_forms, known_splits)
        if not dec_:
            break
        for d_, (rsn_, note_) in dec_.items():
            if d_ in caps:
                del caps[d_]
                reasons_by_day[d_] = rsn_
        for note_ in sorted({n_ for _r, n_ in dec_.values()}):
            w["split_gap"].append((cik, None, None, "EXTREME_STEP", None, None, None, "HELD_EXTREME_STEP", None, None,
                                   "EVIDENCE", None, note_[:400]))
    first_val = min(caps) if caps else None
    # write daily output
    for d, v in caps.items():
        w["cap_daily"].append((cik, _i(d), v))
    runs, contiguous = [], False
    for d in pdays_all:
        r = None if d in caps else reasons_by_day.get(d)
        if r is None:
            contiguous = False
            continue
        if contiguous and runs[-1][3] == r:
            runs[-1][2] = _i(d)
            runs[-1][4] += 1
        else:
            runs.append([cik, _i(d), _i(d), r, 1])
        contiguous = True
    for r in runs:
        w["gap_run"].append(tuple(r))

    listed_days = [d for d in pdays_all if d >= lst.start and (lst.end is None or d <= lst.end)]
    valued = [d for d in listed_days if d in caps]
    span = [d for d in listed_days if first_val and d >= first_val]
    internal = [d for d in span if d not in caps]
    unexplained = [d for d in internal if reasons_by_day.get(d) in (R.BUG, None)]
    rc = Counter(reasons_by_day[d] for d in listed_days if d not in caps)
    w["coverage"].append((cik, primary, int(foreign), pdays_all[0].isoformat(), lst.start.isoformat(),
                          first_val.isoformat() if first_val else None, pdays_all[-1].isoformat(), len(listed_days), len(valued),
                          len(span), len(span) - len(internal), len(internal), len(unexplained), json.dumps(struct_summary),
                          json.dumps(dict(rc))))
    return {"cik": cik, "status": "OK", "primary": primary, "valued": len(valued), "listed": len(listed_days), "gaps": gaps}


def git_head() -> str:
    try:
        return subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=os.path.dirname(__file__), text=True).strip()
    except Exception:
        return "unknown"


def sha256(p: str) -> str:
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--ciks")
    ap.add_argument("--no-hash", action="store_true", help="skip input hashing (development runs only)")
    a = ap.parse_args(argv)
    P = lambda n: os.path.join(a.data, n)
    D = Data(sqlite3.connect(P("inputs.db")), sqlite3.connect(P("covers.db")) if os.path.exists(P("covers.db")) else None,
             sqlite3.connect(P("text.db")) if os.path.exists(P("text.db")) else None, sqlite3.connect(P("prices.db")),
             load_ref(P("ref.jsonl")),
             *(sqlite3.connect(P(n)) if os.path.exists(P(n)) else None for n in ("ipo.db", "econ.db", "adr.db")))
    from .acceptance import Authority
    if not os.path.exists(P("acceptance.db")):
        print("REFUSED: acceptance.db missing -- evidence public times would fall back to submissions' ambiguous "
              "acceptanceDateTime (one-day lookahead risk). Build it: python -m api.services.marketcap.acceptance ...")
        return 2
    D.acc = Authority(P("acceptance.db"))
    D.prosp = sqlite3.connect(P("prosp.db")) if os.path.exists(P("prosp.db")) else None
    D.splitev = sqlite3.connect(P("splitev.db")) if os.path.exists(P("splitev.db")) else None
    D.lineage = sqlite3.connect(P("lineage.db")) if os.path.exists(P("lineage.db")) else None
    if os.path.exists(P("pred_inputs.db")):
        D.pred = Data(sqlite3.connect(P("pred_inputs.db")),
                      sqlite3.connect(P("pred_covers.db")) if os.path.exists(P("pred_covers.db")) else None,
                      sqlite3.connect(P("pred_text.db")) if os.path.exists(P("pred_text.db")) else None, D.px, D.ref,
                      None, sqlite3.connect(P("pred_econ.db")) if os.path.exists(P("pred_econ.db")) else None, None, D.acc)
    build_id = f"{DATASET}-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}"
    os.makedirs(a.out, exist_ok=True)
    out_path = os.path.join(a.out, build_id + ".db")
    db = sqlite3.connect(out_path)
    db.executescript(SCHEMA)
    ciks = [int(x) for x in a.ciks.split(",")] if a.ciks else [c for (c,) in D.inp.execute("SELECT cik FROM issuer ORDER BY cik")]
    tables = ("security", "ticker_map", "observation", "state_run", "regime", "cap_daily", "gap_run", "coverage", "econ_request",
              "split_gap", "lineage_applied")
    stat = Counter()
    from .splitev import confirm
    for i, cik in enumerate(ciks):
        w = {t: [] for t in tables}
        try:
            r = build_issuer(D, cik, build_id, w)
            # ⭐ HISTORICAL SPLIT EVIDENCE: a detected split-ledger gap is lifted only by an authoritative statement of
            # that split (same factor, dated inside the transition). Re-run with the confirmed splits; repeat while new
            # confirmations appear (an earlier split can only be seen once a later one is normalized).
            applied: dict = {}
            ev = []
            for _round in range(4):
                gaps = r.get("gaps") or []
                if not gaps or D.splitev is None:
                    break
                ev_ciks = [cik] + ([p_ for (p_,) in D.lineage.execute(
                    "SELECT pred_cik FROM lineage WHERE succ_cik=? AND pred_cik IS NOT NULL", (cik,))] if D.lineage is not None else [])
                ev = D.splitev.execute(f"SELECT ex_date, ratio, source, accn, snippet FROM split_evidence WHERE cik IN "
                                       f"({','.join('?' * len(ev_ciks))}) ORDER BY source DESC, ex_date", ev_ciks).fetchall()
                new = {}
                for g_ in gaps:
                    c_ = confirm(ev, g_["k"], g_["direction"], g_["prev_asof"], g_["next_asof"])
                    if c_ and (c_[0], round(c_[1], 6)) not in applied:
                        new[(c_[0], round(c_[1], 6))] = c_
                if not new:
                    break
                applied.update(new)
                w = {t: [] for t in tables}
                r = build_issuer(D, cik, build_id, w, extra_splits=[Split(d_, r_) for (d_, r_) in applied])
            from .splitev import contradicted
            for (d_, r_), c_ in applied.items():
                w.setdefault("split_gap", []).append((cik, d_.isoformat(), None, "APPLIED", None, None, None, "APPLIED",
                                                     d_.isoformat(), r_, c_[2], c_[3], c_[4][:400]))
            for g_ in r.get("gaps") or []:
                bad = contradicted(ev, g_["k"], g_["direction"], g_["prev_asof"], g_["next_asof"])
                w.setdefault("split_gap", []).append((cik, g_["date"].isoformat(), g_["k"], g_["direction"], g_["cls"],
                                                     g_["prev_asof"].isoformat(), g_["next_asof"].isoformat(),
                                                     "HELD_CONTRADICTED" if bad else "HELD_NO_EVIDENCE",
                                                     *((bad[0], bad[1], bad[2], bad[3], bad[4][:400]) if bad else (None,) * 5)))
            db.execute("SAVEPOINT issuer")
            for t in tables:
                if w[t]:
                    db.executemany(f"INSERT INTO {t} VALUES({','.join('?' * len(w[t][0]))})", w[t])
            db.execute("RELEASE issuer")
            stat[r["status"]] += 1
        except Exception as e:                         # an issuer that fails is a BUG, recorded -- never silent
            try:
                db.execute("ROLLBACK TO issuer")
                db.execute("RELEASE issuer")
            except sqlite3.Error:
                pass
            stat["BUG"] += 1
            import traceback
            tb = traceback.format_exc(limit=3).replace(chr(10), " | ")[-400:]
            db.execute("INSERT OR REPLACE INTO manifest VALUES(?,?)", (f"bug:{cik}", f"{type(e).__name__}: {str(e)[:200]} :: {tb}"))
            continue
        if i % 250 == 0:
            db.commit()
            print(f"{i}/{len(ciks)} {dict(stat)}", flush=True)
    man = {"dataset": DATASET, "build_id": build_id, "code_commit": git_head(), "issuers": len(ciks), "status": dict(stat),
           "safety_bound_days": R.SAFETY_BOUND_DAYS, "built_at": datetime.now(timezone.utc).isoformat()}
    if not a.no_hash:
        for n in ("inputs.db", "covers.db", "text.db", "ipo.db", "econ.db", "adr.db", "prices.db", "ref.jsonl", "acceptance.db",
                  "prosp.db", "splitev.db", "lineage.db", "pred_inputs.db", "pred_covers.db", "pred_text.db", "pred_econ.db"):
            if os.path.exists(P(n)):
                man[f"input_sha256:{n}"] = sha256(P(n))
    for k, v in man.items():
        db.execute("INSERT OR REPLACE INTO manifest VALUES(?,?)", (k, json.dumps(v) if not isinstance(v, str) else v))
    db.commit()
    db.close()
    print(json.dumps({"out": out_path, **man}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
