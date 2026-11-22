"""Track 4, unit E0 (2026-11-22): where TradingView places earnings, dividends and splits, derived from our own probe
captures, and the built-in VWAP's anchors read against them.

WHY. `request.earnings` / `request.dividends` / `request.splits` have no reference sentence in the repo that says on
which chart bar an event lands. The S4-2 probes (`tools/visual_conformance/probes/vw-data-*.pine`, licence `probe`)
were captured on 2026-11-20 (run `s4-closed-retake-2026-11-20`, 24 captures) and TradingView's own VWAP at its
Earnings / Dividends / Splits anchors on 2026-11-21 (run `s4-vwap-anchors-retake3-2026-11-21`, 7 captures, licence
held). This module turns those local captures into DERIVED FACTS ONLY (dates and placements, never a plotted
value: EPS figures and prices are TradingView's data and stay in the local capture store) and checks every
placement rule the event supply (E2) will be built on, by count, with every exception named.

THE RULES IT CHECKS (each a count over every event of every capture, exceptions listed):
  R1  on a D or W chart, `lookahead_on` places an event on one bar (`on`), and `lookahead_off` on the NEXT chart
      bar, except when the bar before `on` is more than one calendar day earlier on a D chart (the event dated on a
      non-session day: both reads land on the first session after it);
  R2  `gaps_off` carries the value from the event bar (`lookahead_on`) or from the next bar (the defaults,
      `lookahead_off`), and reads `na` before the first event;
  R3  on an intraday chart both reads land on the same bar, and the chart's FIRST bar carries the latest event
      before it under `gaps_on`;
  V1  the built-in VWAP at an event anchor restarts on exactly the event bars (earnings: the union of
      `earnings.actual` and `earnings.standardized`, as the built-in reads both).
Value checks (R2's carry, the dividend basis, `dividends.net`) run at derive time against the local values and are
recorded as counts; the committed document carries no value except a split's ratio, which is the corporate action
itself, not a vendor's figure.

    python tools/vendor_harness/event_witness.py derive --probe-run <run dir> --vwap-run <run dir> --out <json>
    python tools/vendor_harness/event_witness.py check  --doc docs/pine/evidence/2026-11-22-t4-e0-event-placement/placements.json

`check` needs no capture: it re-proves R1-R3 and V1 from the committed placements, so CI can hold the document.
"""
from __future__ import annotations

import argparse
import datetime as _dt
import hashlib
import json
import os
import sys
import tempfile
from typing import Iterable

SCHEMA = "uct.t4-event-placement/v1"
FAMILIES = ("earnings", "dividends", "splits")
#: per family: the probe's row titles (prefix before the first space) by role. `on` = gaps_on + lookahead_on (the
#: built-in VWAP's pairing), `off` = gaps_on + lookahead_off, `carry_on` = gaps_off + lookahead_on, `carry_off` =
#: the defaults (gaps_off + lookahead_off). Splits carry two fields; the numerator rows are the placement rows.
ROLES = {
    "earnings": {"on": "E01", "off": "E02", "carry_on": "E03", "carry_off": "E04",
                 "fields": {"estimate": "E05", "standardized": "E06"}},
    "dividends": {"on": "D01", "off": "D02", "carry_on": "D03", "carry_off": "D04",
                  "fields": {"net_on": "D05", "net_defaults": "D06"}},
    "splits": {"on": "S01", "off": "S03", "carry_on": None, "carry_off": "S05",
               "fields": {"denominator_on": "S02", "denominator_off": "S04", "denominator_defaults": "S06"}},
}
INTRADAY_TFS = frozenset({"1", "5", "15", "30", "60"})


# ── reading a capture ───────────────────────────────────────────────────────────────────────────────────────────
def _when(t: int, intraday: bool) -> str:
    """A bar's open as a date (D/W/M) or a UTC minute (intraday). `t` is unix seconds, negative before 1970."""
    d = _dt.datetime(1970, 1, 1, tzinfo=_dt.timezone.utc) + _dt.timedelta(seconds=int(t))
    return d.strftime("%Y-%m-%dT%H:%MZ") if intraday else d.strftime("%Y-%m-%d")


