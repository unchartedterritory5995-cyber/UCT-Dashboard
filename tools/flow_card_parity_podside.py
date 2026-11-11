#!/usr/bin/env python
"""Page-vs-card parity, run ON THE POD, with no member credentials.

    railway ssh --service flow-worker "cd /app && /opt/venv/bin/python tools/flow_card_parity_podside.py --symbols AMD,DELL,META,NVDA"
    railway ssh --service flow-worker "cd /app && /opt/venv/bin/python tools/flow_card_parity_podside.py --self-check"

⛔ READ-ONLY. GETs only, against this pod's own loopback. It never writes a row, never
posts to Discord, never touches a threshold.

WHY A SECOND TRANSPORT, WHEN `tools/flow_card_parity_audit.py` ALREADY ASKS THE QUESTION.
That tool signs in as `smoke@uctintelligence.internal` and reads over the public domain, so
it needs SMOKE_EMAIL / SMOKE_PASSWORD -- which live, by the rule in CLAUDE.md, in ONE
operator's environment via `setx`. Measured 2026-11-08: absent in both User and Machine
scope on a second maintainer's box, so the audit simply could not be run from there and the
parity number went unmeasured. Every flow read also accepts the PUSH_SECRET bearer
(`flow_proxy.internal_read_headers`), and that secret is already in the pod's environment,
so the same question can be asked from inside with no human credential at all.

⭐ THE COMPARISON LOGIC IS IMPORTED, NOT REIMPLEMENTED. `scope_page_rows`, `page_summary`,
`card_summary`, `compare` and `trading_dates_from_page` all come from
`flow_card_parity_audit`. A second copy of the verdict rules would be a second authority
over one value, which is the defect this repo records more than any other. Only the
TRANSPORT differs. `--self-check` delegates to that module's own self-check, so a run still
proves the comparator can FIRE before any number it prints is believed.

⛔ WHICH POD YOU RUN THIS ON IS THE WHOLE MEANING OF THE ANSWER.
  * flow-worker owns the live tape and is where the Discord push scheduler runs. Measured
    2026-11-08: /data/flow.db there is ~17.1 GB, 212 sessions, current through 11/6/2026.
  * web's /data/flow.db is ~1.65 GB, 53 sessions, FROZEN at 7/14/2026 -- and that is FINE,
    because `FLOW_READS_PROXY_ENABLED=1` and `WORKER_INTERNAL_URL` are both set on web, so
    `flow_proxy` forwards every /api/flow/* read to flow-worker and, in its own words,
    "web's frozen flow.db is never consulted". ⚠️ Run this on `web` and the loopback read
    is proxied to flow-worker anyway, so the answer is flow-worker's either way. Run it on
    flow-worker to remove the hop.

⚠️ THE PAGE PRODUCT IS A REAL BUILD AND IT TAKES THE BUILD LANE. A cold one measured ~10.8 s
on prod and holds a lock written to keep members from colliding. Prefer off-hours, and
prefer `--window-days 1`.

⚰️ `CreatedDate` IS TEXT IN M/D/YYYY, SO `MAX(CreatedDate)` IS A LEXICOGRAPHIC MAX. On
2026-11-08 it answered '9/9/2026' against a tape whose newest session was 11/6/2026. Any
date this tool reports is parsed and sorted as a date, never compared as a string.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# ⛔ stdlib urllib, never httpx: httpx is MIA in the flow-worker container (CLAUDE.md).
from tools.flow_card_parity_audit import (  # noqa: E402
    card_summary,
    compare,
    page_summary,
    scope_page_rows,
    self_check,
    trading_dates_from_page,
)

UA = {"User-Agent": "UCT-FlowParity-PodSide/1.0"}


def base_url() -> str:
    """This pod's own app. PORT is what Railway binds uvicorn to."""
    port = (os.environ.get("PORT") or "8080").strip()
    return os.environ.get("UCT_POD_BASE_URL") or ("http://127.0.0.1:%s" % port)


def _headers() -> dict:
    """The SERVICE credential. ⛔ Never printed, never logged, never returned to a caller."""
    secret = (os.environ.get("PUSH_SECRET") or "").strip()
    if not secret:
        return {}
    h = dict(UA)
    h["Authorization"] = "Bearer " + secret
    return h


