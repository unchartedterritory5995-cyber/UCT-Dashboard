"""Flow card parity audit: the Discord /flow card vs the Options Flow page's OWN product.

WHY A SECOND SOURCE. docs/discord-render/instruments/w8_accuracy_audit.py checks the card
against the RAW tape (an upper bound) and against itself (sums, ordering). Neither says
whether the card agrees with what a member sees on the Options Flow page for the same name
and window, and on 2026-09-24 it did not: "/flow DELL" read "no significant options flow
today" while the page's Search view for DELL that day read BULL $7.84M vs BEAR $3.81M over
108 directional prints. Same tape (flow.db), two derivations:

  * the PAGE: GET /api/flow/ticker-product/{sym}, which is processFlowData (the partner's
    app/src/pages/optionsFlow/flowCompute.js) run server-side over the ticker's full
    history, then scoped by date at render time (_scopeAllDirectional in OptionsFlow.jsx).
  * the CARD: GET /api/live/massive/ticker-flow, which is
    live_massive_router._build_by_contract over the same rows, through _row_to_alert and
    the By-Contract rollup.

This tool puts the two side by side for the SAME symbol and SAME dates so the gap is a
number, not an impression. It does not decide which derivation is right.

Run (needs SMOKE_EMAIL / SMOKE_PASSWORD in the environment, the account
tools/mobile_audit.py already uses; nothing is printed but that account's own reads):

    python tools/flow_card_parity_audit.py --symbols DELL,BP,ASTS --days 1
    python tools/flow_card_parity_audit.py --symbols DELL --days 5 --json
    python tools/flow_card_parity_audit.py --self-check

--self-check proves the pure comparison fires on an empty card, a flipped direction and an
alien contract, and stays quiet on agreement, without touching production.

A head name the server declines ("too big to derive within budget") is reported as
INCONCLUSIVE on the page side, never as zero: the page itself falls back to deriving the
same product in the browser for those names.
"""
from __future__ import annotations

import argparse
import collections
import datetime as dt
import http.cookiejar
import json
import os
import sys
import urllib.error
import urllib.request

BASE = os.environ.get("UCT_BASE_URL", "https://uctintelligence.com")
UA = "Mozilla/5.0 (flow-card-parity-audit)"


# ---- pure ------------------------------------------------------------------------------

def _mdy(s: str, year: int | None = None) -> dt.date | None:
    """'9/24/2026', '10/9/26' or the product's year-less '9/24' -> date."""
    try:
        parts = [int(x) for x in str(s).strip().split("/")]
    except ValueError:
        return None
    if len(parts) == 3:
        m, d, y = parts
        y = y + 2000 if y < 100 else y
        return dt.date(y, m, d)
    if len(parts) == 2:
        return dt.date(year or dt.date.today().year, parts[0], parts[1])
    return None


def _contract_key(cp, strike, exp) -> tuple:
    e = _mdy(exp)
    try:
        k = float(str(strike).lstrip("$"))
    except ValueError:
        k = str(strike)
    return (str(cp or "").upper()[:1], k, e.isoformat() if e else str(exp))


def scope_page_rows(all_directional: list, window_dates: set) -> list:
    """The page's _scopeAllDirectional for an explicit set of trading dates."""
    return [r for r in all_directional if _mdy(r.get("Dt") or "") in window_dates]


def page_summary(rows: list) -> dict:
    bull = sum(float(r.get("P") or 0) for r in rows if r.get("D") == "BULL")
    bear = sum(float(r.get("P") or 0) for r in rows if r.get("D") == "BEAR")
    by = collections.defaultdict(float)
    for r in rows:
        by[_contract_key(r.get("CP"), r.get("K"), r.get("E"))] += float(r.get("P") or 0)
    top = sorted(by.items(), key=lambda kv: -kv[1])
    return {"prints": len(rows), "bull": round(bull), "bear": round(bear),
            "dir": "BULL" if bull > bear else ("BEAR" if bear > bull else "NEUTRAL"),
            "contracts": len(by), "top": [(k, round(v)) for k, v in top[:10]]}


