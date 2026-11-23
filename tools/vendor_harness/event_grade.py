"""Track 4, unit E1 (2026-11-22): grade production's own event fetch against TradingView, per symbol and family.

The coordinator's ruling: vendor depth and values are measured through E1 deployed dark, never by reading a vendor
key on a PC. So this reads OUR answer from `GET /api/pine/events/{ticker}` (as an admin while the route is dark;
or from saved answers) and TRADINGVIEW's from our own probe captures (`vw-data-earnings` / `-dividends` /
`-splits`, local; their values never leave this PC: the report holds counts, dates and verdicts only).

For each (symbol, family) it answers the questions E2 needs before it places a single event:
  coverage   TradingView's first event against our `knownFrom`; events TradingView has that we lack, and the reverse
  placement  each of our events placed on the capture's chart bars by the witnessed rule (E0: `lookahead_on` puts
             an event dated d on the first bar closing at or after d's session close), against TradingView's bars
  values     on every bar both hold: exactly equal, equal at float32 (TradingView stores some fields as float32),
             within 1e-6 relative, within 1%; for earnings also after adjusting ours by the splits after the date
             (TradingView's actual is on today's share basis)
  verdict    MATCH-CAPABLE (placement and values exact), SUBSTITUTED (placement exact, values differ: served as
             UCT data and graded MATCH_SUBSTITUTED), DIVERGE (placement differs), or COVERAGE (we lack events)

    python tools/vendor_harness/event_grade.py --captures <run dir> --ours <dir of {SYM}.json> --out <report.json>
    python tools/vendor_harness/event_grade.py --captures <run dir> --base https://uctintelligence.com --out ...
        (--base signs in as the synthetic admin through tools/synthetic_session.py, which reads SMOKE_EMAIL /
         SMOKE_PASSWORD from the operator's environment by name, never printed, and signs the session OUT when the
         read ends, however it ends)
"""
from __future__ import annotations

import argparse
import datetime as _dt
import json
import os
import struct
import sys
import tempfile
import time
from typing import Iterable, Optional

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import event_witness as ew  # noqa: E402

# per family: the probe's on-row, the field of ours compared to it, and our date key
COMPARE = {
    "earnings": [("E01", "actual"), ("E05", "estimate")],
    "dividends": [("D01", "gross")],
    "splits": [("S01", "numerator"), ("S02", "denominator")],
}
DATE_KEY = {"earnings": "date", "dividends": "exDate", "splits": "date"}


def f32(x: float) -> float:
    return struct.unpack("f", struct.pack("f", float(x)))[0]


def _date(s: str) -> _dt.date:
    return _dt.date.fromisoformat(s[:10])


def place(event_day: str, bar_days: list[str], weekly: bool) -> Optional[str]:
    """The chart bar TradingView's `lookahead_on` read lands an event on (E0, R1): the first bar closing at or after
    the event day's session close. A D bar closes on its own day; a W bar on its week's last session, so an event
    dated on a weekend lands on the next week."""
    d = _date(event_day)
    if not weekly:
        for b in bar_days:
            if _date(b) >= d:
                return b
        return None
    cand = None
    for b in bar_days:
        if _date(b) <= d:
            cand = b
        else:
            break
    if cand is None:
        return bar_days[0] if bar_days else None
    if d.weekday() >= 5:
        i = bar_days.index(cand)
        return bar_days[i + 1] if i + 1 < len(bar_days) else None
    return cand


def _split_factor_after(day: str, splits: list[dict]) -> float:
    """How many of today's shares one share on `day` became: the product of every later split's ratio."""
    f = 1.0
    for s in splits:
        if s["date"] > day[:10] and s.get("numerator") and s.get("denominator"):
            f *= float(s["numerator"]) / float(s["denominator"])
    return f


