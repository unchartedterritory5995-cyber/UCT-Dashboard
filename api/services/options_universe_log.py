"""Owner ruling 2026-09-30: log the WHOLE options universe, every trading day, from now on.

Massive confirmed (2026-09-30 reply) that it sells no historical option chains, no
greeks, no IV and no open-interest history. The only way this product will ever have
options history -- for IV rank, for BRK-01's history half, for anything that looks back
-- is to record it forward. Every trading day not recorded is lost for good.

WHAT ONE RUN DOES
  1. Walks Massive's universe-wide options snapshot (`/v3/snapshot?type=options`,
     250 contracts a page, cursor-paginated). Measured 2026-09-30 from this box:
     2,018,713 contracts, 6,034 underlyings, 8,075 pages, 13 minutes, 0 errors.
  2. Streams one CSV row per contract into a gzip file on local disk -- never the
     whole chain in memory.
  3. Builds a per-underlying summary in the same pass: contracts, call/put open
     interest, the underlying's price, and one at-the-money IV (the expiry CLOSEST
     to 30 days out within 7-90 days, the strike closest to the underlying; mean of
     call and put IV), with the days-to-expiry it was read at.
     That summary is what an IV rank will read once history exists.
     It also carries the FRONT straddle: the first expiry strictly after the session,
     at the strike closest to the underlying that has a two-sided quote on both legs,
     priced off bid/ask MIDS (the method `implied_move` uses live). Straddle / price
     at a print's pre-print close IS that print's implied move (BRK-10).
  4. Uploads both files plus a manifest to R2 (the DATA_SYNC_* bucket the store
     backups use) under `options_log/<YYYY>/<YYYY-MM-DD>.*`.

⛔ A PARTIAL RUN SAYS SO. A run that hit its time budget or lost pages still uploads
what it has, and the manifest carries `complete: false` with the reason. A day's file
is never silently short.
⛔ HEAVY, SO NEVER ON WEB. It runs from the terminal-next-monitor cron (`--once
options-log`), never on the member-facing web pod.
⛔ DARK behind `OPTIONS_UNIVERSE_LOG_ENABLED` (read per call, unset = OFF).
"""
from __future__ import annotations

import csv
import datetime as _dt
import gzip
import io
import json
import os
import tempfile
import time
from typing import Callable, Iterable, Optional
from zoneinfo import ZoneInfo

FLAG = "OPTIONS_UNIVERSE_LOG_ENABLED"
BASE = "https://api.massive.com"
PAGE_LIMIT = 250
TIME_BUDGET_S = 40 * 60          # measured 13 min; 3x headroom before calling it partial
PAGE_RETRIES = 3
KEY_PREFIX = "options_log"
#: The ATM read takes the expiry closest to ATM_DTE_TARGET within [MIN, MAX].
#: First run (2026-09-30) used a fixed 20-45 day window and found an ATM IV for only
#: 687 of 6,034 underlyings: most names list monthlies only, and that day the
#: monthlies sat at 16 and 51 days. "Closest to 30" is the standard constant-maturity
#: read, and the DTE travels with the number so two days are comparable.
ATM_DTE_MIN, ATM_DTE_MAX, ATM_DTE_TARGET = 7, 90, 30

_ET = ZoneInfo("America/New_York")

CONTRACT_FIELDS = ("contract", "underlying", "expiration", "strike", "type",
                   "open_interest", "iv", "delta", "gamma", "theta", "vega",
                   "bid", "ask", "last", "volume", "vwap", "underlying_price")
UNDERLYING_FIELDS = ("underlying", "contracts", "call_oi", "put_oi", "underlying_price",
                     "atm_iv", "atm_expiration", "atm_strike", "atm_dte",
                     "front_expiration", "front_dte", "front_strike", "front_straddle")


def is_enabled() -> bool:
    return os.environ.get(FLAG, "0").strip().lower() in ("1", "true", "yes", "on")


def _num(v):
    return v if isinstance(v, (int, float)) and not isinstance(v, bool) else None


