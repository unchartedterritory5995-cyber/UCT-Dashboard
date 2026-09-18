"""R89 — every consumer that surfaces a CALL respects `floor.passes()`, proved BEHAVIOURALLY.

⛔⛔ WHY THIS FILE EXISTS AT ALL, GIVEN THAT R89 CHANGED ONE TUPLE. Because "the predicate now
includes CALL" and "no CALL below the floor reaches a member" are different claims, and this repo
has paid for the gap between them repeatedly: `lesson_built_tested_green_and_unreachable`, and the
comment in `test_wisdom_item3_floor.py` recording that two floor sites could be bypassed entirely
with their `floor.` mention intact while the whole file stayed green. A unit test of `passes()`
cannot tell you whether `desk_markers` calls it.

⭐ **The reach is structural, and that is the finding, not an accident.** Nine of the ten CALL
consumers read through ONE function — `common.select_records`, which applies `floor.sql_clause()`
unless a caller opts out — and the tenth (`clips.clip_candidates`) applies the same clause to its
own untyped SQL. So R89 required **no consumer edit**. That is exactly what
`lesson_a_guard_repeated_is_a_guard_unproved` is for, and it is also why the reach has to be
measured rather than asserted: a single shared read is the best possible design AND the easiest
thing to quietly opt out of with one `include_unstable=True`.

⛔ EVERY TEST HERE IS A PAIR. A blocked CALL must not come back AND a passing CALL must — because
"nothing came back" is also what a broken fixture, an empty table and a typo in a ticker produce.
The blocked record is deliberately the NEWER of the two wherever a consumer takes "the newest",
so a floor that did nothing would hand back the blocked one and the control would fail loudly
instead of the pair passing for the wrong reason.

⚠️ WHAT THIS FILE DOES NOT CLAIM. It does not re-test `passes()` (that is
`tests/test_wisdom_item3_floor.py`), it does not re-classify consumers (that is R50's census in
`tests/test_wisdom_type_gating_audit.py`), and it says nothing about the consumers that
deliberately DO see below-floor CALLs — `publish/report.py`, `evals/*` and
`brainkb`'s citation lookup. Those are recorded in `test_the_owner_and_measurement_lanes_are_
deliberately_not_floored` below, with the reason each one is exempt.
"""
from __future__ import annotations

from datetime import date, datetime

import pytest

from api.services.wisdom.core import store, timeutil
from api.services.wisdom.publish import floor
from api.services.wisdom.publish.adapters import provenance
from tests.test_wisdom_publish_adapters_store import (  # noqa: F401
    add_record, adapters_db, seeded,
)

TICKER = "R89X"
SESSION = date(2026, 9, 11)
NOW = datetime(2026, 9, 12, 12, 0, tzinfo=timeutil.ET)

#: ⛔ The blocked row is stated LATER than the passing one on purpose. `badges` keeps the NEWEST
#: record per ticker and `select_records` orders `stated_at_et DESC`, so with the floor removed
#: the blocked row would WIN — the mutation shows up as a wrong answer, not merely a missing one.
PASS_AT = "2026-09-08T10:05:00-04:00"
BLOCK_AT = "2026-09-09T10:05:00-04:00"

OPEN_CALL = dict(direction="long", stance="watching", trigger_text="break over the pivot on volume",
                 thesis="tight base under the highs", vocab_id="v_flat_base")
CLOSED_CALL = dict(direction="long", stance="hindsight", hindsight=1, stated_outcome="profit",
                   vocab_id="v_ep", thesis="the gap held and the base resolved higher")


def _pair(conn, prefix: str, **kw) -> tuple[str, str]:
    """One CALL at the floor over MIN_RUNS, one measured below it. Returns (passing, blocked)."""
    add_record(conn, f"{prefix}_pass", "CALL", "segLIVE1", "srcLIVE", author_id="tsdr", ticker=TICKER,
               record_hash=f"{prefix}pass", stated_at_et=PASS_AT,
               stability=1.0, stability_runs=floor.MIN_RUNS, **kw)
    add_record(conn, f"{prefix}_block", "CALL", "segLIVE1", "srcLIVE", author_id="tsdr", ticker=TICKER,
               record_hash=f"{prefix}block", stated_at_et=BLOCK_AT,
               stability=2 / 5, stability_runs=5, **kw)
    return f"{prefix}_pass", f"{prefix}_block"


def _refs(value) -> set:
    """Every `wisdom_records:<id>` a consumer's output names, read out of the provenance markers."""
    import json

    blob = value if isinstance(value, str) else json.dumps(value, default=str)
    return {m["ref"].split(":", 1)[1] for m in provenance.find_all(blob)
            if m["ref"].startswith("wisdom_records:")}


