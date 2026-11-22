"""tools/history_lake/build.py against a slow, obviously-correct reference.

The reference below shares NOTHING with the builder: it reads the CSV with the
stdlib, takes prices through ``Decimal`` (never a float), buckets every minute
with the app's own ``tv_bucket_bounds`` (never ``bucketing.py``) and aggregates
with plain dicts. It only uses ``piece.decode_piece`` to open the result.

Run: python -m pytest tests/test_history_lake_build.py -q -p no:cacheprovider
"""
from datetime import datetime
from decimal import Decimal
import gzip
import itertools
import json
import os
from pathlib import Path
import random
import shutil

import numpy as np
import pytest

from api.services import bar_rollup
from tools.history_lake import build as BLD
from tools.history_lake import bucketing as B
from tools.history_lake import piece as P

ET = B.ET
REAL_RAW = Path("D:/uct-history/raw")
REAL_DAYS = ["2026-11-11", "2026-11-12", "2026-11-13"]
REAL_SYMBOLS = [
    "SPY", "QQQ", "IWM", "NVDA", "AAPL", "TSLA", "MSFT", "AMD", "F", "GME",          # liquid
    "BRK.A", "BRK.B", "AGM.A", "AKO.B",                                              # dots
    "BACpB", "ABRpD", "AIIAr", "AMPX.WS", "AAC.U",                                   # share-class suffixes
    "CON", "PRN",                                                                    # Windows device names
    "BCPC", "BCpC", "TPC", "TpC",                                                    # differ only by case
    "AAOG", "AACOW", "AADX", "AAAU", "A", "AA", "AAL",                               # sub-dollar / 6-decimal prints
]
SERIES_GRID = {"1": ("1", "rth"), "5": ("5", "rth"), "15": ("15", "rth"), "30": ("30", "rth"),
               "60": ("60", "rth"), "60e": ("60", "eth")}
HEADER = "ticker,volume,open,close,high,low,window_start,transactions\n"
_counter = itertools.count()


# ------------------------------------------------------------------ fixtures

@pytest.fixture(scope="module")
def workroot(tmp_path_factory):
    """Temp root: under D:\\uct-history\\build-test when that drive exists (the
    only place this suite may write there), else pytest's tmp dir."""
    base = Path("D:/uct-history/build-test")
    if Path("D:/uct-history").is_dir():
        root = base / f"_pytest_{os.getpid()}"
        if root.exists():
            shutil.rmtree(root)
        root.mkdir(parents=True)
    else:
        root = tmp_path_factory.mktemp("history_lake_build")
    yield root
    shutil.rmtree(root, ignore_errors=True)


def _newdir(workroot, name):
    d = workroot / f"{name}_{next(_counter)}"
    d.mkdir()
    return d


def _ts(day, hh, mm):
    y, m, d = (int(x) for x in day.split("-"))
    return int(datetime(y, m, d, hh, mm, tzinfo=ET).timestamp())


SYN_DAYS = ["2026-10-30", "2026-11-02", "2026-11-27", "2026-12-31", "2027-01-04"]
#            Fri (EDT)     Mon (EST)     13:00 close   last day of   first day of
#                          after DST                   month/Q/year  the next year


