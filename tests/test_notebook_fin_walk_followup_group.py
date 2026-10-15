"""Tier 2 part B (Task 11): the finish walk's `followup` group. The group itself needs a sandbox boot and a browser
(Task 12 runs it), so these rails check what can be checked without one: that the group is registered after `smart`,
that every name it asserts on is the product's own (read, never retyped), that the producer child parses, and that the
sandbox calendar edit keeps the file's shape."""
from __future__ import annotations

import ast
import json
import re
import sys
from datetime import date, datetime
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "tools"))

import notebook_fin_walk as C  # noqa: E402
import notebook_fin_walk_features as F  # noqa: E402


def test_the_followup_step_is_registered_right_after_smart():
    assert F.ORDER.index("followup") == F.ORDER.index("smart") + 1
    assert F.ORDER.count("followup") == 1


def test_the_followup_flag_is_one_the_walk_arms_in_c2():
    assert F.EARNINGS_FOLLOWUP_KEY.upper() in C.WAVE_FLAGS          # armed in c2 (c2 = armed + WAVE_FLAGS)
    assert F.JOURNAL_STYLES_KEY.upper() in C.WAVE_FLAGS             # the card's create needs it too


def test_the_headings_the_walk_expects_are_the_products():
    from api.services.journal_two import journal_styles
    assert F.followup_headings() == journal_styles.FOLLOWUP_HEADINGS and len(F.followup_headings()) == 3


def test_the_notice_title_the_walk_looks_for_is_what_the_producer_writes():
    from api.services.journal_two import earnings_followup as ef
    title, _ = ef.notice_copy(F.FOLLOWUP_SYM, date(2026, 10, 14), ["watchlist"])
    assert title == F.FOLLOWUP_NOTICE_TITLE == "ORCL reported: write your follow-up"
    assert ef.followup_url(F.FOLLOWUP_SYM, "2026-10-14") == "/journal/notebook?followup=ORCL&reportDate=2026-10-14"


def test_the_producer_child_parses_and_runs_the_pass_twice_with_the_default_delivery():
    tree = ast.parse(C.FOLLOWUP_CHILD)
    calls = [n for n in ast.walk(tree) if isinstance(n, ast.Call) and getattr(n.func, "attr", "") == "run_followups"]
    assert len(calls) == 2
    for c in calls:                                                  # the default delivery: no `deliver=` seam
        assert "deliver" not in {k.arg for k in c.keywords}
    # the seed is written where the card reads it: earnings_intel's own snapshot kind, 7 days
    assert "earnings_intel._KIND" in C.FOLLOWUP_CHILD and "7 * 86400" in C.FOLLOWUP_CHILD


def test_the_calendar_edit_keeps_the_existing_reporters_and_the_indent_1_shape(tmp_path):
    cal = {"reporters": {"AMZN": {"date": "2026-10-19"}, "AMD": {"date": "2026-10-19"}}, "asOf": "2026-10-15T00:00:00+00:00",
           "partial": False}
    (tmp_path / C.CAL_FILE).write_text(json.dumps(cal, indent=1), encoding="utf-8")
    held = C.add_calendar_reporter(tmp_path, "ORCL", "2026-10-14", "bmo")
    after = json.loads((tmp_path / C.CAL_FILE).read_text(encoding="utf-8"))
    assert held == after["reporters"] == {**cal["reporters"], "ORCL": {"date": "2026-10-14", "timing": "bmo"}}
    assert {k: v for k, v in after.items() if k != "reporters"} == {k: v for k, v in cal.items() if k != "reporters"}
    assert (tmp_path / C.CAL_FILE).read_text(encoding="utf-8") == json.dumps(after, indent=1)       # the same shape


