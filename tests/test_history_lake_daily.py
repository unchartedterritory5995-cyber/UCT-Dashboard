"""tools/history_lake/daily.py: keep the history lake current (2026-11-17)."""
import datetime as dt
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools" / "history_lake"))
import daily as D  # noqa: E402


def test_only_days_after_the_newest_held_day_are_folded_in_date_order():
    raw = ["2026-11-10", "2026-11-12", "2026-11-13", "2026-11-16", "2026-11-17"]
    assert D.new_days(raw, ["2026-11-12", "2026-11-13"]) == ["2026-11-16", "2026-11-17"]
    assert D.new_days(raw, ["2026-11-13", "2026-11-12", "2026-11-10"]) == ["2026-11-16", "2026-11-17"]
    # a hole BEFORE the newest held day is never folded (the builder works in date order)
    assert D.new_days(["2026-11-11", "2026-11-16"], ["2026-11-13"]) == ["2026-11-16"]
    assert D.new_days(raw, raw) == []
    assert D.new_days(raw, []) == raw


def test_the_packs_a_day_rewrites_are_its_month_quarter_and_year():
    assert D.touched_packs(["2026-11-16"]) == sorted([
        "1/2026-11.pack", "5/2026Q4.pack", "15/2026.pack", "30/2026.pack", "60/2026.pack", "60e/2026.pack"])
    assert "1/2026-12.pack" in D.touched_packs(["2026-11-30", "2026-12-01"])
    assert D.period_of("2026-01-02", "5") == "2026Q1" and D.period_of("2026-07-01", "5") == "2026Q3"


def test_trading_days_behind_counts_weekdays_between():
    assert D.trading_days_between("2026-11-13", dt.date(2026, 11, 17)) == 1      # Fri -> Tue: Monday
    assert D.trading_days_between("2026-11-13", dt.date(2026, 11, 16)) == 0      # the weekend
    assert D.trading_days_between("2026-11-13", dt.date(2026, 11, 19)) == 3


def test_reaches_day_reads_the_bar_in_new_york():
    mon_evening = int(dt.datetime(2026, 11, 17, 0, 59, tzinfo=dt.timezone.utc).timestamp())   # Mon 19:59 ET
    assert D.reaches_day(mon_evening, "2026-11-16")
    assert not D.reaches_day(mon_evening, "2026-11-17")
    assert not D.reaches_day(None, "2026-11-16")
    assert D.newest_1m_bar({"series": {"1": {"2026-10": {"last": 5}, "2026-11": {"last": 9}}}}) == 9
    assert D.newest_1m_bar({"series": {}}) is None


def test_days_to_fold_new_holes_and_rewritten_days():
    ledger = {"2026-11-10": {"size": 10}, "2026-11-11": {"size": 11}, "2026-11-13": {"size": 13}}
    sizes = {"2026-11-10": 10, "2026-11-11": 99, "2026-11-12": 12, "2026-11-13": 13, "2026-11-16": 16}
    plan = D.days_to_fold(sizes, ledger)
    assert plan["new"] == ["2026-11-16"]
    assert plan["holes"] == ["2026-11-12"]                  # present now, never folded: not left behind
    assert plan["changed"] == ["2026-11-11"]                # the vendor rewrote it: refold
    # a rewrite older than the revisit window is not re-checked; an empty ledger folds everything
    assert D.days_to_fold(sizes, ledger, revisit=1)["changed"] == []
    assert D.days_to_fold({"2026-11-16": 1}, {}) == {"new": ["2026-11-16"], "holes": [], "changed": []}


def _world(tmp_path, held, raw, published=None):
    root = tmp_path / "lake"
    tree = root / "packs-7"
    (tree / "packs").mkdir(parents=True)
    (tree / "ledger.json").write_text(json.dumps({"v": 1, "days": {d: {"size": 1} for d in held}}))
    if published:
        (root / "daily-state.json").write_text(json.dumps({"published_through": published}))
    for rel in D.touched_packs(["2026-11-16"]):
        p = tree / "packs" / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(b"pack")
    for d in raw:
        f = root / "raw" / d[:4] / f"{d}.csv.gz"
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_bytes(b"x")                                 # 1 byte: the size the ledger recorded
    (root / "packs-1" / "packs").mkdir(parents=True)
    return root


def _runner(calls, fail_on=None):
    def run(cmd, log, low_priority=False):
        calls.append([str(c) for c in cmd])
        return 1 if fail_on and any(fail_on in str(c) for c in cmd) else 0
    return run


MON_EVENING = int(dt.datetime(2026, 11, 17, 0, 59, tzinfo=dt.timezone.utc).timestamp())


def test_a_new_day_is_backed_up_built_published_and_proven_on_the_bucket(tmp_path):
    root = _world(tmp_path, ["2026-11-12", "2026-11-13"], ["2026-11-13", "2026-11-16"])
    calls = []
    code = D.run(root, "packs-7", "bkt", "hist/", runner=_runner(calls), today=dt.date(2026, 11, 17),
                 read_index=lambda b, p, s: {"series": {"1": {"2026-11": {"last": MON_EVENING}}}}, log=lambda *_: None)
    assert code == D.EXIT_OK
    flat = [" ".join(c) for c in calls]
    assert any("download_minute_aggs.py" in c for c in flat)
    assert any("fetch_splits.py" in c for c in flat)
    build = next(c for c in calls if any(x.endswith("build.py") for x in c))
    assert "heavy_lock.py" in " ".join(build) and build[build.index("--days") + 1] == "2026-11-16"
    pub = next(c for c in calls if any(x.endswith("publish.py") for x in c))
    assert pub[pub.index("--as-of") + 1] == "2026-11-16" and "--force-since" in pub and "--upload" in pub
    # only the packs this run rebuilt are checked (the rest were checked when written)
    assert pub[pub.index("--check-since") + 1] == pub[pub.index("--force-since") + 1] and "--no-check" not in pub
    assert str(root / "packs-1") in pub and str(root / "packs-7") in pub          # every tree's indexes
    assert flat.index(" ".join(build)) < flat.index(" ".join(pub))                 # build before publish
    backups = list(root.glob("backup-*"))
    assert len(backups) == 1 and (backups[0] / "1" / "2026-11.pack").exists() and (backups[0] / "ledger.json").exists()
    st = json.loads((root / "daily-status.json").read_text())
    assert st["ok"] is True and st["days"] == ["2026-11-16"] and st["exit"] == 0
    # only a VERIFIED publish records what the bucket holds
    assert json.loads((root / "daily-state.json").read_text())["published_through"] == "2026-11-16"


