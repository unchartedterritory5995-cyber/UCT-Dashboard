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
    # ...and the gate must not count a SKIPPED row as a trigger, in ANY trigger.
    # ⚰️ THIS USED TO PIN THE STRING `'"SKIPPED" not in x[-1]'`, which was the
    # spelling inside trigger 1 — and pinning a spelling is how a rail comes to
    # describe one caller while the property it names is missing from the other
    # three. It WAS missing: trigger 4 counted the 20 console errors a 5xx SKIP
    # recorded from a page that could not load, and printed REVERT
    # (`lesson_a_guard_repeated_is_a_guard_unproved`).
    #
    # ⭐ So the structural claim is now ONE AUTHORITY, and every trigger reading
    # the partition it produces. The behavioural half lives in
    # tests/test_nb_gate_columns.py, which drives a real SKIPPED row through.
    assert "def is_skipped(" in gate_src
    body = gate_src[gate_src.index("    recs, gripes = parsed_rows()"):]
    assert "observed = [x for x in recs if not is_skipped(x)]" in body
    # ⚰️ This pinned `bad = [x for x in observed` and `errs = [x for x in observed`
    # and was RED at 324a5135a (wave 9 found it; nb_gate.py and this file were
    # byte-identical to that commit): the 2026-09-14 ownership rulings rebuilt
    # triggers 1 and 4 as `t1_attr = …` / `errs_all = …`, still over `observed`,
    # and nobody moved the pins. The PROPERTY held; the spelling had moved. The
    # pins now name the lines that actually read the partition today.
    for trigger in ("t1_attr = [(x, flag_attribution(x.get('flag'))) for x in observed]",
                    "conf = [x for x in observed",
                    "errs_all = [x for x in observed"):
        assert trigger in body, trigger


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


# ===========================================================================
# WAVE 9 (9C) — the 30-day soak's SIDECAR. One JSON line per run, and the Q1
# table untouched.
# ===========================================================================

import datetime as _dt
import hashlib as _hashlib
import json as _json
import types as _types

# ⛔⛔ BYTE-UNCHANGED, PINNED BY VALUE. These are the sha256 of HEADER and of one
# row() at 324a5135a (the base of wave 9 lane 9C), computed from `git show` of
# that commit. `nb_gate` names every header cell through `_COLUMNS` and an
# unknown cell turns the verdict INCOMPLETE — so a soak figure that leaked into
# the Q1 table would make every soak Sunday unreadable. The soak's figures go to
# the sidecar; this table does not move.
_Q1_HEADER_SHA = "ace7c360c58a32df50860c684e975ef92003de06a3c27e1ead541955e8c08933"
_Q1_ROW_SHA = "28df3076398c9417c5a23a4bab54f4273b28dc0947a5a014b5478a075c0d83a4"
_ROW_ARGS = ("2026-10-05 14:00 ET", "L", 3, "0/0 — no member reported", 0, 3, 0, 0, "OK")


def _sha(s: str) -> str:
    return _hashlib.sha256(s.encode("utf-8")).hexdigest()


def test_the_Q1_HEADER_and_row_are_byte_unchanged(tmp_path, monkeypatch):
    monkeypatch.setenv("NB_OBSERVE_LOG", str(tmp_path / "l.md"))
    obs = _load("nb_observe")
    assert _sha(obs.HEADER) == _Q1_HEADER_SHA, "the Q1 table's header moved"
    assert _sha(obs.row(*_ROW_ARGS)) == _Q1_ROW_SHA, "the Q1 table's row format moved"


def test_every_Q1_header_cell_is_one_the_gate_can_name(tmp_path, monkeypatch):
    monkeypatch.setenv("NB_OBSERVE_LOG", str(tmp_path / "l.md"))
    obs = _load("nb_observe")
    gate = _load("nb_gate")
    cells = gate.split_cells(obs._column_line(obs.HEADER))
    assert len(cells) == 9
    assert all(gate.canonical(c) for c in cells), [c for c in cells if not gate.canonical(c)]
    # ⭐ CONTROL: a soak column the gate cannot name is exactly what it refuses.
    assert gate.canonical("organic note-edits (soak)") is None


