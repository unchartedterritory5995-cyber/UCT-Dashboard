"""Rails over the observation sampler and the Sunday gate reading.

⛔ THESE EXIST BECAUSE BOTH TOOLS ALREADY DESTROYED OR MANUFACTURED A FACT:
  · the appender rewrote the log on a header mismatch, erasing five real rows the
    moment the schema was improved;
  · the gate compared the feed against a FIXED constant, so the instrument's own
    canary opt-in would have been reported as the first member datapoint.
Each case below drives the defect, not a restatement of the fix.
"""
from __future__ import annotations

import datetime
import importlib.util
import pathlib
import sys

import pytest

NL = chr(10)
TOOLS = pathlib.Path(__file__).resolve().parents[1] / "tools"


def _load(name):
    spec = importlib.util.spec_from_file_location(name, TOOLS / (name + ".py"))
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


def test_a_header_change_cannot_rewrite_existing_rows(tmp_path, monkeypatch):
    """⛔ THE DEFECT, DRIVEN. Five real rows were lost to exactly this."""
    log = tmp_path / "log.md"
    monkeypatch.setenv("NB_OBSERVE_LOG", str(log))
    obs = _load("nb_observe")

    obs.append("| row-A |\n")
    assert "row-A" in log.read_text(encoding="utf-8")

    # the schema changes underneath it, as it really did
    obs.HEADER = "# a DIFFERENT header" + NL + NL + "| new | columns |" + NL + "|---|---|" + NL
    obs.append("| row-B |\n")

    text = log.read_text(encoding="utf-8")
    assert "row-A" in text, "⛔ the old row was destroyed by a header change"
    assert "row-B" in text
    assert "a DIFFERENT header" in text, "the new schema should be appended, not dropped"


def test_the_header_is_written_into_an_empty_file(tmp_path, monkeypatch):
    """⭐ CONTROL: the append path must still create a usable log from nothing."""
    log = tmp_path / "fresh.md"
    monkeypatch.setenv("NB_OBSERVE_LOG", str(log))
    obs = _load("nb_observe")
    obs.append("| first |\n")
    text = log.read_text(encoding="utf-8")
    assert "observation log" in text and "| first |" in text


def test_a_canary_opt_in_is_never_read_as_a_member(tmp_path, monkeypatch):
    """⛔ THE OTHER DEFECT, DRIVEN. The Saturday canary fired its own opt-in 12s
    after its sentinel; a fixed constant would have called that a member."""
    resume = tmp_path / "resume.md"
    resume.write_text("### saturday-canary-1 - **2026-09-12T13:32:54Z**" + NL, encoding="utf-8")
    monkeypatch.setenv("NB_RESUME_DOC", str(resume))
    gate = _load("nb_gate")

    cans = gate.canary_times()
    assert cans, "the canary time should be derived from the stamped row"
    # 12 seconds after the canary: OURS
    assert gate.is_rig("2026-09-12 13:33:06", cans) is True
    # ⭐ CONTROL: far from any canary, and after the pre-canary baseline: a MEMBER
    assert gate.is_rig("2026-09-12 20:00:00", cans) is False
    # ⭐ CONTROL: before any canary existed, still the rig
    assert gate.is_rig("2026-09-12 05:00:00", cans) is True


def test_an_unparseable_stamp_is_never_claimed_as_a_member(tmp_path, monkeypatch):
    """⛔ A value that could not be READ is not a member who arrived - the same
    distinction _doc_text(None) == '' got wrong twice in this wave."""
    resume = tmp_path / "r.md"
    resume.write_text("nothing stamped here" + NL, encoding="utf-8")
    monkeypatch.setenv("NB_RESUME_DOC", str(resume))
    gate = _load("nb_gate")
    assert gate.is_rig("not-a-timestamp", []) is True


def test_a_KEEP_over_zero_members_says_so(tmp_path, monkeypatch):
    """⛔ A verdict file must never look like population evidence it does not have.

    Every trigger reads clean when nobody has run the layer — that is what clean
    looks like over an EMPTY SET. A bare KEEP would be read next week as "a week
    of members found nothing".
    """
    gate = _load("nb_gate")
    src = (TOOLS / "nb_gate.py").read_text(encoding="utf-8")
    assert "no independent member exposure" in src
    assert "0 blocked-baseline " in src and "events measured over 0 real members" in src
    # the qualification is gated on the member line, not unconditional
    assert 'no_member = member.startswith("none")' in src
    assert 'if verdict == "KEEP" and no_member:' in src