def test_the_pair_helper_really_straddles_the_floor():
    """⭐ NON-VACUITY FOR EVERY TEST BELOW. If both fixtures landed on the same side of the floor,
    each pair would be asserting one thing twice and the whole file would be decorative."""
    assert floor.passes("CALL", 1.0, floor.MIN_RUNS) is True
    assert floor.passes("CALL", 2 / 5, 5) is False


# ── the member doors ─────────────────────────────────────────────────────────

def test_desk_markers_withholds_a_blocked_call_and_still_returns_a_passing_one(seeded):
    """⛔⛔ THE DOOR R89 NAMES. A desk marker is a CALL on a member's StockChart."""
    from api.services.wisdom.publish.adapters import desk_markers

    with store.write() as conn:
        good, bad = _pair(conn, "dm", **OPEN_CALL)
    rows = desk_markers.wisdom_rows(TICKER)
    got = _refs(rows)
    assert good in got, "non-vacuity: a passing CALL MUST reach the chart"
    assert bad not in got, "R89: a below-floor CALL reached a member's chart"


def test_desk_markers_withholds_a_blocked_mention_too(seeded):
    """⭐ THE EVIDENCE THAT BOUGHT MENTION ITS PLACE IN `FLOORED_TYPES`, as behaviour.

    `desk_markers._KINDS` is `{CALL, MENTION}` — the same member door, the same chart, the same
    named author. R89 names CALL; MENTION was added because this consumer surfaces it, and that
    claim is worth a test rather than a sentence, because the claim IS the reason.
    """
    from api.services.wisdom.publish.adapters import desk_markers

    with store.write() as conn:
        add_record(conn, "dmm_pass", "MENTION", "segLIVE1", "srcLIVE", author_id="tsdr", ticker=TICKER,
                   record_hash="dmmpass", stated_at_et=PASS_AT, stability=1.0, stability_runs=floor.MIN_RUNS)
        add_record(conn, "dmm_block", "MENTION", "segLIVE1", "srcLIVE", author_id="tsdr", ticker=TICKER,
                   record_hash="dmmblock", stated_at_et=BLOCK_AT, stability=2 / 5, stability_runs=5)
    got = _refs(desk_markers.wisdom_rows(TICKER))
    assert "dmm_pass" in got, "non-vacuity: a passing MENTION MUST reach the chart"
    assert "dmm_block" not in got, "R89: a below-floor MENTION reached a member's chart"


def test_dossier_withholds_a_blocked_negative_call_too(seeded, monkeypatch):
    """⭐ And the evidence for NEGATIVE_CALL: `dossier` (MEMBER in R50's map) reads it, so "UCT
    passed on this name" is a published stance under a named author like any other."""
    from api.services.wisdom.publish.adapters import dossier

    monkeypatch.setenv("WISDOM_DOSSIER_ENABLED", "1")
    with store.write() as conn:
        add_record(conn, "dneg_pass", "NEGATIVE_CALL", "segDISC1", "srcDISC", author_id="tsdr", ticker=TICKER,
                   record_hash="dnegpass", stated_at_et=PASS_AT, stance="passed", reason="group is broken",
                   stability=1.0, stability_runs=floor.MIN_RUNS)
        add_record(conn, "dneg_block", "NEGATIVE_CALL", "segDISC1", "srcDISC", author_id="tsdr", ticker=TICKER,
                   record_hash="dnegblock", stated_at_et=BLOCK_AT, stance="passed", reason="no relative strength",
                   stability=2 / 5, stability_runs=5)
    got = _refs(dossier.wisdom_lines(TICKER, limit=20))
    assert "dneg_pass" in got, "non-vacuity: a passing NEGATIVE_CALL MUST reach the dossier"
    assert "dneg_block" not in got, "R89: a below-floor NEGATIVE_CALL reached an AI dossier"


def test_dossier_withholds_a_blocked_call_and_still_returns_a_passing_one(seeded, monkeypatch):
    from api.services.wisdom.publish.adapters import dossier

    monkeypatch.setenv("WISDOM_DOSSIER_ENABLED", "1")
    with store.write() as conn:
        good, bad = _pair(conn, "do", **OPEN_CALL)
    lines = dossier.wisdom_lines(TICKER, limit=20)
    got = _refs(lines)
    assert good in got, "non-vacuity: a passing CALL MUST reach the dossier"
    assert bad not in got, "R89: a below-floor CALL reached an AI dossier"


def test_badges_withholds_a_blocked_call_and_the_newer_blocked_row_never_wins(seeded, monkeypatch):
    """⛔ `badges` keeps the NEWEST record per ticker, and the blocked row IS the newest — so a
    floor that did nothing produces a badge naming the blocked record, not an empty mapping."""
    from api.services.wisdom.publish.adapters import badges

    monkeypatch.setenv("WISDOM_BADGES_ENABLED", "1")
    with store.write() as conn:
        good, bad = _pair(conn, "bd", **OPEN_CALL)
    out = badges.badges_for([TICKER], now=NOW)
    assert TICKER in out, "non-vacuity: the passing CALL MUST still badge the ticker"
    got = _refs(out)
    assert got == {good}, f"the badge names {got}, expected only the passing record"
    assert bad not in got


