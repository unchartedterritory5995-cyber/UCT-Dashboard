"""A measurement that cannot silently measure nothing.

⭐⭐ WHY THIS EXISTS, FROM THREE FAILURES IN ONE SESSION. Every one printed a
plausible answer and every one was worthless:

  1. A raw-versus-sanitised comparison where BOTH ARMS WERE THE SAME BARS —
     `bars_sanitize` needs a corporate-action fetch, every fetch failed, and it
     returns its input unchanged on failure. It reported "0 differences", which
     reads as a clean result and was an empty one.
  2. A cross-engine probe whose `except Exception: continue` swallowed an
     AttributeError on EVERY ticker. It printed "nothing fired — no
     disagreement to measure today". That is a crash wearing a finding's words.
  3. A forward scan that ran four detectors at every bar position, ~10k calls
     per ticker. It never finished, and its progress prints were too sparse to
     show that.

The common shape: an empty or broken run is INDISTINGUISHABLE from a real
negative result. That is the same defect this repo names everywhere else —
`lesson_a_fixture_that_cannot_distinguish_is_not_a_rail`, and the pytest
summary line whose absence means "unfinished", not "clean".

USE IT LIKE THIS:

    from tools.probe import Probe

    with Probe("split contamination", expect_min=200) as p:
        for t in tickers:
            with p.item(t):                 # counts, and records the error
                bars = load(t)
                p.ok() if condition(bars) else p.skip("too few bars")
        p.result("hit rate", hits / p.counted)

On exit it prints a SUMMARY LINE and refuses the run if nothing was measured,
if everything errored, or if fewer than `expect_min` items were processed.
"""
from __future__ import annotations

import collections
import sys
import time
import traceback
from contextlib import contextmanager


class ProbeFailed(RuntimeError):
    """The probe did not measure enough to be believed."""


class Probe:
    """A measurement harness that fails loudly instead of reporting nothing.

    ⛔ `expect_min` IS THE POINT, not a nicety. Without a floor, a probe that
    processed 3 of 4,000 tickers prints a number and looks like an answer.
    Set it from what you actually expect to see; if you do not know, you are
    not ready to believe the output either.
    """

    def __init__(self, name: str, expect_min: int = 1, *,
                 max_error_rate: float = 0.5, out=sys.stdout):
        self.name = name
        self.expect_min = expect_min
        self.max_error_rate = max_error_rate
        self.out = out
        self.counted = 0
        self.errors = 0
        self.skipped = 0
        self.oks = 0
        self.first_error: str | None = None
        self.error_kinds: collections.Counter = collections.Counter()
        self.results: list[tuple[str, object]] = []
        self._t0 = 0.0
        self._skips: collections.Counter = collections.Counter()

    # ── recording ───────────────────────────────────────────────────────────
    def ok(self, n: int = 1):
        self.oks += n

    def skip(self, why: str):
        self.skipped += 1
        self._skips[why] += 1

    def result(self, label: str, value):
        self.results.append((label, value))

    @contextmanager
    def item(self, label: str = ""):
        """One unit of work. Counts it, and RECORDS any exception by kind.

        ⛔ IT RECORDS RATHER THAN RE-RAISING, because a probe that dies on the
        first bad ticker never finishes — but it also never swallows silently,
        which is failure #2 above. Every error lands in the summary.
        """
        self.counted += 1
        try:
            yield self
        except Exception as e:                                  # noqa: BLE001
            self.errors += 1
            kind = type(e).__name__
            self.error_kinds[kind] += 1
            if self.first_error is None:
                self.first_error = f"{label}: {kind}: {e}"
                self._first_tb = traceback.format_exc()

    # ── lifecycle ───────────────────────────────────────────────────────────
    def __enter__(self):
        self._t0 = time.time()
        print(f"[probe] {self.name}: starting", file=self.out, flush=True)
        return self

    def __exit__(self, exc_type, exc, tb):
        if exc_type is not None:
            return False                       # a real crash: let it through
        self.summary()
        self.assert_measured()
        return False

    # ── the summary line, always ────────────────────────────────────────────
    def summary(self):
        dt = time.time() - self._t0
        print(f"\n[probe] {self.name}: SUMMARY  counted={self.counted} "
              f"ok={self.oks} skipped={self.skipped} errors={self.errors} "
              f"in {dt:.0f}s", file=self.out)
        if self._skips:
            for why, n in self._skips.most_common(5):
                print(f"[probe]   skipped {n}x: {why}", file=self.out)
        if self.error_kinds:
            for kind, n in self.error_kinds.most_common(5):
                print(f"[probe]   {n}x {kind}", file=self.out)
            print(f"[probe]   first: {self.first_error}", file=self.out)
        for label, value in self.results:
            print(f"[probe]   {label}: {value}", file=self.out)
        print(f"[probe] {self.name}: END", file=self.out, flush=True)

    def assert_measured(self):
        """Refuse to let an empty or broken run pass as a result."""
        if self.counted == 0:
            raise ProbeFailed(
                f"{self.name}: nothing was processed at all. An empty run is "
                f"not a negative result.")
        if self.errors == self.counted:
            raise ProbeFailed(
                f"{self.name}: EVERY one of {self.counted} items raised — this "
                f"measured nothing. First: {self.first_error}\n"
                + getattr(self, "_first_tb", ""))
        rate = self.errors / self.counted
        if rate > self.max_error_rate:
            raise ProbeFailed(
                f"{self.name}: {self.errors} of {self.counted} items raised "
                f"({rate:.0%} > {self.max_error_rate:.0%}). First: "
                f"{self.first_error}")
        usable = self.counted - self.errors - self.skipped
        if usable < self.expect_min:
            raise ProbeFailed(
                f"{self.name}: only {usable} usable items (expected at least "
                f"{self.expect_min}). A number computed from this few is not "
                f"an answer — widen the sample or lower the floor DELIBERATELY.")