def test_the_child_applies_the_sandbox_env_before_it_imports_any_api_module():
    """The live-data-root rule rests on this ORDER: the sandbox env is applied first, or the first `api` import resolves
    its data paths to the live files. Compared by string index, with a control proving the check can see a real
    occurrence (a child with the two lines swapped must fail the same comparison). CODE, never prose: the source is read
    as TOKENS, so a comment or a string that merely mentions either statement is not an occurrence."""
    import io
    import tokenize

    def code_tokens(src: str) -> list:
        skip = (tokenize.COMMENT, tokenize.STRING, tokenize.NL, tokenize.NEWLINE, tokenize.INDENT, tokenize.DEDENT)
        return [t for t in tokenize.generate_tokens(io.StringIO(src).readline) if t.type not in skip]

    def first(toks: list, pair: tuple) -> tuple | None:
        for a, b in zip(toks, toks[1:]):
            if (a.string, b.string) == pair:
                return a.start
        return None

    def order_ok(src: str) -> bool:
        toks = code_tokens(src)
        apply_at = first(toks, ("apply_sandbox_env", "("))
        api_at = min([p for p in (first(toks, ("from", "api")), first(toks, ("import", "api"))) if p], default=None)
        return apply_at is not None and api_at is not None and apply_at < api_at   # both found, and the sandbox first

    assert order_ok(C.FOLLOWUP_CHILD)
    # CONTROL: the same two statements in the wrong order are refused, and a source with no api import cannot pass.
    swapped = "from api.services import auth_db\nb.apply_sandbox_env(data_dir)\n"
    assert not order_ok(swapped)
    assert not order_ok("b.apply_sandbox_env(data_dir)\n")
    # CONTROL: a comment or a string naming the call above the real import is NOT the call (decoys are refused) ...
    assert not order_ok("# b.apply_sandbox_env(data_dir)\nfrom api.services import auth_db\nb.apply_sandbox_env(d)\n")
    assert not order_ok('"""b.apply_sandbox_env(d)"""\nfrom api.services import auth_db\nb.apply_sandbox_env(d)\n')
    # ... and a commented-out api import before the call does not make a correct child fail.
    assert order_ok("# from api.services import auth_db\nb.apply_sandbox_env(d)\nfrom api.services import auth_db\n")
    toks = code_tokens(C.FOLLOWUP_CHILD)
    assert first(toks, ("apply_sandbox_env", "(")) and first(toks, ("from", "api"))


def test_the_walks_expected_number_lines_are_what_the_product_writes_for_the_childs_seed():
    """The walk's EPS line and Reaction prefix are literals. Feed the seed's own numbers (read out of FOLLOWUP_CHILD, so a
    changed seed is followed) through `followup_prefill.number_lines` and compare."""
    from api.services.journal_two import followup_prefill as fp
    m = re.search(r'"FY2026 Q4", 2026, 4, day\.isoformat\(\), ([\d.]+), ([\d.]+), ([\d.]+), ([\d.e]+), ([\d.e]+), ([\d.]+)\)',
                  C.FOLLOWUP_CHILD)
    assert m, "the seeded quarter row was not found in FOLLOWUP_CHILD (the pattern needs updating with the seed)"
    ea, ee, ep, ra, re_, rp = (float(g) for g in m.groups())
    r = re.search(r'"reaction_pct": (-?[\d.]+)', C.FOLLOWUP_CHILD)
    assert r, "the seeded reaction was not found in FOLLOWUP_CHILD"
    day = "2026-10-14"                     # a Wednesday; its reacting session below is the next trading day
    session = date(2026, 10, 15)
    intel = {
        "quarters": [{"label": "FY2026 Q4", "report_date": day, "reported": True, "eps_actual": ea, "eps_estimate": ee,
                      "eps_surprise_pct": ep, "revenue_actual": ra, "revenue_estimate": re_, "rev_surprise_pct": rp}],
        "reaction": {"events": [{"quarter": "FY2026 Q4", "report_date": day, "reaction_pct": float(r.group(1))}]},
        # retrieved well after the reacting session's close plus the buffer, as the child's seed is
        "meta": {"retrieved_at": datetime(2026, 10, 15, 17, 0, tzinfo=fp.ET).timestamp()},
    }
    # The reacting session is named explicitly: this pins the number lines, not the held calendar.
    orig = fp.reacting_session
    fp.reacting_session = lambda symbol, report_date: (session, True)
    try:
        lines = fp.number_lines(F.FOLLOWUP_SYM, day, intel)
    finally:
        fp.reacting_session = orig
    assert F.FOLLOWUP_EPS_LINE in lines
    reaction = next((ln for ln in lines if ln.startswith("Reaction:")), None)
    assert reaction is not None and reaction.startswith(F.FOLLOWUP_REACTION_PREFIX), reaction
    assert "−" in F.FOLLOWUP_REACTION_PREFIX                     # the real minus sign, U+2212, not a hyphen
    # CONTROL: an unmeasured payload does NOT start with the walk's prefix, so the comparison can fail.
    intel["meta"]["retrieved_at"] = datetime(2026, 10, 15, 15, 0, tzinfo=fp.ET).timestamp()
    fp.reacting_session = lambda symbol, report_date: (session, True)
    try:
        lines2 = fp.number_lines(F.FOLLOWUP_SYM, day, intel)
    finally:
        fp.reacting_session = orig
    assert not next(ln for ln in lines2 if ln.startswith("Reaction:")).startswith(F.FOLLOWUP_REACTION_PREFIX)


def test_the_walk_reads_the_kind_from_the_property_and_records_kind_id_beside_it():
    """The member-visible Kind of note is `builtin:note_kind`; `kindId` (the internal column) is a recorded fact, never a fallback."""
    src = Path(F.__file__).read_text(encoding="utf-8")
    assert '(got.get("propertiesJson") or {}).get("builtin:note_kind")' in src
    assert 'got.get("kindId") or' not in src and "kind_id=kind_id" in src
