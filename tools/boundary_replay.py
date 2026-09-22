"""DETERMINISTIC 5-MINUTE BOUNDARY REPLAY — is the gap ours or the market's?

⛔⛔ WHAT IS NOT BEING ASKED. "Do consecutive intraday candles ever gap?" They
do, and a real gap must stay visible. The question is whether UCT's consecutive
bar OHLC matches the authoritative trade tape. So every scenario here carries its
own authoritative bars, computed by bucketing the tape on MARKET time, and scores
PREVIOUS CLOSE and NEW OPEN as SEPARATE fields. A run that only reported "gap:
yes/no" could not tell a wrong close from a wrong open, and those have different
root causes and different fixes.

⭐ THE TWO CLOCKS ARE THE WHOLE EXPERIMENT. Production's price lane stamps
`updated_at = int(time.time())` — the SERVER'S RECEIPT clock (api/routers/
stream.py) — and discards the provider's own `ts`. StockChart's Writer A buckets
on that stamp, and Writer A is the ONLY writer that can open a 5m bucket (Writer
C returns early for 5/15/30/60 unless the developing bar already exists, so it
extends h/l/c and never creates). So a trade that happened at 09:34:59.8 but was
observed at 09:35:00.1 can become bucket N+1's OPEN while being excluded from
bucket N's CLOSE — manufacturing a gap in both directions at once. This replay
drives the REAL Writer A with both clocks under independent control.

⚠️ WHAT IS REAL HERE AND WHAT IS MODELLED, stated plainly so no one over-reads
the result:
  REAL     StockChart's Writer A, classifyLiveBar, computeBarTime, the developing
           bar refs, the LWC series, and the rendered candles that are measured.
  MODELLED the server + transport: the 0.25s sampling loop, `int()` truncation to
           whole seconds, and priceStreamManager's ~1 Hz publish throttle. These
           are the STIMULUS GENERATOR, and they are the thing being varied — the
           product is never re-implemented.
  ABSENT   the SSE transport itself. Snapshots are delivered through the REST
           live-price door, which carries the SAME two fields Writer A consumes
           (`price`, `updated_at`) and merges identically. Transport latency is
           therefore folded into the observation model rather than measured.

Usage:  python tools\\boundary_replay.py
"""
from __future__ import annotations

import json
import os
import sys
from datetime import timedelta

from playwright.sync_api import sync_playwright

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from intraday_tail_harness import (   # noqa: E402
    CLOCK_JS, FAKE_NOW, Fixture, SEED_JS, CACHE_LOGIC_VERSION, make_bars, route_handler,
)
from scan_handoff_harness import CLEAR_IDB, start_dev_server  # noqa: E402
from stimulus import require, verdict, summarize, render, StimulusError, INVALID, PASS, FAIL  # noqa: E402

SYM, TF = "USO", "5"
PERIOD = 300
# The tape straddles the 13:20 ET boundary; the seeded series ends at 13:15, so
# 13:20 is the IMMEDIATE next bucket and clears classifyLiveBar's contiguity guard.
BOUNDARY = int((FAKE_NOW.replace(minute=20, second=0, microsecond=0)).timestamp())


# ── THE AUTHORITATIVE TAPE ───────────────────────────────────────────────────

def tape_normal():
    """A quiet, unambiguous boundary: no trade is near enough to the edge for
    observation latency to move it across."""
    b = BOUNDARY
    return [
        (b - 12.0, 146.30), (b - 9.0, 146.32), (b - 6.0, 146.29),
        (b + 2.0, 146.31), (b + 5.0, 146.35), (b + 9.0, 146.33),
    ]


def tape_edge():
    """The race. The final trade of bucket N lands 0.2s before the boundary —
    close enough that a receipt-time stamp lands it in N+1."""
    b = BOUNDARY
    return [
        (b - 12.0, 146.30), (b - 6.0, 146.29),
        (b - 0.2, 146.44),            # ← belongs to N. Its fate is the experiment.
        (b + 1.5, 146.46), (b + 6.0, 146.48),
    ]


