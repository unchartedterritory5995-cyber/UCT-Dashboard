"""Re-measure lift for every named structure and rewrite the ledger artifact.

    python tools/run_lift_ledger.py                    # measure, print, write
    python tools/run_lift_ledger.py --dry-run          # measure and print only
    python tools/run_lift_ledger.py --sample 800       # wider sample, slower
    python tools/run_lift_ledger.py --null-trials 30   # harder null
    python tools/run_lift_ledger.py --only darvas-box
    python tools/run_lift_ledger.py --only flat-base,cup-with-handle

⭐ SEVERAL KEYS IN ONE RUN SHARE THE UNIVERSE LOAD, which is the whole
setup cost. Launching several PROCESSES instead used to be worse than
slow: each loaded the artifact, added its row and wrote the file back,
so a concurrent run silently erased the other's measurement. The write
path now merges, but one process is still the cheaper way.

⛔ WHY THIS IS A TOOL AND NOT A SCHEDULER JOB. The completion plan called for a
cron job; that was the wrong call and this is the correction. The web pod
already carries ~135 cron jobs, 39 threads and a 39s boot, and the jobs cannot
move off it because 20+ SQLite databases live on its per-service volume. This
harness runs for MINUTES (each structure is re-scanned once per null trial),
and what it measures — whether a multi-week structure beats the market's own
base rate — moves on a quarterly timescale, not a nightly one. Adding a
multi-minute monthly job to that pod buys nothing and costs real headroom.

So the freshness guarantee is the other half of this pair:
`lift_ledger.is_stale()` plus `test_the_ledger_is_not_stale`, which fails BY
NAME once the artifact ages past the bound and names this command in the
failure message. A job that silently stops running is invisible; a rail that
goes red is not.

⚠️ RUN THIS WHERE `bars.db` IS COMPLETE. On a thin local copy the sample is
quietly smaller and every interval quietly wider.
"""
from __future__ import annotations

import argparse
import json
import tempfile
import os
import random
import sqlite3
import sys
import time
from types import SimpleNamespace

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from api.services import bars_sqlite                                # noqa: E402
from api.services.screener import base_catalog as bc                # noqa: E402
from api.services.screener import lift_ledger as ll                 # noqa: E402
from api.services.screener import bases                            # noqa: E402
from api.services.screener import technicals                        # noqa: E402

#: Per-structure scan window. A structure may only be measured over a window
#: that can actually contain it — Green Line Breakout reads MONTHLY highs, so a
#: 400-bar window would silently redefine its "all-time" high as an 18-month
#: high and the measurement would be of a different pattern.
WINDOWS = {
    "darvas-box":          400,
    # 260-bar base search + 60 bars of prior-advance history behind it.
    "flat-base":           400,
    # Two stacked bases plus the failed advance between them, each needing its
    # own prior-advance history: the same 400 will not hold both.
    "base-on-base":        600,
    # A cup may run 65 weeks (325 bars) plus a handle, so a 400-bar window
    # would silently redefine the pattern as a shorter one.
    "cup-with-handle":     500,
    # The W plus the advance it rests, plus prior-uptrend history behind that.
    "double-bottom":       400,
    # Pole (<=40) + flag (<=25) plus swing history to anchor the pole's origin.
    "high-tight-flag":     400,
    # The contraction sequence plus the advance it continues, plus the
    # prior-advance lookback behind that.
    "vcp":                 400,
    # A 9-16 week staircase plus the advance it sits midway in.
    "ascending-base":      400,
    # A 4-7 week box plus the advance it follows.
    "square-box":          300,
    # 3-week surge + the prolonged advance that must precede it.
    "climax-top":          300,
    # A <=20-bar parabolic leg; nothing behind it is read.
    "parabolic-extension": 200,
    # A 60-bar trading range plus the recent window the spring must sit in.
    "wyckoff-spring":      300,
    # A base up to 45 weeks plus the 200-day average behind it.
    "cheat-3c":            500,
    "low-cheat":           500,
    # A saucer may run a year or more, so a shorter window would redefine it.
    "saucer":              500,
    # A 40-bar ATR plus the doubling lookback behind the gap.
    "buyable-gap-up":      400,
    "green-line-breakout": 1500,
    "pocket-pivot":        300,
    "power-play":          200,
    # The 30-week MA needs ~150 sessions before it exists at all, plus swing
    # history behind it for the breakout/breakdown level.
    "stage-2-breakout":    400,
    "stage-4-breakdown":   400,
}
DEFAULT_WINDOW = 400


