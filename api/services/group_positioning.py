"""Positioning by sector and industry (the GRPS CROWDING view): short interest, insider buying and fund holdings,
each stock's figure rolled up by the sector and industry map GRPS groups by. Worked out inside GRPS's evening build
(`group_stats.build`) and held with its answer; the route answers from what is held.

WHERE THE NUMBERS COME FROM. All of it is already held by this server. NOTHING HERE ASKS A VENDOR OR THE SEC, and
each store is read ONCE per build, by the build (a member's request never reads a store):

  short interest  `short_data.held_market_rows()`: the newest FINRA short interest report (read through Massive)
                  for every universe stock in it, beside the report before it, with the vendor's days to cover and
                  the percent of float (the float from the nightly screener export): the list SHRTS ranks, kept built
                  by short_data's own warm loop. Twice a month: a settlement date on the 15th and on the month's last
                  business day, published by FINRA about 7 business days later.
  insider buying  `insider_clusters_sec.held_purchases()`: every open-market purchase (Form 4, transaction code P,
                  acquired: the rule INS and INS CLUSTER use) that the INS CLUSTER store holds, read from the SEC's
                  own filings each night: every Form 4 in EDGAR's daily index for the last `KEEP_DAYS` calendar days
                  of filing days. THE STORE KEEPS NO SALES, and no more than `KEEP_DAYS` days, so 90 days of purchases
                  AND sales with the net cannot be told from it without a new read of the SEC. This part is purchases
                  only, over the store's window, and the panel says so.
  fund holdings   the Funds (N-PORT) index OWN reads (`fund_holders_nport.index_path()`, a read-only SQLite file;
                  its per-stock summary over EVERY matched fund, not only the 50 kept for display): how many funds
                  added, cut, opened, sold out or held, and the shares held at both reports by the funds that have
                  both. Quarterly: the SEC posts one data set a quarter, and a fund files within 60 days after its
                  fiscal quarter ends.
  institutions    NOT BUILT. OWN's 13F holders are read from FMP one stock at a time when a member opens OWN
  (13F)           (`research/ownership._thirteen_f`, kept only in the shared cache for 12 hours); there is no store of
                  the whole market's 13F holdings to read without a vendor call, so this part is left out and the
                  answer says why (`parts.institutions`).

THE DEFINITIONS (pure, tested on invented figures in tests/test_group_positioning.py):
  * a group is every stock of GRPS's universe whose company details name it (`group_stats`'s map and name
    cleaning); a figure is given only when at least `group_stats_calc.MIN_MEMBERS` members have one, and every
    figure says how many members it rests on (`n`), as GRPS's own medians do;
  * short interest: the median percent of float (short interest over today's float; withheld by short_data where
    the two cannot describe the same share count), the median days to cover, and the median change in shares short
    since the previous report, in percent (every member with both reports; a previous report of zero has no
    percent); the three most shorted are the highest percent of float (ties by symbol);
  * insider buying: the members with at least one purchase among all members (when the store is held, every member
    is covered: a member with no filing in the window made no open-market purchase that the filings show), the
    purchases (filings), their dollars (the purchases that state a price; how many did not is counted, never
    priced at 0), and the three largest purchases by dollars (one filing each);
  * funds: of the members whose funds' change is known (at least one fund with a previous report in the data), the
    share where more funds added (`added` + `new`) than cut (`cut` + `sold_out`), and the median net change in the
    shares held by the funds with both reports, in percent of what they held before (`both_now` against
    `both_prior`; none when they held none before). The index puts a fund's earlier shares in post-split terms
    across a stock split between its reports; a member with any fund whose change is NOT COMPARABLE (a split may
    fall between the reports and could not be checked: `not_comparable`) has no known change here, never a guessed
    add or cut.
MEMORY: the per-stock figures are kept as one short list per stock with a figure (`STOCK_FIELDS`) and each group
lists its members' symbols; the stores' own rows are let go as soon as their figures are taken.
"""
from __future__ import annotations

import json
import os
import sqlite3
import time
from collections import Counter, defaultdict
from datetime import date
from typing import Callable, Iterable, Optional

from api.services import group_stats_calc as C

KINDS = ("sector", "industry")
TOP_N = 3                    # the most shorted members and the largest purchases a group names
MEMBERS_MAX = 1000           # members one group's answer lists (the largest sector is well under it)
STOCK_FIELDS = ("short_interest", "pct_float", "days_to_cover", "short_change_pct",
                "buys", "buy_value", "buy_unpriced", "last_buy",
                "funds", "funds_added", "funds_cut", "fund_net_pct")
