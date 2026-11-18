"""Keep the history lake current: fold each new vendor day into the lake and publish it (2026-11-17).

WHY. The lake was built and published once (2026-11-16, data through Fri 11-13). Nothing extended it,
so the distance between where the lake ends and where a chart's server bars begin grew every day:
on 11-17 a 1m chart of AAPL / NVDA had Monday's premarket and morning in NEITHER (the BarStore now
refuses to join across such a hole, #1735, but then deep history comes from the slower server
window). The lake has to end where the vendor's last published day ends.

WHAT ONE RUN DOES (idempotent; nothing new -> nothing done):
  1. download the vendor's 1-minute day files the PC lacks (`download_minute_aggs.py`)
  2. the new days = raw day files after the newest day in the tree's ledger (ascending only: the
     builder folds days in date order), none -> status only
  3. refresh the split reference (`fetch_splits.py`; on failure the last one is kept)
  4. back up the packs those days will rewrite (their month / quarter / year), keep 7 days of backups
  5. build those days into the tree (build.py --packs) at below-normal priority, under the shared
     heavy lock
  6. publish every tree (publish.py): indexes for every symbol, packs rebuilt by this run ALWAYS sent
     (`--force-since`), the rest only if the bucket lacks them; indexes last
  7. read the live index of a reference symbol back from the bucket: its newest 1m bar must reach the
     newest folded day, or the run fails
  8. write <root>/daily-status.json

Exit: 0 published or already current; 1 a step failed; 3 nothing new to fold but the lake is more
than one trading day behind (the vendor has not published a day yet, or the download failed).

Run (the scheduled task runs master's copy of this file, exported by tools/history_lake/run_daily.cmd):
    python tools/history_lake/daily.py --root D:/uct-history --tree packs-7 \
        --bucket uct-bars-snapshots --prefix hist/ [--dry-run]
"""
from __future__ import annotations

import argparse
import datetime as _dt
import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path
from typing import Callable, Iterable, List, Optional, Sequence

HERE = Path(__file__).resolve().parent
HEAVY_LOCK = Path(r"C:\Users\Patrick\uct-clips\tools\heavy_lock.py")
SERIES_PERIOD = {"1": "month", "5": "quarter", "15": "year", "30": "year", "60": "year", "60e": "year"}
BACKUP_KEEP_DAYS = 7
REFERENCE_SYMBOL = "SPY"
EXIT_OK, EXIT_FAILED, EXIT_BEHIND = 0, 1, 3


# ── pure parts (tests/test_history_lake_daily.py) ───────────────────────────────────────────────

def raw_days(raw_dir: Path, years: Iterable[int]) -> List[str]:
    """Every vendor day file present, 'YYYY-MM-DD', ascending."""
    return sorted(raw_sizes(raw_dir, years))


def raw_sizes(raw_dir: Path, years: Iterable[int]) -> dict:
    """{day: byte size} of every vendor day file present (the downloader keeps each at the vendor's
    listed size, re-fetching one the vendor rewrote)."""
    out = {}
    for y in years:
        d = Path(raw_dir) / str(y)
        if d.is_dir():
            for f in d.iterdir():
                if f.name.endswith(".csv.gz") and len(f.name) == 17:
                    out[f.name[:10]] = f.stat().st_size
    return out


#: Held days this recent are re-checked against the vendor's file: a day file can be rewritten after
#: it was first folded (an early copy before ~11:00 ET, or a correction months later).
REVISIT_DAYS = 10


def new_days(raw: Sequence[str], ledger_days: Iterable[str]) -> List[str]:
    """The days AFTER the newest day the tree holds (the common case: yesterday)."""
    have = set(ledger_days)
    last = max(have) if have else ""
    return [d for d in raw if d > last and d not in have]