def _write_ledger(path: str, data: dict) -> None:
    """Publish the artifact atomically.

    ⛔ ENCODE -> TMP -> REPLACE. Both write sites used `open(path, "w")`,
    which TRUNCATES before `json.dump` can fail -- so a serialisation error
    part-way through would leave the published ledger destroyed rather than
    merely unchanged. This is `lesson_open_w_truncates_before_your_write_can_
    fail`, and the artifact it protects is the one members' numbers come from.

    ⭐ ONE writer, not two. The two sites were the same code with two
    different spellings of the newline; keeping them separate is how they drift.
    """
    blob = json.dumps(data, indent=2, ensure_ascii=False) + chr(10)
    fd, tmp = tempfile.mkstemp(
        dir=os.path.dirname(os.path.abspath(path)) or ".", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(blob)
        os.replace(tmp, path)
    except Exception:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def load_universe(sample: int, seed: int = 7) -> dict:
    from api.services.screener import snapshot_db
    db = snapshot_db.get_db_path()
    con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
    day = con.execute("select max(snapshot_date) from screener_rows").fetchone()[0]
    tickers = [r[0] for r in con.execute(
        "select ticker from screener_rows where snapshot_date=? order by ticker",
        (day,))]
    random.Random(seed).shuffle(tickers)

    out = {}
    for t in tickers[:sample]:
        raw = bars_sqlite.get_bars(t, "D", 3000) or []
        bars = technicals.usable_bars(
            [{"t": r[0], "o": r[1], "h": r[2], "l": r[3], "c": r[4], "v": r[5]}
             for r in raw])
        if len(bars) >= 400:
            out[t] = bars
    return out


def write_null_chunk(path: str, key: str, seed: int, trials: int,
                     lifts: list) -> None:
    payload = {"key": key, "seed": seed, "trials": trials, "lifts": lifts}
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, indent=2)
        fh.write(chr(10))


def load_null_chunks(paths: str, key: str) -> list:
    """Recombine null chunks, refusing any set that is not a clean partition.

    ⛔⛔ THE CHECK IS THE POINT, NOT THE CONCATENATION. `null_lifts` seeds trial
    k with `NULL_SEED + k`, so chunks recombine EXACTLY only when their seed
    ranges are disjoint and contiguous. Overlapping ranges would silently count
    one trial twice, which shrinks the effective spread and LOWERS the null
    maximum -- and the null maximum is the bar the CI's lower bound has to
    clear, so the error's direction is to PUBLISH something that should have
    been refused. A gap is the mirror defect: fewer distinct draws than the
    header claims. Both refuse here rather than average out.
    """
    chunks = []
    for path in [p.strip() for p in paths.split(",") if p.strip()]:
        with open(path, encoding="utf-8") as fh:
            c = json.load(fh)
        if c.get("key") != key:
            raise SystemExit(
                f"chunk {path} is for {c.get('key')!r}, not {key!r}")
        if len(c.get("lifts") or []) != c.get("trials"):
            # A trial whose measure() returned no lift is dropped by null_lifts,
            # so a short chunk is a real event -- but it breaks the seed
            # arithmetic, so it must be visible rather than quietly recombined.
            raise SystemExit(
                f"chunk {path}: {len(c.get('lifts') or [])} lifts for "
                f"{c.get('trials')} trials -- a dropped trial breaks the "
                f"seed partition; re-run this chunk")
        chunks.append((int(c["seed"]), int(c["trials"]), list(c["lifts"]), path))

    chunks.sort()
    for i, (seed, trials, _, path) in enumerate(chunks):
        if i == 0:
            continue
        prev_seed, prev_trials, _, prev_path = chunks[i - 1]
        expected = prev_seed + prev_trials
        if seed < expected:
            raise SystemExit(
                f"chunks {prev_path} and {path} OVERLAP at seed {seed} "
                f"(previous chunk ends at {expected}) -- recombining them "
                f"would count a trial twice and understate the null maximum")
        if seed > expected:
            raise SystemExit(
                f"chunks {prev_path} and {path} leave a GAP: seeds "
                f"[{expected}, {seed}) were never run")

    out = []
    for _, _, lifts, _ in chunks:
        out.extend(lifts)
    return out


