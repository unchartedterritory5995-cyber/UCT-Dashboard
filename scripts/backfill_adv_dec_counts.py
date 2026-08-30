#!/usr/bin/env python
"""Backfill `advancing` / `declining` onto stored breadth snapshots.

WHY THIS EXISTS
---------------
`scripts/breadth_collector.py` (uct-intelligence) computed `adv` and `dec` and
returned only `adv - dec`, so every historical breadth row carries
`adv_decline` and NEITHER count. The Monitor's two count columns have been
blank for the life of the table, and the Event Ledger's **Zweig Breadth
Thrust** — a 10-day EMA of `advancing / (advancing + declining)` — refuses to
evaluate:

    Advance/decline counts cover 0 of 90 sessions — needs 11

The collector fix is forward-only, so without a backfill that lens stays dead
for ~3 trading weeks. This restores the counts on the sessions already stored.

WHERE THE NUMBERS COME FROM — and why not from bars.db
------------------------------------------------------
The collector caches the exact OHLCV frame it computed each session from at
`<uct-intelligence>/data/massive_cache/breadth_ohlcv_<YYYY-MM-DD>.pkl`. That
frame is the collector's OWN input: its column set is that day's universe
(point-in-time — delisted names included, because they were listed then), and
`Close.pct_change().iloc[-1]` on it is literally `adv_decline_parts`.

Measured 2026-08-30 against the stored `adv_decline` series:

    the collector's own cached frame          91 / 98 sessions EXACT
    a bars.db recompute (breadth_history_recon) 0 / 96 sessions exact

— which is why this script reads the frames rather than driving the recon.
The recon reconstructs the collector's METHOD faithfully but not its
POPULATION: bars.db cannot price 0.3-22% of each session's point-in-time
universe, and the missing names are distributed like the day, so every count
comes back scaled by that session's coverage. Measured per name, that accounts
for the whole gap; the dividend basis everyone reaches for first contributes
5 sign flips in 114 sessions. `POST .../history/adv-dec-validate` re-measures
it on the pod at any time.

A DATE'S OWN FRAME IS NOT ALWAYS THE SOURCE ITS ROW CAME FROM
-------------------------------------------------------------
`--backfill --since <date>` in the collector recomputes EVERY past session from
ONE frame — the one downloaded on the day the backfill ran — and re-pushes it.
A row written that way was measured over that later day's universe and on that
later day's adjusted prices, so its own day's cached frame no longer reproduces
it and the gate correctly refuses. Measured: 2026-03-16..03-20 are exactly that,
and all five reproduce to the unit from the 2026-03-22 frame (see `--survey`).

⛔ THE DISCIPLINE THAT KEEPS THE GATE HONEST. The gate is strong because a wrong
pair would have to be wrong by the same amount in advancers AND decliners at
once. SEARCHING over candidate frames until one matches weakens exactly that —
neighbouring frames' nets sit within a few units of each other, so over twenty
candidates a spurious single-date match is likely, not rare. So: `--survey`
REPORTS which frames reproduce which dates and applies nothing, and `--apply`
with `--restated-from` requires you to name ONE source frame by hand. Trust it
when one frame reproduces a RUN of consecutive dates — that is a mechanism.
Do not trust one frame matching one date.

THE GATE
--------
Nothing here is trusted. Every pair is checked against the row's own stored
`adv_decline` — `advancing - declining == adv_decline`, exactly — FIRST here
(so a bad frame never leaves this machine) and again server-side in
`breadth_history_recon.apply_adv_dec_counts`, which is what actually writes.
Sessions that fail are reported and skipped, never adjusted to fit.

SAFETY
------
Read-only on disk: it opens the collector's pickles and nothing else. It never
touches `C:\\data` / `/data`, and it cannot write to the store directly — the
only write path is the PUSH_SECRET-gated endpoint, which re-runs the gate.
It is idempotent: rows that already carry the counts are reported as
`already_present` and left alone, so re-running is a no-op.

USAGE
-----
    # 1. look, don't touch (the default) — prints the match rate + what would land
    python scripts/backfill_adv_dec_counts.py

    # 2. write it
    python scripts/backfill_adv_dec_counts.py --apply

    # 3. ask WHERE the refused rows actually came from (writes nothing, ever)
    python scripts/backfill_adv_dec_counts.py --survey

    # 4. having read the survey and seen ONE frame explain a RUN of dates:
    python scripts/backfill_adv_dec_counts.py --apply \
        --restated-from 2026-03-22 \
        --restated-dates 2026-03-16,2026-03-17,2026-03-18,2026-03-19,2026-03-20

    set PUSH_SECRET=...        (or pass --secret)
    --base-url  https://uctintelligence.com   (default)
    --cache-dir <uct-intelligence>/data/massive_cache
    --since / --until  YYYY-MM-DD bounds
    --batch     dates per request (default 40)
    --survey-window  how many calendar days of later frames to scan (default 21)
    --survey-dates   extra dates to survey that have no usable own frame
                     (e.g. 2026-07-10, whose frame was never written)
"""
from __future__ import annotations

