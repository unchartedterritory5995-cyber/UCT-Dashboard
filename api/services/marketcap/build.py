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
from .adr import RatioStatement, ratio_at
from .classecon import ClassEcon
from .cover import num as cover_num
from .engine import Component, Listing, Structure, company_cap
from .identity import EDGAR_DOMESTIC, EDGAR_FOREIGN, Ref, decide, segments
from .state import ET, Obs, timeline, validate
from .structure import class_key, resolve, ticker_letter

EQUITY_TYPES = {"CS", "ADRC", "OS", "NYRS", "GDR", "ADRS", None}
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
                d.get("share_class_shares_outstanding"), d.get("weighted_shares_outstanding"))
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


# ---------------------------------------------------------------- observations
def observations(D: Data, cik: int, filings: dict) -> tuple[list[tuple], dict]:
    """-> ([(class_key, Obs, meta)], per-filing class sets {accn: (known_from, frozenset)})."""
    out = []
    fsets: dict = {}

    def pub(accn, filed):
        f = filings.get(accn)
        return (_ts(f["public_at"]) if f else None) or _evidence_public(D, accn, filed)

    seen = set()
    # 1. per-class and non-dimensional rendered covers
    if D.cov is not None:
        byacc = defaultdict(list)
        for accn, mem, lab, concept, as_of, text, scale in D.cov.execute(
                "SELECT accn, member, label, concept, as_of, text, share_scale FROM cover_fact WHERE cik=? AND "
                "concept='dei:EntityCommonStockSharesOutstanding'", (cik,)):
            byacc[accn].append((mem, lab, as_of, text, scale))
        for accn, rows in byacc.items():
            f = filings.get(accn)
            if not f:
                continue
            keys = set()
            for mem, lab, as_of, text, scale in rows:
                v = cover_num(text)
                if v is None or not as_of:
                    continue
                k = class_key(mem, lab)
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
    return out, fsets


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


# ---------------------------------------------------------------- per issuer
def build_issuer(D: Data, cik: int, build_id: str, w) -> dict:
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
        if ref is not None and ref.type not in EQUITY_TYPES:
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

    obs, fsets = observations(D, cik, filings)
    ipo_status = "NOT_APPLICABLE"
    lstart = min(l.start for l in listings.values())
    if lstart >= edgar and (first_filing is None or lstart >= first_filing):
        io, ipo_status = ipo_observations(D, cik, filings, lstart)
        obs += io

    # listed class map (letter -> ticker)
    listed: dict = {}
    if D.cov is not None:
        for mem, lab, concept, text in D.cov.execute(
                "SELECT member, label, concept, text FROM cover_fact WHERE cik=? AND concept IN ('dei:TradingSymbol','dei:Security12bTitle') "
                "ORDER BY accn", (cik,)):
            k = class_key(mem, lab)
            if concept == "dei:TradingSymbol":
                sym = text.strip().upper().replace(".", "-")
                for t in listings:
                    if t.upper().replace(".", "-") == sym:
                        listed.setdefault(k, t)
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
    if D.cov is not None:
        from .adr import parse_ratio
        for accn, text in D.cov.execute("SELECT accn, text FROM cover_fact WHERE cik=? AND concept='dei:Security12bTitle'", (cik,)):
            v, st, snip = parse_ratio(text)
            if st == "OK" and accn in filings:
                is_adr = True
                ratio_stmts.append(RatioStatement(date.fromisoformat(filings[accn]["filing_date"]), v, accn, snip))

    # multi-class SUSPECT: never price a non-dimensional (possibly all-class) total at one class's price
    pref = D.ref.get(primary, (None, []))[0]
    diverge = bool(pref and pref.share_class_shares and pref.weighted_shares
                   and abs(pref.share_class_shares / pref.weighted_shares - 1) > 0.05)
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
        if is_adr and st.kind == "SINGLE":
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
                ledger = Ledger([s for s in ref_c[1] if s.ex_date >= lst.start])
                cobs = [o for k, o, _m in obs if k == c.class_key]
                notes = {}
                if st.kind == "ADR":
                    conv = []
                    for o in cobs:
                        rs = ratio_at(o.as_of, ratio_stmts, ledger)
                        if rs is None:
                            notes[id(o)] = "ADR ratio unresolved at as-of"
                            continue
                        conv.append(Obs(o.as_of, o.public_at, o.value / rs.ords_per_ads, o.source, o.accn, o.form,
                                        o.tag + f"/ADS{rs.ords_per_ads:g}@{rs.accn}", o.class_key, o.snippet, o.confidence))
                    if cobs and not conv:
                        st = Structure("UNRESOLVED", reason=R.ADR_RATIO, note="no ADS ratio statement valid at any as-of date")
                        break
                    cobs = conv
                checked = validate(cobs, ledger)
                cdays = [d for d in rdays if d in bars[c.price_ticker][1]]
                tl = timeline(checked, cdays, edgar)
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
    return {"cik": cik, "status": "OK", "primary": primary, "valued": len(valued), "listed": len(listed_days)}


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
    build_id = f"{DATASET}-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}"
    os.makedirs(a.out, exist_ok=True)
    out_path = os.path.join(a.out, build_id + ".db")
    db = sqlite3.connect(out_path)
    db.executescript(SCHEMA)
    ciks = [int(x) for x in a.ciks.split(",")] if a.ciks else [c for (c,) in D.inp.execute("SELECT cik FROM issuer ORDER BY cik")]
    tables = ("security", "ticker_map", "observation", "state_run", "regime", "cap_daily", "gap_run", "coverage", "econ_request")
    stat = Counter()
    for i, cik in enumerate(ciks):
        w = {t: [] for t in tables}
        try:
            r = build_issuer(D, cik, build_id, w)
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
        for n in ("inputs.db", "covers.db", "text.db", "ipo.db", "econ.db", "adr.db", "prices.db", "ref.jsonl", "acceptance.db"):
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