def _mid(bid, ask):
    """Bid/ask mid, or None unless the quote is two-sided (bid > 0, ask >= bid)."""
    if bid is None or ask is None or bid <= 0 or ask < bid:
        return None
    return (bid + ask) / 2.0


def contract_row(x: dict) -> Optional[dict]:
    """One snapshot record -> one CSV row, or None when it names no contract."""
    d = x.get("details") or {}
    occ = d.get("ticker") or x.get("ticker")
    if not occ:
        return None
    g = x.get("greeks") or {}
    q = x.get("last_quote") or {}
    t = x.get("last_trade") or {}
    day = x.get("day") or {}
    u = x.get("underlying_asset") or {}
    return {
        "contract": occ, "underlying": u.get("ticker"),
        "expiration": d.get("expiration_date"), "strike": _num(d.get("strike_price")),
        "type": d.get("contract_type"), "open_interest": _num(x.get("open_interest")),
        "iv": _num(x.get("implied_volatility")), "delta": _num(g.get("delta")),
        "gamma": _num(g.get("gamma")), "theta": _num(g.get("theta")),
        "vega": _num(g.get("vega")), "bid": _num(q.get("bid")), "ask": _num(q.get("ask")),
        "last": _num(t.get("price")), "volume": _num(day.get("volume")),
        "vwap": _num(day.get("vwap")), "underlying_price": _num(u.get("price")),
    }


class _Summary:
    """Per-underlying running totals, built in the same pass as the rows."""

    def __init__(self, session: _dt.date):
        self.session = session
        self.by: dict[str, dict] = {}

    def add(self, row: dict) -> None:
        und = row.get("underlying")
        if not und:
            return
        s = self.by.setdefault(und, {"contracts": 0, "call_oi": 0, "put_oi": 0,
                                     "underlying_price": None, "_atm": {},
                                     "_front_exp": None, "_front": {}})
        s["contracts"] += 1
        oi = row.get("open_interest") or 0
        if row.get("type") == "call":
            s["call_oi"] += oi
        elif row.get("type") == "put":
            s["put_oi"] += oi
        if row.get("underlying_price") is not None:
            s["underlying_price"] = row["underlying_price"]
        if row.get("strike") is None or not row.get("expiration"):
            return
        try:
            dte = (_dt.date.fromisoformat(row["expiration"]) - self.session).days
        except ValueError:
            return
        self._add_front(s, row, dte)
        if row.get("iv") is None:
            return
        if ATM_DTE_MIN <= dte <= ATM_DTE_MAX:
            s["_atm"].setdefault((row["expiration"], row["strike"]), []).append(row["iv"])

    @staticmethod
    def _add_front(s: dict, row: dict, dte: int) -> None:
        """Keep only the FRONT expiry's legs (first expiry strictly after the session)."""
        if dte < 1 or row.get("type") not in ("call", "put"):
            return
        exp = row["expiration"]
        if s["_front_exp"] is None or exp < s["_front_exp"]:
            s["_front_exp"], s["_front"] = exp, {}
        if exp != s["_front_exp"]:
            return
        m = _mid(row.get("bid"), row.get("ask"))
        if m is not None:
            s["_front"].setdefault(row["strike"], {})[row["type"]] = m

    def _front_row(self, s: dict, px) -> dict:
        out = {"front_expiration": s["_front_exp"], "front_dte": None,
               "front_strike": None, "front_straddle": None}
        if s["_front_exp"] is not None:
            out["front_dte"] = (_dt.date.fromisoformat(s["_front_exp"]) - self.session).days
        both = [k for k, legs in s["_front"].items() if "call" in legs and "put" in legs]
        if px is not None and both:
            k = min(both, key=lambda k: (abs(k - px), k))
            out["front_strike"] = k
            out["front_straddle"] = round(s["_front"][k]["call"] + s["_front"][k]["put"], 4)
        return out

    def rows(self) -> Iterable[dict]:
        for und in sorted(self.by):
            s = self.by[und]
            px = s["underlying_price"]
            atm_iv = atm_exp = atm_strike = atm_dte = None
            if px is not None and s["_atm"]:
                dte_of = {e: (_dt.date.fromisoformat(e) - self.session).days
                          for e in {e for e, _ in s["_atm"]}}
                # closest to the target; an exact tie takes the NEARER expiry
                chosen = min(dte_of, key=lambda e: (abs(dte_of[e] - ATM_DTE_TARGET), dte_of[e]))
                strikes = [k for e, k in s["_atm"] if e == chosen]
                atm_strike = min(strikes, key=lambda k: abs(k - px))
                ivs = s["_atm"][(chosen, atm_strike)]
                atm_iv, atm_exp, atm_dte = round(sum(ivs) / len(ivs), 6), chosen, dte_of[chosen]
            yield {"underlying": und, "contracts": s["contracts"], "call_oi": s["call_oi"],
                   "put_oi": s["put_oi"], "underlying_price": px, "atm_iv": atm_iv,
                   "atm_expiration": atm_exp, "atm_strike": atm_strike, "atm_dte": atm_dte,
                   **self._front_row(s, px)}


