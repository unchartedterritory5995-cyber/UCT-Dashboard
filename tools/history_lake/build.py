"""Build history-lake pieces from the vendor's daily 1-minute bar files.

    python tools/history_lake/build.py --raw D:/uct-history/raw \
        --out D:/uct-history/build-test --days 2026-11-10..2026-11-13 [--symbols SPY,NVDA]

Input : ``<raw>/YYYY/YYYY-MM-DD.csv.gz`` (gzipped CSV, one trading day, all US
        stocks, UNADJUSTED; columns ``ticker,volume,open,close,high,low,
        window_start,transactions``; ``window_start`` = bar start, epoch ns UTC).
        ``*.part`` files and missing days are skipped.
Output: ``<out>/v1/<series>/<encoded symbol>/<period>.ubh``   pieces (piece.py)
        ``<out>/v1/index/<encoded symbol>.json``              what exists per symbol
        ``<out>/ledger.json``                                 day files already folded in

What it does per day file: parse with pyarrow, order rows by (ticker, time),
turn prices/volume into exact integers at 1e-6 (refusing to round), and for each
series ``1 5 15 30 60 60e`` bucket the minutes with ``bucketing.py`` and
aggregate O = first, H = max, L = min, C = last, V = sum, N = sum, in time
order. Every series keeps every bar the raw file has (pre-market and
after-hours included). No split adjustment: pieces are raw by design.

Memory: nothing but ONE day is held in RAM. Each day's aggregated bars go to a
spill file under ``<out>/_spill`` (one per series per day); when the date
range moves past a period (month for ``1``, quarter for ``5``, year for the
rest) -- or at the end of the run -- that period's spill files are gathered
symbol by symbol in bounded chunks, merged with any piece already on disk
(new bar replaces old bar with the same time) and written. Peak temporary disk
is about one year of the derived series plus a quarter of 5m and a month of 1m
(roughly 12 GB at 2026 volumes).

Order: days are processed in ASCENDING date order (the range is sorted; that is
the only order supported). Period flushing relies on it.

Resumable and idempotent: a day is added to the ledger only after every piece
it touches is on disk; a rerun skips ledger days whose file size is unchanged
(``--rebuild`` ignores the ledger and folds the days in again). Because merging
replaces by bar time and encoding is deterministic, folding the same days twice
yields byte-identical pieces, and building A then B equals building A..B.
"""
from __future__ import annotations

import argparse
import bisect
import json
import os
import re
import shutil
import sys
import time
from datetime import date, timedelta
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Tuple

import numpy as np

if __package__ in (None, ""):  # script mode: python tools/history_lake/build.py
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    import bucketing  # type: ignore[no-redef]
    import encode_job  # type: ignore[no-redef]
    import pack  # type: ignore[no-redef]
    import piece  # type: ignore[no-redef]
else:
    from . import bucketing, encode_job, pack, piece

SERIES = piece.SERIES_IDS
RECORD = np.dtype([(k, "<i8") for k in piece.COLUMNS])
CSV_COLUMNS = ("ticker", "volume", "open", "close", "high", "low", "window_start", "transactions")
LEDGER_VERSION = 1
_DAY_FILE_RE = re.compile(r"^(\d{4}-\d{2}-\d{2})\.csv\.gz$")


class BuildError(RuntimeError):
    """The build cannot continue without guessing."""


# --------------------------------------------------------------------------
# small file helpers
# --------------------------------------------------------------------------

_write_atomic = encode_job.write_atomic


def _json_bytes(obj) -> bytes:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode("ascii")


def peak_rss_bytes() -> Optional[int]:
    """Peak working set of this process, or None when it cannot be read cheaply."""
    try:
        if os.name == "nt":
            import ctypes
            from ctypes import wintypes

            class PMC(ctypes.Structure):
                _fields_ = [("cb", wintypes.DWORD), ("PageFaultCount", wintypes.DWORD),
                            ("PeakWorkingSetSize", ctypes.c_size_t), ("WorkingSetSize", ctypes.c_size_t),
                            ("QuotaPeakPagedPoolUsage", ctypes.c_size_t), ("QuotaPagedPoolUsage", ctypes.c_size_t),
                            ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t), ("QuotaNonPagedPoolUsage", ctypes.c_size_t),
                            ("PagefileUsage", ctypes.c_size_t), ("PeakPagefileUsage", ctypes.c_size_t)]
            pmc = PMC()
            pmc.cb = ctypes.sizeof(PMC)
            kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
            psapi = ctypes.WinDLL("psapi", use_last_error=True)
            kernel32.GetCurrentProcess.restype = wintypes.HANDLE
            psapi.GetProcessMemoryInfo.argtypes = [wintypes.HANDLE, ctypes.POINTER(PMC), wintypes.DWORD]
            if psapi.GetProcessMemoryInfo(kernel32.GetCurrentProcess(), ctypes.byref(pmc), pmc.cb):
                return int(pmc.PeakWorkingSetSize)
            return None
        import resource
        peak = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
        return int(peak if sys.platform == "darwin" else peak * 1024)
    except Exception:  # noqa: BLE001 - a missing metric must never fail a build
        return None