import argparse
import glob
import json
import os
import sys
import urllib.error
import urllib.request

DEFAULT_CACHE_DIR = os.environ.get(
    "BREADTH_COLLECTOR_CACHE_DIR",
    r"C:\Users\Patrick\uct-intelligence\data\massive_cache",
)
DEFAULT_BASE_URL = os.environ.get("DASHBOARD_URL", "https://uctintelligence.com")
# Cloudflare 1010-blocks bare script user agents on uctintelligence.com.
_UA = "Mozilla/5.0 (compatible; uct-adv-dec-backfill)"


def _frames(cache_dir: str, since: str | None, until: str | None):
    """(date, path) for every cached collector frame in range, oldest first."""
    out = []
    for p in sorted(glob.glob(os.path.join(cache_dir, "breadth_ohlcv_*.pkl"))):
        d = os.path.basename(p)[len("breadth_ohlcv_"):-len(".pkl")]
        if len(d) != 10 or d[4] != "-" or d[7] != "-":
            continue
        if since and d < since:
            continue
        if until and d > until:
            continue
        out.append((d, p))
    return out


def counts_from_frame(path: str, expect_date: str):
    """`(advancing, declining, universe)` for the frame's LAST session.

    This is `breadth_collector.adv_decline_parts` verbatim — same
    `pct_change()`, same `notna()` mask, same strict `> 0` / `< 0` — applied to
    the frame the collector itself computed that session from. The duplicate-
    column drop mirrors `_download_ohlcv`'s cache branch.

    Returns None when the frame's newest session is not `expect_date` (a rerun
    on a later day rewrote the file, so its last row is somebody else's
    session and its column set is somebody else's universe).
    """
    import pandas as pd  # imported here so --help works without pandas

    df = pd.read_pickle(path)
    cl = df["Close"]
    cl = cl.loc[:, ~cl.columns.duplicated()]
    last = cl.index[-1]
    last_iso = last.strftime("%Y-%m-%d") if hasattr(last, "strftime") else str(last)[:10]
    if last_iso != expect_date:
        return None
    chg = cl.pct_change().iloc[-1]
    valid = chg.notna()
    adv = int((chg[valid] > 0).sum())
    dec = int((chg[valid] < 0).sum())
    universe = int(cl.iloc[-1].notna().sum())
    return adv, dec, universe