def test_modelbook_example_drafts_withhold_a_blocked_call(seeded):
    from api.services.wisdom.publish.adapters import modelbook

    with store.write() as conn:
        good, bad = _pair(conn, "mb", **CLOSED_CALL)
        drafts = modelbook.build_example_drafts(conn)
    subjects = {d["subject_ref"] for d in drafts}
    assert f"wisdom_records:{good}" in subjects, "non-vacuity: a passing CALL MUST draft an example"
    assert f"wisdom_records:{bad}" not in subjects, "R89: a below-floor CALL drafted a Model Book example"


def test_brainkb_lesson_rows_withhold_a_blocked_call(seeded):
    from api.services.wisdom.publish.adapters import brainkb

    with store.write() as conn:
        good, bad = _pair(conn, "kb", **CLOSED_CALL)
        refs = {r["source_ref"] for r in brainkb.build_rows(conn)}
    assert f"wisdom:lesson:{good}" in refs, "non-vacuity: a passing CALL MUST build a KB lesson row"
    assert f"wisdom:lesson:{bad}" not in refs, "R89: a below-floor CALL became a Brain KB row"


# ── the owner / internal lanes that still read CALL ──────────────────────────

def test_pv_example_drafts_withhold_a_blocked_call(seeded):
    from api.services.wisdom.publish.adapters import pv_examples

    with store.write() as conn:
        good, bad = _pair(conn, "pv", **CLOSED_CALL)
        for image_id, record_id in (("imgPASS", good), ("imgBLOCK", bad)):
            conn.execute(
                "INSERT INTO wisdom_chart_images(image_id, source_id, segment_id, origin, public_url, r2_key, "
                "label_text, label_ticker, label_timeframe, linked_record_id, status, created_at) VALUES "
                "(?, 'srcSCAN', 'segSCAN1', 'sunday_scans', 'https://example.test/i.png', 'k/i.png', "
                "'R89X (Daily)', ?, 'D', ?, 'provisional', '2026-09-08T10:05:00-04:00')",
                (image_id, TICKER, record_id))
        drafts = pv_examples.build_drafts(conn)
    subjects = {d["subject_ref"] for d in drafts}
    assert "wisdom_chart_images:imgPASS" in subjects, "non-vacuity: a passing CALL MUST draft an exemplar"
    assert "wisdom_chart_images:imgBLOCK" not in subjects


def test_level_alerts_scores_a_passing_call_and_not_a_blocked_one(seeded):
    from api.services.wisdom.publish import level_alerts

    with store.write() as conn:
        good, bad = _pair(conn, "la", **OPEN_CALL)
        with_levels = {r["record_id"] for r in level_alerts.open_calls(conn, SESSION)}
    assert good in with_levels, "non-vacuity: a passing open CALL MUST be scored"
    assert bad not in with_levels, "R89: a below-floor CALL was scored for level crosses"


def test_lookalike_reference_vectors_exclude_a_blocked_call(seeded, monkeypatch):
    """⛔ The reference SET is what the model learns 'what TSDR buys' from. A below-floor CALL in
    it does not publish text, but it steers every score the D20 lane produces."""
    from api.services.wisdom.publish import lookalike

    monkeypatch.setattr(lookalike, "_daily_bars", lambda t, ymd, n: [])
    monkeypatch.setattr(lookalike, "features", lambda bars: {k: 1.0 for k in lookalike.FEATURES})
    with store.write() as conn:
        good, bad = _pair(conn, "lk", **OPEN_CALL)
        refs = {record_id for record_id, _ in lookalike.reference_vectors(conn, SESSION)}
    assert good in refs, "non-vacuity: a passing CALL MUST be a reference"
    assert bad not in refs, "R89: a below-floor CALL steered the lookalike model"


def test_clip_candidates_withhold_a_blocked_call(seeded):
    """The one CALL consumer that does NOT go through select_records — it applies the same
    `floor.sql_clause()` to its own untyped SQL, so it picked CALL up the moment R89 landed."""
    from api.services.wisdom.publish.adapters import clips

    with store.write() as conn:
        good, bad = _pair(conn, "cl", **OPEN_CALL)
    out = {r["record_id"] for r in clips.clip_candidates(42)["records"]}
    assert good in out, "non-vacuity: a passing CALL MUST still be exported to the clip pipeline"
    assert bad not in out


# ── what is deliberately NOT floored, and why ────────────────────────────────