def walk(get: Callable[[str], dict], api_key: str, *, budget_s: float = TIME_BUDGET_S,
         clock: Callable[[], float] = time.monotonic):
    """Yield every contract record; the LAST thing yielded is the walk's own receipt:
    `{"_receipt": {pages, complete, reason}}`. The cursor's own query is kept and
    only the key is appended (passing params= would replace it -- measured on the
    GEX walk 2026-09-29)."""
    url = f"{BASE}/v3/snapshot?type=options&limit={PAGE_LIMIT}&apiKey={api_key}"
    t0, pages, reason = clock(), 0, None
    while url:
        if clock() - t0 > budget_s:
            reason = f"time budget {int(budget_s)}s reached after {pages} pages"
            break
        body = None
        for attempt in range(PAGE_RETRIES):
            try:
                body = get(url)
                break
            except Exception as e:  # noqa: BLE001 -- retried, then named in the receipt
                last = f"{type(e).__name__}: {e}"
                time.sleep(min(2 ** attempt, 5))
        if body is None:
            reason = f"page {pages + 1} failed {PAGE_RETRIES}x ({last})"
            break
        pages += 1
        for rec in body.get("results") or []:
            yield rec
        nxt = body.get("next_url")
        url = f"{nxt}&apiKey={api_key}" if nxt else None
    yield {"_receipt": {"pages": pages, "complete": reason is None and url is None,
                        "reason": reason}}


def resummarize(contracts_gz_path: str, session: _dt.date, out_gz_path: str) -> int:
    """Rebuild the per-underlying summary FROM a stored contracts file -- the full
    record is the authority, so a summary rule can change without losing a day.
    Returns the number of underlyings written."""
    summary = _Summary(session)
    num = ("strike", "open_interest", "iv", "underlying_price", "bid", "ask")
    with gzip.open(contracts_gz_path, "rt", newline="", encoding="utf-8") as fh:
        for r in csv.DictReader(fh):
            for k in num:
                v = r.get(k)
                # a whole number comes back as int, so a rebuilt summary is
                # byte-identical to one written in the original pass
                r[k] = None if v in (None, "") else (float(v) if "." in v or "e" in v.lower() else int(v))
            summary.add(r)
    n = 0
    with gzip.open(out_gz_path, "wt", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=UNDERLYING_FIELDS)
        w.writeheader()
        for row in summary.rows():
            w.writerow(row)
            n += 1
    return n


def keys_for(session: _dt.date) -> dict:
    base = f"{KEY_PREFIX}/{session.year}/{session.isoformat()}"
    return {"contracts": f"{base}.contracts.csv.gz", "underlyings": f"{base}.underlyings.csv.gz",
            "manifest": f"{base}.manifest.json"}