def load(path: str) -> dict:
    """{meta, cols: {title prefix: column index}, rows} of one vendor capture (`uct.vendor-capture/v1`)."""
    with open(path, "rb") as fh:
        raw = fh.read()
    doc = json.loads(raw.decode("utf-8"))
    titles = {p["id"]: str(p.get("title", "")).split(" ")[0] for p in doc["study"]["plots"]}
    fields = doc["plotValues"]["fields"]
    cols = {titles.get(f, f): i for i, f in enumerate(fields)}
    tf = str(doc.get("timeframe", ""))
    return {"meta": {"captureId": doc["id"], "captureSha256": hashlib.sha256(raw).hexdigest(),
                     "capturedAtUTC": doc.get("capturedAtUTC"), "symbol": (doc.get("symbol") or {}).get("full_name"),
                     "timeframe": tf, "study": doc["study"].get("title"),
                     "newestBarIsForming": doc.get("newestBarIsForming")},
            "cols": cols, "rows": doc["plotValues"]["rows"], "bars": (doc.get("bars") or {}).get("rows") or [],
            "intraday": tf in INTRADAY_TFS}


def _family_of(cap: dict) -> str | None:
    title = str(cap["meta"].get("study") or "").upper()
    for fam in FAMILIES:
        if title == f"UCTPROBE_VW_DATA_{fam.upper()}":
            return fam
    return None


# ── deriving the placements of one probe capture ───────────────────────────────────────────────────────────────
def derive_probe(cap: dict) -> dict:
    fam = _family_of(cap)
    if fam is None:
        raise ValueError(f"{cap['meta']['captureId']}: not an S4 placement probe ({cap['meta'].get('study')})")
    role = ROLES[fam]
    rows, c, intraday = cap["rows"], cap["cols"], cap["intraday"]
    when = [_when(r[0], intraday) for r in rows]
    n = len(rows)
    val = lambda i, key: rows[i][c[key]] if key in c else None  # noqa: E731

    on_ix = [i for i in range(n) if val(i, role["on"]) is not None]
    off_ix = [i for i in range(n) if val(i, role["off"]) is not None]
    off_set = set(off_ix)
    events, r1_held, r1_exc = [], 0, []
    for i in on_ix:
        nxt = i + 1 if i + 1 < n else None
        if intraday:
            off = i if i in off_set else (nxt if nxt in off_set else None)
        else:
            off = nxt if nxt in off_set else (i if i in off_set else None)
        ev = {"on": when[i], "prev": when[i - 1] if i > 0 else None, "next": when[nxt] if nxt is not None else None,
              "off": when[off] if off is not None else None}
        events.append(ev)
        if intraday:
            r1_held += off == i
        elif off == nxt and nxt is not None:
            r1_held += 1
        else:
            r1_exc.append(ev)
    # every off-read bar is accounted for by an event (none floats free). One shape is named, not stray: an
    # off-read on an event's OWN bar beside its normal next-bar off-read, the bar before the event more than one
    # calendar day earlier. The vendor held two records: one dated on the non-session day before the bar (its
    # off-read lands on the first session after it, the event bar) and one dated on the session (the next bar);
    # the on-reads of both land on the event bar, so it shows one value.
    off_of = {}
    for i in on_ix:
        nxt = i + 1 if i + 1 < n else None
        off_of[i] = (i if i in off_set else (nxt if nxt in off_set else None)) if intraday else             (nxt if nxt in off_set else (i if i in off_set else None))
    claimed = {j for j in off_of.values() if j is not None}
    two_records = []
    for j in off_ix:
        if (not intraday and j not in claimed and j in off_of and off_of[j] == j + 1 and j > 0
                and _gap_days(when[j - 1], when[j]) > 1):
            two_records.append(when[j])
            claimed.add(j)
    stray_off = [when[j] for j in off_ix if j not in claimed]

    def carry(key, source):
        """R2: a gaps_off row is the gaps_on row of the same lookahead, carried forward; na before its first value."""
        if not key or key not in c or source not in c:
            return None
        cur, mismatches, first_value = None, 0, None
        for k in range(n):
            if val(k, source) is not None:
                cur = val(k, source)
            if val(k, key) != cur:
                mismatches += 1
            if first_value is None and val(k, key) is not None:
                first_value = when[k]
        return {"row": key, "carries": source, "mismatches": mismatches, "firstValueBar": first_value}

    carries = {"carryOn": carry(role["carry_on"], role["on"]), "carryOff": carry(role["carry_off"], role["off"])}
    if fam == "splits":
        carries["carryDenominatorOff"] = carry("S06", "S04")
    out = {**cap["meta"], "family": fam, "bars": n, "firstBar": when[0] if n else None,
           "lastBar": when[-1] if n else None, "events": events,
           "rules": {"R1": {"held": r1_held, "of": len(on_ix), "exceptions": r1_exc, "strayOffBars": stray_off,
                            "twoRecordsOffBars": two_records},
                     "R2": {k: v for k, v in carries.items() if v is not None}}}
    if intraday:
        first_on = bool(on_ix) and on_ix[0] == 0
        out["rules"]["R3"] = {"firstBarCarries": first_on, "sameBar": r1_held, "of": len(on_ix)}
    out["fields"] = _fields(fam, role, cap, on_ix, when)
    return out