def card_summary(payload: dict) -> dict:
    net = payload.get("net") or {}
    cs = payload.get("contracts") or []
    return {"contract_count": payload.get("contract_count"),
            "bull": round(float(net.get("bull") or 0)), "bear": round(float(net.get("bear") or 0)),
            "unclassified": round(float(net.get("unclassified") or 0)),
            "dir": net.get("dir") or "NEUTRAL",
            "window": payload.get("window") or {},
            "top": [(_contract_key(c.get("cp"), c.get("strike"), c.get("exp")),
                     round(float(c.get("premium") or 0))) for c in cs],
            # the contracts the CARD gave a side to; only these can be checked against the page's
            # directional rows, because a side-less card contract can never appear there
            "sided": [_contract_key(c.get("cp"), c.get("strike"), c.get("exp")) for c in cs
                      if str(c.get("direction") or "").upper() in ("BULL", "BEAR", "MIXED")]}


def compare(page: dict, card: dict) -> dict:
    """The verdict for one symbol/window. Pure, so --self-check can plant a disagreement.

    Two PROBLEMS (a DISAGREE verdict): the card is empty while the page has directional prints,
    or the two net directions contradict each other. Everything else is reported as a NOTE:
    the page's `all_directional` holds only prints its classifier gave a side, so a card
    contract the page has no row for is a classifier difference (the card sided a print the
    page left side-less), not a defect -- and it is counted, not failed. The first cut of this
    instrument failed every symbol on that count and read as 'nothing agrees' the day after the
    direction flip it was built to catch had actually been fixed."""
    page_keys = {k for k, _ in page["top"]}
    card_keys = {k for k, _ in card["top"]}
    sided = list(card.get("sided") or [])
    sided_not_on_page = sorted(str(k) for k in set(sided) - page_keys)
    problems, notes = [], []
    if page["prints"] > 0 and (card["contract_count"] or 0) == 0:
        problems.append("card EMPTY while the page has %d directional prints (BULL $%s / BEAR $%s)"
                        % (page["prints"], format(page["bull"], ","), format(page["bear"], ",")))
    if page["dir"] != "NEUTRAL" and card["dir"] != "NEUTRAL" and page["dir"] != card["dir"]:
        problems.append("net direction disagrees: page %s vs card %s" % (page["dir"], card["dir"]))
    if sided_not_on_page:
        notes.append("card sided %d of %d contracts the page left side-less, e.g. %s"
                     % (len(sided_not_on_page), len(sided), sided_not_on_page[:3]))
    return {"agree_direction": page["dir"] == card["dir"],
            "card_contracts_on_page": len(card_keys & page_keys), "card_contracts": len(card_keys),
            "card_sided": len(sided), "card_sided_on_page": len(set(sided) & page_keys),
            "problems": problems, "notes": notes}


# ---- I/O -------------------------------------------------------------------------------

def _opener():
    cj = http.cookiejar.CookieJar()
    op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
    op.addheaders = [("User-Agent", UA)]
    return op


def login(op) -> bool:
    email, pw = os.environ.get("SMOKE_EMAIL"), os.environ.get("SMOKE_PASSWORD")
    if not (email and pw):
        print("! SMOKE_EMAIL / SMOKE_PASSWORD not set; the page product needs a signed-in member",
              file=sys.stderr)
        return False
    body = json.dumps({"email": email, "password": pw}).encode()
    req = urllib.request.Request(BASE + "/api/auth/login", data=body,
                                 headers={"Content-Type": "application/json"})
    try:
        return op.open(req, timeout=60).status == 200
    except urllib.error.HTTPError as e:
        print("! login HTTP %s" % e.code, file=sys.stderr)
        return False