def test_a_day_whose_download_failed_is_folded_once_its_file_arrives(tmp_path):
    root = _world(tmp_path, ["2026-11-12", "2026-11-16"], ["2026-11-12", "2026-11-13", "2026-11-16"], published="2026-11-16")
    calls = []
    D.run(root, "packs-7", "bkt", "hist/", runner=_runner(calls), today=dt.date(2026, 11, 17),
          read_index=lambda b, p, s: {"series": {"1": {"2026-11": {"last": MON_EVENING}}}}, log=lambda *_: None)
    build = next(c for c in calls if any(x.endswith("build.py") for x in c))
    assert build[build.index("--days") + 1] == "2026-11-13"


def test_a_failed_build_never_publishes(tmp_path):
    root = _world(tmp_path, ["2026-11-13"], ["2026-11-13", "2026-11-16"])
    calls = []
    code = D.run(root, "packs-7", "bkt", "hist/", runner=_runner(calls, fail_on="build.py"),
                 today=dt.date(2026, 11, 17), read_index=lambda *a: {}, log=lambda *_: None)
    assert code == D.EXIT_FAILED
    assert not any(any(x.endswith("publish.py") for x in c) for c in calls)
    assert json.loads((root / "daily-status.json").read_text())["step"] == "build"


def test_a_build_whose_publish_failed_is_published_again_next_run_without_rebuilding(tmp_path):
    """The ledger records a day once it is BUILT; the bucket may still lack it (a publish that died).
    The next run sees `published_through` behind the ledger and publishes again, nothing rebuilt."""
    root = _world(tmp_path, ["2026-11-13", "2026-11-16"], ["2026-11-13", "2026-11-16"], published="2026-11-13")
    calls = []
    code = D.run(root, "packs-7", "bkt", "hist/", runner=_runner(calls), today=dt.date(2026, 11, 17),
                 read_index=lambda b, p, s: {"series": {"1": {"2026-11": {"last": MON_EVENING}}}}, log=lambda *_: None)
    assert code == D.EXIT_OK
    assert not any(any(x.endswith("build.py") for x in c) for c in calls)
    pub = next(c for c in calls if any(x.endswith("publish.py") for x in c))
    assert pub[pub.index("--as-of") + 1] == "2026-11-16" and "--force-since" not in pub and "--no-check" in pub   # nothing rebuilt: nothing re-read
    assert json.loads((root / "daily-state.json").read_text())["published_through"] == "2026-11-16"


def test_a_failed_publish_never_advances_what_the_bucket_is_said_to_hold(tmp_path):
    root = _world(tmp_path, ["2026-11-13"], ["2026-11-13", "2026-11-16"], published="2026-11-13")
    code = D.run(root, "packs-7", "bkt", "hist/", runner=_runner([], fail_on="publish.py"),
                 today=dt.date(2026, 11, 17), read_index=lambda *a: {}, log=lambda *_: None)
    assert code == D.EXIT_FAILED
    assert json.loads((root / "daily-state.json").read_text())["published_through"] == "2026-11-13"


def test_a_publish_the_bucket_does_not_show_is_a_failure(tmp_path):
    root = _world(tmp_path, ["2026-11-13"], ["2026-11-13", "2026-11-16"])
    friday = int(dt.datetime(2026, 11, 14, 0, 59, tzinfo=dt.timezone.utc).timestamp())
    code = D.run(root, "packs-7", "bkt", "hist/", runner=_runner([]), today=dt.date(2026, 11, 17),
                 read_index=lambda *a: {"series": {"1": {"2026-11": {"last": friday}}}}, log=lambda *_: None)
    assert code == D.EXIT_FAILED
    assert "does not reach 2026-11-16" in json.loads((root / "daily-status.json").read_text())["reason"]
    assert not (root / "daily-state.json").exists()        # nothing is claimed for the bucket


def test_nothing_new_is_current_or_behind(tmp_path):
    root = _world(tmp_path, ["2026-11-13", "2026-11-16"], ["2026-11-13", "2026-11-16"], published="2026-11-16")
    calls = []
    assert D.run(root, "packs-7", "bkt", "hist/", runner=_runner(calls), today=dt.date(2026, 11, 17),
                 read_index=lambda *a: {}, log=lambda *_: None) == D.EXIT_OK
    assert not any(any(x.endswith("build.py") for x in c) for c in calls)
    # Thursday, and the vendor has published nothing after Monday: two trading days behind
    assert D.run(root, "packs-7", "bkt", "hist/", runner=_runner([]), today=dt.date(2026, 11, 19),
                 read_index=lambda *a: {}, log=lambda *_: None) == D.EXIT_BEHIND
    assert json.loads((root / "daily-status.json").read_text())["step"] == "nothing-new"