def tape_genuine_gap():
    """A REAL gap: the last trade of N is 100.00 and the first of N+1 is 101.00.
    Nothing here is a defect and the harness must say so."""
    b = BOUNDARY
    return [(b - 10.0, 99.80), (b - 4.0, 100.00), (b + 3.0, 101.00), (b + 7.0, 101.10)]


def authoritative(tape, period=PERIOD):
    """Bucket the tape on MARKET time — the truth every scenario is scored against."""
    bars = {}
    for ts, px in tape:
        bt = int(ts // period) * period
        bar = bars.get(bt)
        if bar is None:
            bars[bt] = {"t": bt, "o": px, "h": px, "l": px, "c": px, "n": 1}
        else:
            bar["h"] = max(bar["h"], px); bar["l"] = min(bar["l"], px)
            bar["c"] = px; bar["n"] += 1
    return bars


# ── THE OBSERVATION MODEL (server + transport, the part being varied) ────────

def observe(tape, *, clock="receipt", latency=0.30, sample=0.25, throttle=1.0,
            drop_first_new=False, drop_last_old=False, misbucket=False,
            stale_replay=False):
    """Turn an authoritative tape into the snapshots Writer A actually receives.

    `clock`:
      'receipt'  production — `updated_at = int(observed_wall_clock)`
      'market'   the §7 experiment — `updated_at = int(trade_market_ts)`

    `latency` is provider→server delay; `sample` is the 0.25s server loop;
    `throttle` is priceStreamManager's ~1 Hz publish coalescing, which OVERWRITES
    intermediate snapshots rather than queueing them.
    """
    seen = []
    for ts, px in tape:
        arrival = ts + latency
        # The server loop only notices a trade at its next 0.25s sample.
        observed = (int(arrival / sample) + 1) * sample if sample else arrival
        stamp = int(observed) if clock == "receipt" else int(ts)
        seen.append({"marketTs": ts, "observedTs": round(observed, 3),
                     "price": px, "updated_at": stamp})

    if misbucket:
        # NC3: force exactly ONE old-bucket trade's stamp into N+1. The first cut
        # moved EVERY old event and the run reported INVALID -- correctly, since
        # with no bucket-N event delivered there was no previous close to score.
        # A control has to corrupt one thing, not erase the experiment.
        olds = [e for e in seen if e["marketTs"] < BOUNDARY]
        if olds:
            olds[-1]["updated_at"] = BOUNDARY
            olds[-1]["misbucketed"] = True

    # The 1 Hz publish throttle: within a window only the LAST snapshot survives,
    # because the manager refreshes one shared object in place.
    kept, window_end = [], None
    for e in seen:
        if window_end is None or e["observedTs"] >= window_end:
            kept.append(e); window_end = e["observedTs"] + throttle
        else:
            kept[-1] = {**e, "coalescedOver": kept[-1]["price"]}   # overwritten in place

    if drop_first_new:
        for i, e in enumerate(kept):
            if e["updated_at"] >= BOUNDARY:
                kept.pop(i); break
    if drop_last_old:
        idx = [i for i, e in enumerate(kept) if e["updated_at"] < BOUNDARY]
        if idx:
            kept.pop(idx[-1])
    if stale_replay and len(kept) >= 2:
        # NC4: re-deliver an older snapshot AFTER a newer one.
        kept.append({**kept[-2], "staleReplay": True})
    return kept


# ── DELIVERY + MEASUREMENT ───────────────────────────────────────────────────

def snapshot_body(e, base):
    return {"price": round(e["price"], 4),
            "change_pct": round((e["price"] / base - 1) * 100, 4),
            "day_open": base,
            # ⛔ THE FIELD UNDER TEST. Writer A buckets on exactly this.
            "updated_at": e["updated_at"]}


def et_time(bucket_utc, et_offset):
    return bucket_utc + et_offset


def run_scenario(page, holder, name, tape, *, note="", expect=PASS, **obs_kw):
    """`expect` is the verdict this scenario MUST produce.

    ⛔ A NEGATIVE CONTROL THAT PASSES HAS FAILED. NC1-NC4 deliberately corrupt
    the stimulus and MUST come back FAIL; NC6 has no new-bucket event and MUST
    come back INVALID. Summing raw verdicts would mark this run "4 failures, not
    accepted" when four of those failures are the instrument working. Acceptance
    is therefore agreement with the declared expectation, per scenario."""
    fixture = holder["f"]
    auth = authoritative(tape)
    bN, bN1 = auth.get(BOUNDARY - PERIOD), auth.get(BOUNDARY)
    events = observe(tape, **obs_kw)

    # Reset the page so no previous scenario's developing bar survives.
    page.goto(f"{holder['base']}/scan-harness.html?blank=1", wait_until="domcontentloaded")
    page.evaluate(CLEAR_IDB)
    page.evaluate("() => { try { localStorage.setItem('uct.chartTiming','1') } catch {} }")
    page.evaluate(SEED_JS, [SYM, TF, make_bars(int(TF), FAKE_NOW, 4), CACHE_LOGIC_VERSION])
    holder["f"] = fixture = Fixture()
    page.goto(f"{holder['base']}/scan-harness.html?tf={TF}&syms={SYM}",
              wait_until="domcontentloaded")
    page.wait_for_timeout(4000)
    et_offset = page.evaluate("() => window.__uctETOffsetForTests ?? null")
    if et_offset is None:
        et_offset = page.evaluate(
            "() => { const d = new Date();"
            "  const et = new Date(d.toLocaleString('en-US', {timeZone:'America/New_York'}));"
            "  const ut = new Date(d.toLocaleString('en-US', {timeZone:'UTC'}));"
            "  return (et - ut) / 1000 }")

    before = page.evaluate("() => window.__scan.tail(3)")
    ledger = []
    for e in events:
        fixture.script(SYM, [snapshot_body(e, 146.30)])
        page.evaluate("() => window.__scan.tick()")
        page.wait_for_timeout(230)
        tail = page.evaluate("() => window.__scan.tail(3)")
        last = (tail or [{}])[-1]
        ledger.append({
            "marketTs": e["marketTs"], "observedTs": e["observedTs"],
            "price": e["price"], "updated_at": e["updated_at"],
            "marketBucket": int(e["marketTs"] // PERIOD) * PERIOD,
            "assignedBucket": int(e["updated_at"] // PERIOD) * PERIOD,
            "coalescedOver": e.get("coalescedOver"),
            "staleReplay": e.get("staleReplay"), "misbucketed": e.get("misbucketed"),
            "renderedLast": {k: last.get(k) for k in ("time", "open", "high", "low", "close")},
            "renderedCount": len(tail or []),
        })
    page.wait_for_timeout(300)
    after = page.evaluate("() => window.__scan.tail(3)")

    # Locate bar N and bar N+1 in the RENDERED series by their ET-offset times.
    want_n = et_time(BOUNDARY - PERIOD, et_offset)
    want_n1 = et_time(BOUNDARY, et_offset)
    ren = {b["time"]: b for b in (after or [])}
    rN, rN1 = ren.get(want_n), ren.get(want_n1)

    rec = {
        "scenario": name, "note": note, "expected": expect,
        "observation": {k: v for k, v in obs_kw.items()},
        "authoritative": {"N": bN, "N1": bN1},
        "rendered": {"N": rN, "N1": rN1},
        "renderedTailBefore": before, "renderedTailAfter": after,
        "eventLedger": ledger,
        "etOffset": et_offset,
    }

    # ── STIMULUS, PROVEN BEFORE ANY VERDICT ──
    old_events = [e for e in ledger if e["assignedBucket"] < BOUNDARY]
    new_events = [e for e in ledger if e["assignedBucket"] >= BOUNDARY]
    appended = bool(rN1) and bool(before) and (after[-1]["time"] != before[-1]["time"])
    try:
        require(f"{name}: old-bucket events were delivered", bool(old_events), len(old_events))
        require(f"{name}: new-bucket events were delivered", bool(new_events), len(new_events))
        require(f"{name}: a NEW bar was appended and rendered", appended,
                {"beforeLast": (before or [{}])[-1].get("time"),
                 "afterLast": (after or [{}])[-1].get("time"), "wantN1": want_n1})
        require(f"{name}: both boundary bars are observable in the rendered series",
                bool(rN) and bool(rN1), {"N": bool(rN), "N1": bool(rN1)})
    except StimulusError as exc:
        rec["verdict"] = INVALID
        rec["why"] = str(exc)
        rec["asExpected"] = (INVALID == expect)
        print(f"  {name:<34} INVALID  {'(as expected)' if rec['asExpected'] else '<-- UNEXPECTED'}"
              f"  -- {exc}", flush=True)
        return rec

    # ── FIELD-LEVEL SCORING, close and open judged SEPARATELY ──
    def close_enough(a, b):
        return a is not None and b is not None and abs(a - b) < 0.005

    prev_close_ok = close_enough(rN.get("close"), bN["c"])
    new_open_ok = close_enough(rN1.get("open"), bN1["o"])
    new_high_ok = close_enough(rN1.get("high"), bN1["h"])
    new_low_ok = close_enough(rN1.get("low"), bN1["l"])
    new_close_ok = close_enough(rN1.get("close"), bN1["c"])

    auth_gap = round(bN1["o"] - bN["c"], 4)
    rendered_gap = round((rN1.get("open") or 0) - (rN.get("close") or 0), 4)

    # ── CLASSIFICATION, from FIELDS — never from the visual gap ──
    cls = []
    if prev_close_ok and new_open_ok:
        cls.append("GENUINE_MARKET_GAP" if abs(auth_gap) > 0.005 else "CLEAN_BOUNDARY")
    if not prev_close_ok:
        cls.append("PREVIOUS_CLOSE_STALE")
        lost = [e for e in ledger if e["marketBucket"] < BOUNDARY
                and e["assignedBucket"] >= BOUNDARY]
        if lost:
            cls.append("BUCKET_TIMESTAMP_ERROR")
        # The true final trade of N never reached the chart -- either misbucketed
        # (above) or never delivered. Both lose it from the close; only the first
        # also poisons the new open, so they are tagged separately.
        if not any(abs(e["price"] - bN["c"]) < 0.005 and e["marketBucket"] < BOUNDARY
                   for e in ledger):
            cls.append("LAST_OLD_BUCKET_EVENT_MISSED")
    if not new_open_ok:
        cls.append("NEW_OPEN_WRONG")
        first_new = next((e for e in ledger if e["marketBucket"] >= BOUNDARY), None)
        if first_new is None or first_new["price"] != bN1["o"]:
            cls.append("FIRST_NEW_BUCKET_EVENT_MISSED")
        if any(e.get("coalescedOver") is not None for e in new_events):
            cls.append("REALTIME_ACCUMULATOR_INCOMPLETE")
    if any(e.get("staleReplay") for e in ledger) and not new_close_ok:
        cls.append("STALE_SNAPSHOT_WON")
        cls.append("OUT_OF_ORDER_EVENT")

    rec.update({
        "fields": {"prevClose": prev_close_ok, "newOpen": new_open_ok,
                   "newHigh": new_high_ok, "newLow": new_low_ok, "newClose": new_close_ok},
        "authoritativeGap": auth_gap, "renderedGap": rendered_gap,
        "falseGap": round(rendered_gap - auth_gap, 4),
        "classification": cls,
    })
    # ⛔ THE CLOSE IS PART OF CORRECTNESS TOO. Gating on prevClose+newOpen alone
    # scored NC4 as PASS while its own classification said STALE_SNAPSHOT_WON --
    # the harness had SEEN an older snapshot overwrite the developing bar's close
    # and passed it anyway. A control that detects the defect and then reports
    # PASS is the silent-failure shape this project keeps paying for.
    rec["verdict"] = verdict(True, prev_close_ok and new_open_ok and new_close_ok)
    rec["asExpected"] = (rec["verdict"] == expect)
    print(f"  {name:<34} {rec['verdict']:<7}{'' if rec['asExpected'] else ' <-- UNEXPECTED'} prevClose={'ok ' if prev_close_ok else 'BAD'} "
          f"newOpen={'ok ' if new_open_ok else 'BAD'} "
          f"authGap={auth_gap:+.2f} renderedGap={rendered_gap:+.2f} "
          f"falseGap={rec['falseGap']:+.2f}  {','.join(cls)}", flush=True)
    return rec


def main():
    import socket
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0)); port = s.getsockname()[1]
    print(f"[bnd-replay] dev server on :{port}", flush=True)
    proc = start_dev_server(port)
    fixture = Fixture()
    results = []
    repair_record = {}
    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            ctx = browser.new_context(viewport={"width": 1400, "height": 860})
            ctx.add_init_script(CLOCK_JS % int(FAKE_NOW.timestamp() * 1000))
            holder = {"f": fixture, "base": f"http://127.0.0.1:{port}"}
            ctx.route("**/api/**", lambda route, request: route_handler(holder["f"])(route, request))
            page = ctx.new_page()

            print("[bnd-replay] EXPERIMENTS:", flush=True)
            results.append(run_scenario(
                page, holder, "E1 baseline (no race)", tape_normal(),
                note="every trade well inside its bucket", clock="receipt"))
            results.append(run_scenario(
                page, holder, "E2 receipt-time race", tape_edge(),
                note="last trade of N observed after the boundary", expect=FAIL, clock="receipt"))
            results.append(run_scenario(
                page, holder, "E3 market-time bucketing", tape_edge(),
                note="SAME tape, stamped with the trade's own ts", clock="market"))
            results.append(run_scenario(
                page, holder, "E4 snapshot-open (throttled)", tape_edge(),
                note="market-time clock, but the 1Hz throttle hides the first new trade",
                expect=FAIL, clock="market", throttle=4.0))

            print("[bnd-replay] NEGATIVE CONTROLS:", flush=True)
            results.append(run_scenario(
                page, holder, "NC1 drop first new-bucket event", tape_normal(),
                expect=FAIL, clock="market", drop_first_new=True))
            results.append(run_scenario(
                page, holder, "NC2 drop last old-bucket event", tape_normal(),
                expect=FAIL, clock="market", drop_last_old=True))
            results.append(run_scenario(
                page, holder, "NC3 misbucket an old event", tape_normal(),
                expect=FAIL, clock="market", misbucket=True))
            results.append(run_scenario(
                page, holder, "NC4 stale snapshot replayed", tape_normal(),
                expect=FAIL, clock="market", stale_replay=True))
            results.append(run_scenario(
                page, holder, "NC5 GENUINE market gap", tape_genuine_gap(),
                note="a real 1.00 gap — must PASS and stay visible", clock="market"))
            results.append(run_scenario(
                page, holder, "NC6 dead stimulus", [(BOUNDARY - 12.0, 146.30),
                                                    (BOUNDARY - 6.0, 146.29)],
                note="no new-bucket event at all — must be INVALID", expect=INVALID, clock="market"))
            # ── §11/§12/§17 TAIL REPAIR, PERSISTENCE, AND THE CAMERA ────────
            # Build a KNOWN-BAD boundary (the receipt-time race), then let the
            # authoritative /api/bars tail land and measure what it repairs, how
            # long the bad state was visible, and whether the repair moves a
            # camera the member owns.
            print("", flush=True)
            print("[bnd-replay] TAIL REPAIR / PERSISTENCE / CAMERA:", flush=True)
            repair = run_scenario(page, holder, "R0 bad boundary (pre-repair)", tape_edge(),
                                  note="seed the wrong bars, then repair them",
                                  expect=FAIL, clock="receipt")
            rep = {"scenario": "R1 authoritative tail repair", "seededFrom": repair.get("fields")}
            if repair.get("verdict") == FAIL:
                # The member takes the view, so a repair that moves it is a Bug B
                # regression -- the accepted camera behaviour is under test here too.
                pan_ok = page.evaluate("() => !!window.__scan")
                cam_before = page.evaluate("() => window.__scan.timeRange()")
                owned_before = page.evaluate("() => window.__scan.camera.owned()")
                bad = page.evaluate("() => window.__scan.tail(3)")
                import time as _t
                # ⛔⛔ "NOTHING CHANGED" HAS TWO CAUSES AND THEY ARE OPPOSITE. The
                # first cut reported repaired=False and I could not tell whether
                # the authoritative tail had landed and failed to fix the bars, or
                # had simply never been fetched -- which would be the harness, not
                # the product. Count the actual /api/bars requests in the window:
                # zero requests means the stimulus never happened, and that is
                # INVALID, never a finding about repair.
                bars_reqs = []
                _h = lambda r: bars_reqs.append(r.url) if "/api/bars" in r.url else None
                page.on("request", _h)
                t0 = _t.time()
                # Force the authoritative tail: advance the market clock past the
                # boundary and revalidate the bars poll the way the product does.
                # ⛔ ADVANCE PAST THE BOUNDARY, NOT UP TO IT. The first cut advanced
                # 120s to 13:19, so the fixture -- which generates bars up to its own
                # `server_now` -- never produced the 13:20 bucket at all. Two
                # /api/bars requests were made and returned an IDENTICAL payload, so
                # SWR had nothing to apply and "repaired=False" said nothing about
                # repair. 400s puts both boundary buckets on the server.
                holder["f"].advance(400)
                page.evaluate("(ms) => window.__uctTestClockAdvance(ms)", 400 * 1000)
                page.evaluate("() => window.__scan.tick()")
                page.wait_for_timeout(1200)
                repaired, waited = None, None
                for _ in range(75):
                    page.wait_for_timeout(1000)
                    cur = page.evaluate("() => window.__scan.tail(3)")
                    if cur and bad and json.dumps(cur) != json.dumps(bad):
                        repaired, waited = cur, round(_t.time() - t0, 2)
                        break
                cam_after = page.evaluate("() => window.__scan.timeRange()")
                try: page.remove_listener("request", _h)
                except Exception: pass                      # noqa: BLE001
                rep.update({
                    "barsRequestsDuringWindow": len(bars_reqs),
                    "barsRequestSample": bars_reqs[:3],
                    "verdict": (INVALID if not bars_reqs
                                else (PASS if repaired is not None else FAIL)),
                    "why": ("no /api/bars request was made in the window -- the tail "
                            "repair was never stimulated, so nothing may be concluded "
                            "about it") if not bars_reqs else None,
                    "harnessReady": pan_ok,
                    "ownedBefore": owned_before,
                    "badTail": bad, "repairedTail": repaired,
                    "secondsToRepair": waited,
                    "repaired": repaired is not None,
                    "cameraBefore": cam_before, "cameraAfter": cam_after,
                    "cameraMoved": (bool(cam_before and cam_after) and
                                    (int(cam_before["from"]) != int(cam_after["from"])
                                     or int(cam_before["to"]) != int(cam_after["to"]))),
                })
                print(f"  R1 repair: {rep['verdict']} barsRequests={rep['barsRequestsDuringWindow']} "
                      f"repaired={rep['repaired']} after={rep['secondsToRepair']}s "
                      f"cameraMoved={rep['cameraMoved']}", flush=True)
                if rep.get("why"):
                    print(f"           !! {rep['why']}", flush=True)
            else:
                rep["why"] = "pre-repair boundary was not bad -- nothing to repair"
                print(f"  R1 repair: SKIPPED -- {rep['why']}", flush=True)
            # §17 THE OWNED CASE, which is the one Bug B is about. R1 ran on an
            # UNTOUCHED chart, where following the tape is the accepted behaviour,
            # so its cameraMoved=True proves nothing either way. Take the view and
            # let another authoritative tail land: the member's window must not move.
            try:
                el = page.query_selector("canvas")
                bb = el.bounding_box() if el else None
                if bb:
                    cx, cy = bb["x"] + bb["width"] * 0.6, bb["y"] + bb["height"] * 0.5
                    page.mouse.move(cx, cy); page.mouse.down()
                    for i in range(1, 9):
                        page.mouse.move(cx + 420 * i / 8, cy); page.wait_for_timeout(10)
                    page.mouse.up(); page.wait_for_timeout(200)
                owned = page.evaluate("() => window.__scan.camera.owned()")
                cam0 = page.evaluate("() => window.__scan.timeRange()")
                tail0 = page.evaluate("() => window.__scan.tail(3)")
                reqs2 = []
                _h2 = lambda r: reqs2.append(r.url) if "/api/bars" in r.url else None
                page.on("request", _h2)
                holder["f"].advance(400)
                page.evaluate("(ms) => window.__uctTestClockAdvance(ms)", 400 * 1000)
                changed = False
                for _ in range(75):
                    page.wait_for_timeout(1000)
                    t = page.evaluate("() => window.__scan.tail(3)")
                    if t and tail0 and json.dumps(t) != json.dumps(tail0):
                        changed = True; break
                try: page.remove_listener("request", _h2)
                except Exception: pass                      # noqa: BLE001
                cam1 = page.evaluate("() => window.__scan.timeRange()")
                moved = (bool(cam0 and cam1) and (int(cam0["from"]) != int(cam1["from"])
                                                  or int(cam0["to"]) != int(cam1["to"])))
                owned_rec = {
                    "scenario": "R2 repair with the member owning the view",
                    "owned": owned, "barsRequests": len(reqs2), "seriesChanged": changed,
                    "cameraBefore": cam0, "cameraAfter": cam1, "cameraMoved": moved,
                    "verdict": (INVALID if not (owned and changed and reqs2)
                                else (FAIL if moved else PASS)),
                }
                if owned_rec["verdict"] == INVALID:
                    owned_rec["why"] = ("no owned+repair stimulus: "
                                        f"owned={owned} seriesChanged={changed} "
                                        f"barsRequests={len(reqs2)}")
                print(f"  R2 owned repair: {owned_rec['verdict']} owned={owned} "
                      f"barsRequests={len(reqs2)} seriesChanged={changed} "
                      f"cameraMoved={moved}", flush=True)
                repair_record["owned"] = owned_rec
            except Exception as exc:                        # noqa: BLE001
                repair_record["owned"] = {"verdict": INVALID, "why": str(exc)[:200]}
                print(f"  R2 owned repair: INVALID -- {exc}", flush=True)

            results.append(repair)
            repair_record.update(rep)
            browser.close()
    finally:
        try: proc.terminate()
        except Exception: pass                              # noqa: BLE001

    summary = summarize(results)
    # ⛔ ACCEPTANCE IS AGREEMENT WITH THE DECLARED EXPECTATION, not an absence of
    # failures. Four of these scenarios MUST fail and one MUST be invalid; that is
    # the instrument proving it can detect each defect class.
    mismatched = [r["scenario"] for r in results if not r.get("asExpected")]
    summary["expectationMismatches"] = mismatched
    summary["accepted"] = not mismatched
    summary["productDefects"] = [
        {"scenario": r["scenario"], "classification": r.get("classification"),
         "falseGap": r.get("falseGap"), "fields": r.get("fields")}
        for r in results if r["scenario"].startswith("E") and r["verdict"] == FAIL
    ]
    dst = os.path.join(os.path.dirname(os.path.abspath(__file__)), "boundary_replay_out.json")
    with open(dst, "w", encoding="utf-8") as f:
        json.dump({"summary": summary, "scenarios": results, "repair": repair_record,
                   "boundary": BOUNDARY}, f, indent=2)
    print("\n" + render(summary, "boundary replay"))
    print(f"[bnd-replay] wrote {dst}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