def _fields(fam, role, cap, on_ix, when) -> dict:
    rows, c = cap["rows"], cap["cols"]
    on_set = set(on_ix)
    res = {}
    for name, key in role["fields"].items():
        if key not in c:
            continue
        ix = [i for i in range(len(rows)) if rows[i][c[key]] is not None]
        res[name] = {"nonNa": len(ix), "onEventBars": sum(1 for i in ix if i in on_set),
                     "offEventBars": [when[i] for i in ix if i not in on_set][:400]}
    if fam == "splits":
        den = role["fields"]["denominator_on"]
        res["ratios"] = [{"on": when[i], "numerator": rows[i][c[role["on"]]], "denominator": rows[i][c[den]]}
                         for i in on_ix]
    if fam == "dividends" and "D05" in c:
        # dividends.net: present only before the symbol's latest split? recorded as the last bar it is present on
        net = [i for i in on_ix if rows[i][c["D05"]] is not None]
        res["net_on"]["lastPresentOn"] = when[net[-1]] if net else None
        # gross as declared: the on-row value is never the net (split-adjusted) one where both exist
        res["grossEqualsNet"] = sum(1 for i in net if rows[i][c[role["on"]]] == rows[i][c["D05"]])
    return res


# ── the built-in VWAP's anchors ─────────────────────────────────────────────────────────────────────────────────
def derive_vwap(cap: dict, events_by_key: dict) -> dict:
    """V1: the bars where the built-in's VWAP restarts (its value equals the bar's hlc3 and differs from the bar
    before), against the probe's event bars for the same symbol, timeframe and family."""
    meta = cap["meta"]
    cid = meta["captureId"]
    fam = next((f for f in FAMILIES if f"-{f}-" in cid), None)
    intraday = cap["intraday"]
    bars = {b[0]: b for b in cap["bars"]}
    vcol = cap["cols"].get("VWAP")
    resets, flat, first, prev = [], [], None, None
    for r in cap["rows"]:
        v = r[vcol]
        if v is None:
            continue
        b = bars.get(r[0])
        w = _when(r[0], intraday)
        if first is None:
            first = w
        if b is not None:
            h = (b[2] + b[3] + b[4]) / 3.0
            if abs(v - h) <= 1e-9 * max(1.0, abs(h)):
                (resets if v != prev else flat).append(w)
        prev = v
    key = (meta["symbol"], meta["timeframe"], fam)
    ev = events_by_key.get(key)
    out = {**meta, "family": fam, "firstStudyBar": first, "resets": resets, "unchangedVwapEqualsHlc3": flat}
    if ev is not None:
        evs = sorted(e for e in ev if e >= (first or ""))
        out["V1"] = {"eventsInWindow": len(evs), "both": len(set(evs) & set(resets)),
                     "resetOnly": sorted(set(resets) - set(evs)), "eventOnly": sorted(set(evs) - set(resets))}
    return out