def _note_stamp(row: dict) -> list:
    return [row.get(f) for f in ("lift", "ci_low", "ci_high", "n", "null_max")]


def _carry_note(prior: dict, row: dict) -> None:
    """Carry a hand-written note forward ONLY while it still describes the row.

    ⛔ The harness rewrites the numbers and cannot rewrite the prose, so a
    note silently outlives the measurement it was written about -- that is how
    `cup-with-handle` kept a note explaining why it sat "below its own null"
    after a wider sample moved it from -7.18pp to -0.18pp. The note is stamped
    with the row it describes; when the row moves, the note is DROPPED rather
    than carried, because a missing explanation is recoverable and a wrong one
    is not.
    """
    note = prior.get("note")
    if not note:
        return
    if prior.get("note_measured") == _note_stamp(row):
        row["note"] = note
        row["note_measured"] = prior["note_measured"]
    else:
        row["note_dropped"] = (
            "A note written for a previous measurement was dropped when this "
            "row changed. Re-write it against the numbers above.")


def _directions_of(st) -> list:
    """Which metric(s) a structure must be graded on.

    ⛔⛔ A NEUTRAL STRUCTURE IS GRADED BOTH WAYS, because grading it long is a
    DIRECTIONAL CLAIM MADE ON ITS BEHALF. `darvas-box` and `square-box` both
    publish on the long metric while declaring `bias="neutral"` -- a box is a
    range, and Darvas's own words describe a frame rather than a forecast.
    Defaulting such a structure to long is not neutral at all; it is an
    undeclared bet, invisible precisely because the number looks like every
    other number.

    Measured both ways the row says something one number cannot: a structure
    positive on ONE side marks direction, and one positive on BOTH marks
    VOLATILITY -- price left the range either way, which is a different and
    still useful fact.
    """
    bias = getattr(st, "bias", "")
    if bias == "bearish":
        return ["short"]
    if bias == "neutral":
        return ["long", "short"]
    return ["long"]


def _direction_of(st) -> str:
    """Which way a structure claims price will resolve.

    ⭐ A BEARISH STRUCTURE IS GRADED ON THE MIRRORED METRIC, so "lift" means
    the same thing for every row: the structure resolved in ITS OWN direction
    more often than its pattern-free baseline did. Graded long, a bearish
    structure's positive lift says price went UP after it -- which is the
    opposite of the claim its name makes, and `stage-4-breakdown` published
    +7.30pp under exactly that reading.
    """
    return _directions_of(st)[0]


