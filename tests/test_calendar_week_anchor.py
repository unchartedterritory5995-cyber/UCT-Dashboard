"""⭐ The frontend and the backend must agree about which week "now" is.

They did not, on two days out of every seven. `api/routers/calendar.py`
rolls a weekend FORWARD to the Monday about to start (a product decision:
open the calendar on a Saturday and you see the upcoming week); the frontend
used to snap a weekend BACK to the Monday just past. Measured on the live
tree:

    2026-08-07 Fri  backend 2026-08-03   frontend 2026-08-03   AGREE
    2026-08-08 Sat  backend 2026-08-10   frontend 2026-08-03   7 DAYS APART
    2026-08-09 Sun  backend 2026-08-10   frontend 2026-08-03   7 DAYS APART
    2026-08-10 Mon  backend 2026-08-10   frontend 2026-08-10   AGREE

Consequences, live every weekend: "Next week ▶" was a visual no-op (it asked
for a `?week=` this module resolves to the payload already on screen) and
"◀ Prev week" skipped a week.

⛔ THIS FILE IS THE FIX. Everything else is consequence. The rule is stated
once per language and this test EXECUTES BOTH — the Python function directly,
the JavaScript one through `node` — and compares them day by day across a
whole year. Change one side alone and this goes red by construction; there is
no way to keep them in step by intention, comment, or review.

That is also why the assertion is not "the frontend has a weekend branch":
a second derivation that merely LOOKS right is exactly what shipped. The two
are compared by result.
"""
from __future__ import annotations

import json
import shutil
import subprocess
from datetime import date, timedelta
from pathlib import Path

import pytest

from api.routers.calendar import (
    _current_week_monday,
    _monday_of,
    _next_session_day,
    _week_dates,
)

_REPO = Path(__file__).resolve().parents[1]
_APP = _REPO / "app"
_WEEK_ANCHOR = _APP / "src" / "pages" / "calendar" / "weekAnchor.js"

# The week the defect was measured on, so the literals below ARE the measurement.
_MON, _TUE, _WED, _THU, _FRI = (date(2026, 8, d) for d in (3, 4, 5, 6, 7))
_SAT, _SUN = date(2026, 8, 8), date(2026, 8, 9)
_NEXT_MON = date(2026, 8, 10)


# ── The Python side, on its own ──────────────────────────────────────────────


class TestTheBackendRule:
    def test_a_weekday_anchors_on_its_own_monday(self):
        for d in (_MON, _TUE, _WED, _THU, _FRI):
            assert _current_week_monday(d) == _MON

    def test_a_weekend_rolls_forward_to_the_upcoming_monday(self):
        # THE PRODUCT DECISION, as an assertion. Deleting this branch to "fix"
        # the disagreement would be fixing it in the wrong direction.
        for d in (_SAT, _SUN):
            assert _current_week_monday(d) == _NEXT_MON

    def test_the_verdict_inverts_across_the_friday_saturday_boundary(self):
        """Non-vacuity: opposite outcomes either side of ONE boundary.

        The same question, asked one day apart, must give different answers —
        and must give the SAME answer across Sun→Mon, which is where the old
        (wrong) frontend rule turned over. A rule collapsed into a constant, or
        one whose weekend branch was deleted, fails the first pair; a rule that
        kept the old snap-back fails the second.
        """
        assert _current_week_monday(_FRI) != _current_week_monday(_SAT)
        assert _current_week_monday(_FRI) == _MON
        assert _current_week_monday(_SAT) == _NEXT_MON

        assert _current_week_monday(_SUN) == _current_week_monday(_NEXT_MON)

        # ...and over a whole week the answer is neither constant nor
        # all-distinct: exactly two weeks, five days then two.
        week = [_MON, _TUE, _WED, _THU, _FRI, _SAT, _SUN]
        answers = [_current_week_monday(d) for d in week]
        assert answers.count(_MON) == 5
        assert answers.count(_NEXT_MON) == 2

    def test_monday_of_answers_a_DIFFERENT_question_and_still_snaps_back(self):
        # `_monday_of` is "which week CONTAINS this date" — it is what the
        # `?week=` handler normalizes a URL param with, and the frontend's
        # `mondayOf` matches it. The two must NOT be conflated; using
        # `_monday_of(today)` as the anchor is the bug.
        for d in (_SAT, _SUN):
            assert _monday_of(d) == _MON
            assert _monday_of(d) != _current_week_monday(d)

    def test_next_session_day_is_identity_on_a_weekday(self):
        for d in (_MON, _TUE, _WED, _THU, _FRI):
            assert _next_session_day(d) == d
        for d in (_SAT, _SUN):
            assert _next_session_day(d) == _NEXT_MON

    def test_week_dates_is_five_consecutive_weekdays_starting_on_a_monday(self):
        # Reads the real clock — deliberately, once. This is the invariant that
        # holds on every day of the year, so it cannot be a weekday-only pass.
        wd = _week_dates()
        assert len(wd) == 5
        assert wd[0].weekday() == 0
        assert [d.weekday() for d in wd] == [0, 1, 2, 3, 4]
        assert wd == [wd[0] + timedelta(days=i) for i in range(5)]