_I = {name: i for i, name in enumerate(STOCK_FIELDS)}
INSTITUTIONS_SOURCE = "Form 13F filings, through FMP"
INSTITUTIONS_DETAIL = ("Not shown: the server reads a stock's 13F holders from the vendor only when a member opens "
                       "OWN for it, and keeps no store of the whole market's 13F holdings to roll up.")
PART_NAMES = ("short", "insider", "funds", "institutions")


def _finite(v) -> Optional[float]:
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        return None
    v = float(v)
    return v if v == v and v not in (float("inf"), float("-inf")) else None


def _count(v) -> int:
    f = _finite(v)
    return int(f) if f is not None and f > 0 else 0


def _iso(v) -> Optional[str]:
    s = str(v or "")[:10]
    try:
        date.fromisoformat(s)
    except ValueError:
        return None
    return s


# ── the reads (each indirected so tests replace it; each is a read of what this server holds) ───────────

def read_short() -> dict:
    """{state, rows {SYM: row}, meta}. state: 'ok' | 'not_held' | 'unavailable' | 'failed' (the last two with the
    reason short_data's last look gave)."""
    from api.services import short_data
    ans, how = short_data.held_market_rows()
    if how == "held" and isinstance(ans, dict):
        meta = {k: ans.get(k) for k in ("settlement_date", "previous_settlement_date", "publication_estimate",
                                        "read_at", "source", "float_source")}
        return {"state": "ok", "rows": ans.get("rows") or {}, "meta": meta}
    state = ans.get("status") if isinstance(ans, dict) else None
    if state in ("unavailable", "failed"):
        return {"state": state, "rows": {}, "meta": {"source": short_data.SOURCE, "reason": ans.get("reason")}}
    return {"state": "not_held", "rows": {}, "meta": {"source": short_data.SOURCE}}


def read_insider() -> dict:
    """{state, purchases [...], coverage, source, keep_days}. state: 'ok' | 'not_held'."""
    from api.services import insider_clusters_sec as ics
    ans, how = ics.held_purchases()
    if how != "held" or not isinstance(ans, dict):
        return {"state": "not_held", "purchases": [], "coverage": None, "source": ics.SOURCE, "keep_days": ics.KEEP_DAYS}
    return {"state": "ok", "purchases": ans.get("purchases") or [], "coverage": ans.get("coverage"),
            "source": ans.get("source") or ics.SOURCE, "keep_days": ics.KEEP_DAYS}


#: the per-stock summary fields of the N-PORT index this reads (fund_holders_nport_data `summary`)
NPORT_FIELDS = ("funds", "added", "cut", "unchanged", "new", "no_prior", "sold_out", "both_now", "both_prior",
                "period_from", "period_to", "not_comparable")


def read_nport(symbols: Iterable[str]) -> dict:
    """{state, rows {SYM: summary (NPORT_FIELDS only)}, meta}, for the given symbols only. state: 'ok' | 'not_built'
    (no index on this server yet) | 'unavailable' (the file could not be read). ONE read-only pass of the index."""
    from api.services import fund_holders_nport as fhn
    path = fhn.index_path()
    base = {"source": fhn.SOURCE}
    if not path or not os.path.exists(path):
        return {"state": "not_built", "rows": {}, "meta": base}
    want = set(symbols)
    rows: dict = {}
    try:
        con = sqlite3.connect(f"file:{path}?mode=ro", uri=True, timeout=2.0)
        try:
            meta = {k: json.loads(v) for k, v in con.execute("SELECT k, v FROM meta")}
            for sym, summary in con.execute("SELECT sym, summary FROM stock"):
                if sym not in want:
                    continue
                try:
                    s = json.loads(summary)
                except ValueError:
                    continue
                if isinstance(s, dict):
                    rows[sym] = {k: s.get(k) for k in NPORT_FIELDS}
        finally:
            con.close()
    except (sqlite3.Error, ValueError):
        return {"state": "unavailable", "rows": {}, "meta": base}
    cov = meta.get("coverage") if isinstance(meta.get("coverage"), dict) else {}
    return {"state": "ok", "rows": rows, "meta": {**base, "quarter": meta.get("quarter"),
                                                   "prior_quarter": meta.get("prior_quarter"),
                                                   "built_at": meta.get("built_at"), "periods": meta.get("periods"),
                                                   "prior_missing": meta.get("prior_missing"),
                                                   "matched_value_pct": cov.get("matched_value_pct"),
                                                   "splits": (meta.get("splits") or {}).get("state")}}


