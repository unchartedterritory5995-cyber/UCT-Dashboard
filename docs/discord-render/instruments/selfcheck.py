"""D-02 C1 — a self-check that cannot count a case it never evaluated.

⚰️ THE DEFECT, MEASURED IN THIS PROGRAMME ON 2026-09-14. `load_harness.self_check` built a list of
cases and evaluated it in a loop that sat **in the middle of the appends**. Fifteen cases were
appended after that loop. They were counted by `len(cases)` and never checked, so `--self-check`
printed:

    TOTALS load_harness --self-check PASS cases=20 failed=0

while **five** cases had actually been evaluated. ⭐ The count rose and the checking did not — which
is precisely the flip-gate defect one level down: a number that grows with the evidence while saying
nothing about it.

⛔ "PUT THE LOOP LAST" IS NOT A FIX, IT IS THE THING THAT WAS ALREADY TRUE AND STOPPED BEING TRUE.
Nothing about a loop's position is enforced by anything; the next person adding a case at the bottom
of a 600-line function restores the bug and every totals line still reads PASS. So the collector
SEALS: once the results have been read, a further `add()` raises. A miscount becomes a crash instead
of a quieter number.

⛔ AND THE TRIPLE IS PRINTED, NOT JUST THE TOTAL. `declared` / `evaluated` / `failed` are three
separate facts, and any tool that reports two of them can hide the third
(`lesson_a_refusal_count_is_not_a_progress_metric`, and the CoverageLine idiom this repo already
uses for member-facing counts: four counts that must close).
"""
from __future__ import annotations


class SealedCases(RuntimeError):
    """Raised when a case is added after the results were read — i.e. it would never be evaluated."""


class Cases:
    """Collect (name, ok) pairs; seal on first read so a late append is loud, not silent.

    Usage:

        cases = Cases("load_harness")
        cases.add("a 4.2 s ack is a measured FAIL", code == FAIL)
        ...
        return cases.report()          # prints every row + the declared/evaluated/failed triple
    """

    def __init__(self, name: str):
        self.name = name
        self._rows: list[tuple[str, bool]] = []
        self._sealed = False

    def add(self, name: str, ok) -> None:
        if self._sealed:
            raise SealedCases(
                f"{self.name}: case {name!r} was added AFTER the results were read. It would have "
                f"been counted and never evaluated — the exact shape that printed "
                f"`cases=20 failed=0` over five checked cases. Move it above the report() call.")
        # ⛔ `bool(ok)`, and the coercion is deliberate: a case that returns a non-empty string or a
        # dict is TRUTHY and would pass silently. Recording the coerced value keeps the row honest
        # while the assertion below keeps the author honest.
        if not isinstance(ok, bool):
            raise TypeError(f"{self.name}: case {name!r} produced {type(ok).__name__}, not a bool. "
                            f"A truthy non-bool passes for the wrong reason.")
        self._rows.append((name, ok))

    def append(self, row) -> None:
        """`cases.append((name, ok))` — the list idiom every existing harness already writes.

        ⭐ Kept deliberately so adopting this collector is a ONE-LINE change at the top of a
        self-check rather than a rewrite of forty call sites. A migration big enough to need review
        is a migration that does not happen, and the harnesses that most need sealing are the
        longest ones."""
        name, ok = row
        self.add(name, ok)

    def add_all(self, rows) -> None:
        for name, ok in rows:
            self.add(name, ok)

    @property
    def declared(self) -> int:
        return len(self._rows)

    def results(self) -> list[tuple[str, bool]]:
        self._sealed = True
        return list(self._rows)

    def report(self, out=print, *, label: str = "--self-check") -> int:
        """Print every row and the triple. Returns the number of failures (0 = green)."""
        rows = self.results()
        evaluated = 0
        failed: list[str] = []
        for name, ok in rows:
            evaluated += 1
            out(f"  {'ok  ' if ok else 'FAIL'} {name}")
            if not ok:
                failed.append(name)
        declared = self.declared
        # ⛔ NON-VACUITY. An empty case set is a failed invocation, never a clean result — the same
        # rule as "a run with no totals line is not a run", one level in.
        if not declared:
            out(f"  FAIL {self.name}: the case set is EMPTY — a self-check that evaluated nothing "
                f"proved nothing")
            failed.append("empty case set")
        if evaluated != declared:
            out(f"  FAIL {self.name}: {declared - evaluated} declared case(s) were NEVER EVALUATED")
            failed.append("declared != evaluated")
        out(f"TOTALS {self.name} {label} {'PASS' if not failed else 'FAIL'} "
            f"declared={declared} evaluated={evaluated} failed={len(failed)}"
            + (f" reasons={'; '.join(failed)}" if failed else ""))
        return len(failed)


def self_check(out=print) -> int:
    """This module's own controls. ⛔ A collector that cannot be proved to catch a late append is
    the same unproved guard it exists to replace."""
    rows: list[tuple[str, bool]] = []

    c = Cases("probe")
    c.add("a true case", True)
    c.add("a false case", False)
    lines: list[str] = []
    failures = c.report(lines.append)
    rows.append(("a failing case is reported as a failure", failures == 1))
    rows.append(("the triple is printed with all three numbers",
                 any("declared=2 evaluated=2 failed=1" in l for l in lines)))

    # ⛔⛔ THE LOAD-BEARING CONTROL: an append after the read must RAISE.
    late = Cases("probe2")
    late.add("first", True)
    late.report(lambda _l: None)
    try:
        late.add("added after the report — this is the 2026-09-14 defect", True)
        rows.append(("a case added after the results were read RAISES", False))
    except SealedCases:
        rows.append(("a case added after the results were read RAISES", True))

    # non-vacuity for the control above: adding BEFORE the read must still work
    early = Cases("probe3")
    early.add("first", True)
    early.add("second", True)
    rows.append(("adding before the read still works (control)", early.declared == 2))

    empty = Cases("probe4")
    lines2: list[str] = []
    rows.append(("an EMPTY case set is a failure, not a clean pass",
                 empty.report(lines2.append) == 1
                 and any("EMPTY" in l for l in lines2)))

    try:
        Cases("probe5").add("a truthy non-bool", "yes")
        rows.append(("a truthy non-bool is refused", False))
    except TypeError:
        rows.append(("a truthy non-bool is refused", True))

    final = Cases("selfcheck")
    final.add_all(rows)
    return 0 if final.report(out) == 0 else 1


if __name__ == "__main__":
    raise SystemExit(self_check())