def test_the_owner_and_measurement_lanes_are_deliberately_not_floored(seeded):
    """⭐⭐ THE EXEMPTIONS, AS A TEST RATHER THAN A PARAGRAPH SOMEBODY EDITS LATER.

    Three readers of CALL records keep seeing below-floor rows, each for a reason that would be
    reversed by applying the floor:

    * **`publish/report.py::_calls`** — the owner's weekly report counts what the pipeline
      EXTRACTED. Flooring it would hide from the owner precisely the records the floor is holding
      back, which is the failure the "2/3 may surface only in the admin review queue" clause
      exists to prevent. Same argument, same shape, as `brainkb` staging rows before filtering at
      export.
    * **`evals/*`** — outcome and precision measurement. `STABILITY_FLOOR` is DERIVED from these
      measurements (`extract/golden.py:644-653` records CALL 0.630, MENTION 0.663 as the numbers
      that justified the gate). Measuring only the records that already cleared the floor would
      make the floor its own evidence.
    * **`brainkb.build_rows`'s support lookup** — `include_unstable=True`, so it can DATE and
      LOCATE a principle it is not publishing. Blocking it drops a citation, not a publication.

    ⛔ This test asserts the mechanism, not the prose: the report lane must still count a
    below-floor CALL, and the deliberate opt-ins must still be exactly the two that carry a
    written reason (`test_the_two_deliberate_opt_ins_are_the_only_ones` owns their identity).
    """
    from api.services.wisdom.publish import report

    with store.write() as conn:
        good, bad = _pair(conn, "rp", **OPEN_CALL)
    with store.read() as conn:
        calls = report._calls(conn, date(2026, 9, 1), date(2026, 9, 30))
    listed = {row["ticker"] for row in calls["listed"]}
    assert TICKER in listed, "the owner's report lost sight of the records the floor is holding"
    # the blocked record is genuinely blocked everywhere it publishes — this lane is the exception
    assert floor.passes("CALL", 2 / 5, 5) is False
    assert calls["n"] >= 2, f"both records of the pair must be counted, got {calls['n']}"
    assert good and bad  # named for the reader; the assertion above is over the report's own rows


@pytest.mark.parametrize("module,func", [
    ("api/services/wisdom/publish/adapters/desk_markers.py", "wisdom_rows"),
    ("api/services/wisdom/publish/adapters/badges.py", "badges_for"),
    ("api/services/wisdom/publish/adapters/dossier.py", "_lines_from"),
    ("api/services/wisdom/publish/adapters/modelbook.py", "build_example_drafts"),
    ("api/services/wisdom/publish/adapters/pv_examples.py", "build_drafts"),
    ("api/services/wisdom/publish/level_alerts.py", "open_calls"),
    ("api/services/wisdom/publish/lookalike.py", "reference_vectors"),
])
def test_no_call_consumer_opts_out_of_the_floor(module, func):
    """⛔ THE ONE-LINE ESCAPE HATCH, RAILED. Every consumer above is floored because it reads
    through `common.select_records`, whose default is fail-closed — and any of them could opt out
    of R89 forever by adding `include_unstable=True` to one call, with no test above going red
    unless that test's fixture happened to be a blocked record.

    ⭐ It reads the AST of the FUNCTION, not the file: `brainkb` legitimately contains two opt-ins
    and a text scan of a file cannot tell a call site from the comment explaining it
    (`CODE, NEVER PROSE` — the first version of the sibling check in `test_wisdom_item3_floor.py`
    found four hits, two of them prose).
    """
    import ast
    import pathlib

    src = (pathlib.Path(__file__).resolve().parents[1] / module).read_text(encoding="utf-8")
    tree = ast.parse(src)
    fn = next((n for n in ast.walk(tree)
               if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and n.name == func), None)
    assert fn is not None, f"control: {func} not found in {module} — the rail is pointing at nothing"
    opted_out = [f"{module}:{n.lineno}" for n in ast.walk(fn) if isinstance(n, ast.Call)
                 for kw in n.keywords
                 if kw.arg == "include_unstable" and isinstance(kw.value, ast.Constant) and kw.value.value is True]
    assert not opted_out, (
        f"{func} bypasses the publication floor with include_unstable=True at {opted_out}. If that "
        "is deliberate it needs an owner ruling and a written reason beside the call, like the two "
        "in brainkb.py — not a keyword argument.")


def test_the_opt_out_rail_can_see_an_opt_out():
    """⭐ NON-VACUITY for the rail above: it must go red on a function that really does opt out."""
    import ast

    tree = ast.parse("def f():\n    select_records(conn, types=('CALL',), include_unstable=True)\n")
    fn = next(n for n in ast.walk(tree) if isinstance(n, ast.FunctionDef))
    found = [kw for n in ast.walk(fn) if isinstance(n, ast.Call)
             for kw in n.keywords
             if kw.arg == "include_unstable" and isinstance(kw.value, ast.Constant) and kw.value.value is True]
    assert len(found) == 1