# --------------------------------------------------------------------------
# days
# --------------------------------------------------------------------------

def parse_days(spec: str) -> List[Tuple[date, date]]:
    """``'2026-11-10..2026-11-13'`` / ``'2026-11-13'`` / comma-separated mix."""
    ranges = []
    for part in spec.split(","):
        part = part.strip()
        if not part:
            continue
        lo, _, hi = part.partition("..")
        try:
            a = date.fromisoformat(lo.strip())
            b = date.fromisoformat(hi.strip()) if hi else a
        except ValueError as exc:
            raise BuildError(f"bad --days value {part!r}: {exc}") from exc
        if b < a:
            raise BuildError(f"--days range runs backwards: {part!r} (ascending only)")
        ranges.append((a, b))
    if not ranges:
        raise BuildError("--days is empty")
    return ranges


def find_day_files(raw: Path, ranges: Iterable[Tuple[date, date]]) -> List[Tuple[str, Path]]:
    """Complete day files inside the ranges, ascending. Missing days and
    ``.part`` files are simply not there."""
    found: Dict[str, Path] = {}
    for a, b in ranges:
        for year in range(a.year, b.year + 1):
            ydir = raw / f"{year:04d}"
            if not ydir.is_dir():
                continue
            for name in os.listdir(ydir):
                m = _DAY_FILE_RE.match(name)
                if not m:
                    continue
                try:
                    d = date.fromisoformat(m.group(1))
                except ValueError:
                    continue
                if a <= d <= b and d.year == year:
                    found[m.group(1)] = ydir / name
    return sorted(found.items())


# --------------------------------------------------------------------------
# one day
# --------------------------------------------------------------------------

class DayData:
    """One day's rows, ordered by (ticker, time), as exact integers."""

    __slots__ = ("day", "names", "offs", "sym", "cols", "stats")

    def __init__(self, day, names, offs, sym, cols, stats):
        self.day = day          # 'YYYY-MM-DD'
        self.names = names      # tickers present, sorted (code-point order)
        self.offs = offs        # row offsets per ticker, len(names) + 1
        self.sym = sym          # per-row index into names
        self.cols = cols        # t o h l c v n (int64; prices/volume at 1e6)
        self.stats = stats


