"""BANK V2: keep only charts the web pod's own bars cover in full.

The bank is built from a local bars database, but the pod resolves every item's chart from ITS bars.db only
(api/routers/study.py::resolve_bars, never a provider fetch), and the two differ: on 2026-11-06 the pod started some
tickers' daily history in 2006, others only in 2024-2026 (XYZ's in 2025), while the local copy went back to 1995. The
import stored 69 bank v2 items with no bars at all and 7 with a stub (XYZ with 1 bar, GCO 2007 with 93 of 120). The
importer accepts any chart with one bar, so this check lives here, before an item is drafted.

docs/study/bank_v2/pod_daily_span.json holds each ticker's first and last daily bar and row count on the pod
(pod_bars_coverage.py, run by the owner). A chart is covered when the pod's history starts on or before the first bar of
the item's window (the 120 sessions up to the chart's last bar, read from the local bars), ends on or after the last
bar of its forward strip, and is not gappy: the pod holds at least 97% of the rows the local bars hold over the pod's
own span. Anything else is never drafted. A gap can still hide inside a dense ticker (pod_window_check.py found 18 on
2026-11-07, plus 31 charts whose signal day the pod lacks), so every chart the pod was measured drawing short or
differently is refused by name as well (REFUSED_FILES).
"""
from __future__ import annotations

import json
import pathlib
import sqlite3

REPO = pathlib.Path(__file__).resolve().parents[3]
SPAN_FILE = REPO / "docs" / "study" / "bank_v2" / "pod_daily_span.json"
WINDOW, FORWARD, DENSE = 120, 20, 0.97


#: charts the pod itself was measured drawing short or differently (pod_bars_coverage.py 2026-11-06,
#: pod_window_check.py 2026-11-07): [segment, id, sym, asof, ...]; never drafted again, whatever the span says
REFUSED_FILES = (REPO / "docs" / "study" / "bank_v2" / "pod_short_2026-11-06.json",
                 REPO / "docs" / "study" / "bank_v2" / "pod_windows_2026-11-07.json")


class PodCoverage:
    def __init__(self, local_db: str, span_file: pathlib.Path = SPAN_FILE, refused_files=REFUSED_FILES):
        self.span = json.loads(span_file.read_text(encoding="utf-8"))["span"]
        self.refused, self.gappy = set(), set()
        for f in refused_files:
            if pathlib.Path(f).exists():
                rows = json.loads(pathlib.Path(f).read_text(encoding="utf-8"))
                self.refused |= {(x[2], x[3]) for x in rows}
                if "windows" in pathlib.Path(f).name:
                    # a ticker the pod was measured drawing with a hidden gap: no NEW chart on it
                    self.gappy |= {x[2] for x in rows}
        self.con = sqlite3.connect(f"file:{local_db}?mode=ro", uri=True)
        self._dense: dict = {}

    def _is_dense(self, sym: str) -> bool:
        if sym not in self._dense:
            first, last, rows = self.span[sym]
            local = self.con.execute("SELECT count(*) FROM ohlcv WHERE ticker=? AND tf='D' AND ts BETWEEN ? AND ?",
                                     (sym, first, last)).fetchone()[0]
            self._dense[sym] = local == 0 or rows >= DENSE * local
        return self._dense[sym]

    def covered(self, sym: str, asof: str, window: int = WINDOW, forward: int = FORWARD) -> tuple[bool, str]:
        """(ok, why). `asof` is YYYY-MM-DD, the chart's last bar."""
        if (sym, asof) in self.refused:
            return False, "the pod was measured drawing this chart short or differently"
        if sym in self.gappy:
            return False, "the pod was measured with a hidden gap on this ticker"
        if sym not in self.span:
            return False, "the pod has no daily bars for this ticker"
        key = int(asof.replace("-", ""))
        back = self.con.execute("SELECT ts FROM ohlcv WHERE ticker=? AND tf='D' AND ts<=? ORDER BY ts DESC LIMIT ?",
                                (sym, key, window)).fetchall()
        fwd = self.con.execute("SELECT ts FROM ohlcv WHERE ticker=? AND tf='D' AND ts>? ORDER BY ts LIMIT ?",
                               (sym, key, forward)).fetchall()
        if len(back) < window or len(fwd) < forward:
            return False, "the local bars are short"
        first, last, _rows = self.span[sym]
        if first > back[-1][0]:
            return False, f"the pod's history starts {first}, after the window's first bar {back[-1][0]}"
        if last < fwd[-1][0]:
            return False, f"the pod's history ends {last}, before the forward strip's last bar {fwd[-1][0]}"
        if not self._is_dense(sym):
            return False, "the pod's history for this ticker has gaps"
        return True, ""