# ── one stock's figures (pure) ───────────────────────────────────────────────────────────────────────────

def short_figures(row: Optional[dict]) -> Optional[tuple]:
    """(short interest, percent of float, days to cover, change in percent) from one short_data market row, or None
    when the row carries no short interest."""
    if not isinstance(row, dict):
        return None
    si = _finite(row.get("short_interest"))
    if si is None or si < 0:
        return None
    return si, _finite(row.get("pct_float")), _finite(row.get("days_to_cover")), _finite(row.get("change_pct"))


def fund_figures(s: Optional[dict]) -> Optional[tuple]:
    """(funds holding it now, funds that added, funds that cut, net change in percent) from one N-PORT summary, or
    None. Added counts `added` + `new` (a new position); cut counts `cut` + `sold_out`. Both are None when no fund's
    change is known (no fund holding or having held it has a previous report in the data), and when any fund's change
    is not comparable (a stock split may fall between its reports and could not be checked); the net is the change
    in the shares held by the funds with both reports (post-split), in percent of what they held before, None when
    they held none before."""
    if not isinstance(s, dict):
        return None
    funds = _count(s.get("funds"))
    if _count(s.get("not_comparable")):
        return funds, None, None, None
    up = _count(s.get("added")) + _count(s.get("new"))
    down = _count(s.get("cut")) + _count(s.get("sold_out"))
    known = up + down + _count(s.get("unchanged")) > 0
    now, before = _finite(s.get("both_now")), _finite(s.get("both_prior"))
    net = round((now - before) / before * 100.0, 2) if known and now is not None and before is not None and before > 0 else None
    return funds, (up if known else None), (down if known else None), net


def primary_role(roles) -> str:
    from api.services.insider_clusters_sec import primary_role as owner_role
    return owner_role(roles or ())


# ── the groups (pure) ────────────────────────────────────────────────────────────────────────────────────

def _top(items, key, n: int = TOP_N) -> list:
    return sorted(items, key=key)[:n]


def short_block(syms: list, stocks: dict) -> dict:
    """One group's short interest: the members in the report, the medians (each with its `n`) and the most shorted."""
    have = [(s, stocks[s]) for s in syms if s in stocks and stocks[s][_I["short_interest"]] is not None]
    col = lambda f: [v[_I[f]] for _s, v in have]           # noqa: E731
    top = _top([(s, v[_I["pct_float"]], v[_I["days_to_cover"]]) for s, v in have if v[_I["pct_float"]] is not None],
               key=lambda t: (-t[1], t[0]))
    return {"reported": len(have), "pct_float": C.summarize(col("pct_float")),
            "days_to_cover": C.summarize(col("days_to_cover")), "change": C.summarize(col("short_change_pct")),
            "top": [{"sym": s, "pct_float": p, "days_to_cover": d} for s, p, d in top]}


def insider_block(syms: list, stocks: dict, buys_of: dict) -> dict:
    """One group's insider buying: every member is covered by the read, so `members` is the base; the buyers among
    them (a share needs `MIN_MEMBERS` members), the purchases, their dollars and the largest purchases."""
    flags, purchases, value, priced, unpriced = [], 0, 0.0, 0, 0
    for s in syms:
        v = stocks.get(s)
        n = v[_I["buys"]] if v is not None and v[_I["buys"]] else 0
        flags.append(n > 0)
        if n:
            purchases += n
            if v[_I["buy_value"]] is not None:
                value += v[_I["buy_value"]]
                priced += 1
            unpriced += v[_I["buy_unpriced"]] or 0
    top = _top([b for s in syms for b in buys_of.get(s, ())], key=lambda b: (-b["value"], b["date"] or "", b["sym"]))
    return {"members": len(syms), "buyers": C.share(flags), "purchases": purchases,
            "value": round(value, 2) if priced else None, "unpriced": unpriced, "top": top}


def funds_block(syms: list, stocks: dict) -> dict:
    """One group's fund holdings: the members held by at least one fund, those whose change is known, the share of
    them where more funds added than cut, and the median net change."""
    held = known = 0
    flags, nets = [], []
    for s in syms:
        v = stocks.get(s)
        if v is None or v[_I["funds"]] is None:
            continue
        if v[_I["funds"]] > 0:
            held += 1
        if v[_I["funds_added"]] is None:
            continue
        known += 1
        flags.append(v[_I["funds_added"]] > v[_I["funds_cut"]])
        nets.append(v[_I["fund_net_pct"]])
    return {"held": held, "known": known, "adding": C.share(flags), "net": C.summarize(nets)}