def _get(path: str, timeout: int = 180):
    """One read-only GET against this pod. Returns (status, parsed_json_or_None)."""
    url = base_url() + path
    req = urllib.request.Request(url, headers=_headers(), method="GET")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read()
            try:
                return r.status, json.loads(raw)
            except ValueError:
                return r.status, None
    except urllib.error.HTTPError as e:
        return e.code, None
    except Exception as e:  # noqa: BLE001
        print("  ! GET %s failed: %s" % (path, e), file=sys.stderr)
        return 0, None


def fetch_page(sym: str, source: str, window_days: int):
    """The PAGE's own product -- processFlowData run server-side, the member's derivation.

    ⚰️ TWO TRAPS, BOTH OF WHICH PRODUCED A FALSE CLEAN RUN ON 2026-11-08 BEFORE THEY WERE
    FIXED, and both are already recorded in `fetch_page_product`'s body in the HTTP tool:

    1. `all_directional` IS NESTED UNDER `product`. The response's top level is
       {ok, product, rows, schema, source, sym, version, window_dates, window_days}, so
       `body["all_directional"]` is always absent -> 0 prints -> every symbol compared an
       EMPTY page against a full card and the run exited 0. ⛔ A read of the wrong key does
       not fail, it answers nothing, and nothing in the comparator distinguishes those.
    2. THE TWO SURFACES NAME THE ETF PARTITION DIFFERENTLY -- the page calls it `indexes`,
       the card calls it `etfs`. Passing the card's word to the page makes it read the
       STOCKS partition and answer empty for SPY.
    """
    page_source = "indexes" if source in ("etfs", "indexes") else "stocks"
    q = {"source": page_source}
    if window_days > 0:
        q["window_days"] = str(window_days)
    status, body = _get("/api/flow/ticker-product/%s?%s"
                        % (urllib.parse.quote(sym), urllib.parse.urlencode(q)))
    if status != 200 or not isinstance(body, dict) or not body.get("ok", True):
        return None, "page read HTTP %s%s" % (
            status, "" if status != 401 else " (PUSH_SECRET missing or wrong)")
    return body, None


def fetch_card(sym: str, source: str, days: str):
    """The CARD -- _build_by_contract through _row_to_alert, the Discord derivation."""
    card_source = "etfs" if source in ("etfs", "indexes") else "stocks"
    q = {"symbol": sym, "days": days, "source": card_source, "top_n": "40"}
    status, body = _get("/api/live/massive/ticker-flow?" + urllib.parse.urlencode(q))
    if status != 200 or not isinstance(body, dict):
        return None, "card read HTTP %s" % status
    return body, None