# ── The cross-language proof ─────────────────────────────────────────────────


def _node_current_week_mondays(days: list[str]) -> list[str]:
    """Run the FRONTEND's `currentWeekMonday` over `days`, via node."""
    script = (
        "import { currentWeekMonday } from %s;\n"
        "const days = %s;\n"
        "process.stdout.write(JSON.stringify(days.map(currentWeekMonday)));\n"
    ) % (json.dumps(_WEEK_ANCHOR.as_uri()), json.dumps(days))
    proc = subprocess.run(
        [shutil.which("node"), "--input-type=module", "-e", script],
        cwd=str(_APP), capture_output=True, text=True, timeout=120,
    )
    assert proc.returncode == 0, (
        f"the JS bridge did not run (exit {proc.returncode}).\n"
        f"stderr:\n{proc.stderr}"
    )
    return json.loads(proc.stdout)


@pytest.mark.skipif(shutil.which("node") is None,
                    reason="node is required to execute the FRONTEND half of "
                           "this equality proof; without it the single-source "
                           "guarantee is UNVERIFIED, not satisfied")
class TestTheTwoImplementationsAgree:
    # A full year: every weekday, 52 weekends, and both US DST transitions
    # (2026-03-08 and 2026-11-01, which are Sundays — i.e. on the rolling
    # branch, the one that adds days across the change).
    DAYS = [date(2026, 1, 1) + timedelta(days=i) for i in range(366)]

    def test_every_day_of_the_year_resolves_to_the_same_monday(self):
        iso = [d.isoformat() for d in self.DAYS]
        js = _node_current_week_mondays(iso)
        py = [_current_week_monday(d).isoformat() for d in self.DAYS]

        # CONTROL 1 — the bridge reached JS and answered for every day. A
        # truncated or empty return would otherwise make `zip` compare nothing.
        assert len(js) == len(py) == 366

        # CONTROL 2 — the JS side is not a constant (which would satisfy a
        # careless comparison against a constant Python side, and is what a
        # stubbed/short-circuited bridge looks like).
        assert len(set(js)) >= 52

        mismatches = [
            (d.isoformat(), d.strftime("%a"), a, b)
            for d, a, b in zip(self.DAYS, js, py) if a != b
        ]
        assert not mismatches, (
            "the frontend and backend week anchors disagree on "
            f"{len(mismatches)} day(s); first five: {mismatches[:5]}"
        )

    def test_they_agree_on_the_weekend_the_defect_was_measured_on(self):
        # The four days from the live measurement, named, so a regression says
        # WHICH day rather than "1 of 366".
        iso = [d.isoformat() for d in (_FRI, _SAT, _SUN, _NEXT_MON)]
        js = _node_current_week_mondays(iso)
        assert js == ["2026-08-03", "2026-08-10", "2026-08-10", "2026-08-10"]
        assert js == [_current_week_monday(d).isoformat()
                      for d in (_FRI, _SAT, _SUN, _NEXT_MON)]

    def test_the_comparison_can_actually_fail(self):
        """Control-of-the-control: the harness reports a disagreement.

        Every test above is an equality that a broken bridge could satisfy by
        returning the Python answers, or by never running. Feed the JS side a
        day ONE LATER than the Python side and the comparison must break — if
        it does not, the equality assertions above prove nothing.
        """
        shifted = [(d + timedelta(days=1)).isoformat() for d in (_FRI, _SAT)]
        js = _node_current_week_mondays(shifted)
        py = [_current_week_monday(d).isoformat() for d in (_FRI, _SAT)]
        assert js != py, ("the harness cannot distinguish different inputs — "
                          "every equality assertion in this class is vacuous")


# ── The frontend derives it in exactly ONE place (AST, not grep) ─────────────