def _blank_stock() -> list:
    return [None] * len(STOCK_FIELDS)


def build(sym_groups: dict, *, short_reader: Optional[Callable[[], dict]] = None,
          insider_reader: Optional[Callable[[], dict]] = None,
          nport_reader: Optional[Callable[[Iterable[str]], dict]] = None) -> dict:
    """The positioning of every group, from `sym_groups` ({SYM: ((kind, name), ...)}: GRPS's mapped universe, names
    already cleaned). Reads each store ONCE. Never raises for a store that cannot be read: that part says so."""
    t0 = time.process_time()
    short_reader = short_reader or read_short
    insider_reader = insider_reader or read_insider
    nport_reader = nport_reader or read_nport
    syms = list(sym_groups)
    universe = set(syms)
    stocks: dict = {}
    counts: Counter = Counter()
    parts: dict = {}

    def slot(sym: str) -> list:
        row = stocks.get(sym)
        if row is None:
            row = stocks[sym] = _blank_stock()
        return row

    # short interest
    got = _safe(short_reader)
    meta = got.get("meta") or {}
    for sym, row in (got.get("rows") or {}).items():
        if sym not in universe:
            continue
        f = short_figures(row)
        if f is None:
            continue
        r = slot(sym)
        r[_I["short_interest"]], r[_I["pct_float"]], r[_I["days_to_cover"]], r[_I["short_change_pct"]] = f
        counts["short"] += 1
    parts["short"] = {"state": got.get("state", "failed"), "source": meta.get("source"),
                      "settlement_date": _iso(meta.get("settlement_date")),
                      "previous_settlement_date": _iso(meta.get("previous_settlement_date")),
                      "publication_estimate": _iso(meta.get("publication_estimate")), "read_at": meta.get("read_at"),
                      "float_source": meta.get("float_source"), "reason": meta.get("reason"),
                      "covered": counts["short"], "universe": len(syms)}
    del got

    # insider buying (open-market purchases only: the store keeps no sales)
    got = _safe(insider_reader)
    buys_of: dict = defaultdict(list)
    for b in got.get("purchases") or ():
        sym = b.get("ticker") if isinstance(b, dict) else None
        if sym not in universe:
            counts["insider_unmatched"] += 1
            continue
        counts["insider_matched"] += 1
        r = slot(sym)
        r[_I["buys"]] = (r[_I["buys"]] or 0) + 1
        val = _finite(b.get("value"))
        if val is not None:
            r[_I["buy_value"]] = round((r[_I["buy_value"]] or 0.0) + val, 2)
            buys_of[sym].append({"sym": sym, "value": val, "date": _iso(b.get("date")), "role": primary_role(b.get("roles"))})
        r[_I["buy_unpriced"]] = (r[_I["buy_unpriced"]] or 0) + _count(b.get("unpriced"))
        day = _iso(b.get("date"))
        if day and (r[_I["last_buy"]] is None or day > r[_I["last_buy"]]):
            r[_I["last_buy"]] = day
    for sym in list(buys_of):                     # each stock keeps only its own largest few (a group needs no more)
        buys_of[sym] = _top(buys_of[sym], key=lambda x: (-x["value"], x["date"] or ""))
    cov = got.get("coverage") or {}
    parts["insider"] = {"state": got.get("state", "failed"), "source": got.get("source"),
                        "keep_days": got.get("keep_days"), "from": _iso(cov.get("from")), "to": _iso(cov.get("to")),
                        "complete": cov.get("complete"), "listed": cov.get("listed"), "read": cov.get("read"),
                        "given_up": cov.get("given_up"), "matched": counts["insider_matched"],
                        "unmatched": counts["insider_unmatched"], "sales": "not_held", "universe": len(syms)}
    del got

    # fund holdings (N-PORT)
    got = _safe(lambda: nport_reader(syms))
    lo = hi = None
    for sym, s in (got.get("rows") or {}).items():
        if sym not in universe:
            continue
        f = fund_figures(s)
        if f is None:
            continue
        r = slot(sym)
        r[_I["funds"]], r[_I["funds_added"]], r[_I["funds_cut"]], r[_I["fund_net_pct"]] = f
        counts["funds"] += 1
        counts["funds_known"] += 1 if f[1] is not None else 0
        a, z = _iso(s.get("period_from")), _iso(s.get("period_to"))
        lo = a if a and (lo is None or a < lo) else lo
        hi = z if z and (hi is None or z > hi) else hi
    meta = got.get("meta") or {}
    parts["funds"] = {"state": got.get("state", "failed"), "source": meta.get("source"), "quarter": meta.get("quarter"),
                      "prior_quarter": meta.get("prior_quarter"), "built_at": meta.get("built_at"),
                      "period_from": lo, "period_to": hi, "prior_missing": meta.get("prior_missing"),
                      "matched_value_pct": meta.get("matched_value_pct"), "splits": meta.get("splits"),
                      "covered": counts["funds"],
                      "known": counts["funds_known"], "universe": len(syms)}
    del got

    parts["institutions"] = {"state": "not_held", "source": INSTITUTIONS_SOURCE, "detail": INSTITUTIONS_DETAIL}

    members: dict = {k: defaultdict(list) for k in KINDS}
    for sym, mine in sym_groups.items():
        for k, name in mine:
            if name:
                members[k][name].append(sym)
    ok = {p: parts[p]["state"] == "ok" for p in ("short", "insider", "funds")}
    kinds: dict = {}
    for k in KINDS:
        blocks = {}
        for name in sorted(members[k]):
            syms_k = sorted(members[k][name])
            blocks[name] = {"members": len(syms_k), "syms": syms_k,
                            "short": short_block(syms_k, stocks) if ok["short"] else None,
                            "insider": insider_block(syms_k, stocks, buys_of) if ok["insider"] else None,
                            "funds": funds_block(syms_k, stocks) if ok["funds"] else None}
        kinds[k] = blocks
    buys_of.clear()
    return {"parts": parts, "fields": list(STOCK_FIELDS), "stocks": stocks, "kinds": kinds,
            "build": {"cpu_s": round(time.process_time() - t0, 2), "counts": dict(counts), "stocks": len(stocks)}}