def run(symbols: list, days: str, source: str, window_days: int, end: dt.date) -> dict:
    out = {"base": base_url(), "end": end.isoformat(), "days": days,
           "source": source, "symbols": {}}
    if not _headers().get("Authorization"):
        out["could_not_ask"] = ("PUSH_SECRET is not in this pod's environment, so every "
                                "flow read is a 401 -- this is exit 2, not a pass")
        return out

    for sym in symbols:
        rec: dict = {}
        page_body, err = fetch_page(sym, source, window_days)
        if err:
            rec["inconclusive"] = err
            out["symbols"][sym] = rec
            continue
        card_body, err = fetch_card(sym, source, days)
        if err:
            rec["inconclusive"] = err
            out["symbols"][sym] = rec
            continue

        all_dir = (page_body.get("product") or {}).get("all_directional") or []
        # The page's own window when it reports one; otherwise its dates stand in for the
        # market calendar, exactly as the HTTP tool does, and the dates used are printed.
        wd = page_body.get("window_dates") or []
        if wd:
            from tools.flow_card_parity_audit import _mdy
            dates = {d for d in (_mdy(s, end.year) for s in wd) if d}
        else:
            dates = trading_dates_from_page(all_dir, days, end)

        page = page_summary(scope_page_rows(all_dir, dates))
        card = card_summary(card_body)
        rec["dates"] = sorted(d.isoformat() for d in dates)
        rec["page"] = {k: page[k] for k in ("prints", "bull", "bear", "dir", "contracts")}
        rec["card"] = {k: card[k] for k in ("contract_count", "bull", "bear", "dir")}
        rec["verdict"] = v = compare(page, card)

        # ⛔ THE DIRECTION THE IMPORTED COMPARATOR CANNOT FAIL ON, ADDED HERE RATHER THAN
        # FORKED INTO IT. `compare()` raises a problem for "card EMPTY while the page has
        # prints" and has NO mirror for "page empty while the card has contracts" -- so on
        # 2026-11-08 a probe bug that zeroed the page side scored 4/4 symbols "ok" at
        # exit 0, against cards carrying up to $35.7M. An instrument that cannot fail in
        # one direction will eventually be read as proof in that direction.
        # ⚠️ This is a PROBE-level check. `tools/flow_card_parity_audit.py` (the committed
        # HTTP tool, same comparator) still has the gap; extending the shared verdict rules
        # is a decision for whoever owns that instrument, not a silent edit from here.
        if page["prints"] == 0 and (card["contract_count"] or 0) > 0:
            v["problems"].append(
                "page EMPTY (0 directional prints) while the card has %d contracts "
                "(BULL $%s / BEAR $%s) -- either the page genuinely sided nothing, or this "
                "read asked the wrong question; do not report it as agreement"
                % (card["contract_count"], format(card["bull"], ","),
                   format(card["bear"], ",")))
        out["symbols"][sym] = rec
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--symbols", default="AMD,DELL,META,NVDA")
    ap.add_argument("--days", default="1", help="card window: an integer or 'all'")
    ap.add_argument("--window-days", type=int, default=1,
                    help="page window in market sessions; 0 = the full product (SLOW)")
    ap.add_argument("--source", default="stocks", choices=("stocks", "etfs", "indexes"))
    ap.add_argument("--end", default=None, help="last trading date, YYYY-MM-DD")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--self-check", action="store_true",
                    help="prove the IMPORTED comparator still fires; touches nothing")
    a = ap.parse_args()

    if a.self_check:
        return self_check()

    end = dt.date.fromisoformat(a.end) if a.end else dt.date.today()
    syms = [s.strip().upper() for s in a.symbols.split(",") if s.strip()]
    res = run(syms, a.days, a.source, a.window_days, end)

    if a.json:
        print(json.dumps(res, indent=2, sort_keys=True))
    else:
        print("FLOW PAGE-vs-CARD PARITY (pod-side, read-only)")
        print("  base=%s  end=%s  card_days=%s  page_window=%s"
              % (res["base"], res["end"], res["days"], a.window_days))
        if res.get("could_not_ask"):
            print("\n  COULD NOT BE ASKED: " + res["could_not_ask"])
        for sym, rec in res["symbols"].items():
            if rec.get("inconclusive"):
                print("  %-6s INCONCLUSIVE  %s" % (sym, rec["inconclusive"]))
                continue
            p, c, v = rec["page"], rec["card"], rec["verdict"]
            flag = "DISAGREE" if v["problems"] else "ok"
            print("  %-6s %-8s page %s (%d prints, BULL $%s / BEAR $%s)  |  "
                  "card %s (%s contracts, BULL $%s / BEAR $%s)"
                  % (sym, flag, p["dir"], p["prints"], format(p["bull"], ","),
                     format(p["bear"], ","), c["dir"], c["contract_count"],
                     format(c["bull"], ","), format(c["bear"], ",")))
            print("         dates=%s  card_contracts_on_page=%d/%d  card_sided_on_page=%d/%d"
                  % (",".join(rec["dates"]) or "none", v["card_contracts_on_page"],
                     v["card_contracts"], v["card_sided_on_page"], v["card_sided"]))
            for m in v["problems"]:
                print("         PROBLEM: " + m)
            for m in v["notes"]:
                print("         note:    " + m)

    if res.get("could_not_ask"):
        return 2
    recs = list(res["symbols"].values())
    if any(r.get("verdict", {}).get("problems") for r in recs):
        return 1
    if any(r.get("inconclusive") for r in recs):
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