def counts_from_slice(path: str, target_date: str):
    """`(advancing, declining, universe)` for `target_date` read out of a LATER
    frame, by slicing it the way `breadth_collector.backfill()` does.

    That function is the reason this exists: it computes every past session from
    ONE frame (`closes.loc[:date_str]`, then `adv_decline_parts`) and re-pushes
    it, so a restated row's numbers live in the frame downloaded on the day the
    backfill ran, not in the target date's own frame.

    Returns None when the frame holds no row for that date (or only one row up
    to it, so there is no prior close to change against). It does NOT refuse a
    frame that IS the target's own — sliced at its own last row it is exactly
    `counts_from_frame`, which is a useful equivalence, not a bug. Choosing
    which frames to offer is the caller's job; `survey` skips `src <= target`.
    """
    import pandas as pd

    df = pd.read_pickle(path)
    cl = df["Close"]
    cl = cl.loc[:, ~cl.columns.duplicated()]
    sl = cl.loc[:target_date]
    if len(sl) < 2:
        return None
    last = sl.index[-1]
    last_iso = last.strftime("%Y-%m-%d") if hasattr(last, "strftime") else str(last)[:10]
    if last_iso != target_date:
        return None
    chg = sl.pct_change().iloc[-1]
    valid = chg.notna()
    adv = int((chg[valid] > 0).sum())
    dec = int((chg[valid] < 0).sum())
    universe = int(sl.iloc[-1].notna().sum())
    return adv, dec, universe


def survey(cache_dir: str, targets: dict, window_days: int = 21) -> dict:
    """For each `{date: stored_adv_decline}`, which later frames reproduce it?

    Read-only and local: it opens pickles and posts nothing. The output is
    evidence for a human, not an instruction to a machine — see THE DISCIPLINE
    in the module docstring for why this never feeds `--apply` automatically.
    """
    import datetime as _dt

    out = {}
    for d in sorted(targets):
        stored = targets[d]
        hi = (_dt.date.fromisoformat(d) + _dt.timedelta(days=window_days)).isoformat()
        hits, tried = [], 0
        for src, path in _frames(cache_dir, d, hi):
            if src <= d:
                continue
            try:
                got = counts_from_slice(path, d)
            except Exception:
                continue
            if got is None:
                continue
            tried += 1
            adv, dec, uni = got
            if stored is not None and (adv - dec) == stored:
                hits.append({"source": src, "advancing": adv, "declining": dec,
                             "universe": uni})
        out[d] = {"stored_adv_decline": stored, "frames_tried": tried, "hits": hits}
    return out


def _post(base_url: str, path: str, secret: str, body: dict, params: str = ""):
    url = base_url.rstrip("/") + path + (("?" + params) if params else "")
    data = json.dumps(body).encode()
    req = urllib.request.Request(
        url, data=data, method="POST",
        headers={"Authorization": "Bearer " + secret,
                 "Content-Type": "application/json", "User-Agent": _UA},
    )
    try:
        with urllib.request.urlopen(req, timeout=180) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        detail = e.read().decode(errors="replace")[:400]
        raise SystemExit(f"HTTP {e.code} from {url}\n{detail}")