def grade_one(cap: dict, ours: dict) -> dict:
    """One capture (a family on one chart) against our answer for its symbol."""
    fam = ew._family_of(cap)
    meta = cap["meta"]
    weekly = meta["timeframe"] in ("1W", "W")
    rows, c = cap["rows"], cap["cols"]
    bar_days = [ew._when(r[0], False) for r in rows]
    on_key = COMPARE[fam][0][0]
    tv_events = {bar_days[i]: i for i in range(len(rows)) if rows[i][c[on_key]] is not None}
    block = ((ours or {}).get("families") or {}).get(fam) or {}
    our_rows = block.get("rows") or []
    out = {"captureId": meta["captureId"], "symbol": meta["symbol"], "timeframe": meta["timeframe"], "family": fam,
           "ourState": block.get("state") or (ours or {}).get("state") or "missing",
           "tvEvents": len(tv_events), "tvFirst": min(tv_events) if tv_events else None,
           "ourKnownFrom": block.get("knownFrom"), "ourEvents": len(our_rows)}
    if not our_rows:
        out["verdict"] = "NO-DATA" if tv_events else ("MATCH-CAPABLE" if out["ourState"] == "empty" else "NO-DATA")
        return out
    placed = {}
    for r in our_rows:
        b = place(r[DATE_KEY[fam]], bar_days, weekly)
        if b is not None:
            placed.setdefault(b, []).append(r)
    window_start = bar_days[0] if bar_days else ""
    both = sorted(set(placed) & set(tv_events))
    tv_only = sorted(set(tv_events) - set(placed))
    ours_only = sorted(set(placed) - set(tv_events))
    known = block.get("knownFrom") or ""
    out["placement"] = {"both": len(both), "tvOnly": len(tv_only), "oursOnly": len(ours_only),
                        "tvOnlyBeforeKnownFrom": sum(1 for b in tv_only if b < known),
                        "tvOnlyFirst": tv_only[:8], "oursOnlyFirst": ours_only[:8],
                        "collisions": sum(1 for v in placed.values() if len(v) > 1),
                        "windowStart": window_start}
    splits = (((ours or {}).get("families") or {}).get("splits") or {}).get("rows") or []
    vals = {}
    for tv_key, our_key in COMPARE[fam]:
        if tv_key not in c:
            continue
        tally = {"compared": 0, "exact": 0, "float32": 0, "rel1e-6": 0, "rel1pct": 0}
        if fam == "earnings":
            tally.update({"splitAdjustedRel1e-6": 0, "splitAdjustedRel1pct": 0})
        for b in both:
            tv = rows[tv_events[b]][c[tv_key]]
            ov = placed[b][-1].get(our_key)
            if tv is None or ov is None:
                continue
            tally["compared"] += 1
            tally["exact"] += ov == tv
            tally["float32"] += f32(ov) == f32(tv)
            rel = abs(ov - tv) / max(abs(tv), 1e-12)
            tally["rel1e-6"] += rel <= 1e-6
            tally["rel1pct"] += rel <= 0.01
            if fam == "earnings":
                adj = ov / _split_factor_after(placed[b][-1][DATE_KEY[fam]], splits)
                rel2 = abs(adj - tv) / max(abs(tv), 1e-12)
                tally["splitAdjustedRel1e-6"] += rel2 <= 1e-6
                tally["splitAdjustedRel1pct"] += rel2 <= 0.01
        vals[our_key] = tally
    out["values"] = vals
    placement_exact = not tv_only and not ours_only
    first = vals.get(COMPARE[fam][0][1]) or {}
    values_exact = first.get("compared") and (first["float32"] == first["compared"] or first["exact"] == first["compared"])
    if tv_only and all(b < known for b in tv_only) and not ours_only:
        out["verdict"] = "COVERAGE"
    elif not placement_exact:
        out["verdict"] = "DIVERGE"
    elif values_exact:
        out["verdict"] = "MATCH-CAPABLE"
    else:
        out["verdict"] = "SUBSTITUTED"
    return out


# ── our side: saved answers, or production read as an admin ────────────────────────────────────────────────────
def _plain(sym_full: str) -> str:
    return sym_full.split(":")[-1]


def ours_from_dir(d: str, sym: str) -> Optional[dict]:
    p = os.path.join(d, f"{sym}.json")
    if not os.path.isfile(p):
        return None
    with open(p, encoding="utf-8") as fh:
        return json.load(fh)