def days_to_fold(sizes: dict, ledger: dict, *, revisit: int = REVISIT_DAYS) -> dict:
    """What this run folds, by reason, each list ascending:
      new      after the newest held day;
      holes    present now, inside the tree's range, but never folded (a failed download fixed later):
               never left behind for good;
      changed  among the newest `revisit` held days, the vendor's file is not the size that was folded
               (the builder refolds a day whose size changed)."""
    held = {d: (v or {}) for d, v in (ledger or {}).items()}
    if not held:
        return {"new": sorted(sizes), "holes": [], "changed": []}
    first, last = min(held), max(held)
    recent = set(sorted(held)[-revisit:]) if revisit > 0 else set()
    return {
        "new": sorted(d for d in sizes if d > last),
        "holes": sorted(d for d in sizes if first < d < last and d not in held),
        "changed": sorted(d for d in sizes if d in recent and held[d].get("size") is not None
                          and int(held[d]["size"]) != int(sizes[d])),
    }


def period_of(day: str, series: str) -> str:
    y, m = int(day[:4]), int(day[5:7])
    kind = SERIES_PERIOD[series]
    if kind == "month":
        return f"{y:04d}-{m:02d}"
    if kind == "quarter":
        return f"{y:04d}Q{(m - 1) // 3 + 1}"
    return f"{y:04d}"


def touched_packs(days: Iterable[str]) -> List[str]:
    """The pack paths (relative to <tree>/packs) the days rewrite: '<series>/<period>.pack'."""
    return sorted({f"{s}/{period_of(d, s)}.pack" for d in days for s in SERIES_PERIOD})


def trading_days_between(last_day: str, today: _dt.date) -> int:
    """Weekdays after `last_day` and before `today` (holidays count, so this can over-report by one
    around a holiday: a false 'behind', never a missed one)."""
    d = _dt.date.fromisoformat(last_day) + _dt.timedelta(days=1)
    n = 0
    while d < today:
        n += d.weekday() < 5
        d += _dt.timedelta(days=1)
    return n


def newest_1m_bar(index_doc: dict) -> Optional[int]:
    periods = ((index_doc or {}).get("series") or {}).get("1") or {}
    lasts = [e.get("last") for e in periods.values() if isinstance(e, dict) and isinstance(e.get("last"), int)]
    return max(lasts) if lasts else None


def reaches_day(last_epoch: Optional[int], day: str) -> bool:
    """Does a bar at `last_epoch` (UTC seconds) fall on or after `day` in New York (UTC-5 floor)?"""
    if last_epoch is None:
        return False
    ny = _dt.datetime.fromtimestamp(last_epoch, _dt.timezone.utc) - _dt.timedelta(hours=5)
    return ny.date().isoformat() >= day


# ── the run ───────────────────────────────────────────────────────────────────────────────────

def _run(cmd: List[str], log: Callable[[str], None], *, low_priority: bool = False) -> int:
    log("$ " + " ".join(str(c) for c in cmd))
    flags = 0
    if low_priority and os.name == "nt":
        flags = getattr(subprocess, "BELOW_NORMAL_PRIORITY_CLASS", 0)
    return subprocess.run([str(c) for c in cmd], creationflags=flags).returncode


def _locked(label: str, cmd: List[str], timeout_s: int) -> List[str]:
    return [sys.executable, str(HEAVY_LOCK), "--timeout", str(timeout_s), "--label", label, "run", "--"] + cmd


def _bucket_index(bucket: str, prefix: str, symbol: str) -> Optional[dict]:
    import boto3
    env = os.environ
    s3 = boto3.client("s3", endpoint_url=env["DATA_SYNC_ENDPOINT_URL"], aws_access_key_id=env["DATA_SYNC_ACCESS_KEY"],
                      aws_secret_access_key=env["DATA_SYNC_SECRET_KEY"], region_name=env.get("DATA_SYNC_REGION", "auto"))
    obj = s3.get_object(Bucket=bucket, Key=f"{prefix}v1/index/s-{symbol}.json")
    return json.loads(obj["Body"].read())