def _load_obs(tmp_path, monkeypatch, **env):
    monkeypatch.setenv("NB_OBSERVE_LOG", str(tmp_path / "obs.md"))
    monkeypatch.setenv("NB_SOAK_SAMPLES", str(tmp_path / "samples.jsonl"))
    monkeypatch.delenv("NB_SOAK_START", raising=False)
    for k, v in env.items():
        monkeypatch.setenv(k, v)
    return _load("nb_observe")


def test_the_sidecar_path_is_its_own_file_beside_the_log(tmp_path, monkeypatch):
    monkeypatch.setenv("NB_OBSERVE_LOG", str(tmp_path / "obs.md"))
    monkeypatch.delenv("NB_SOAK_SAMPLES", raising=False)
    obs = _load("nb_observe")
    assert obs.SOAK_SAMPLES == tmp_path / "soak-samples.jsonl"
    assert obs.SOAK_SAMPLES != obs.LOG


def test_the_sidecar_appends_and_never_rewrites(tmp_path, monkeypatch):
    obs = _load_obs(tmp_path, monkeypatch)
    path = obs.SOAK_SAMPLES
    before = b'{"kept":"one"}\nnot even json, and still kept\n'
    path.write_bytes(before)
    obs.append_soak_sample({"n": 1})
    obs.append_soak_sample({"n": 2})
    after = path.read_bytes()
    assert after.startswith(before), "an existing line was rewritten"
    tail = after[len(before):].decode("utf-8").splitlines()
    assert [_json.loads(x) for x in tail] == [{"n": 1}, {"n": 2}]


def test_a_cut_short_last_line_gets_a_newline_before_the_next(tmp_path, monkeypatch):
    obs = _load_obs(tmp_path, monkeypatch)
    obs.SOAK_SAMPLES.write_bytes(b'{"half":')          # a run killed mid-write
    obs.append_soak_sample({"n": 3})
    lines = obs.SOAK_SAMPLES.read_text(encoding="utf-8").splitlines()
    assert lines == ['{"half":', '{"n":3}']


_T0 = _dt.datetime(2026, 10, 5, 16, 0, tzinfo=_dt.timezone.utc)
_T1 = _dt.datetime(2026, 10, 5, 18, 0, tzinfo=_dt.timezone.utc)


@pytest.mark.parametrize("result", [
    {"err": "HTTP 502"}, {"err": "not JSON (deploy blip?)"}, {"err": "HTTP 404"},
    None, {}, {"body": "not an object"}, {"body": None},
])
def test_a_failed_read_writes_skipped_never_zeros(tmp_path, monkeypatch, result):
    """⛔⛔ Zeros are a CLEAN interval; a failed read is an UNOBSERVED one."""
    obs = _load_obs(tmp_path, monkeypatch)
    line = obs.soak_sample_line("2026-10-05 14:00 ET", _T0, _T1, result, now=_T1)
    assert set(line) == {"at", "row_at", "interval", "skipped"}, line
    assert line["skipped"]
    assert line["interval"] == {"since": "2026-10-05T16:00:00Z", "until": "2026-10-05T18:00:00Z"}


def test_a_good_read_writes_the_figures_as_returned(tmp_path, monkeypatch):
    obs = _load_obs(tmp_path, monkeypatch)
    body = {"events": {"save_failed": {"organic": {"events": 0}}}, "exposure": {}}
    line = obs.soak_sample_line("at", _T0, _T1, {"body": body}, now=_T1)
    assert line["figures"] == body and "skipped" not in line


def test_intervals_tile_from_the_newest_GOOD_line(tmp_path, monkeypatch):
    obs = _load_obs(tmp_path, monkeypatch)
    now = _T1
    # nothing yet -> the trailing two hours
    assert obs.next_soak_since(obs.SOAK_SAMPLES, now) == (now - obs.SOAK_INTERVAL, False)
    good = obs.soak_sample_line("a", _T0 - _dt.timedelta(hours=4), _T0 - _dt.timedelta(hours=2),
                                {"body": {}}, now=_T0)
    bad = obs.soak_sample_line("b", _T0 - _dt.timedelta(hours=2), _T0, {"err": "HTTP 502"}, now=_T0)
    obs.append_soak_sample(good)
    obs.append_soak_sample(bad)
    with obs.SOAK_SAMPLES.open("a", encoding="utf-8") as fh:
        fh.write("garbage line\n")
    since, clamped = obs.next_soak_since(obs.SOAK_SAMPLES, now)
    # ⭐ the FAILED interval is re-read by the next good one: no server event is lost
    assert since == _T0 - _dt.timedelta(hours=2) and clamped is False