_AST_SCRIPT = r"""
import { readFileSync } from 'node:fs'
import * as acorn from 'acorn'
import jsx from 'acorn-jsx'

const Parser = acorn.Parser.extend(jsx())
const files = JSON.parse(process.env.UCT_FILES)

function walk(node, visit) {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) { for (const n of node) walk(n, visit); return }
  if (typeof node.type === 'string') visit(node)
  for (const k of Object.keys(node)) {
    if (k === 'type' || k === 'start' || k === 'end' || k === 'loc') continue
    walk(node[k], visit)
  }
}

const out = { staleAnchorCalls: [], toISOStringCalls: [], anchorImports: {},
              anchorUses: {}, anchorDeclarations: [] }

for (const f of files) {
  const src = readFileSync(f.path, 'utf8')
  const ast = Parser.parse(src, { ecmaVersion: 'latest', sourceType: 'module',
                                  locations: true })
  out.anchorImports[f.name] = []
  out.anchorUses[f.name] = 0
  walk(ast, (n) => {
    // `mondayOf(todayIso())` — the OLD anchor: the week CONTAINING today used
    // as the week SHOWN. This is the defect, expressed structurally.
    if (n.type === 'CallExpression' && n.callee.type === 'Identifier'
        && n.callee.name === 'mondayOf' && n.arguments.length === 1
        && n.arguments[0].type === 'CallExpression'
        && n.arguments[0].callee.type === 'Identifier'
        && /^todayIso/.test(n.arguments[0].callee.name)) {
      out.staleAnchorCalls.push(`${f.name}:${n.loc ? n.loc.start.line : '?'}`)
    }
    // `<expr>.toISOString()` — the UTC-day trap for rendered calendar dates.
    if (n.type === 'CallExpression' && n.callee.type === 'MemberExpression'
        && n.callee.property.type === 'Identifier'
        && n.callee.property.name === 'toISOString') {
      out.toISOStringCalls.push(f.name)
    }
    if (n.type === 'ImportDeclaration' && /weekAnchor$/.test(n.source.value)) {
      for (const s of n.specifiers) {
        if (s.type === 'ImportSpecifier') out.anchorImports[f.name].push(s.imported.name)
      }
    }
    if (n.type === 'Identifier' && n.name === 'currentWeekMonday') out.anchorUses[f.name]++
    if (n.type === 'FunctionDeclaration' && n.id && n.id.name === 'currentWeekMonday') {
      out.anchorDeclarations.push(f.name)
    }
  })
}
process.stdout.write(JSON.stringify(out))
"""

_SURFACE = {
    "Calendar.jsx":       "app/src/pages/Calendar.jsx",
    "CalendarHeader.jsx": "app/src/pages/calendar/CalendarHeader.jsx",
    "useCalendarData.js": "app/src/pages/calendar/useCalendarData.js",
    "monthGrid.js":       "app/src/pages/calendar/monthGrid.js",
    "weekAnchor.js":      "app/src/pages/calendar/weekAnchor.js",
}


@pytest.mark.skipif(shutil.which("node") is None,
                    reason="node + acorn are required to PARSE the frontend; a "
                           "regex would re-introduce exactly the guess this "
                           "test exists to remove")
class TestTheAnchorIsDerivedOnce:
    @staticmethod
    def _parse() -> dict:
        files = [{"name": n, "path": str(_REPO / p)} for n, p in _SURFACE.items()]
        proc = subprocess.run(
            [shutil.which("node"), "--input-type=module", "-e", _AST_SCRIPT],
            cwd=str(_APP), capture_output=True, text=True, timeout=120,
            env={**__import__("os").environ, "UCT_FILES": json.dumps(files)},
        )
        assert proc.returncode == 0, (
            f"the AST parse did not run (exit {proc.returncode}).\n{proc.stderr}")
        return json.loads(proc.stdout)

    def test_no_surface_still_computes_the_anchor_the_old_way(self):
        ast = self._parse()
        assert ast["staleAnchorCalls"] == [], (
            "`mondayOf(todayIso())` is the week CONTAINING today being used as "
            "the week SHOWN — the weekend defect, verbatim. Call "
            "`currentWeekMonday(todayIso())` instead. Found at: "
            f"{ast['staleAnchorCalls']}")

    def test_exactly_one_module_declares_the_anchor(self):
        ast = self._parse()
        assert ast["anchorDeclarations"] == ["weekAnchor.js"], (
            "a SECOND derivation of the current-week anchor has appeared in "
            f"{ast['anchorDeclarations']} — that is how this bug started")

    def test_every_consumer_imports_it_rather_than_restating_it(self):
        ast = self._parse()
        for name, uses in ast["anchorUses"].items():
            if name == "weekAnchor.js" or uses == 0:
                continue
            assert "currentWeekMonday" in ast["anchorImports"][name], (
                f"{name} uses `currentWeekMonday` without importing it from "
                "weekAnchor.js")
        # ...and the consumers we know about are actually wired, so this test
        # cannot pass by every file having stopped using the anchor at all.
        assert ast["anchorUses"]["Calendar.jsx"] >= 3
        assert ast["anchorUses"]["CalendarHeader.jsx"] >= 1

    def test_no_rendered_calendar_date_comes_from_toISOString(self):
        # Defect 2, structurally: `toISOString()` on a local-midnight Date is
        # the UTC day, which is the PREVIOUS day for every browser east of UTC.
        ast = self._parse()
        assert ast["toISOStringCalls"] == [], (
            "toISOString() shifts a local date back one day east of UTC; use "
            f"`localIso` from weekAnchor.js. Found in: {ast['toISOStringCalls']}")