def run(root: Path, tree: str, bucket: str, prefix: str, *, dry_run: bool = False,
        runner: Callable = _run, read_index: Callable = _bucket_index, today: Optional[_dt.date] = None,
        log: Callable[[str], None] = print, now: Callable[[], float] = time.time) -> int:
    root = Path(root)
    tree_dir = root / tree
    today = today or _dt.date.today()
    status = {"started": now(), "tree": tree, "days": [], "ok": False, "step": "start"}

    def finish(code: int, **kw) -> int:
        status.update(kw, finished=now(), exit=code)
        if not dry_run:
            tmp = root / "daily-status.json.tmp"
            tmp.write_text(json.dumps(status, indent=1), encoding="utf-8")
            os.replace(tmp, root / "daily-status.json")
        log(f"[lake-daily] exit {code}: {json.dumps({k: status.get(k) for k in ('step', 'days', 'ok', 'reason')})}")
        return code

    years = sorted({today.year, today.year - 1} if today.month == 1 else {today.year})
    status["step"] = "download"
    dl = [sys.executable, str(root / "tools" / "download_minute_aggs.py"), "--from", str(years[0]),
          "--to", str(years[-1]), "--workers", "2"]
    if not dry_run and runner(dl, log) != 0:
        log("[lake-daily] download failed; folding whatever is already on disk")

    ledger = json.loads((tree_dir / "ledger.json").read_text(encoding="utf-8"))
    held_days = ledger.get("days") or {}
    held = list(held_days.keys())
    plan = days_to_fold(raw_sizes(root / "raw", years), held_days)
    days = sorted(set(plan["new"]) | set(plan["holes"]) | set(plan["changed"]))
    status["days"] = days
    status["plan"] = plan
    lake_last = max(held) if held else None
    # What the BUCKET was last proven to hold (written only after a verified publish). The build ledger
    # is not that: a run that built, then failed to publish, recorded its days anyway.
    state_file = root / "daily-state.json"
    try:
        published = json.loads(state_file.read_text(encoding="utf-8")).get("published_through")
    except (OSError, ValueError):
        published = None
    unpublished = bool(lake_last and (published is None or published < lake_last))
    status["published_through"] = published
    if not days and not unpublished:
        behind = trading_days_between(lake_last, today) if lake_last else 99
        status["lake_last_day"] = lake_last
        if behind > 1:
            return finish(EXIT_BEHIND, step="nothing-new", reason=f"lake ends {lake_last}, {behind} trading days behind")
        return finish(EXIT_OK, step="current", ok=True, reason=f"lake ends {lake_last}")

    status["step"] = "splits"
    if not dry_run and runner([sys.executable, str(root / "tools" / "fetch_splits.py")], log) != 0:
        log("[lake-daily] split reference not refreshed; publishing with the last one")

    if not days:
        # Nothing to build, but the bucket was never proven to hold what the tree has: publish again
        # (packs already there at their size are skipped; indexes are rewritten).
        return _publish_and_verify(root, tree, bucket, prefix, lake_last, None, status, finish,
                                   runner=runner, read_index=read_index, log=log, now=now, dry_run=dry_run)

    status["step"] = "backup"
    backup = root / f"backup-{_dt.datetime.fromtimestamp(now()).strftime('%Y%m%d-%H%M')}"
    for rel in touched_packs(days):
        src = tree_dir / "packs" / rel
        if src.exists() and not dry_run:
            (backup / Path(rel).parent).mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, backup / rel)
    if not dry_run:
        backup.mkdir(parents=True, exist_ok=True)
        shutil.copy2(tree_dir / "ledger.json", backup / "ledger.json")
        cutoff = now() - BACKUP_KEEP_DAYS * 86400
        for old in root.glob("backup-*"):
            if old.is_dir() and old != backup and old.stat().st_mtime < cutoff:
                shutil.rmtree(old, ignore_errors=True)

    status["step"] = "build"
    t0 = now()
    build = [sys.executable, str(HERE / "build.py"), "--raw", str(root / "raw"), "--out", str(tree_dir),
             "--days", ",".join(days), "--packs", "--jobs", "4"]
    if not dry_run and runner(_locked("lake-daily-build", build, 4 * 3600), log, low_priority=True) != 0:
        return finish(EXIT_FAILED, reason=f"build failed; packs backed up in {backup}")

    try:
        ledger_last = max((json.loads((tree_dir / "ledger.json").read_text(encoding="utf-8")).get("days") or {}).keys())
    except (OSError, ValueError):
        ledger_last = days[-1]
    return _publish_and_verify(root, tree, bucket, prefix, max(ledger_last, days[-1]), t0, status, finish,
                               runner=runner, read_index=read_index, log=log, now=now, dry_run=dry_run)