def test_the_owner_and_the_smoke_account_are_not_members(tmp_path, monkeypatch):
    """⛔ ATTRIBUTION BY IDENTITY, NOT BY CLOCK.

    The gate excluded rig activity by canary TIMING alone and reported the
    owner's own 14:00:28 opt-in as FIRST MEMBER OPT-IN — 27 minutes from any
    canary, so the timing rule could not see it.
    """
    monkeypatch.setenv("NB_OBSERVE_LOG", str(tmp_path / "l.md"))
    obs = _load("nb_observe")
    assert "unchartedterritory5995@gmail.com" in obs.NOT_A_MEMBER
    assert "smoke@uctintelligence.internal" in obs.NOT_A_MEMBER
    # ⭐ CONTROL: the exclusion list is not a catch-all
    assert "someone-else@example.com" not in obs.NOT_A_MEMBER


def test_a_5xx_reading_is_SKIPPED_not_an_ANOMALY():
    """⛔ A reading that could not be TAKEN is not a finding. Production 502s on
    every Tier 1 deploy; an ANOMALY row there makes the Sunday gate REVERT a
    healthy product because another workstream deployed at 17:05."""
    obs_src = (TOOLS / "nb_observe.py").read_text(encoding="utf-8")
    gate_src = (TOOLS / "nb_gate.py").read_text(encoding="utf-8")
    assert "production unreachable (HTTP 5xx" in obs_src
    assert 'not a finding, and not evidence of a clean interval either' in obs_src
    # and the gate must not count a SKIPPED row as a trigger
    assert '"SKIPPED" not in x[-1]' in gate_src


# ---------------------------------------------------------------------------
# WAVE K — the config-served column, and the three ways it could lie.
#
# K-1's precondition is a "config-served rate of 100% over the K window,
# measured by identity, rig and owner-browser excluded". Each test below is one
# way that sentence gets satisfied by an artifact rather than by reality.
# ---------------------------------------------------------------------------

def test_zero_over_zero_is_never_rendered_as_a_rate():
    """⛔⛔ THE ONE THAT MATTERS. A window in which NO member opened the Notebook
    has 0 successes out of 0 — and a percentage renders that as 100%, which reads
    as the precondition being SATISFIED. The column prints both numbers instead,
    so the denominator cannot hide."""
    obs = _load("nb_observe")
    out = obs.render_config_served({"served": 0, "total": 0})
    assert "0/0" in out and "%" not in out, out
    assert "no member reported" in out


def test_a_shortfall_is_marked_not_merely_printed():
    """A reader scanning a column of bold fractions must not have to do the
    division themselves to notice the one that is short."""
    obs = _load("nb_observe")
    assert "NOT 100%" in obs.render_config_served({"served": 3, "total": 4})
    assert "NOT 100%" not in obs.render_config_served({"served": 4, "total": 4})


def test_an_unreadable_feed_is_ERR_not_zero():
    """⛔ A failed read must never render as "0 served" — a measurement that says
    the opposite of the truth (`lesson_a_swallowed_error_becomes_a_confident_finding`).
    ERR is a third state and it has to stay one."""
    obs = _load("nb_observe")
    assert obs.render_config_served({"err": "HTTP 502"}).startswith("ERR")
    assert obs.render_config_served(None) == "ERR"


def test_the_schema_change_detector_reads_a_COLUMN_line_not_the_prose():
    """⚰️ It used to read `HEADER.split("|")[0]` — the prose ABOVE the table. A new
    column with unchanged prose would have appended MISALIGNED ROWS under the old
    header, silently, in the one file whose whole purpose is that a hole stays
    visible. Found while adding this very column."""
    obs = _load("nb_observe")
    col = obs._column_line(obs.HEADER)
    assert col.startswith("|") and "config-served" in col
    # ⛔ and it does not hard-code THIS schema: a header whose first column is
    # renamed is still a header. The pre-existing rail above drives exactly that.
    assert obs._column_line("# x" + NL + NL + "| new | columns |" + NL) == "| new | columns |"
    with pytest.raises(SystemExit):
        obs._column_line("# a header with no table in it" + NL)