def derive_probe_anchors(cap: dict, events_by_key: dict) -> dict:
    """V0: our own anchor probe (vw-data-vwap-anchors.pine) flags 1 on each event bar of its family (V04 earnings
    actual, V05 dividends, V06 splits, all gaps_on + lookahead_on): the same bars as the placement probe's."""
    meta, rows, c = cap["meta"], cap["rows"], cap["cols"]
    out = {**meta, "bars": len(rows), "flags": {}}
    for key, fam in (("V04", "earnings"), ("V05", "dividends"), ("V06", "splits")):
        flagged = [_when(r[0], cap["intraday"]) for r in rows if key in c and r[c[key]] == 1]
        ev = events_by_key.get((meta["symbol"], meta["timeframe"], fam + ":actual" if fam == "earnings" else fam))
        row = {"flagged": len(flagged), "firstBar": _when(rows[0][0], cap["intraday"]) if rows else None,
               "flaggedBars": flagged}
        if ev is not None:
            row["notAnEvent"] = sorted(set(flagged) - ev)
            row["eventNotFlagged"] = sorted(e for e in ev - set(flagged) if e >= (row["firstBar"] or ""))
        out["flags"][fam] = row
    return out


def derive(probe_run: str, vwap_run: str | None) -> dict:
    caps = sorted(os.listdir(os.path.join(probe_run, "captures")))
    probes, events_by_key = [], {}
    for name in caps:
        cap = load(os.path.join(probe_run, "captures", name))
        if _family_of(cap) is None:
            continue
        p = derive_probe(cap)
        probes.append(p)
        evs = {e["on"] for e in p["events"]}
        events_by_key[(p["symbol"], p["timeframe"], p["family"] + (":actual" if p["family"] == "earnings" else ""))] = set(evs)
        if p["family"] == "earnings":
            # the built-in's earnings anchor reads actual OR standardized: its event set is the union
            evs |= _std_bars(cap)
        events_by_key[(p["symbol"], p["timeframe"], p["family"])] = evs
    anchors, future = [], []
    for name in caps:
        cap = load(os.path.join(probe_run, "captures", name))
        title = str(cap["meta"].get("study") or "")
        if title == "UCTPROBE_VW_DATA_VWAP_ANCHORS":
            anchors.append(derive_probe_anchors(cap, events_by_key))
        elif title == "UCTPROBE_VW_DATA_EARNINGS_FUTURE":
            future.append({**cap["meta"], "bars": len(cap["rows"]),
                           "nonNa": {k: sum(1 for r in cap["rows"] if r[i] is not None)
                                     for k, i in sorted(cap["cols"].items()) if k.startswith("F0") and k != "F05"}})
    vwaps = []
    if vwap_run:
        for name in sorted(os.listdir(os.path.join(vwap_run, "captures"))):
            vwaps.append(derive_vwap(load(os.path.join(vwap_run, "captures", name)), events_by_key))
    return {"schema": SCHEMA, "generatedBy": "tools/vendor_harness/event_witness.py derive",
            "runs": {"probe": os.path.basename(os.path.normpath(probe_run)),
                     "vwap": os.path.basename(os.path.normpath(vwap_run)) if vwap_run else None},
            "note": "derived dates and placements only; no plotted value except a split's ratio",
            "probes": probes, "probeAnchors": anchors, "earningsFuture": future, "vwap": vwaps}


def _std_bars(cap: dict) -> set:
    c, rows = cap["cols"], cap["rows"]
    k = ROLES["earnings"]["fields"]["standardized"]
    return {_when(r[0], cap["intraday"]) for r in rows if k in c and r[c[k]] is not None}


# ── check: the committed document re-proves every rule, no capture needed ───────────────────────────────────────
def _gap_days(a: str, b: str) -> int:
    return (_dt.date.fromisoformat(b[:10]) - _dt.date.fromisoformat(a[:10])).days