def read_day(path: Path, day: str, symbols: Optional[frozenset] = None,
             foreign_rows: str = "error") -> DayData:
    import pyarrow as pa
    import pyarrow.csv as pc

    pa.set_cpu_count(1)
    types = {"ticker": pa.string(), "volume": pa.float64(), "open": pa.float64(), "close": pa.float64(),
             "high": pa.float64(), "low": pa.float64(), "window_start": pa.int64(), "transactions": pa.int64()}
    try:
        tb = pc.read_csv(str(path), read_options=pc.ReadOptions(use_threads=False),
                         convert_options=pc.ConvertOptions(column_types=types, include_columns=list(CSV_COLUMNS)))
    except (pa.ArrowInvalid, pa.ArrowKeyError, OSError) as exc:
        raise BuildError(f"{path}: cannot parse: {exc}") from exc
    nulls = {c: tb[c].null_count for c in CSV_COLUMNS if tb[c].null_count}
    if nulls:
        raise BuildError(f"{path}: null values {nulls}")
    stats = {"rows_in_file": tb.num_rows, "rows": 0, "symbols": 0, "out_of_order_rows": 0,
             "duplicate_rows": 0, "foreign_rows": 0, "outside_0400_2000": 0, "unnamed_rows": 0}
    # The vendor file occasionally carries rows with NO ticker (2006-08-31: nine, all zero price and
    # volume). A bar nobody can ask for is not data: left out and counted, never a reason to stop.
    import pyarrow.compute as pcmp
    named = pcmp.not_equal(pcmp.utf8_trim_whitespace(tb["ticker"]), "")
    n_unnamed = tb.num_rows - int(pcmp.sum(named).as_py() or 0)
    if n_unnamed:
        stats["unnamed_rows"] = n_unnamed
        tb = tb.filter(named)
    empty = DayData(day, [], np.zeros(1, dtype=np.int64), np.zeros(0, dtype=np.int64),
                    {k: np.zeros(0, dtype=np.int64) for k in piece.COLUMNS}, stats)
    if tb.num_rows == 0:
        return empty

    enc = tb["ticker"].combine_chunks().dictionary_encode()
    codes = enc.indices.to_numpy(zero_copy_only=False).astype(np.int64)
    names_seen = enc.dictionary.to_pylist()
    ws = tb["window_start"].to_numpy(zero_copy_only=False)
    fcols = {k: tb[src].to_numpy(zero_copy_only=False)
             for k, src in (("o", "open"), ("h", "high"), ("l", "low"), ("c", "close"), ("v", "volume"))}
    ncol = tb["transactions"].to_numpy(zero_copy_only=False)
    del tb, enc

    keep = None
    if symbols is not None:
        wanted = np.array([i for i, nm in enumerate(names_seen) if nm in symbols], dtype=np.int64)
        keep = np.isin(codes, wanted)
    off_minute = ws % 60_000_000_000 != 0
    if keep is not None:
        off_minute &= keep
    if off_minute.any():
        raise BuildError(f"{path}: {int(off_minute.sum())} rows do not start on a minute boundary")
    t = ws // 1_000_000_000
    ctx = bucketing.day_context(bucketing.to_ymd(day))
    foreign = (t < ctx.mid0) | (t >= ctx.mid1)
    if keep is not None:
        foreign &= keep
    n_foreign = int(foreign.sum())
    if n_foreign:
        stats["foreign_rows"] = n_foreign
        if foreign_rows != "drop":
            i = int(np.flatnonzero(foreign)[0])
            raise BuildError(
                f"{path}: {n_foreign} rows are not on ET date {day} (first: {names_seen[codes[i]]} at "
                f"{int(t[i])}). Rerun with --foreign-rows drop to leave them out.")
        keep = ~foreign if keep is None else (keep & ~foreign)
    if keep is not None:
        codes, t, ncol = codes[keep], t[keep], ncol[keep]
        fcols = {k: a[keep] for k, a in fcols.items()}
    if codes.size == 0:
        return empty

    # rank tickers in code-point order; the vendor file is normally already (ticker, time) sorted
    order_names = sorted(range(len(names_seen)), key=names_seen.__getitem__)
    rank = np.empty(len(names_seen), dtype=np.int64)
    rank[np.array(order_names, dtype=np.int64)] = np.arange(len(names_seen), dtype=np.int64)
    sym = rank[codes]
    d_sym, d_t = np.diff(sym), np.diff(t)
    in_order = (d_sym > 0) | ((d_sym == 0) & (d_t > 0))
    if not in_order.all():
        stats["out_of_order_rows"] = int(((d_sym < 0) | ((d_sym == 0) & (d_t < 0))).sum())
        idx = np.lexsort((np.arange(sym.size), t, sym))        # stable: file order breaks ties
        sym, t, ncol = sym[idx], t[idx], ncol[idx]
        fcols = {k: a[idx] for k, a in fcols.items()}
        last = np.ones(sym.size, dtype=bool)                   # duplicate (ticker, minute): LAST row in the file wins
        last[:-1] = (sym[1:] != sym[:-1]) | (t[1:] != t[:-1])
        stats["duplicate_rows"] = int((~last).sum())
        if stats["duplicate_rows"]:
            sym, t, ncol = sym[last], t[last], ncol[last]
            fcols = {k: a[last] for k, a in fcols.items()}

    try:
        cols = piece.bars_from_floats(t, fcols["o"], fcols["h"], fcols["l"], fcols["c"], fcols["v"], ncol)
    except piece.PieceError as exc:
        raise BuildError(f"{path}: {exc}") from exc
    del fcols

    present = np.flatnonzero(np.concatenate(([True], sym[1:] != sym[:-1])))
    offs = np.append(present, sym.size).astype(np.int64)
    ranks_present = sym[present]
    sorted_names = [names_seen[i] for i in order_names]
    names = [sorted_names[int(r)] for r in ranks_present]
    dense = np.repeat(np.arange(len(names), dtype=np.int64), np.diff(offs))
    mod = bucketing.et_minute_of_day(t, day)
    stats.update(rows=int(sym.size), symbols=len(names),
                 outside_0400_2000=int(((mod < 240) | (mod >= 1200)).sum()))
    return DayData(day, names, offs, dense, cols, stats)