def _syn_rows(day, rng):
    """(ticker, 'vol', 'open', 'close', 'high', 'low', window_start_ns, n) rows, (ticker, time) ordered."""
    rows = []

    def add(ticker, minutes, base, decimals, frac_vol):
        px = base
        for m in minutes:
            px = max(0.0002, px + rng.uniform(-0.02, 0.02) * base)
            o = round(px, decimals)
            c = round(max(0.0001, px + rng.uniform(-0.01, 0.01) * base), decimals)
            h = round(max(o, c) + rng.uniform(0, 0.01) * base, decimals)
            low = round(max(0.0001, min(o, c) - rng.uniform(0, 0.01) * base), decimals)
            low = min(low, o, c)
            vol = rng.randint(1, 500000) + (rng.randint(1, 999999) / 1e6 if frac_vol and rng.random() < 0.4 else 0)
            rows.append((ticker, f"{vol:.6f}", f"{o:.6f}", f"{c:.6f}", f"{h:.6f}", f"{low:.6f}",
                         _ts(day, m // 60, m % 60) * 1_000_000_000, rng.randint(1, 5000)))

    every = list(range(4 * 60, 20 * 60))
    add("AAA", every, 412.5, 2, False)                                        # every minute, cents, whole volume
    add("BB.C", sorted(rng.sample(every, 300)), 37.25, 4, True)               # 4 decimals, fractional volume
    add("BBPC", sorted(rng.sample(every, 120)), 0.4467, 6, True)              # sub-dollar, 6 decimals
    add("BBpC", sorted(rng.sample(every, 90)), 25.11, 2, False)               # differs from BBPC by case only
    add("CON", sorted(rng.sample(every, 60)), 18.4, 3, True)                  # Windows device name
    if day != "2026-11-27":
        add("ZZ", sorted(rng.sample(every, 5)), 891999.5, 2, False)           # absent one day, huge price
    rows.sort(key=lambda r: (r[0], r[6]))
    return rows


def _write_day(raw, day, rows):
    ydir = raw / day[:4]
    ydir.mkdir(parents=True, exist_ok=True)
    path = ydir / f"{day}.csv.gz"
    with gzip.open(path, "wt", encoding="ascii", newline="") as f:
        f.write(HEADER)
        for r in rows:
            f.write(",".join(str(x) for x in r) + "\n")
    return path


@pytest.fixture(scope="module")
def syn_raw(workroot):
    """Five synthetic vendor day files. 2026-11-02 is written OUT OF ORDER with
    DUPLICATE (ticker, minute) rows; a .part file and missing days sit in range."""
    raw = workroot / "syn_raw"
    rng = random.Random(4242)
    for day in SYN_DAYS:
        rows = _syn_rows(day, rng)
        if day == "2026-11-02":
            dups = []
            for r in rng.sample(rows, 40):                       # a later, different row for the same minute
                dups.append((r[0], "777.000000", r[2], f"{float(r[3]) + 0.01:.6f}",
                             f"{max(float(r[4]), float(r[3]) + 0.01):.6f}", r[5], r[6], 9))
            rng.shuffle(rows)
            rows = rows + dups                                   # duplicates come LAST in the file: they must win
        _write_day(raw, day, rows)
    (raw / "2026" / "2026-11-03.csv.gz.part").write_bytes(b"half a download")
    (raw / "2026" / "notes.txt").write_text("not a day file")
    return raw


# ---------------------------------------------------- the independent reference

def _et_date(ts):
    return datetime.fromtimestamp(ts, tz=ET).date()


def _ref_period(series, ts):
    d = _et_date(ts)
    if series == "1":
        return f"{d.year:04d}-{d.month:02d}"
    if series == "5":
        return f"{d.year:04d}Q{(d.month - 1) // 3 + 1}"
    return f"{d.year:04d}"


def _to_micro(text):
    scaled = Decimal(text) * 1_000_000
    assert scaled == scaled.to_integral_value(), text
    return int(scaled)


def reference_pieces(files, symbols=None):
    """{(symbol, series, period): [(t, o, h, l, c, v, n), ...]} by brute force.
    ``files`` is [(day, path)] in ascending day order; a later row for the same
    (ticker, minute) replaces the earlier one, in a file and across files."""
    minutes = {}                                                  # symbol -> {t: row}
    for _day, path in files:
        with gzip.open(path, "rt", encoding="ascii", newline="") as f:
            assert f.readline() == HEADER
            for line in f:
                ticker, rest = line.split(",", 1)
                if symbols is not None and ticker not in symbols:
                    continue
                vol, o, c, h, low, ws, n = rest.rstrip("\n").split(",")
                ws = int(ws)
                assert ws % 60_000_000_000 == 0
                minutes.setdefault(ticker, {})[ws // 1_000_000_000] = (
                    _to_micro(o), _to_micro(h), _to_micro(low), _to_micro(c), _to_micro(vol), int(n))
    out = {}
    for symbol, by_t in minutes.items():
        for series, (tf, grid) in SERIES_GRID.items():
            buckets = {}
            for t in sorted(by_t):                                # time order
                o, h, low, c, v, n = by_t[t]
                start = bar_rollup.tv_bucket_bounds(t * 1000, tf, grid)[0] // 1000
                cur = buckets.get(start)
                if cur is None:
                    buckets[start] = [o, h, low, c, v, n, _ref_period(series, t)]
                else:
                    cur[1] = max(cur[1], h)
                    cur[2] = min(cur[2], low)
                    cur[3] = c
                    cur[4] += v
                    cur[5] += n
                    assert cur[6] == _ref_period(series, t)       # a bucket never straddles a period
            for start in sorted(buckets):
                o, h, low, c, v, n, period = buckets[start]
                out.setdefault((symbol, series, period), []).append((start, o, h, low, c, v, n))
    return out


# ------------------------------------------------------------- checkers

def _snapshot(out):
    out = Path(out)
    return {p.relative_to(out).as_posix(): p.read_bytes() for p in sorted(out.rglob("*")) if p.is_file()}


def _pieces_on_disk(out):
    found = {}
    root = Path(out) / "v1"
    for path in root.rglob("*.ubh"):
        series, enc, fname = path.relative_to(root).parts
        found[(P.decode_symbol(enc), series, fname[:-4])] = path
    return found


def assert_matches_reference(out, ref):
    disk = _pieces_on_disk(out)
    assert set(disk) == set(ref), (sorted(set(disk) ^ set(ref))[:5])
    bars = 0
    for key, path in disk.items():
        symbol, series, period = key
        dec = P.decode_piece(path.read_bytes())
        hdr = dec["header"]
        assert (hdr["symbol"], hdr["series"], hdr["period"]) == key
        pf, vf = 1_000_000 // hdr["pscale"], 1_000_000 // hdr["vscale"]
        got = list(zip(dec["t"].tolist(), (dec["o"] * pf).tolist(), (dec["h"] * pf).tolist(),
                       (dec["l"] * pf).tolist(), (dec["c"] * pf).tolist(), (dec["v"] * vf).tolist(),
                       dec["n"].tolist()))
        want = ref[key]
        assert len(got) == len(want), (key, len(got), len(want))
        for g, w in zip(got, want):
            assert g == w, (key, g, w)
        # the smallest exact scale was used
        if hdr["pscale"] > 1:
            assert any(x % 10 for row in zip(dec["o"], dec["h"], dec["l"], dec["c"]) for x in row), key
        bars += len(got)
    return bars


def assert_index_matches_pieces(out):
    disk = _pieces_on_disk(out)
    listed = set()
    idx_dir = Path(out) / "v1" / "index"
    for path in idx_dir.glob("*.json"):
        doc = json.loads(path.read_text(encoding="utf-8"))
        assert doc["v"] == 1 and doc["symbol"] == P.decode_symbol(path.stem)
        for series, periods in doc["series"].items():
            for period, entry in periods.items():
                key = (doc["symbol"], series, period)
                listed.add(key)
                blob = disk[key].read_bytes()
                hdr = P.read_header(blob)
                assert entry == {"bars": hdr["bars"], "first": hdr["first"], "last": hdr["last"],
                                 "bytes": len(blob), "crc": hdr["crc"]}, key
    assert listed == set(disk)
    assert len(list(idx_dir.glob("*.json"))) == len({k[0] for k in disk})
    return len(listed)


def _build(raw, out, days, **kw):
    kw.setdefault("log", lambda *_: None)
    summary = BLD.Builder(Path(raw), Path(out), **kw).run(days)
    assert not (Path(out) / "_spill").exists() and not (Path(out) / "build.lock").exists()
    return summary


def _syn_files(raw):
    return [(d, raw / d[:4] / f"{d}.csv.gz") for d in SYN_DAYS]


# ------------------------------------------------------------ synthetic tests

@pytest.fixture(scope="module")
def syn_oneshot(workroot, syn_raw):
    out = _newdir(workroot, "syn_oneshot")
    summary = _build(syn_raw, out, "2026-10-01..2027-01-31", chunk_rows=700)   # several flush chunks
    return out, summary


def test_synthetic_build_equals_independent_reference(syn_raw, syn_oneshot):
    out, summary = syn_oneshot
    ref = reference_pieces(_syn_files(syn_raw))
    bars = assert_matches_reference(out, ref)
    assert bars == sum(len(v) for v in ref.values()) > 6000
    # every period kind was produced, on both sides of the month / quarter / year boundary
    keys = set(ref)
    for want in [("AAA", "1", "2026-10"), ("AAA", "1", "2026-11"), ("AAA", "1", "2026-12"), ("AAA", "1", "2027-01"),
                 ("AAA", "5", "2026Q4"), ("AAA", "5", "2027Q1"), ("AAA", "60", "2026"), ("AAA", "60e", "2027"),
                 ("CON", "15", "2026"), ("BBpC", "30", "2026"), ("BBPC", "30", "2026")]:
        assert want in keys
    # the dense ticker has the full grid: 960 minutes, 17 rth-hour bars (10+7 on the half day), 16 clock hours
    assert len(ref[("AAA", "1", "2026-10")]) == 960
    by_day = lambda key, day: [r for r in ref[key] if str(_et_date(r[0])) == day]
    assert len(by_day(("AAA", "60", "2026"), "2026-10-30")) == 17
    assert len(by_day(("AAA", "60", "2026"), "2026-11-27")) == 17
    assert len(by_day(("AAA", "60e", "2026"), "2026-11-27")) == 16
    assert len(by_day(("AAA", "5", "2026Q4"), "2026-12-31")) == 192
    # summary
    assert [d["day"] for d in summary["days"]] == SYN_DAYS            # ascending; .part and junk ignored
    assert summary["symbols"] == 6
    assert summary["anomalies"]["duplicate_rows"] == 40 and summary["anomalies"]["out_of_order_rows"] > 100
    assert summary["pieces_written"] == len(ref) and summary["bytes_written"] == sum(
        p.stat().st_size for p in _pieces_on_disk(out).values())
    assert sum(s["bars"] for s in summary["series"].values()) == bars
    ledger = json.loads((out / "ledger.json").read_text())
    assert list(ledger["days"]) == SYN_DAYS and ledger["symbols"] is None
    for day, path in _syn_files(syn_raw):
        assert ledger["days"][day]["size"] == path.stat().st_size


def test_synthetic_duplicate_rows_last_one_wins(syn_raw, syn_oneshot):
    out, _ = syn_oneshot
    # the reference agrees (it also keeps the last row) -- so pin the rule itself, independently:
    replaced = 0
    with gzip.open(syn_raw / "2026" / "2026-11-02.csv.gz", "rt") as f:
        f.readline()
        seen = {}
        for line in f:
            tkr, vol, o, c, h, low, ws, n = line.rstrip("\n").split(",")
            seen.setdefault((tkr, int(ws) // 10 ** 9), []).append((vol, int(n)))
    for (tkr, t), rows in seen.items():
        if len(rows) < 2:
            continue
        dec = P.decode_piece((out / P.piece_relpath("1", tkr, "2026-11")).read_bytes())
        i = int(np.searchsorted(dec["t"], t))
        assert dec["t"][i] == t and dec["n"][i] == 9 and rows[-1] == ("777.000000", 9)
        assert dec["v"][i] * (1_000_000 // dec["header"]["vscale"]) == 777_000_000
        replaced += 1
    assert replaced == 40


def test_synthetic_index_matches_pieces(syn_oneshot):
    out, summary = syn_oneshot
    assert assert_index_matches_pieces(out) == summary["pieces_written"]
    doc = json.loads((out / "v1" / "index" / "s-AAA.json").read_text())
    assert set(doc["series"]) == set(P.SERIES_IDS)
    assert set(doc["series"]["1"]) == {"2026-10", "2026-11", "2026-12", "2027-01"}
    assert set(doc["series"]["60e"]) == {"2026", "2027"}


def test_synthetic_rebuild_twice_is_byte_identical(workroot, syn_raw, syn_oneshot):
    out, _ = syn_oneshot
    before = _snapshot(out)
    # a plain rerun skips every day (ledger) and touches nothing
    again = _build(syn_raw, out, "2026-10-01..2027-01-31")
    assert again["days"] == [] and again["skipped_days"] == SYN_DAYS and again["pieces_written"] == 0
    assert _snapshot(out) == before
    # --rebuild folds every day in again: same bytes
    redo = _build(syn_raw, out, "2026-10-01..2027-01-31", rebuild=True)
    assert [d["day"] for d in redo["days"]] == SYN_DAYS
    assert redo["pieces_written"] == redo["pieces_unchanged"] > 0
    assert _snapshot(out) == before
    # and a second, independent output directory is identical too (default chunking this time)
    out2 = _newdir(workroot, "syn_second")
    _build(syn_raw, out2, "2026-10-01..2027-01-31")
    assert _snapshot(out2) == before


def test_synthetic_day_by_day_equals_all_at_once(workroot, syn_raw, syn_oneshot):
    out, _ = syn_oneshot
    step = _newdir(workroot, "syn_stepwise")
    _build(syn_raw, step, "2026-10-30")
    first = _snapshot(step)
    assert "v1/1/s-AAA/2026-10.ubh" in first and "v1/1/s-AAA/2026-11.ubh" not in first
    _build(syn_raw, step, "2026-11-02")
    _build(syn_raw, step, "2026-11-27..2026-12-31")
    _build(syn_raw, step, "2027-01-04")
    assert _snapshot(step) == _snapshot(out)                     # pieces, indexes and ledger
    # the yearly piece really was merged, not overwritten: it holds all four 2026 days
    dec = P.decode_piece((step / "v1/60/s-AAA/2026.ubh").read_bytes())
    assert sorted({str(_et_date(t)) for t in dec["t"].tolist()}) == SYN_DAYS[:4]


def test_finished_periods_are_flushed_and_ledgered_before_later_days_are_read(workroot, syn_raw):
    """Memory discipline and resumability, observed while the build runs: when a later
    day is logged, every period that ended before it is already off the spill, on disk
    as pieces, and its days are in the ledger."""
    out = _newdir(workroot, "syn_flush_order")
    seen = {}

    def log(msg):
        day = msg[:10]
        if day in SYN_DAYS:
            ledger = out / "ledger.json"
            seen[day] = {
                "spill": sorted(os.listdir(out / "_spill")),
                "ledger": sorted(json.loads(ledger.read_text())["days"]) if ledger.exists() else [],
                "pieces": {k for k in _pieces_on_disk(out) if k[0] == "AAA"},
            }

    BLD.Builder(syn_raw, out, log=log).run("2026-10-01..2027-01-31")
    assert list(seen) == SYN_DAYS
    # first day: nothing finished yet, six spill files (one per series)
    assert len(seen["2026-10-30"]["spill"]) == 6 and seen["2026-10-30"]["ledger"] == []
    # 2026-11-02: October's 1-minute month is done -> flushed; quarter and year still open
    s = seen["2026-11-02"]
    assert ("AAA", "1", "2026-10") in s["pieces"] and ("AAA", "5", "2026Q4") not in s["pieces"]
    assert not [f for f in s["spill"] if f.startswith("1_2026-10_")]
    assert s["ledger"] == []                                   # 2026-10-30 still has open periods
    # first day of 2027: everything of 2026 is flushed and its four days are in the ledger
    s = seen["2027-01-04"]
    assert s["ledger"] == SYN_DAYS[:4]
    assert all("_2027" in f for f in s["spill"]) and len(s["spill"]) == 6
    assert {("AAA", "1", "2026-12"), ("AAA", "5", "2026Q4"), ("AAA", "60", "2026"), ("AAA", "60e", "2026")} <= s["pieces"]
    assert not any(k[2].startswith("2027") for k in s["pieces"])


def test_synthetic_symbol_filter_builds_the_same_pieces(workroot, syn_raw, syn_oneshot):
    out, _ = syn_oneshot
    sub = _newdir(workroot, "syn_subset")
    summary = _build(syn_raw, sub, "2026-10-01..2027-01-31", symbols=["BBpC", "CON", "NOPE"])
    full, part = _snapshot(out), _snapshot(sub)
    part.pop("ledger.json")
    assert part and all(full[k] == v for k, v in part.items())
    assert {k.split("/")[2] for k in part if k.endswith(".ubh")} == {"s-BB_70C", "s-CON"}
    assert summary["symbols"] == 2
    assert json.loads((sub / "ledger.json").read_text())["symbols"] == ["BBpC", "CON", "NOPE"]
    # a ledger written for one symbol scope refuses another, instead of skipping days it never built
    with pytest.raises(BLD.BuildError, match="--symbols"):
        _build(syn_raw, sub, "2026-10-01..2027-01-31")
    assert not (sub / "build.lock").exists()


def test_revised_day_file_is_folded_in_again_and_new_bars_replace_old(workroot, syn_raw):
    raw = _newdir(workroot, "rev_raw")
    out = _newdir(workroot, "rev_out")
    src = syn_raw / "2026" / "2026-10-30.csv.gz"
    with gzip.open(src, "rt") as f:
        lines = f.read().splitlines()
    _write_day(raw, "2026-10-30", [ln.split(",") for ln in lines[1:]])
    _build(raw, out, "2026-10-30")
    before = P.decode_piece((out / "v1/1/s-AAA/2026-10.ubh").read_bytes())
    # the vendor republishes the day: AAA's first bar gets a different close, volume and count
    rows = [ln.split(",") for ln in lines[1:]]
    i = next(k for k, r in enumerate(rows) if r[0] == "AAA")
    rows[i][1], rows[i][3], rows[i][4], rows[i][7] = "123456.500000", "400.010000", "999.990000", "4242"
    _write_day(raw, "2026-10-30", rows)
    summary = _build(raw, out, "2026-10-30")
    assert [d["day"] for d in summary["days"]] == ["2026-10-30"]          # size changed -> not skipped
    after = P.decode_piece((out / "v1/1/s-AAA/2026-10.ubh").read_bytes())
    assert after["header"]["bars"] == before["header"]["bars"] == 960
    assert after["n"][0] == 4242 and before["n"][0] != 4242
    assert after["c"][0] * (1_000_000 // after["header"]["pscale"]) == 400_010_000
    assert np.array_equal(after["n"][1:], before["n"][1:])
    assert_matches_reference(out, reference_pieces([("2026-10-30", raw / "2026" / "2026-10-30.csv.gz")]))
    assert_index_matches_pieces(out)


def test_build_refuses_instead_of_guessing(workroot, syn_raw):
    rows = _syn_rows("2026-11-10", random.Random(1))[:50]

    # a price with 7 decimals cannot be held exactly at 1e-6: stop, never round
    raw = _newdir(workroot, "bad_raw")
    bad = [list(r) for r in rows]
    bad[3][2] = "412.1234567"
    _write_day(raw, "2026-11-10", bad)
    with pytest.raises(BLD.BuildError, match="round-trip"):
        _build(raw, _newdir(workroot, "bad_out"), "2026-11-10")

    # a row from another ET day: stop by default, leave it out on request
    raw = _newdir(workroot, "foreign_raw")
    foreign = [list(r) for r in rows]
    foreign[-1][6] = _ts("2026-11-11", 9, 30) * 1_000_000_000
    _write_day(raw, "2026-11-10", foreign)
    with pytest.raises(BLD.BuildError, match="not on ET date 2026-11-10"):
        _build(raw, _newdir(workroot, "foreign_out"), "2026-11-10")
    out = _newdir(workroot, "foreign_out")
    summary = _build(raw, out, "2026-11-10", foreign_rows="drop")
    assert summary["anomalies"]["foreign_rows"] == 1 and summary["rows"] == 49
    assert sum(P.read_header(p.read_bytes())["bars"] for k, p in _pieces_on_disk(out).items() if k[1] == "1") == 49

    # rows with NO ticker (the vendor's 2006-08-31 file has nine): left out and counted, and the
    # named rows build exactly as they would without them
    raw = _newdir(workroot, "unnamed_raw")
    junk = [["", 0, "0.0", "0.0", "0.0", "0.0", rows[5][6], 1], ["  ", 0, "0.0", "0.0", "0.0", "0.0", rows[9][6], 1]]
    _write_day(raw, "2026-11-10", [list(r) for r in rows[:20]] + junk + [list(r) for r in rows[20:]])
    out = _newdir(workroot, "unnamed_out")
    summary = _build(raw, out, "2026-11-10")
    assert summary["anomalies"]["unnamed_rows"] == 2 and summary["rows"] == 50
    clean_raw, clean_out = _newdir(workroot, "unnamed_clean_raw"), _newdir(workroot, "unnamed_clean_out")
    _write_day(clean_raw, "2026-11-10", [list(r) for r in rows])
    _build(clean_raw, clean_out, "2026-11-10")
    got, want = _pieces_on_disk(out), _pieces_on_disk(clean_out)
    assert got.keys() == want.keys() and all(got[k].read_bytes() == want[k].read_bytes() for k in want)

    # a bar that does not start on a minute
    raw = _newdir(workroot, "offmin_raw")
    off = [list(r) for r in rows]
    off[0][6] = int(off[0][6]) + 1_000_000_000
    _write_day(raw, "2026-11-10", off)
    with pytest.raises(BLD.BuildError, match="minute boundary"):
        _build(raw, _newdir(workroot, "offmin_out"), "2026-11-10")

    # another build holds the output directory
    out = _newdir(workroot, "locked_out")
    (out / "build.lock").write_text("1")
    with pytest.raises(BLD.BuildError, match="build.lock"):
        BLD.Builder(syn_raw, out, log=lambda *_: None).run("2026-10-30")
    assert (out / "build.lock").exists() and not (out / "v1").exists()

    with pytest.raises(BLD.BuildError, match="backwards"):
        BLD.parse_days("2026-11-13..2026-11-10")
    assert BLD.parse_days("2026-11-10..2026-11-13, 2026-12-01") == [
        (datetime(2026, 11, 10).date(), datetime(2026, 11, 13).date()),
        (datetime(2026, 12, 1).date(), datetime(2026, 12, 1).date())]


def test_cli_prints_a_summary(workroot, syn_raw, capsys):
    out = _newdir(workroot, "cli_out")
    rc = BLD.main(["--raw", str(syn_raw), "--out", str(out), "--days", "2026-10-30..2026-11-02",
                   "--symbols", "AAA,CON", "--quality", "5"])
    text = capsys.readouterr().out
    assert rc == 0
    for needle in ("days processed   2", "symbols          2", "pieces written", "bytes/bar", "peak RSS", "s/day"):
        assert needle in text, needle
    ref = reference_pieces(_syn_files(syn_raw)[:2], symbols={"AAA", "CON"})
    assert_matches_reference(out, ref)                 # quality changes bytes, never bars
    rc = BLD.main(["--raw", str(syn_raw), "--out", str(out), "--days", "2026-11-02..2026-10-30"])
    assert rc == 2 and "BUILD FAILED" in capsys.readouterr().err


# ------------------------------------------------------------ real data

_real_files = [(d, REAL_RAW / d[:4] / f"{d}.csv.gz") for d in REAL_DAYS]
_real_missing = [str(p) for _, p in _real_files if not p.exists()]
needs_real = pytest.mark.skipif(bool(_real_missing), reason=f"real day files absent: {_real_missing}")


@pytest.fixture(scope="module")
def real_oneshot(workroot):
    out = _newdir(workroot, "real_oneshot")
    summary = _build(REAL_RAW, out, f"{REAL_DAYS[0]}..{REAL_DAYS[-1]}", symbols=REAL_SYMBOLS, chunk_rows=20_000)
    return out, summary


@needs_real
def test_real_build_equals_independent_reference(real_oneshot):
    out, summary = real_oneshot
    ref = reference_pieces(_real_files, symbols=set(REAL_SYMBOLS))
    present = {k[0] for k in ref}
    assert len(present) >= 28, sorted(set(REAL_SYMBOLS) - present)
    assert {"SPY", "BRK.A", "BACpB", "CON", "PRN", "BCPC", "BCpC", "TPC", "TpC"} <= present
    bars = assert_matches_reference(out, ref)
    assert bars == sum(len(v) for v in ref.values()) > 50_000
    assert len(ref) == 6 * len(present) == summary["pieces_written"]
    assert summary["rows"] == sum(len(v) for k, v in ref.items() if k[1] == "1")
    # SPY trades every extended-hours hour: 17 rth-grid bars and 16 clock-hour bars per day
    assert len(ref[("SPY", "60", "2026")]) == 17 * 3 and len(ref[("SPY", "60e", "2026")]) == 16 * 3
    scales = {P.read_header(p.read_bytes())["pscale"] for p in _pieces_on_disk(out).values()}
    assert 1_000_000 in scales and len(scales) >= 2


@needs_real
def test_real_index_matches_pieces(real_oneshot):
    out, summary = real_oneshot
    assert assert_index_matches_pieces(out) == summary["pieces_written"]


@needs_real
def test_real_build_twice_is_byte_identical(real_oneshot):
    out, _ = real_oneshot
    before = _snapshot(out)
    redo = _build(REAL_RAW, out, f"{REAL_DAYS[0]}..{REAL_DAYS[-1]}", symbols=REAL_SYMBOLS, rebuild=True)
    assert len(redo["days"]) == 3 and redo["pieces_written"] == redo["pieces_unchanged"] > 0
    assert _snapshot(out) == before


@needs_real
def test_real_day_a_then_b_equals_a_to_b(workroot, real_oneshot):
    out, _ = real_oneshot
    step = _newdir(workroot, "real_stepwise")
    for day in REAL_DAYS:
        _build(REAL_RAW, step, day, symbols=REAL_SYMBOLS)
    assert _snapshot(step) == _snapshot(out)