def _publish_and_verify(root: Path, tree: str, bucket: str, prefix: str, through: str, built_at: Optional[float],
                        status: dict, finish: Callable, *, runner: Callable, read_index: Callable,
                        log: Callable, now: Callable, dry_run: bool) -> int:
    """Publish every tree, read the reference index back, and only then record what the bucket holds."""
    status["step"] = "publish"
    trees = sorted(p for p in root.glob("packs-*") if (p / "packs").is_dir())
    pub = [sys.executable, str(HERE / "publish.py")]
    for t in trees:
        pub += ["--from", str(t)]
    pub += ["--out", str(root / "publish"), "--splits", str(root / "ref" / "splits.json"), "--as-of", through,
            "--upload", "--bucket", bucket, "--prefix", prefix]
    if built_at is not None:
        # packs rebuilt by this run: always sent, and the only ones whose pieces are checked
        pub += ["--force-since", f"{built_at - 1:.0f}", "--check-since", f"{built_at - 1:.0f}"]
    else:
        pub += ["--no-check"]           # nothing rebuilt: every pack was checked when it was written
    events = root / "ref" / "ticker_events.jsonl"
    if events.exists():                 # reused tickers cut, renamed companies stitched (identity.py)
        pub += ["--ticker-events", str(events)]
    if not dry_run and runner(_locked("lake-daily-publish", pub, 4 * 3600), log, low_priority=True) != 0:
        return finish(EXIT_FAILED, reason="publish failed (the next run publishes again: packs already sent are skipped)")

    status["step"] = "verify"
    if dry_run:
        return finish(EXIT_OK, ok=True, reason="dry run")
    try:
        last = newest_1m_bar(read_index(bucket, prefix, REFERENCE_SYMBOL))
    except Exception as e:  # noqa: BLE001 - reported, the run fails
        return finish(EXIT_FAILED, reason=f"could not read back {REFERENCE_SYMBOL}'s index: {type(e).__name__}")
    status["reference_last_1m"] = last
    if not reaches_day(last, through):
        return finish(EXIT_FAILED, reason=f"{REFERENCE_SYMBOL}'s live index does not reach {through}")
    tmp = root / "daily-state.json.tmp"
    tmp.write_text(json.dumps({"published_through": through, "at": now()}), encoding="utf-8")
    os.replace(tmp, root / "daily-state.json")
    return finish(EXIT_OK, ok=True, reason=f"published through {through}")


def main(argv: Optional[List[str]] = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--root", type=Path, default=Path("D:/uct-history"))
    ap.add_argument("--tree", default="packs-7", help="the pack tree that holds the current periods")
    ap.add_argument("--bucket", default="uct-bars-snapshots")
    ap.add_argument("--prefix", default="hist/")
    ap.add_argument("--dry-run", action="store_true", help="decide and print, change nothing")
    a = ap.parse_args(argv)
    return run(a.root, a.tree, a.bucket, a.prefix, dry_run=a.dry_run)


if __name__ == "__main__":
    sys.exit(main())