def fetch_page_product(op, sym: str, source: str, window_days: int = 0):
    """-> (all_directional | None, note).

    `window_days=N` asks for the WINDOWED product (`?window_days=N`, option A's derivation over the
    symbol's last N sessions) instead of the full-history one the page itself serves. Comparing
    the two is the residual the flip decision needs: the windowed derivation sees only the
    window's rows, so its contract-level rules can answer differently."""
    # The page names the ETF/index partition `indexes`; the card names it `etfs`. Passing the
    # card's word through made the page read the STOCKS partition for SPY and answer empty.
    page_source = "indexes" if source == "etfs" else "stocks"
    q = "source=%s" % page_source + ("&window_days=%d" % window_days if window_days else "")
    try:
        r = op.open("%s/api/flow/ticker-product/%s?%s" % (BASE, sym, q), timeout=180)
        d = json.loads(r.read().decode())
        note = "version %s" % d.get("version")
        if window_days:
            note += " windowed=%s" % (d.get("window_dates") or [])
        return (d.get("product") or {}).get("all_directional") or [], note
    except urllib.error.HTTPError as e:
        try:
            why = json.loads(e.read().decode()).get("error")
        except Exception:  # noqa: BLE001
            why = None
        return None, ("HTTP %s %s" % (e.code, why or "")).strip()


def fetch_card(op, sym: str, source: str, days: str, widen: bool) -> dict:
    q = "symbol=%s&days=%s&source=%s" % (sym, days, source) + ("&widen=1" if widen else "")
    r = op.open("%s/api/live/massive/ticker-flow?%s" % (BASE, q), timeout=120)
    return json.loads(r.read().decode())


def trading_dates_from_page(all_directional: list, days: str, end: dt.date) -> set:
    """The page's 'Last N' is the last N MARKET days. Without the market calendar here, the
    ticker's own dates <= end stand in for it. A thin name therefore reaches further back than
    the page would; the dates compared are printed so that is visible, not hidden."""
    dates = sorted({d for d in (_mdy(r.get("Dt") or "", end.year) for r in all_directional)
                    if d and d <= end}, reverse=True)
    if str(days).lower() == "all":
        return set(dates)
    return set(dates[: max(1, int(days))])


def run(symbols: list, days: str, source: str, widen: bool, end: dt.date, page_window: int = 0) -> dict:
    op = _opener()
    if not login(op):
        return {"ok": False, "error": "login"}
    out = {"ok": True, "base": BASE, "days": days, "end": end.isoformat(), "page_window": page_window,
           "results": []}
    for sym in symbols:
        row = {"symbol": sym}
        ad, note = fetch_page_product(op, sym, source, window_days=page_window)
        row["page_note"] = note
        # A card fetch that fails is that symbol's INCONCLUSIVE, never the whole run's crash: a
        # 502 during a web swap took down a six-symbol run once (2026-09-25) and left no rows.
        try:
            card_payload = fetch_card(op, sym, source, days, widen)
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, OSError) as e:
            row["card"] = None
            row["verdict"] = "INCONCLUSIVE (card fetch failed: %s)" % str(e)[:80]
            out["results"].append(row)
            continue
        card = card_summary(card_payload)
        row["card"] = card
        if ad is None:
            row["verdict"] = "INCONCLUSIVE (page product not derivable: %s)" % note
        else:
            win = card["window"] or {}
            # Judge over the dates the CARD actually served, so a widened card is compared
            # against the page's view of the same dates.
            served_days = str(win.get("days_requested") or days)
            dates = trading_dates_from_page(ad, served_days, end)
            page = page_summary(scope_page_rows(ad, dates))
            row["page"] = page
            row["dates_compared"] = sorted(d.isoformat() for d in dates)
            row["compare"] = compare(page, card)
            row["verdict"] = "AGREE" if not row["compare"]["problems"] else "DISAGREE"
        out["results"].append(row)
    return out