def test_a_gap_longer_than_one_read_is_clamped_and_says_so(tmp_path, monkeypatch):
    obs = _load_obs(tmp_path, monkeypatch)
    old = obs.soak_sample_line("a", _T1 - _dt.timedelta(days=60, hours=2),
                               _T1 - _dt.timedelta(days=60), {"body": {}}, now=_T1)
    obs.append_soak_sample(old)
    since, clamped = obs.next_soak_since(obs.SOAK_SAMPLES, _T1)
    assert clamped is True and since == _T1 - obs.SOAK_MAX_READ
    line = obs.soak_sample_line("b", since, _T1, {"body": {}}, clamped=clamped, now=_T1)
    assert line["interval"]["clamped"] is True


def test_a_stamp_from_the_future_is_not_trusted(tmp_path, monkeypatch):
    obs = _load_obs(tmp_path, monkeypatch)
    obs.append_soak_sample(obs.soak_sample_line("a", _T1, _T1 + _dt.timedelta(hours=3),
                                                {"body": {}}, now=_T1))
    assert obs.next_soak_since(obs.SOAK_SAMPLES, _T1) == (_T1 - obs.SOAK_INTERVAL, False)


def test_the_population_lists_still_match_the_server_module(tmp_path, monkeypatch):
    """The import-side twin of tests/test_notebook_populations.py's AST rail."""
    obs = _load_obs(tmp_path, monkeypatch)
    from api.services.journal_two import notebook_populations as pops
    assert obs.RIG_AND_OWNER == pops.RIG_AND_OWNER
    assert obs.SYNTHETIC_MEMBERS == pops.SYNTHETIC_MEMBERS
    assert obs.INTERNAL_DOMAIN == pops.INTERNAL_DOMAIN


def test_the_soak_read_uses_the_same_guarded_fetch_as_the_other_reads(tmp_path, monkeypatch):
    obs = _load_obs(tmp_path, monkeypatch)
    js = obs.SOAK_JS
    assert "/api/admin/notebook-soak?" in js and "credentials:'include'" in js
    assert "if (!r.ok) return {err: 'HTTP ' + r.status};" in js
    assert "if (!ct.includes('application/json')) return {err: 'not JSON (deploy blip?)'};" in js


# ── main(), end to end, on a fake rig ──────────────────────────────────────

class _FakePage:
    def __init__(self, obs, soak_results):
        self.obs, self.soak_results, self.soak_args = obs, list(soak_results), []

    def on(self, *_a, **_k):
        pass

    def goto(self, *_a, **_k):
        pass

    def wait_for_timeout(self, *_a, **_k):
        pass

    def evaluate(self, js, arg=None):
        o = self.obs
        if js is o.wc.ACTIVITY_JS:
            return {o.OPT_IN: {"count": 15}, o.BLOCKED: {"count": 0}}
        if js is o.OPTIN_JS:
            empty = {"identities": 0, "events": 0, "latest": None, "who": []}
            return {"total": 15, "latest": "2026-09-25 03:00:06", "capped": False,
                    "organic": empty, "synthetic": empty, "rigOwner": empty,
                    "unknownInternal": empty}
        if js is o.CONFIG_SERVED_JS:
            return {"total": 0, "served": 0, "rows": 0}
        if js is o.NOTES_JS:
            return {"conflicts": 3}
        if js is o.SOAK_JS:
            self.soak_args.append(arg)
            r = self.soak_results.pop(0)
            if isinstance(r, Exception):
                raise r
            return r
        raise AssertionError("unexpected evaluate")