def check(doc: dict) -> list[str]:
    """Every rule violation, by capture and event. An empty list is the pass."""
    bad = []
    if doc.get("schema") != SCHEMA:
        return [f"schema {doc.get('schema')!r} is not {SCHEMA}"]
    for p in doc.get("probes", []):
        cid, intraday = p["captureId"], p["timeframe"] in INTRADAY_TFS
        r1 = p["rules"]["R1"]
        if r1["of"] != len(p["events"]):
            bad.append(f"{cid}: R1 counts {r1['of']} events, the document lists {len(p['events'])}")
        if r1["strayOffBars"]:
            bad.append(f"{cid}: lookahead_off bars no event explains: {r1['strayOffBars'][:5]}")
        for ev in p["events"]:
            if intraday:
                if ev["off"] != ev["on"]:
                    bad.append(f"{cid}: intraday event {ev['on']} read off at {ev['off']} (R3: the same bar)")
                continue
            if ev["off"] == ev["next"] and ev["next"] is not None:
                continue
            # the one stated exception: the event dated on a non-session day (a D chart, the bar before `on` more
            # than one calendar day earlier) lands both reads on `on`
            if (p["timeframe"] in ("1D", "D") and ev["off"] == ev["on"] and ev["prev"] is not None
                    and _gap_days(ev["prev"], ev["on"]) > 1 and ev in r1["exceptions"]):
                continue
            bad.append(f"{cid}: event {ev['on']} read off at {ev['off']}, next bar {ev['next']} (R1)")
        if r1["held"] + len(r1["exceptions"]) != r1["of"] and not intraday:
            bad.append(f"{cid}: R1 held {r1['held']} + exceptions {len(r1['exceptions'])} != {r1['of']}")
        for tr in r1.get("twoRecordsOffBars") or []:
            if not any(e["on"] == tr and e["off"] == e["next"] and e["prev"] is not None
                       and _gap_days(e["prev"], e["on"]) > 1 for e in p["events"]):
                bad.append(f"{cid}: off-read at {tr} named as a second record, but no event before it fits")
        first_on = p["events"][0]["on"] if p["events"] else None
        for k, v in (p["rules"].get("R2") or {}).items():
            if v["mismatches"]:
                bad.append(f"{cid}: R2 {k} ({v['row']} carrying {v['carries']}) has {v['mismatches']} mismatching bars")
            if v["firstValueBar"] is not None and first_on is not None and v["firstValueBar"] < first_on:
                bad.append(f"{cid}: R2 {k} holds a value at {v['firstValueBar']}, before the first event {first_on}")
        if intraday and not (p["rules"].get("R3") or {}).get("firstBarCarries") and p["events"]:
            bad.append(f"{cid}: R3 the first bar does not carry the latest prior event")
    for a in doc.get("probeAnchors", []):
        for fam, row in a["flags"].items():
            # the 60-minute chart starts after events: its first bar carries the latest one (R3), so flagged
            first = row.get("firstBar")
            extra = [b for b in row.get("notAnEvent", []) if b != first]
            if extra or row.get("eventNotFlagged"):
                bad.append(f"{a['captureId']}: V0 {fam} flags off the event bars: {extra[:5]} / {row.get('eventNotFlagged', [])[:5]}")
    for v in doc.get("vwap", []):
        v1 = v.get("V1")
        if v1 is None:
            continue
        if v1["eventOnly"]:
            bad.append(f"{v['captureId']}: V1 events where the built-in did not restart: {v1['eventOnly'][:5]}")
        if v1["resetOnly"]:
            bad.append(f"{v['captureId']}: V1 restarts with no event: {v1['resetOnly'][:5]}")
    return bad


def _write_json(path: str, doc: dict) -> None:
    d = os.path.dirname(os.path.abspath(path))
    os.makedirs(d, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=d, suffix=".tmp")
    with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(doc, fh, indent=1, sort_keys=True)
        fh.write("\n")
    os.replace(tmp, path)


def main(argv: Iterable[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    d = sub.add_parser("derive")
    d.add_argument("--probe-run", required=True)
    d.add_argument("--vwap-run")
    d.add_argument("--out", required=True)
    k = sub.add_parser("check")
    k.add_argument("--doc", required=True)
    a = ap.parse_args(list(argv) if argv is not None else None)
    if a.cmd == "derive":
        doc = derive(a.probe_run, a.vwap_run)
        _write_json(a.out, doc)
        bad = check(doc)
        print(f"derived {len(doc['probes'])} probe captures, {len(doc['vwap'])} VWAP captures -> {a.out}")
    else:
        with open(a.doc, encoding="utf-8") as fh:
            bad = check(json.load(fh))
    for b in bad:
        print("RULE BROKEN:", b)
    print("CHECK:", "PASS" if not bad else f"FAIL ({len(bad)})")
    return 0 if not bad else 1


if __name__ == "__main__":
    sys.exit(main())