def aggregate(dd: DayData, series: str) -> Tuple[np.ndarray, np.ndarray]:
    """Bars of one series for the whole day: (records grouped by ticker in
    ``dd.names`` order and time-ordered inside a ticker, row offsets per ticker)."""
    c = dd.cols
    n = c["t"].size
    if series == "1":
        rec = np.empty(n, dtype=RECORD)
        for k in piece.COLUMNS:
            rec[k] = c[k]
        return rec, dd.offs.copy()
    b = bucketing.series_bucket_starts(c["t"], series, dd.day)
    same_sym = dd.sym[1:] == dd.sym[:-1]
    if (same_sym & (b[1:] < b[:-1])).any():
        raise BuildError(f"{dd.day} series {series}: bucket starts are not monotonic in time")
    first = np.flatnonzero(np.concatenate(([True], ~same_sym | (b[1:] != b[:-1]))))
    last = np.append(first[1:], n) - 1
    rec = np.empty(first.size, dtype=RECORD)
    rec["t"] = b[first]
    rec["o"] = c["o"][first]                         # first minute's open
    rec["h"] = np.maximum.reduceat(c["h"], first)
    rec["l"] = np.minimum.reduceat(c["l"], first)
    rec["c"] = c["c"][last]                          # last minute's close
    rec["v"] = np.add.reduceat(c["v"], first)
    rec["n"] = np.add.reduceat(c["n"], first)
    offs = np.searchsorted(dd.sym[first], np.arange(len(dd.names) + 1), side="left").astype(np.int64)
    return rec, offs


# --------------------------------------------------------------------------
# the builder
# --------------------------------------------------------------------------

def _log(message: str) -> None:
    print(message, flush=True)      # a redirected long run must show progress line by line


class _Block:
    __slots__ = ("day", "path", "names", "offs")

    def __init__(self, day, path, names, offs):
        self.day, self.path, self.names, self.offs = day, path, names, offs