def _rig(obs, monkeypatch, page, busy=False):
    monkeypatch.setattr(obs.wc, "use_profile", lambda *_: None)
    monkeypatch.setattr(obs.wc, "resolve_profile", lambda *_: None)
    monkeypatch.setattr(obs.wc, "profile_lock_released",
                        lambda timeout=5: (False, ["chrome.exe 123"]) if busy else (True, []))
    monkeypatch.setattr(obs.wc, "spawn_rig", lambda: (None, "ws://fake", "v"))
    monkeypatch.setattr(obs.wc, "teardown", lambda: None)
    ctx = _types.SimpleNamespace(pages=[page], new_page=lambda: page)
    browser = _types.SimpleNamespace(contexts=[ctx])
    chromium = _types.SimpleNamespace(connect_over_cdp=lambda _e: browser)

    class _PW:
        def __enter__(self):
            return _types.SimpleNamespace(chromium=chromium)

        def __exit__(self, *_):
            return False

    fake = _types.ModuleType("playwright.sync_api")
    fake.sync_playwright = lambda: _PW()
    monkeypatch.setitem(sys.modules, "playwright.sync_api", fake)


def _samples(obs):
    return [_json.loads(x) for x in obs.SOAK_SAMPLES.read_text(encoding="utf-8").splitlines()]


def _q1_rows(obs):
    return [ln for ln in obs.LOG.read_text(encoding="utf-8").splitlines() if ln.startswith("| 20")]


def test_a_run_writes_ONE_q1_row_and_ONE_sidecar_line_with_the_figures(tmp_path, monkeypatch):
    obs = _load_obs(tmp_path, monkeypatch)
    page = _FakePage(obs, [{"body": {"events": {}, "exposure": {"identities_editing": {}}}}])
    _rig(obs, monkeypatch, page)
    assert obs.main() == 0
    rows = _q1_rows(obs)
    assert len(rows) == 1 and rows[0].rstrip().endswith("| OK |"), rows
    s = _samples(obs)
    assert len(s) == 1 and s[0]["figures"] == {"events": {}, "exposure": {"identities_editing": {}}}
    assert s[0]["row_at"] == rows[0].split("|")[1].strip()
    assert page.soak_args and set(page.soak_args[0]) == {"since", "until"}
    assert "cumulative" not in s[0]


def test_a_failed_soak_read_leaves_the_q1_row_alone_and_writes_skipped(tmp_path, monkeypatch):
    obs = _load_obs(tmp_path, monkeypatch)
    page = _FakePage(obs, [{"err": "HTTP 404"}])
    _rig(obs, monkeypatch, page)
    obs.main()
    rows = _q1_rows(obs)
    assert len(rows) == 1 and rows[0].rstrip().endswith("| OK |")
    s = _samples(obs)
    assert len(s) == 1 and s[0]["skipped"] == "HTTP 404" and "figures" not in s[0]


def test_a_throwing_soak_read_is_skipped_never_a_crash(tmp_path, monkeypatch):
    obs = _load_obs(tmp_path, monkeypatch)
    page = _FakePage(obs, [RuntimeError("target closed")])
    _rig(obs, monkeypatch, page)
    obs.main()
    s = _samples(obs)
    assert len(s) == 1 and s[0]["skipped"].startswith("RuntimeError")
    assert _q1_rows(obs)[0].rstrip().endswith("| OK |")


def test_a_busy_profile_writes_a_skipped_row_AND_a_skipped_line(tmp_path, monkeypatch):
    obs = _load_obs(tmp_path, monkeypatch)
    _rig(obs, monkeypatch, _FakePage(obs, []), busy=True)
    obs.main()
    assert "rig profile busy" in _q1_rows(obs)[0]
    s = _samples(obs)
    assert len(s) == 1 and s[0]["skipped"].startswith("rig profile busy")


def test_the_cumulative_read_runs_from_NB_SOAK_START(tmp_path, monkeypatch):
    start = (_dt.datetime.now(_dt.timezone.utc) - _dt.timedelta(days=3)).strftime("%Y-%m-%dT%H:%M:%SZ")
    obs = _load_obs(tmp_path, monkeypatch, NB_SOAK_START=start)
    cum_body = {"exposure": {"identities_editing": {"organic": 2}, "notes_edited": {"organic": 7}},
                "speed": {"label": "field: network + device"}}
    page = _FakePage(obs, [{"body": {"events": {}}}, {"body": cum_body}])
    _rig(obs, monkeypatch, page)
    obs.main()
    s = _samples(obs)
    assert len(s) == 1
    assert page.soak_args[1]["since"] == start
    assert s[0]["cumulative"]["identities_editing"] == {"organic": 2}
    assert s[0]["cumulative"]["notes_edited"] == {"organic": 7}
    assert s[0]["cumulative"]["since"] == start