def _run_grouped(args, bars_by, wanted, existing) -> int:
    """Measure every requested structure, one pass per WINDOW group.

    ⛔ GROUPING IS BY WINDOW AND NOTHING ELSE. Two structures may only share a
    scan if they see the same bars per anchor; a green-line breakout reading
    1,500 bars cannot ride a 400-bar pass without silently becoming a
    different pattern. `WINDOWS` already records that per structure, so the
    grouping is DERIVED from it rather than declared a second time.
    """
    import collections

    structures = dict((existing.get("structures") or {}))
    # ⛔ GROUPED BY (WINDOW, DIRECTION), NOT WINDOW ALONE. Two structures may
    # share a scan only if they see the same bars per anchor AND grade the
    # same outcome. A bearish structure is graded on the MIRRORED metric, so
    # putting it in a long-side pass would silently measure it against the
    # wrong question -- the failure would be invisible, because the numbers
    # would still look like numbers.
    groups = collections.OrderedDict()
    for st in bc.RELATIONS:
        if wanted and st.key not in wanted:
            continue
        for d in _directions_of(st):
            groups.setdefault(
                (WINDOWS.get(st.key, DEFAULT_WINDOW), d), []).append(st)

    measured = []
    for (window, direction), members in groups.items():
        usable = {k: v for k, v in bars_by.items() if len(v) >= window + 25}
        kw = dict(window=window, min_history=window, step=ll.HORIZON_BARS,
                  direction=direction)
        dets = {st.key: (lambda s: (lambda ctx: bool(s.detect(ctx))))(st)
                for st in members}
        prep = lambda w: bases._context(w, w)

        t0 = time.time()
        print("=== window %d, %s : %s ==="
              % (window, direction, ", ".join(d.key for d in members)))
        obs = ll.measure_many(dets, usable, prepare=prep,
                              bootstrap=args.bootstrap, **kw)
        nulls = ll.null_lifts_many(dets, usable, prepare=prep,
                                   trials=args.null_trials,
                                   seed=args.null_seed, **kw)
        print("  %d tickers, %d structures, %.0fs"
              % (len(usable), len(members), time.time() - t0))

        for st in members:
            o, nl = obs[st.key], nulls[st.key]
            verdict = ll.adjudicate(o, nl)
            print("  --- %s (%s)" % (st.label, st.key))
            print("      anchors %s  n %s" % (o.get("anchors"), o.get("n")))
            if o["lift"] is not None:
                print("      lift %+.2fpp  CI [%+.2f, %+.2f]"
                      % (o["lift"] * 100, o["ci_low"] * 100, o["ci_high"] * 100))
            if nl:
                print("      null n=%d  max %+.2fpp" % (len(nl), max(nl) * 100))
            print("      PUBLISHED: %s" % verdict["published"])
            for r in verdict.get("reasons", []):
                print("        refused: %s" % r)

            row = {"published": bool(verdict["published"]),
                   "sample_tickers": len(usable),
                   # ⛔ THE DATE IS A PROPERTY OF THE ROW, exactly as the
                   # sample size is. The header's `measured_at` is rewritten
                   # on EVERY run, so a `--only` re-measure of one structure
                   # marked all the others freshly measured -- the same
                   # defect already fixed for `sample`, left standing for its
                   # twin.
                   "measured_at": time.strftime("%Y-%m-%d"),
                   "direction": direction}
            if o["lift"] is not None:
                row.update({"lift": round(o["lift"], 4),
                            "ci_low": round(o["ci_low"], 4),
                            "ci_high": round(o["ci_high"], 4),
                            "n": o["n"], "rate": round(o["rate"], 4),
                            "baseline": round(o["baseline"], 4)})
            if nl:
                row["null_max"] = round(max(nl), 4)
                row["null_trials"] = len(nl)
            if not verdict["published"]:
                row["reasons"] = verdict.get("reasons", [])
            prior = structures.get(st.key) or {}
            _carry_note(prior, row)

            # ⛔ A NEUTRAL STRUCTURE PRODUCES TWO ROWS, ONE PER DIRECTION, and
            # the second must not silently overwrite the first. Both are kept
            # under `by_direction`, and the top-level fields describe the
            # STRONGER side -- with the other visible beside it, so the choice
            # of which side to headline is auditable rather than implicit.
            side = {k: row.get(k) for k in
                    ("lift", "ci_low", "ci_high", "n", "null_max",
                     "null_trials", "published")}
            row["by_direction"] = dict(prior.get("by_direction") or {})
            row["by_direction"][direction] = side

            if len(_directions_of(st)) > 1 and prior.get("lift") is not None:
                other = prior.get("lift")
                if (other or -9) > (row.get("lift") or -9):
                    # The side already on file is stronger: keep it as the
                    # headline and record this one beside it.
                    keep = dict(prior)
                    keep["by_direction"] = row["by_direction"]
                    structures[st.key] = keep
                    measured.append(st.key)
                    continue

            structures[st.key] = row
            measured.append(st.key)

    if args.dry_run:
        print("--dry-run: artifact not written")
        return 0

    on_disk = ll.load(args.out)
    merged = dict(on_disk.get("structures") or {})
    for key in measured:
        merged[key] = structures[key]
    data = dict(existing)
    data["structures"] = merged
    data["measured_at"] = time.strftime("%Y-%m-%d")
    _write_ledger(args.out, data)
    print("wrote %s" % args.out)
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--sample", type=int, default=400)
    ap.add_argument("--null-trials", type=int, default=ll.NULL_TRIALS)
    ap.add_argument("--bootstrap", type=int, default=ll.BOOTSTRAP_TRIALS)
    ap.add_argument("--only", default=None, help=(
        "One structure key, or several comma-separated. Several in ONE run "
        "share a single universe load, which is the expensive setup step, and "
        "-- since the write path merges -- is also the safe way to measure "
        "more than one structure at a time."))
    ap.add_argument("--null-seed", type=int, default=ll.NULL_SEED)
    ap.add_argument("--grouped", action="store_true", help=(
        "Measure structures that share a scan WINDOW in one pass. The "
        "per-anchor context (a zigzag segmentation) is the expensive step and "
        "is identical for every structure, so sharing it is what makes a "
        "full-universe run tractable. Verified identical to the "
        "one-structure-at-a-time path by "
        "test_a_shared_scan_returns_EXACTLY_what_separate_scans_return."))
    ap.add_argument("--nulls-out", default=None, help=(
        "Compute ONLY this structure's null trials and write them to PATH as a "
        "chunk. Use with --only, --null-seed and --null-trials to split the "
        "expensive 30-trial escalation across processes."))
    ap.add_argument("--nulls-in", default=None, help=(
        "Comma-separated chunk files written by --nulls-out. Their trials are "
        "used INSTEAD of computing nulls, after the seed ranges are checked "
        "disjoint and contiguous."))
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--out", default=ll.LEDGER_PATH)
    args = ap.parse_args()

    wanted = ([k.strip() for k in args.only.split(",") if k.strip()]
              if args.only else None)
    if wanted:
        known = {r.key for r in bc.RELATIONS}
        unknown = [k for k in wanted if k not in known]
        if unknown:
            # ⛔ A TYPO MUST NOT LOOK LIKE A CLEAN RUN. Silently matching
            # nothing is how `--only double-bottom` would have reported
            # success while measuring zero structures.
            raise SystemExit(
                "unknown structure key(s): %s%sknown: %s"
                % (", ".join(unknown), chr(10), ", ".join(sorted(known))))

    bars_by = load_universe(args.sample)
    print(f"universe: {len(bars_by)} tickers\n")

    existing = ll.load(args.out)
    structures = dict((existing.get("structures") or {}))
    measured: list = []          # keys THIS run actually re-measured

    if args.grouped:
        return _run_grouped(args, bars_by, wanted, existing)

    for s in bc.RELATIONS:
        if wanted and s.key not in wanted:
            continue
        window = WINDOWS.get(s.key, DEFAULT_WINDOW)
        usable = {k: v for k, v in bars_by.items() if len(v) >= window + 25}
        # ⛔ A REAL CONTEXT, NOT A STUB. This used
        # `SimpleNamespace(bars=w, bars_full=w)`, which has no `swings` — so
        # every structure reading `ctx.swings` raised AttributeError, the bare
        # `except` in `scan_series` swallowed it, and the run reported n=0 as
        # though the structure simply never fired. Stage 2 Breakout measured
        # 0 detections across 20,566 anchors while the live coverage check
        # found it on 21 of 3,541 tickers; those cannot both be true, and that
        # contradiction is the only reason the bug was caught.
        det = (lambda st: (lambda w: bool(st.detect(bases._context(w, w)))))(s)
        kw = dict(window=window, min_history=window, step=ll.HORIZON_BARS,
                  direction=_direction_of(s))

        t0 = time.time()

        if args.nulls_out:
            lifts = ll.null_lifts(det, usable, trials=args.null_trials,
                                  seed=args.null_seed, **kw)
            write_null_chunk(args.nulls_out, s.key, args.null_seed,
                             args.null_trials, lifts)
            print(f"=== {s.label} ({s.key}) NULL CHUNK ===")
            print(f"  seeds [{args.null_seed}, "
                  f"{args.null_seed + args.null_trials})  "
                  f"n={len(lifts)}  max {max(lifts) * 100:+.2f}pp  "
                  f"({time.time() - t0:.0f}s)")
            print(f"  wrote {args.nulls_out}")
            continue

        obs = ll.measure(det, usable, bootstrap=args.bootstrap, **kw)
        if args.nulls_in:
            nulls = load_null_chunks(args.nulls_in, s.key)
        else:
            nulls = ll.null_lifts(det, usable, trials=args.null_trials,
                                  seed=args.null_seed, **kw)
        verdict = ll.adjudicate(obs, nulls)

        print(f"=== {s.label} ({s.key}) ===")
        print(f"  tickers {len(usable)}  anchors {obs['anchors']:,}  "
              f"n {obs['n']:,}  ({time.time() - t0:.0f}s)")
        if obs["lift"] is not None:
            print(f"  lift {obs['lift'] * 100:+.2f}pp  "
                  f"cluster CI [{obs['ci_low'] * 100:+.2f}, "
                  f"{obs['ci_high'] * 100:+.2f}]")
        if nulls:
            print(f"  null n={len(nulls)}  max {max(nulls) * 100:+.2f}pp")
        print(f"  PUBLISHED: {verdict['published']}")
        for r in verdict.get("reasons", []):
            print(f"    refused: {r}")
        print()

        # ⛔ THE SAMPLE IS A PROPERTY OF THE ROW, NOT THE FILE. A `--only` run
        # re-measures ONE structure and used to rewrite the header's single
        # `sample` line for the whole artifact -- so after re-running Stage 4 on
        # 112 tickers the header claimed 112 while five rows had been measured
        # on 374, and the `limitations` note still said 374. One field
        # describing rows it did not measure is the second-authority defect in
        # its quietest form: nothing disagrees loudly, the header is just wrong
        # about most of the file.
        row = {"published": bool(verdict["published"]),
               "sample_tickers": len(usable),
                   # ⛔ THE DATE IS A PROPERTY OF THE ROW, exactly as the
                   # sample size is. The header's `measured_at` is rewritten
                   # on EVERY run, so a `--only` re-measure of one structure
                   # marked all the others freshly measured -- the same
                   # defect already fixed for `sample`, left standing for its
                   # twin.
                   "measured_at": time.strftime("%Y-%m-%d"),
               "direction": _direction_of(s)}
        if obs["lift"] is not None:
            row.update({
                "lift": round(obs["lift"], 4),
                "ci_low": round(obs["ci_low"], 4),
                "ci_high": round(obs["ci_high"], 4),
                "n": obs["n"],
                "rate": round(obs["rate"], 4),
                "baseline": round(obs["baseline"], 4),
            })
        if nulls:
            row["null_max"] = round(max(nulls), 4)
            row["null_trials"] = len(nulls)
        if not verdict["published"]:
            row["reasons"] = verdict.get("reasons", [])
        # ⛔ Keep any hand-written `note` — the artifact's prose records WHY a
        # verdict landed where it did, and a re-run must not silently erase it.
        _carry_note(structures.get(s.key) or {}, row)
        structures[s.key] = row
        measured.append(s.key)

    if args.nulls_out:
        # ⛔ A NULLS-ONLY RUN MUST NOT TOUCH THE ARTIFACT. Without this the
        # chunk runs fell through to the write below -- and because chunks are
        # meant to run CONCURRENTLY, three processes rewrote one JSON file at
        # once. Nothing was corrupted this time (each wrote the same unchanged
        # `structures`), which is the whole problem: a race that happens to be
        # harmless today is indistinguishable from one that is not.
        return 0

    if args.dry_run:
        print("--dry-run: artifact not written")
        return 0

    # ⛔⛔ RE-READ AND MERGE AT WRITE TIME, NEVER WRITE THE COPY LOADED AT
    # START. Two `--only` runs launched together each loaded the artifact,
    # added their own row, and wrote the WHOLE file back -- so the one that
    # finished four seconds later silently erased the other's row. The
    # measurement had run for nine minutes and left no trace, and nothing
    # complained: the file was valid JSON with one fewer structure in it.
    # (`--nulls-out` was given its own early return for this reason; that
    # fixed the chunk runs and left the ordinary publish path exposed.)
    # Merging the rows THIS run actually measured, over whatever is on disk
    # now, makes concurrent measurement of different structures safe.
    on_disk = ll.load(args.out)
    merged = dict(on_disk.get("structures") or {})
    for key in measured:
        merged[key] = structures[key]

    data = dict(existing)
    data["structures"] = merged
    data["measured_at"] = time.strftime("%Y-%m-%d")
    data["sample"] = (
        "Seeded-random draw from the screener universe, up to 3,000 daily bars "
        "per ticker. The size differs per structure and per run, so it is "
        "recorded on each row as `sample_tickers` rather than claimed once "
        "here; a row's window is `tools/run_lift_ledger.py::WINDOWS[key]`.")
    _write_ledger(args.out, data)
    print(f"wrote {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