def _safe(read: Callable[[], dict]) -> dict:
    """A store read that raised is that part 'failed', never a failed build."""
    try:
        got = read()
    except Exception:  # noqa: BLE001 -- said as the part's state
        return {"state": "failed"}
    return got if isinstance(got, dict) else {"state": "failed"}


def failed(why: str = "failed") -> dict:
    """The positioning when its build could not run at all: every part says so."""
    parts = {p: {"state": why} for p in ("short", "insider", "funds")}
    parts["institutions"] = {"state": "not_held", "source": INSTITUTIONS_SOURCE, "detail": INSTITUTIONS_DETAIL}
    return {"parts": parts, "fields": list(STOCK_FIELDS), "stocks": {}, "kinds": {k: {} for k in KINDS}, "build": None}


# ── the reads the route makes (pure over the held positioning) ───────────────────────────────────────────

def parts_view(pos: Optional[dict]) -> dict:
    """Each part's state, source, as-of and coverage. 'pending' for every part when the held answer was built before
    positioning existed."""
    if not isinstance(pos, dict) or not isinstance(pos.get("parts"), dict):
        return {"state": "pending", **{p: {"state": "pending"} for p in PART_NAMES}}
    return {"state": "ok", **{p: dict(pos["parts"].get(p) or {"state": "failed"}) for p in PART_NAMES},
            "min_members": C.MIN_MEMBERS, "top_n": TOP_N}


def brief(block: Optional[dict]) -> Optional[dict]:
    """One group's positioning without its member list."""
    if not isinstance(block, dict):
        return None
    return {k: v for k, v in block.items() if k != "syms"}


def member_rows(pos: Optional[dict], block: Optional[dict]) -> dict:
    """One group's members with their own figures, the most shorted first (a member with no percent of float after
    the rest, by symbol), at most `MEMBERS_MAX`, the cut said."""
    if not isinstance(block, dict) or not isinstance(pos, dict):
        return {"member_rows": [], "member_total": 0, "member_limit": MEMBERS_MAX, "member_cut": False}
    stocks = pos.get("stocks") or {}
    fields = pos.get("fields") or list(STOCK_FIELDS)
    rows = []
    for sym in block.get("syms") or ():
        v = stocks.get(sym)
        rows.append({"sym": sym, **{f: (v[i] if v is not None and i < len(v) else None) for i, f in enumerate(fields)}})
    rows.sort(key=lambda r: (r.get("pct_float") is None, -(r.get("pct_float") or 0.0), r["sym"]))
    return {"member_rows": rows[:MEMBERS_MAX], "member_total": len(rows), "member_limit": MEMBERS_MAX,
            "member_cut": len(rows) > MEMBERS_MAX}