def self_check() -> int:
    page = page_summary([
        {"Dt": "9/24", "CP": "C", "K": 535, "E": "10/9", "P": 1_000_000, "D": "BULL"},
        {"Dt": "9/24", "CP": "P", "K": 500, "E": "10/9", "P": 200_000, "D": "BEAR"},
    ])
    empty_card = card_summary({"contract_count": 0, "contracts": [], "net": {"dir": "NEUTRAL"}})
    assert compare(page, empty_card)["problems"], "an empty card beside a live page must FIRE"
    bear_card = card_summary({"contract_count": 1, "net": {"bull": 0, "bear": 5, "dir": "BEAR"},
                              "contracts": [{"cp": "P", "strike": 500, "exp": "10/9/2026", "premium": 5}]})
    assert any("direction" in p for p in compare(page, bear_card)["problems"]), "a flipped direction must FIRE"
    good_card = card_summary({"contract_count": 1, "net": {"bull": 9, "bear": 0, "dir": "BULL"},
                              "contracts": [{"cp": "C", "strike": 535, "exp": "10/9/2026", "premium": 9}]})
    assert compare(page, good_card)["problems"] == [], "an agreeing card must stay QUIET"
    alien = card_summary({"contract_count": 1, "net": {"bull": 9, "bear": 0, "dir": "BULL"},
                          "contracts": [{"cp": "C", "strike": 999, "exp": "10/9/2026", "premium": 9,
                                         "direction": "Bull"}]})
    r = compare(page, alien)
    assert r["problems"] == [] and any("side-less" in n for n in r["notes"]), (
        "a card-sided contract the page left side-less is a NOTE, never a failure")
    unsided = card_summary({"contract_count": 1, "net": {"bull": 0, "bear": 0, "dir": "NEUTRAL"},
                            "contracts": [{"cp": "C", "strike": 999, "exp": "10/9/2026", "premium": 9,
                                           "direction": "Unclear"}]})
    assert compare(page, unsided)["notes"] == [], "an unsided card contract is not even a note"
    assert scope_page_rows([{"Dt": "9/24"}, {"Dt": "9/23"}], {_mdy("9/24")}) == [{"Dt": "9/24"}]
    assert _mdy("10/9/26") == dt.date(2026, 10, 9) and _mdy("10/9/2026") == dt.date(2026, 10, 9)
    print("self-check OK: fires on empty / flipped, notes a sided-vs-side-less contract, quiet on agreement")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description="Discord /flow card vs the Options Flow page product")
    ap.add_argument("--symbols", default="DELL,BP,ASTS")
    ap.add_argument("--days", default="1")
    ap.add_argument("--source", default="stocks", choices=("stocks", "etfs"))
    ap.add_argument("--widen", action="store_true",
                    help="ask the card endpoint to widen (the Discord path's flag)")
    ap.add_argument("--end", default=None, help="last trading date to include, YYYY-MM-DD (default today)")
    ap.add_argument("--page-window", type=int, default=0,
                    help="compare against the page's WINDOWED product (?window_days=N, option A's derivation) "
                         "instead of its full-history one; run once with and once without to measure the residual")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--self-check", action="store_true")
    a = ap.parse_args()
    if a.self_check:
        return self_check()
    end = dt.date.fromisoformat(a.end) if a.end else dt.date.today()
    syms = [s.strip().upper() for s in a.symbols.split(",") if s.strip()]
    res = run(syms, a.days, a.source, a.widen, end, page_window=a.page_window)
    if not res.get("ok"):
        print(res)
        return 2
    for r in res["results"]:
        c = r["card"]
        p = r.get("page")
        if c is None:
            print("== %s  days=%s" % (r["symbol"], res["days"])); print("   VERDICT: %s" % r["verdict"])
            continue
        print("== %s  days=%s  card window=%s" % (r["symbol"], res["days"], c["window"]))
        print("   CARD: %s contracts  BULL $%s  BEAR $%s  UNCL $%s  net %s"
              % (c["contract_count"], format(c["bull"], ","), format(c["bear"], ","),
                 format(c["unclassified"], ","), c["dir"]))
        if p:
            print("   PAGE: %d prints / %d contracts  BULL $%s  BEAR $%s  net %s   (%s; dates %s)"
                  % (p["prints"], p["contracts"], format(p["bull"], ","), format(p["bear"], ","),
                     p["dir"], r["page_note"], r["dates_compared"]))
        print("   VERDICT: %s" % r["verdict"])
        for prob in (r.get("compare") or {}).get("problems", []):
            print("     - %s" % prob)
        for note in (r.get("compare") or {}).get("notes", []):
            print("     note: %s" % note)
    if a.json:
        print(json.dumps(res, indent=1, default=str))
    return 0 if all(r["verdict"] == "AGREE" for r in res["results"]) else 1


if __name__ == "__main__":
    sys.exit(main())
