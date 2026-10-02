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
            if rr < 1.9 or not (2 <= k <= 100 and abs(math.log(rr) - math.log(k)) < 0.02):
                continue
            ds = date.fromisoformat(n[0])
            a_ = date.fromisoformat(p[1])
            i0 = bisect.bisect_left(pdays_sorted, ds)
            if i0 >= len(pdays_sorted):
                continue
            b_ = pdays_sorted[i0]
            if a_ in caps and b_ in caps and pclose.get(a_) and pclose.get(b_):
                pr, cr = pclose[b_] / pclose[a_], caps[b_] / caps[a_]
                if abs(math.log(pr)) < math.log(1.5) and abs(math.log(cr)) > math.log(1.9):
                    out.append({"date": ds, "k": k, "direction": "FORWARD" if r > 1 else "REVERSE", "cls": ck,
                                "prev_asof": date.fromisoformat(p[4]), "next_asof": date.fromisoformat(n[4]),
                                "prev_accn": p[3], "next_accn": n[3]})
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
        if not invalid_member(mem, lab):
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


def unlisted_split_events(days: list, closes: dict, ledger_splits) -> list[tuple]:
    """Split-LIKE one-day price steps the split ledger does not explain: the close moves by a clean factor k or 1/k
    (k = 2..100, within 3%) with no ledger split within 7 days. DETECTION ONLY: no factor is inferred and nothing is
    re-based -- a count dated before the step is simply not carried across it (ELVR-class consolidations)."""
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
        pa, src = _authority(D).resolve(a, acc_raw, fd)
        filings[a] = {"form": f, "filing_date": fd, "public_at": pa.isoformat(), "report_date": rd, "acc_source": src}
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
    lin_reason, lin_note, pred_cik_used = None, "", None
    pred_listed_rows = []
    if lin:
        kind, lstatus, _e, pred_cik, laccn, each_cls, lratio = lin
        if kind == "PURE_REORGANIZATION" and lstatus == "OK" and pred_cik and lratio == 1.0:
            pf = {}
            if D.pred is not None:
                for a, f, fd, acc_raw, rd in D.pred.inp.execute(
                        "SELECT accn, form, filing_date, accepted, report_date FROM filing WHERE cik=?", (pred_cik,)):
                    pa, src = _authority(D).resolve(a, acc_raw, fd)
                    pf[a] = {"form": f, "filing_date": fd, "public_at": pa.isoformat(), "report_date": rd, "acc_source": src}
            if not pf:
                lin_reason, lin_note = R.SUCCESSOR_UNRESOLVED, f"predecessor {pred_cik} evidence not staged"
            else:
                pobs, pfsets, _pinv = observations(D.pred, pred_cik, pf)
                pobs = [(k_, o_, m_) for k_, o_, m_ in pobs if o_.as_of < lin_eff]
                pfsets = {a_: v for a_, v in pfsets.items() if v[0].astimezone(ET).date() < lin_eff}
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

    # listed class map (letter -> ticker)
    listed: dict = {}
    if D.cov is not None:
        sym_rows = D.cov.execute(
            "SELECT accn, member, label, concept, text FROM cover_fact WHERE cik=? AND concept IN ('dei:TradingSymbol','dei:Security12bTitle') "
            "ORDER BY accn", (cik,)).fetchall()
        fk_by_accn = filing_key_maps(D.cov, cik)
        for accn_, mem, lab, concept, text in sym_rows:
            if invalid_member(mem, lab):
                continue
            k = fk_by_accn.get(accn_, {}).get((mem, lab)) or class_key(mem, lab)
            if concept == "dei:TradingSymbol":
                sym = text.strip().upper().replace(".", "-")
                for t in listings:
                    if t.upper().replace(".", "-") == sym:
                        listed.setdefault(k, t)
    for k_, text in pred_listed_rows:                    # the predecessor's symbols, never overriding the successor's
        sym = (text or "").strip().upper().replace(".", "-")
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
                ledger = Ledger([s_ for s_ in ref_c[1] if lst.start <= s_.ex_date <= cdays_all[-1]]
                                + [s_ for s_ in (extra_splits or []) if s_.ex_date <= cdays_all[-1]])
                cobs = [o for k, o, _m in obs if k == c.class_key]
                pre_listing = []
                if lst.start:
                    # ⛔ a count dated before this security began trading describes a capitalization that the listing
                    # itself may have changed (ELVR: Sayona's 11.5B pre-merger ordinary shares carried onto the post-
                    # merger, post-consolidation Elevra ADS -> 60x). Only the IPO prospectus speaks for the listing.
                    pre_listing = [o for o in cobs if o.as_of < lst.start and o.source != R.IPO_PROSPECTUS]
                    cobs = [o for o in cobs if not (o.as_of < lst.start and o.source != R.IPO_PROSPECTUS)]
                blocked = []
                if st.kind == "ADR":
                    ord_points = sorted((o.as_of, o.value * ledger.factor_after(o.as_of)) for o in cobs)
                    stmts = valid_statements(ratio_stmts, ledger, ord_points)
                    conv = []
                    for o in cobs:
                        if not ads_at(o.known_from):
                            conv.append(o)                      # the listed security is not an ADS at this time
                            continue
                        rs = ratio_at(o.as_of, stmts, ledger, o.value * ledger.factor_after(o.as_of), ord_points)
                        if rs is None:
                            # a NEWER count we cannot convert still supersedes the older state: it BLOCKS
                            blocked.append(Checked(o, "REJECTED_ADR_RATIO_UNRESOLVED", note="no ADS ratio valid at as-of",
                                                   block=(o.known_from, None, R.ADR_RATIO)))
                            continue
                        conv.append(Obs(o.as_of, o.public_at, o.value / rs.ords_per_ads, o.source, o.accn, o.form,
                                        o.tag + f"/ADS{rs.ords_per_ads:g}@{rs.accn}", o.class_key, o.snippet, o.confidence))
                    cobs = conv
                checked = validate(cobs, ledger) + blocked
                for o in pre_listing:
                    checked.append(Checked(o, R.REJ_PRE_LISTING, note=f"as-of before listing start {lst.start}"))
                cdays = [d for d in rdays if d in ccloses]
                # corporate actions across which a count dated BEFORE them is never carried
                events = [(s_.ex_date, R.REVERSE_SPLIT_RECOUNT) for s_ in ledger.splits if s_.ratio < 1]
                events += unlisted_split_events(cdays_all, ccloses, ref_c[1])
                if st.kind == "ADR":
                    events += [(t_, R.ADR_RATIO) for t_ in ads_changes]
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
    hold_before = max((g_["date"] for g_ in gaps), default=None)
    if hold_before is not None:
        for d in [d for d in caps if d < hold_before]:
            del caps[d]
            reasons_by_day[d] = R.HIST_SPLIT_UNRESOLVED
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
                ev = D.splitev.execute("SELECT ex_date, ratio, source, accn, snippet FROM split_evidence WHERE cik=? "
                                       "ORDER BY source DESC, ex_date", (cik,)).fetchall()
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