def test_a_new_column_appends_a_new_header_block_and_keeps_every_row(tmp_path, monkeypatch):
    """⭐ The property the detector exists for, driven end to end."""
    log = tmp_path / "obs.md"
    monkeypatch.setenv("NB_OBSERVE_LOG", str(log))
    obs = _load("nb_observe")
    log.write_text("# old" + NL + NL + "| at (ET) | flag |" + NL + "|---|---|" + NL
                   + "| 2026-09-12 01:20 ET | OK |" + NL, encoding="utf-8")
    obs.append(obs.row("2026-09-12 23:00 ET", "—", 1, "**2/2**", 0, 0, 0, 0, "OK"))
    body = log.read_text(encoding="utf-8")
    assert "| 2026-09-12 01:20 ET | OK |" in body, "⛔ an existing row was destroyed"
    assert "config-served" in body, "the new column did not append a new header block"
    assert "**2/2**" in body


def test_the_row_writer_and_the_header_agree_on_the_column_count():
    """⛔ A column added to the header and not to `row()` — or the reverse —
    writes rows that render misaligned, and markdown does not complain."""
    obs = _load("nb_observe")
    header_cols = obs._column_line(obs.HEADER).count("|") - 1
    written = obs.row("at", "latest", 1, "2/2", 0, 0, 0, 0, "OK").count("|") - 1
    assert header_cols == written, (header_cols, written)


def test_the_config_served_reader_counts_BY_IDENTITY_and_excludes_the_rig():
    """⛔ The exclusion list is the SAME one the opt-in column uses, and it is
    passed to the browser rather than restated — two lists over one question is
    how they drift. This pins that the reader is handed that list."""
    obs = _load("nb_observe")
    assert "unchartedterritory5995@gmail.com" in obs.NOT_A_MEMBER
    assert "smoke@uctintelligence.internal" in obs.NOT_A_MEMBER
    js = obs.CONFIG_SERVED_JS
    assert "excluded.includes(email)" in js, "the reader must drop excluded identities"
    assert "byEmail" in js and "byEmail.size" in js, "the denominator must be identities, not rows"
    assert "notebook_config_served" in js
    # ⭐ ANY served:true in the window counts that identity as served — a member
    # whose first tab predated the deploy must not be held against the rate forever.
    assert "|| served" in js


# ---------------------------------------------------------------------------
# ⛔⛔ THE DEPLOYED COPY IS A SECOND AUTHORITY, BY DESIGN — so it needs a check.
#
# `C:\Users\Patrick\uct-q1-observe\` holds COPIES of nb_observe.py and nb_gate.py,
# deliberately outside every worktree so that removing a worktree during the
# 7-day window cannot kill the job. Its own .cmd says so: *"they will not track
# later repo edits."*
#
# That is a sound trade and it has a sharp edge: editing the repo file changes
# NOTHING about what runs every two hours. Wave K's column would have been a
# silent no-op — the repo would show a new column, the log would keep writing
# the old one, and the K-1 precondition would have no numerator while looking
# like it had one.
#
# ⛔ ABSENT IS REPORTED, NOT SKIPPED SILENTLY. On a machine without the runner
# directory this test asserts the CONTRACT instead (the repo still documents the
# copy relationship), so it can never read as "verified" for the wrong reason.
# ---------------------------------------------------------------------------

RUNNER_DIR = pathlib.Path(r"C:\Users\Patrick\uct-q1-observe")


@pytest.mark.parametrize("name", ["nb_observe.py", "nb_gate.py"])
def test_the_deployed_copy_matches_the_repo_or_the_drift_is_named(name):
    """⛔ BOTH copied files, not just the sampler.

    ⚰️ 2026-09-13: this rail covered `nb_observe.py` alone, and `nb_gate.py` had
    ALREADY drifted — the deployed Sunday gate still carried the FOUR-doors
    attribution text a day after the repo learned there are seven. The gate would
    have printed a stale list of families for an operator to rule out, at 17:05,
    on the one run that decides keep-or-revert. A rail that covers one of two
    copied files reports coverage it does not have."""
    import hashlib
    repo = TOOLS / name
    deployed = RUNNER_DIR / name
    if not deployed.exists():
        # Not this machine. Assert the contract that makes the copy legible,
        # rather than passing over an absence.
        cmd = RUNNER_DIR / "nb_observe.cmd"
        assert not cmd.exists(), (
            "the runner directory has its .cmd but not its .py — a half-deployed "
            "sampler is worse than none")
        return
    h = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
    assert h(repo) == h(deployed), (
        f"⛔ THE LIVE COPY IS NOT THIS FILE. `tools/{name}` has been edited "
        "and the deployed copy at\n"
        f"  {deployed}\n"
        "still runs the old code every two hours. Copy it across and re-run this test; "
        "the repo edit alone changes nothing about what is measured."
    )