def _get(base_url: str, path: str):
    req = urllib.request.Request(base_url.rstrip("/") + path,
                                 headers={"User-Agent": _UA})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode())


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--cache-dir", default=DEFAULT_CACHE_DIR)
    ap.add_argument("--base-url", default=DEFAULT_BASE_URL)
    ap.add_argument("--secret", default=os.environ.get("PUSH_SECRET", ""))
    ap.add_argument("--since", default=None, help="YYYY-MM-DD (inclusive)")
    ap.add_argument("--until", default=None, help="YYYY-MM-DD (inclusive)")
    ap.add_argument("--batch", type=int, default=40)
    ap.add_argument("--apply", action="store_true",
                    help="actually write (default is a dry run that writes nothing)")
    ap.add_argument("--json-out", default=None, help="write the full report here")
    ap.add_argument("--restated-from", default=None, metavar="YYYY-MM-DD",
                    help="source --restated-dates by SLICING this cached frame, the way "
                         "the collector's --backfill did. Requires --restated-dates.")
    ap.add_argument("--restated-dates", default=None,
                    help="comma-separated dates to take from --restated-from")
    ap.add_argument("--survey", action="store_true",
                    help="report which later frames reproduce each refused row's stored "
                         "adv_decline. Forces a dry run; writes nothing.")
    ap.add_argument("--survey-window", type=int, default=21,
                    help="calendar days of later frames to scan (default 21)")
    ap.add_argument("--survey-dates", default=None,
                    help="extra dates to survey that have no usable own frame")
    a = ap.parse_args(argv)

    if bool(a.restated_from) != bool(a.restated_dates):
        print("--restated-from and --restated-dates must be given together",
              file=sys.stderr)
        return 2
    if a.survey and a.apply:
        # A survey is an argument for a decision, not the decision. Applying in
        # the same breath is how a search over candidate frames turns into a
        # write nobody chose.
        print("--survey never writes; drop --apply, read it, then re-run with "
              "--apply --restated-from", file=sys.stderr)
        return 2

    if not a.secret:
        print("PUSH_SECRET is required (env PUSH_SECRET or --secret)", file=sys.stderr)
        return 2
    if not os.path.isdir(a.cache_dir):
        print(f"no collector cache directory at {a.cache_dir}", file=sys.stderr)
        print("This script must run on the machine the breadth collector runs on.",
              file=sys.stderr)
        return 2

    frames = _frames(a.cache_dir, a.since, a.until)
    if not frames:
        print(f"no cached frames in {a.cache_dir} for that range")
        return 1
    print(f"reading {len(frames)} collector frames "
          f"({frames[0][0]} .. {frames[-1][0]})")

    pairs, skipped = {}, []
    for i, (d, p) in enumerate(frames, 1):
        try:
            got = counts_from_frame(p, d)
        except Exception as e:  # a truncated / half-written pickle
            skipped.append({"date": d, "reason": f"{type(e).__name__}: {e}"})
            continue
        if got is None:
            skipped.append({"date": d, "reason": "frame's newest session is not this date"})
            continue
        adv, dec, uni = got
        pairs[d] = [adv, dec]
        print(f"  [{i}/{len(frames)}] {d}  adv={adv:>5}  dec={dec:>5}  "
              f"net={adv - dec:>6}  universe={uni}")

    # Dates whose row was written by a LATER frame (a collector `--backfill`
    # restatement). Named by hand, sourced by slicing, gated server-side like
    # everything else — the source frame overrides that date's own frame.
    restated = sorted({d.strip() for d in (a.restated_dates or "").split(",") if d.strip()})
    if restated:
        src_path = os.path.join(a.cache_dir, f"breadth_ohlcv_{a.restated_from}.pkl")
        if not os.path.exists(src_path):
            print(f"no cached frame for --restated-from {a.restated_from}", file=sys.stderr)
            return 2
        print(f"\nre-sourcing {len(restated)} date(s) from the {a.restated_from} frame:")
        for d in restated:
            got = counts_from_slice(src_path, d)
            if got is None:
                print(f"  {d}: that frame has no row for this date — skipped")
                skipped.append({"date": d, "reason": f"no {d} row in the "
                                                     f"{a.restated_from} frame"})
                continue
            adv, dec, uni = got
            pairs[d] = [adv, dec]
            print(f"  {d}  adv={adv:>5}  dec={dec:>5}  net={adv - dec:>6}  universe={uni}")

    # A `[0, 0]` probe is a pair the gate can only refuse, and a refusal reports
    # the row's stored `adv_decline`. That is how a date with no usable frame of
    # its own gets surveyed without inventing a number for it.
    probe_only = set()
    if a.survey:
        for d in {x.strip() for x in (a.survey_dates or "").split(",") if x.strip()}:
            if d not in pairs:
                pairs[d] = [0, 0]
                probe_only.add(d)

    before = _get(a.base_url, "/api/breadth-monitor/history/adv-dec-coverage")
    print(f"\nZweig coverage before: {before['covered']} of {before['sessions']} "
          f"sessions (needs {before['needs']})")

    merged = {"written": [], "already_present": [], "partial_present": [],
              "refused_identity": [], "refused_no_row": [],
              "refused_no_adv_decline": [], "refused_malformed": [],
              "write_failed": []}
    dates = sorted(pairs)
    for s in range(0, len(dates), max(1, a.batch)):
        chunk = {d: pairs[d] for d in dates[s:s + a.batch]}
        src = "collector_cache_restated" if (restated and set(chunk) & set(restated)) \
            else "collector_cache"
        rep = _post(a.base_url, "/api/breadth-monitor/history/adv-dec-apply",
                    a.secret, {"rows": chunk, "source": src},
                    params=("dry_run=false" if (a.apply and not a.survey) else "dry_run=true"))
        for k in merged:
            merged[k].extend(rep.get(k) or [])

    after = _get(a.base_url, "/api/breadth-monitor/history/adv-dec-coverage")

    n_ok = len(merged["written"])
    n_gate = len(merged["refused_identity"])
    graded = n_ok + n_gate
    print("\n" + ("APPLIED" if a.apply else "DRY RUN — nothing was written"))
    print(f"  frames read           {len(frames)}")
    print(f"  frames unusable       {len(skipped)}")
    print(f"  identity gate passed  {n_ok}"
          + (f"  ({n_ok / graded:.1%} of {graded} graded)" if graded else ""))
    print(f"  identity gate refused {n_gate}")
    print(f"  already had counts    {len(merged['already_present'])}")
    print(f"  no stored row         {len(merged['refused_no_row'])}")
    print(f"  no stored adv_decline {len(merged['refused_no_adv_decline'])}")
    if merged["partial_present"]:
        print(f"  ⚠ half-written rows   {len(merged['partial_present'])}: "
              f"{merged['partial_present']}")
    if merged["write_failed"]:
        print(f"  ⚠ write failures      {merged['write_failed']}")
    for r in merged["refused_identity"][:10]:
        note = "  [probe]" if r["date"] in probe_only else ""
        print(f"    refused {r['date']}: net {r['net']} vs stored "
              f"adv_decline {r['stored_adv_decline']} (off by {r['diff']}){note}")
    if len(merged["refused_identity"]) > 10:
        print(f"    … and {len(merged['refused_identity']) - 10} more")

    survey_out = None
    if a.survey:
        targets = {r["date"]: r["stored_adv_decline"]
                   for r in merged["refused_identity"]}
        print(f"\nSURVEY — which LATER frame reproduces each refused row "
              f"(scanning {a.survey_window} calendar days ahead)")
        survey_out = survey(a.cache_dir, targets, a.survey_window)
        by_source = {}
        for d in sorted(survey_out):
            e = survey_out[d]
            if not e["hits"]:
                print(f"  {d}: stored {e['stored_adv_decline']} — NO frame of the "
                      f"{e['frames_tried']} scanned reproduces it")
                continue
            names = ", ".join(h["source"] for h in e["hits"])
            print(f"  {d}: stored {e['stored_adv_decline']} — reproduced by {names}")
            for h in e["hits"]:
                by_source.setdefault(h["source"], []).append(d)
        for src_date, ds in sorted(by_source.items(), key=lambda kv: -len(kv[1])):
            verdict = ("a RUN — this is a mechanism" if len(ds) > 1
                       else "ONE date only — not enough; a single match is "
                            "expected by chance across many frames")
            print(f"\n  the {src_date} frame reproduces {len(ds)} date(s): {verdict}")
            if len(ds) > 1:
                print(f"    python scripts/backfill_adv_dec_counts.py --apply \\\n"
                      f"        --restated-from {src_date} \\\n"
                      f"        --restated-dates {','.join(sorted(ds))}")

    print(f"\nZweig coverage after:  {after['covered']} of {after['sessions']} "
          f"sessions (needs {after['needs']})  ->  "
          + ("EVALUATES" if after["zweig_ok"] else "still refuses"))
    if not a.apply or a.survey:
        print("(coverage is unchanged because nothing was written — "
              "re-run with --apply)")

    if a.json_out:
        with open(a.json_out, "w") as f:
            json.dump({"skipped_frames": skipped, "report": merged,
                       "survey": survey_out,
                       "coverage_before": before, "coverage_after": after}, f, indent=1)
        print(f"\nfull report -> {a.json_out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