class Builder:
    def __init__(self, raw: Path, out: Path, *, symbols: Optional[Iterable[str]] = None,
                 rebuild: bool = False, quality: int = piece.DEFAULT_QUALITY,
                 foreign_rows: str = "error", chunk_rows: int = 1_000_000, jobs: int = 1,
                 packs: bool = False, spill_dir: Optional[Path] = None, min_spill_free_gb: float = 15.0,
                 log=_log):
        self.raw, self.out = Path(raw), Path(out)
        self.symbols = frozenset(symbols) if symbols else None
        self.rebuild, self.quality = rebuild, int(quality)
        self.foreign_rows, self.chunk_rows, self.log = foreign_rows, int(chunk_rows), log
        # --jobs: pieces are encoded by this many processes (1: in this one, as before). Results are
        # recorded in the order the pieces were handed out, so the indexes, the summary and every
        # piece's bytes are the same whatever the number.
        self.jobs = max(1, int(jobs))
        self._pool = None
        self._inflight = []                          # [(symbol, series, period, future)] oldest first
        # --packs: each (series, period) is ONE file, packs/<series>/<period>.pack (pack.py), and no
        # per-symbol index is written (publish.py derives the indexes from the packs).
        self.packs = bool(packs)
        self._pack_in = None                         # PackReader of the period being flushed, or None
        self._pack_out = None                        # its PackWriter
        # --spill-dir: the day-by-day scratch rows (~120 MB a day, read back at every flush) on another
        # disk. 2026-11-16: three pack builds held this PC's spinning D: at 93% busy, almost all of it
        # this scratch; on the SSD the disk stops being the limit. The builder owns ONLY its own
        # subfolder there, named after its output folder, and refuses to start, or stops (resumable,
        # nothing lost: the ledger only records finished days), when that disk falls below
        # `min_spill_free_gb` free.
        self.spill = (Path(spill_dir) / f"_spill_{self.out.name}") if spill_dir else (self.out / "_spill")
        self.min_spill_free = float(min_spill_free_gb) * 2 ** 30 if spill_dir else 0.0
        self.lock_path = self.out / "build.lock"
        self.ledger_path = self.out / "ledger.json"
        self.open_periods: Dict[Tuple[str, str], List[_Block]] = {}
        self.pending: Dict[str, set] = {}             # day -> (series, period) not yet on disk
        self.day_info: Dict[str, dict] = {}
        self.summary = {
            "days": [], "skipped_days": [], "rows": 0, "symbols": set(), "pieces_written": 0,
            "pieces_unchanged": 0,
            "bytes_written": 0, "series": {s: {"pieces": 0, "bars": 0, "bytes": 0} for s in SERIES},
            "flush_seconds": 0.0, "anomalies": {"out_of_order_rows": 0, "duplicate_rows": 0,
                                                "foreign_rows": 0, "outside_0400_2000": 0,
                                                "unnamed_rows": 0},
            "uncovered_calendar_days": [],
        }

    # ---- ledger ---------------------------------------------------------
    def _load_ledger(self) -> dict:
        scope = sorted(self.symbols) if self.symbols is not None else None
        fresh = {"v": LEDGER_VERSION, "symbols": scope, "days": {}}
        if not self.ledger_path.exists():
            return fresh
        try:
            led = json.loads(self.ledger_path.read_text(encoding="utf-8"))
            ok = led.get("v") == LEDGER_VERSION and isinstance(led.get("days"), dict)
        except (ValueError, OSError):
            ok = False
        if not ok:
            raise BuildError(f"{self.ledger_path} is unreadable; move it aside or fix it")
        if led.get("symbols") != scope:
            if not self.rebuild:
                raise BuildError(
                    f"{self.ledger_path} was written for --symbols {led.get('symbols')!r} but this run "
                    f"asks for {scope!r}. Use a different --out, or --rebuild to start the ledger over.")
            return fresh
        return led

    def _save_ledger(self) -> None:
        _write_atomic(self.ledger_path, _json_bytes(self.ledger))

    # ---- run ------------------------------------------------------------
    def run(self, days_spec: str) -> dict:
        t_run = time.perf_counter()
        self.out.mkdir(parents=True, exist_ok=True)
        try:
            fd = os.open(self.lock_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        except FileExistsError as exc:
            raise BuildError(f"{self.lock_path} exists: another build is using this --out "
                             f"(delete the file if none is running)") from exc
        os.write(fd, str(os.getpid()).encode())
        os.close(fd)
        try:
            self.ledger = self._load_ledger()
            if self.spill.exists():
                self.log(f"removing stale spill directory {self.spill}")
                shutil.rmtree(self.spill)
            self.spill.mkdir(parents=True)
            files = find_day_files(self.raw, parse_days(days_spec))
            if not files:
                self.log("no complete day files in range")
            for day, path in files:           # ASCENDING: period flushing depends on it
                size = path.stat().st_size
                done = self.ledger["days"].get(day)
                if done and not self.rebuild:
                    if done.get("size") == size:
                        self.summary["skipped_days"].append(day)
                        continue
                    self.log(f"{day}: file size changed ({done.get('size')} -> {size}); folding it in again")
                self._flush_periods_before(day)
                self._check_spill_room()
                self._process_day(day, path, size)
            self._flush(list(self.open_periods))
        finally:
            if self._pool is not None:
                self._pool.shutdown(wait=True, cancel_futures=True)
                self._pool = None
            shutil.rmtree(self.spill, ignore_errors=True)   # useless after a failure too
            try:
                os.remove(self.lock_path)
            except OSError:
                pass
        s = self.summary
        s["wall_seconds"] = time.perf_counter() - t_run
        s["peak_rss_bytes"] = peak_rss_bytes()
        s["symbols"] = len(s["symbols"])
        return s

    def _process_day(self, day: str, path: Path, size: int) -> None:
        t0 = time.perf_counter()
        if not bucketing.calendar_covers(day):
            self.summary["uncovered_calendar_days"].append(day)
        dd = read_day(path, day, self.symbols, self.foreign_rows)
        t1 = time.perf_counter()
        keys = set()
        bars = {}
        if dd.stats["rows"]:
            for series in SERIES:
                rec, offs = aggregate(dd, series)
                period = piece.period_of(series, day)
                blk_path = self.spill / f"{series}_{period}_{day}.bin"
                with open(blk_path, "wb") as f:
                    rec.tofile(f)
                self.open_periods.setdefault((series, period), []).append(
                    _Block(day, blk_path, dd.names, offs))
                keys.add((series, period))
                bars[series] = int(rec.size)
                del rec
        t2 = time.perf_counter()
        st = dd.stats
        self.day_info[day] = {"size": size, "rows": st["rows"]}
        self.pending[day] = keys
        s = self.summary
        s["rows"] += st["rows"]
        s["symbols"].update(dd.names)
        for k in s["anomalies"]:
            s["anomalies"][k] += st[k]
        s["days"].append({"day": day, "rows": st["rows"], "symbols": st["symbols"], "bars": bars,
                          "parse_seconds": t1 - t0, "aggregate_seconds": t2 - t1,
                          "seconds": t2 - t0, "anomalies": {k: st[k] for k in s["anomalies"] if st[k]}})
        self.log(f"{day}  rows {st['rows']:>9,}  symbols {st['symbols']:>6,}  "
                 f"parse {t1 - t0:5.2f}s  aggregate+spill {t2 - t1:5.2f}s"
                 + (f"  anomalies {s['days'][-1]['anomalies']}" if s['days'][-1]['anomalies'] else ""))
        if not keys:
            self._settle_days()

    def _check_spill_room(self) -> None:
        if not self.min_spill_free:
            return
        free = shutil.disk_usage(self.spill).free
        if free < self.min_spill_free:
            raise BuildError(f"only {free / 2 ** 30:.1f} GB free where the scratch rows go ({self.spill}); "
                             f"stopping before that disk fills (rerun the same command to resume)")

    def _flush_periods_before(self, day: str) -> None:
        stale = [key for key in self.open_periods if piece.period_of(key[0], day) != key[1]]
        if stale:
            self._flush(stale)

    def _settle_days(self) -> None:
        """Days whose every piece is on disk move into the ledger."""
        settled = [d for d, keys in self.pending.items() if not keys]
        if not settled:
            return
        for d in settled:
            self.ledger["days"][d] = self.day_info[d]
            del self.pending[d]
        self.ledger["days"] = dict(sorted(self.ledger["days"].items()))
        self._save_ledger()

    # ---- flush ----------------------------------------------------------
    def _flush(self, keys: List[Tuple[str, str]]) -> None:
        if not keys:
            return
        t0 = time.perf_counter()
        index_updates: Dict[str, Dict[str, Dict[str, dict]]] = {}
        for key in sorted(keys):
            self._flush_one(key, index_updates)
        self._drain(index_updates, keep=0)
        if not self.packs:
            self._write_indexes(index_updates)
        for key in keys:
            for blk in self.open_periods.pop(key):
                try:
                    os.remove(blk.path)
                except OSError:
                    pass
            for pend in self.pending.values():
                pend.discard(key)
        self._settle_days()
        dt = time.perf_counter() - t0
        self.summary["flush_seconds"] += dt
        self.log(f"flushed {', '.join(f'{s}/{p}' for s, p in sorted(keys))} in {dt:.1f}s")

    def _flush_one(self, key: Tuple[str, str], index_updates: dict) -> None:
        if not self.packs:
            self._flush_rows(key, index_updates)
            return
        series, period = key
        try:
            self._pack_in = pack.PackReader.open(self.out, series, period)
        except pack.PackError as exc:
            raise BuildError(f"{exc} (move it aside to rebuild that period)") from exc
        self._pack_out = pack.PackWriter(self.out, series, period)
        try:
            written = self._flush_rows(key, index_updates)
            self._drain(index_updates, keep=0)
            if self._pack_in is not None:
                # symbols the pack already held that did not trade in these days: carried as they are
                for sym in sorted(set(self._pack_in.symbols()) - set(written)):
                    e = self._pack_in.entry(sym)
                    self._pack_out.add(sym, self._pack_in.get(sym),
                                       {"bars": e[2], "first": e[3], "last": e[4], "crc": e[5]})
                # ⛔ Windows will not replace a file that is still open: close the old pack first
                self._pack_in.close()
            self._pack_out.close()
        except BaseException:
            for _, _, _, f in self._inflight:
                f.cancel()
            self._inflight.clear()
            self._pack_out.abort()
            raise
        finally:
            if self._pack_in is not None:
                self._pack_in.close()
            self._pack_in = self._pack_out = None

    def _flush_rows(self, key: Tuple[str, str], index_updates: dict) -> List[str]:
        """Gather each symbol's bars of this period from the spill blocks and write its piece.
        Returns the symbols written, in order."""
        series, period = key
        blocks = self.open_periods[key]                       # in ascending day order
        union = sorted(set().union(*(b.names for b in blocks)))
        if not union:
            return []
        union_arr = np.array(union)
        gidx = []                                             # per block: union index of each of its tickers
        totals = np.zeros(len(union), dtype=np.int64)
        for b in blocks:
            g = np.searchsorted(union_arr, np.array(b.names)).astype(np.int64)
            gidx.append(g)
            np.add.at(totals, g, np.diff(b.offs))
        cum = np.cumsum(totals)
        g0 = 0
        written: List[str] = []
        while g0 < len(union):
            base = int(cum[g0 - 1]) if g0 else 0
            g1 = int(np.searchsorted(cum, base + self.chunk_rows, side="right"))
            g1 = min(max(g1, g0 + 1), len(union))
            recs, gids = [], []
            for b, g in zip(blocks, gidx):
                lo, hi = int(np.searchsorted(g, g0)), int(np.searchsorted(g, g1))
                if hi <= lo:
                    continue
                r0, r1 = int(b.offs[lo]), int(b.offs[hi])
                recs.append(np.fromfile(b.path, dtype=RECORD, count=r1 - r0, offset=r0 * RECORD.itemsize))
                if recs[-1].size != r1 - r0:
                    raise BuildError(f"spill file {b.path} is shorter than expected")
                gids.append(np.repeat(g[lo:hi], np.diff(b.offs[lo:hi + 1])))
            rec = np.concatenate(recs)
            gid = np.concatenate(gids)
            order = np.argsort(gid, kind="stable")            # days stay in ascending order inside a ticker
            gid = gid[order]
            cols = {k: np.ascontiguousarray(rec[k][order]) for k in piece.COLUMNS}
            del rec, recs, gids
            starts = np.flatnonzero(np.concatenate(([True], gid[1:] != gid[:-1])))
            ends = np.append(starts[1:], gid.size)
            for s, e in zip(starts.tolist(), ends.tolist()):
                symbol = union[int(gid[s])]
                self._write_piece(symbol, series, period, {k: v[s:e] for k, v in cols.items()}, index_updates)
                written.append(symbol)
            g0 = g1
        return written

    def _write_piece(self, symbol: str, series: str, period: str, bars: dict, index_updates: dict) -> None:
        if self.packs:
            existing = self._pack_in.get(symbol) if self._pack_in is not None else None
            job = (encode_job.encode_blob, existing, symbol, series, period, bars, self.quality)
        else:
            job = (encode_job.write_piece, str(self.out / piece.piece_relpath(series, symbol, period)),
                   symbol, series, period, bars, self.quality)
        if self.jobs == 1:
            self._record(symbol, series, period, job[0](*job[1:]), index_updates)
            return
        if self._pool is None:
            from concurrent.futures import ProcessPoolExecutor
            self._pool = ProcessPoolExecutor(max_workers=self.jobs)
        fut = self._pool.submit(*job)
        self._inflight.append((symbol, series, period, fut))
        self._drain(index_updates, keep=self.jobs * 4)     # bounded: the chunk's arrays are not all queued

    def _drain(self, index_updates: dict, keep: int) -> None:
        while len(self._inflight) > keep:
            symbol, series, period, fut = self._inflight.pop(0)
            self._record(symbol, series, period, fut.result(), index_updates)

    def _record(self, symbol: str, series: str, period: str, res: dict, index_updates: dict) -> None:
        if "error" in res:
            for _, _, _, f in self._inflight:
                f.cancel()
            self._inflight.clear()
            raise BuildError(f"{symbol} {series}/{period}: {res['error']}")
        if res["unchanged"]:
            self.summary["pieces_unchanged"] += 1
        if self.packs:
            self._pack_out.add(symbol, res["blob"], res)
        index_updates.setdefault(symbol, {}).setdefault(series, {})[period] = {
            "bars": res["bars"], "first": res["first"], "last": res["last"],
            "bytes": res["bytes"], "crc": res["crc"]}
        s = self.summary
        s["pieces_written"] += 1
        s["bytes_written"] += res["bytes"]
        st = s["series"][series]
        st["pieces"] += 1
        st["bars"] += res["bars"]
        st["bytes"] += res["bytes"]

    def _write_indexes(self, index_updates: dict) -> None:
        idx_dir = self.out / f"v{piece.FORMAT_VERSION}" / "index"
        idx_dir.mkdir(parents=True, exist_ok=True)
        for symbol in sorted(index_updates):
            path = self.out / piece.index_relpath(symbol)
            try:
                doc = json.loads(path.read_text(encoding="utf-8"))
                if doc.get("symbol") != symbol or not isinstance(doc.get("series"), dict):
                    raise BuildError(f"{path} is not the index of {symbol!r}")
            except FileNotFoundError:
                doc = {"v": piece.FORMAT_VERSION, "symbol": symbol, "series": {}}
            except ValueError as exc:
                raise BuildError(f"{path} is unreadable: {exc}") from exc
            before = _json_bytes(doc)
            for series, periods in index_updates[symbol].items():
                doc["series"].setdefault(series, {}).update(periods)
            after = _json_bytes(doc)
            if after != before or not path.exists():
                _write_atomic(path, after)


# --------------------------------------------------------------------------
# CLI
# --------------------------------------------------------------------------

def format_summary(s: dict) -> str:
    lines = []
    days = s["days"]
    lines.append(f"days processed   {len(days)}" + (f"   (skipped via ledger: {len(s['skipped_days'])})"
                                                    if s["skipped_days"] else ""))
    lines.append(f"rows             {s['rows']:,}")
    lines.append(f"symbols          {s['symbols']:,}")
    lines.append(f"pieces written   {s['pieces_written']:,}"
                 + (f"   (of which already identical on disk: {s['pieces_unchanged']:,})"
                    if s["pieces_unchanged"] else ""))
    lines.append(f"bytes written    {s['bytes_written']:,}")
    lines.append("series   pieces        bars         bytes   bytes/bar")
    for series in SERIES:
        st = s["series"][series]
        bpb = f"{st['bytes'] / st['bars']:.3f}" if st["bars"] else "-"
        lines.append(f"{series:>6} {st['pieces']:>8,} {st['bars']:>11,} {st['bytes']:>13,}   {bpb:>9}")
    if days:
        per_day = sum(d["seconds"] for d in days) / len(days)
        lines.append(f"read+aggregate   {per_day:.2f} s/day  "
                     f"({s['rows'] / max(sum(d['seconds'] for d in days), 1e-9):,.0f} rows/s)")
        lines.append(f"flush (encode)   {s['flush_seconds']:.1f} s total  ({s['flush_seconds'] / len(days):.2f} s/day)")
        lines.append(f"wall             {s['wall_seconds']:.1f} s total  ({s['wall_seconds'] / len(days):.2f} s/day, "
                     f"{s['rows'] / max(s['wall_seconds'], 1e-9):,.0f} rows/s)")
    rss = s.get("peak_rss_bytes")
    lines.append("peak RSS         " + (f"{rss / 2 ** 20:,.0f} MiB" if rss else "unavailable"))
    anomalies = {k: v for k, v in s["anomalies"].items() if v}
    lines.append(f"raw anomalies    {anomalies if anomalies else 'none'}")
    if s["uncovered_calendar_days"]:
        lines.append(f"WARNING: early-close calendar does not cover {len(s['uncovered_calendar_days'])} day(s), "
                     f"e.g. {s['uncovered_calendar_days'][0]}; they were bucketed as full days")
    return "\n".join(lines)


def main(argv: Optional[List[str]] = None) -> int:
    ap = argparse.ArgumentParser(description="Build history-lake pieces from daily 1-minute bar files.")
    ap.add_argument("--raw", required=True, help="directory holding YYYY/YYYY-MM-DD.csv.gz")
    ap.add_argument("--out", required=True, help="output directory (v1/, ledger.json)")
    ap.add_argument("--days", required=True, help="A..B (inclusive), a single day, or a comma-separated mix; "
                                                  "processed in ascending date order")
    ap.add_argument("--symbols", default=None, help="comma-separated tickers (default: all)")
    ap.add_argument("--rebuild", action="store_true", help="ignore the ledger and fold the days in again")
    ap.add_argument("--quality", type=int, default=piece.DEFAULT_QUALITY, help="Brotli quality (default 10)")
    ap.add_argument("--foreign-rows", choices=("error", "drop"), default="error",
                    help="rows whose bar is not on the file's ET date: stop (default) or leave out")
    ap.add_argument("--chunk-rows", type=int, default=1_000_000, help="rows gathered per flush chunk")
    ap.add_argument("--jobs", type=int, default=1, help="processes that encode pieces (default 1)")
    ap.add_argument("--spill-dir", type=Path, default=None,
                    help="put the scratch rows here (a faster disk) instead of <out>/_spill")
    ap.add_argument("--min-spill-free-gb", type=float, default=15.0,
                    help="with --spill-dir: stop (resumable) when that disk has less free than this")
    ap.add_argument("--packs", action="store_true",
                    help="write one pack file per series and period (pack.py) instead of a file per piece")
    args = ap.parse_args(argv)
    symbols = [s.strip() for s in args.symbols.split(",") if s.strip()] if args.symbols else None
    try:
        summary = Builder(Path(args.raw), Path(args.out), symbols=symbols, rebuild=args.rebuild,
                          quality=args.quality, foreign_rows=args.foreign_rows,
                          chunk_rows=args.chunk_rows, jobs=args.jobs, packs=args.packs,
                          spill_dir=args.spill_dir, min_spill_free_gb=args.min_spill_free_gb).run(args.days)
    except BuildError as exc:
        print(f"BUILD FAILED: {exc}", file=sys.stderr)
        return 2
    print(format_summary(summary))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