def _synthetic_session():
    """tools/synthetic_session.py: the ONE sign-in for a synthetic account. This tool never posts a login itself and
    never reads the credential; the helper does both, and every session it opens is signed out."""
    try:
        from tools import synthetic_session as S  # noqa: PLC0415 -- package import (repo root on sys.path)
    except ImportError:
        sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))  # tools/
        import synthetic_session as S  # noqa: PLC0415 -- script import (tools/ on sys.path)
    return S


def ours_from_base(base: str, syms: Iterable[str], wait_s: int = 120) -> dict:
    """Sign in as the operator's synthetic admin through tools/synthetic_session.py and read each symbol, waiting
    out `pending` (202) while the background lane fetches. The session is signed out when the read ends: on a
    normal return, a refusal, an exception or Ctrl-C (the `with` below; the helper's atexit is the backstop)."""
    S = _synthetic_session()
    if not S.has_credentials("smoke"):
        raise SystemExit("SMOKE_EMAIL / SMOKE_PASSWORD are not set in this environment")
    import httpx
    out = {}
    with httpx.Client(base_url=base, timeout=30, follow_redirects=True) as cl:
        try:
            session = S.sign_in_client(cl, base, "smoke")
        except S.SignInError as exc:  # the helper left no session behind; its message names no secret
            raise SystemExit(f"sign-in refused: {exc}") from None
        with session:
            if not session.ok:
                raise SystemExit(f"sign-in refused: HTTP {session.status}")
            out = _read_events(cl, syms, wait_s)
    return out


def _read_events(cl, syms: Iterable[str], wait_s: int) -> dict:
    out = {}
    for sym in syms:
        deadline = time.time() + wait_s
        while True:
            r = cl.get(f"/api/pine/events/{sym}")
            if r.status_code == 202 and time.time() < deadline:
                time.sleep(5)
                continue
            out[sym] = r.json() if r.status_code in (200, 202) else {"state": f"http-{r.status_code}"}
            break
    return out


def grade(captures_dir: str, ours: dict) -> dict:
    results = []
    for name in sorted(os.listdir(captures_dir)):
        cap = ew.load(os.path.join(captures_dir, name))
        if ew._family_of(cap) is None or cap["intraday"]:
            continue
        results.append(grade_one(cap, ours.get(_plain(cap["meta"]["symbol"]))))
    counts = {}
    for r in results:
        counts[r["verdict"]] = counts.get(r["verdict"], 0) + 1
    return {"schema": "uct.t4-event-grade/v1", "generatedBy": "tools/vendor_harness/event_grade.py",
            "note": "counts, dates and verdicts only; no TradingView value", "verdicts": counts, "results": results}


def main(argv: Iterable[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--captures", required=True, help="a probe capture run dir (its captures/ folder is read)")
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--ours", help="a folder of saved /api/pine/events answers, one {SYM}.json each")
    g.add_argument("--base", help="read production as the synthetic admin, e.g. https://uctintelligence.com")
    ap.add_argument("--out", required=True)
    a = ap.parse_args(list(argv) if argv is not None else None)
    cdir = os.path.join(a.captures, "captures") if os.path.isdir(os.path.join(a.captures, "captures")) else a.captures
    syms = sorted({_plain(ew.load(os.path.join(cdir, n))["meta"]["symbol"] or "") for n in os.listdir(cdir)})
    if a.ours:
        ours = {s: ours_from_dir(a.ours, s) for s in syms}
    else:
        ours = ours_from_base(a.base, syms)
    rep = grade(cdir, {k: v for k, v in ours.items() if v is not None})
    d = os.path.dirname(os.path.abspath(a.out))
    os.makedirs(d, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=d, suffix=".tmp")
    with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(rep, fh, indent=1, sort_keys=True)
        fh.write("\n")
    os.replace(tmp, a.out)
    for r in rep["results"]:
        print(f"{r['symbol']:14} {r['timeframe']:3} {r['family']:9} {r['verdict']:13} "
              f"tv {r['tvEvents']:4} ours {r['ourEvents']:4} placement {r.get('placement', {}).get('both', 0)}")
    print("VERDICTS:", rep["verdicts"])
    return 0


if __name__ == "__main__":
    sys.exit(main())