def run(*, now: Optional[_dt.datetime] = None, get=None, upload=None, api_key: Optional[str] = None,
        workdir: Optional[str] = None) -> dict:
    """One day's log. Returns the manifest (also uploaded). Never raises on a vendor
    failure -- that is a partial manifest; raises only on missing configuration."""
    from api.services import session_calendar

    now = now or _dt.datetime.now(_ET)
    session = now.astimezone(_ET).date()
    if not session_calendar.is_trading_day(session):
        return {"session": session.isoformat(), "skipped": "not a trading day"}
    api_key = api_key or os.environ.get("MASSIVE_API_KEY")
    if not api_key:
        raise RuntimeError("MASSIVE_API_KEY is not set on this service")
    if get is None:
        import httpx
        client = httpx.Client(timeout=60)

        def get(url):
            r = client.get(url)
            r.raise_for_status()
            return r.json()
    if upload is None:
        upload = _r2_upload

    started = time.time()
    tmp = workdir or tempfile.mkdtemp(prefix="options_log_")
    c_path = os.path.join(tmp, "contracts.csv.gz")
    u_path = os.path.join(tmp, "underlyings.csv.gz")
    summary = _Summary(session)
    n = with_iv = 0
    receipt = {"pages": 0, "complete": False, "reason": "walk did not finish"}
    with gzip.open(c_path, "wt", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=CONTRACT_FIELDS)
        w.writeheader()
        for rec in walk(get, api_key):
            if "_receipt" in rec:
                receipt = rec["_receipt"]
                continue
            row = contract_row(rec)
            if row is None:
                continue
            w.writerow(row)
            summary.add(row)
            n += 1
            with_iv += row["iv"] is not None
    with gzip.open(u_path, "wt", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=UNDERLYING_FIELDS)
        w.writeheader()
        n_und = 0
        for row in summary.rows():
            w.writerow(row)
            n_und += 1
    keys = keys_for(session)
    manifest = {
        "session": session.isoformat(), "contracts": n, "underlyings": n_und,
        "with_iv": with_iv, "pages": receipt["pages"], "complete": receipt["complete"],
        "reason": receipt["reason"], "seconds": round(time.time() - started, 1),
        "bytes": {"contracts": os.path.getsize(c_path), "underlyings": os.path.getsize(u_path)},
        "keys": keys, "source": "Massive /v3/snapshot?type=options",
    }
    upload(c_path, keys["contracts"], "application/gzip")
    upload(u_path, keys["underlyings"], "application/gzip")
    m_path = os.path.join(tmp, "manifest.json")
    with open(m_path, "w", encoding="utf-8") as fh:
        json.dump(manifest, fh, indent=1)
    upload(m_path, keys["manifest"], "application/json")
    for p in (c_path, u_path, m_path):
        try:
            os.remove(p)
        except OSError:
            pass
    return manifest


def _r2_upload(path: str, key: str, content_type: str) -> None:
    from api import flow_backup
    client, bucket = flow_backup._r2_client(), flow_backup._bucket()
    if client is None or not bucket:
        raise RuntimeError("DATA_SYNC_* R2 credentials are not set on this service")
    client.upload_file(path, bucket, key, ExtraArgs={"ContentType": content_type})


def receipt_text(m: dict) -> tuple[str, str, bool]:
    """(title, body, alert) for the monitor's post."""
    if m.get("skipped"):
        return ("Options log: skipped", f"{m['session']}: {m['skipped']}.", False)
    mb = m["bytes"]["contracts"] / 1e6
    body = (f"{m['session']}: {m['contracts']:,} contracts across {m['underlyings']:,} underlyings "
            f"({m['with_iv']:,} with IV), {m['pages']:,} pages in {m['seconds']:.0f}s, "
            f"{mb:.0f} MB compressed -> `{m['keys']['contracts']}`.")
    if not m["complete"]:
        return ("Options log: PARTIAL", body + f" Incomplete: {m['reason']}.", True)
    return ("Options log: recorded", body, False)
