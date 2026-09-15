"""The sampler's refusals are the product. Session 11, B.4.

⛔⛔ SAMPLER LOAD IS PRODUCTION LOAD. Every refusal below is a rail, because a sampler
that forgets one is a self-inflicted load test on a single-uvicorn-process pod. The
decision logic is a PURE FUNCTION (`should_sample`) precisely so these can feed it fake
clocks, fake uptimes and fake counters without touching the network.

⛔ AND EACH TEST DRIVES THE REFUSAL IN BOTH DIRECTIONS. A test that only checks "it
refused" passes just as happily against a sampler that refuses everything forever —
which is the failure mode that looks like safety and produces no data at all.
"""
from __future__ import annotations

import datetime
import json
import pathlib
import sys

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from tools import breadth_sampler as bs  # noqa: E402

ET = bs.ZoneInfo("America/New_York")


def at(h, m, day=15):
    return datetime.datetime(2026, 9, day, h, m, tzinfo=ET)


# ── the four refusals ───────────────────────────────────────────────────────

def test_an_unsettled_pod_is_refused_and_a_settled_one_is_not():
    """Session 7 measured 17,480 ms three minutes after boot against 224 ms settled.
    A sample taken then measures the boot, not the reader."""
    ok, why = bs.should_sample(at(3, 0), uptime_s=599, taken_today=0, kill_switch_present=False)
    assert not ok and why.startswith("pod_unsettled"), why
    ok, why = bs.should_sample(at(3, 0), uptime_s=600, taken_today=0, kill_switch_present=False)
    assert ok, f"600 s is the floor and must PASS, got {why}"


# ⚰️ `test_inside_the_push_guard_window_is_refused_at_both_edges` WAS HERE AND IS DELETED.
# Owner ruling 2026-09-15 (SD-1.1 A0): "we no longer have mid day blocks ever". The rule
# it guarded was carried in from another programme's context, not the owner's.
# ⛔ It was DELETED, not inverted. An inverted rail ("the clock must NOT refuse") would
# pin the absence of a rule as though the absence were itself a policy, and the next
# person reading it would reasonably conclude a clock had once been correct here.
# The replacement is the rail below: the clock cannot refuse because it is not consulted.


def test_the_clock_is_not_a_sampling_condition_at_any_hour():
    """⛔ The load bound is the CAP and the CADENCE, which bound load directly. Sweep the
    whole day: no hour may produce a refusal, and no refusal reason may mention a clock."""
    for h in range(24):
        for m in (0, 25, 5, 59):
            ok, why = bs.should_sample(at(h, m), 9999, 0, False)
            assert ok, f"{h:02d}:{m:02d} was refused with {why!r} — no hour may refuse"
            for word in ("window", "guard", "rth", "hours"):
                assert word not in why.lower(), f"{why!r} still speaks of a clock"


def test_the_kill_switch_refuses_everything_and_its_absence_does_not():
    ok, why = bs.should_sample(at(3, 0), 9999, 0, kill_switch_present=True)
    assert not ok and why == "kill_switch_present", why
    ok, _ = bs.should_sample(at(3, 0), 9999, 0, kill_switch_present=False)
    assert ok


def test_the_daily_cap_refuses_at_the_cap_not_after_it():
    ok, _ = bs.should_sample(at(3, 0), 9999, taken_today=bs.DAILY_CAP - 1,
                             kill_switch_present=False)
    assert ok
    ok, why = bs.should_sample(at(3, 0), 9999, taken_today=bs.DAILY_CAP,
                               kill_switch_present=False)
    assert not ok and why.startswith("daily_cap_reached"), why


def test_an_unknown_uptime_is_refused_rather_than_assumed_settled():
    """⛔ The health probe failing must not read as a settled pod. `None` is not a
    large number."""
    ok, why = bs.should_sample(at(3, 0), uptime_s=None, taken_today=0,
                               kill_switch_present=False)
    assert not ok and why == "uptime_unknown", why


def test_the_kill_switch_outranks_a_perfectly_samplable_moment():
    """Ordering matters: the switch is the operator's, and it wins over every other
    condition being green."""
    ok, why = bs.should_sample(at(3, 0), 100000, 0, True)
    assert why == "kill_switch_present", why


# ── the timezone, which is the guard's foundation ───────────────────────────

def test_the_clock_is_zoneinfo_ET_and_not_the_local_box():
    """⛔ This box runs on CENTRAL time, and `TZ=America/New_York date` in Git Bash
    printed the UTC hour on 2026-09-15. A guard on the wrong clock refuses and permits
    at the wrong times while looking correct."""
    utc = datetime.datetime(2026, 9, 15, 13, 30, tzinfo=datetime.timezone.utc)
    et = bs.et_now(utc)
    assert (et.hour, et.minute) == (9, 30), et          # EDT = UTC-4
    assert (et.hour, et.minute) == (9, 30), "13:30Z must read as 09:30 ET"
    # and the same instant is NOT inside it if you mistake Central for Eastern
    assert et.tzinfo is not None, "the timestamp must carry a zone, never be naive"


# ── a response without Server-Timing is a FAILURE, never a zero ─────────────

def test_a_missing_server_timing_header_parses_to_empty_not_to_zeros():
    assert bs.parse_server_timing("") == {}
    assert bs.parse_server_timing(None) == {}
    got = bs.parse_server_timing("total;dur=281.0, reader;dur=157.6, junk, x;dur=nope")
    assert got == {"total": 281.0, "reader": 157.6}, got


def test_the_cap_counts_successes_only_so_an_outage_cannot_exhaust_the_day(tmp_path):
    """⛔ If failures consumed the cap, a bad hour would silently spend the whole day's
    budget and the log would show a quiet sampler rather than a broken one."""
    p = tmp_path / "s.jsonl"
    rows = [
        {"ok": True, "et_date": "2026-09-15"},
        {"ok": True, "et_date": "2026-09-15"},
        {"ok": False, "et_date": "2026-09-15", "error": "boom"},
        {"ok": False, "et_date": "2026-09-15", "refused": "kill_switch_present"},
        {"ok": True, "et_date": "2026-09-14"},
    ]
    p.write_text("\n".join(json.dumps(r) for r in rows) + "\n", encoding="utf-8")
    assert bs.samples_taken_today(p, at(3, 0)) == 2
    assert bs.samples_taken_today(p, at(3, 0, day=14)) == 1


def test_a_corrupt_log_line_does_not_crash_the_counter(tmp_path):
    p = tmp_path / "s.jsonl"
    p.write_text('{"ok": true, "et_date": "2026-09-15"}\nnot json\n\n', encoding="utf-8")
    assert bs.samples_taken_today(p, at(3, 0)) == 1


# ── the constants are the policy; pin them so a drift is deliberate ─────────

def test_the_policy_constants_are_what_the_owner_authorised():
    assert bs.MIN_UPTIME_S == 600
    assert bs.DAILY_CAP == 60
    assert bs.MIN_CADENCE_S >= 35
    assert bs.BACKOFF_S >= 600
    # ⛔ No clock constant. Asserting its ABSENCE is the point: a reintroduced window
    # would be a policy change, and it should break a rail rather than pass quietly.
    assert not hasattr(bs, "WINDOW_OPEN") and not hasattr(bs, "WINDOW_CLOSE"), (
        "a sampling window has been reintroduced — owner ruling SD-1.1 A0 retired it")


def test_every_span_is_distinct_so_every_deep_read_is_a_forced_miss():
    assert bs.SPAN_LO < bs.SPAN_HI
    assert bs.SPAN_HI - bs.SPAN_LO >= bs.DAILY_CAP, (
        "the span walk must not repeat a cache key within one day's cap")


# ── the hot path file the pooling rule depends on ───────────────────────────

REPO = pathlib.Path(__file__).resolve().parents[1]


def test_the_hot_path_file_lists_real_files_and_the_ones_that_must_be_there():
    from tools import breadth_sampler_report as rep
    files = rep.hot_path()
    assert files, "empty hot path would pool every SHA together"
    for f in files:
        assert (REPO / f).exists(), f"{f} is listed but does not exist"
    # ⛔ NON-VACUITY: a truncated list would still "pass" the existence check above.
    for must in ("api/services/breadth_daily_ohlc.py", "api/services/breadth_monitor.py",
                 "api/routers/breadth_monitor.py", "api/services/breadth_timing.py"):
        assert must in files, f"{must} missing from the hot path — pooling would be blind to it"


def test_two_shas_with_an_identical_hot_path_pool_and_different_ones_do_not():
    """⛔ Proved against REAL commits, not fixtures. The 31 commits between M10 and
    master changed 4 files under api/ and none on the hot path, so those two SHAs must
    pool; a commit that changed a hot file must not."""
    import subprocess
    from tools import breadth_sampler_report as rep
    files = rep.hot_path()

    def rev(x):
        p = subprocess.run(["git", "rev-parse", x], cwd=str(REPO),
                           capture_output=True, encoding="utf-8")
        return p.stdout.strip() if p.returncode == 0 else None

    a, b = rev("30fd58aef"), rev("origin/master")
    if not a or not b:
        pytest.skip("reference commits unavailable in this checkout")
    same, diff = rep.hot_path_identical(a, b, files)
    assert same, f"expected these to pool; hot files differing: {diff}"

    # ⛔ THE DISCRIMINATOR IS DERIVED, NOT AN OFFSET. A first attempt used
    # `30fd58aef~1` and FAILED: that SHA is the rename's sibling commit, so both sides
    # already carried the renamed file and the pair proved nothing. Ask git which commit
    # last touched a hot file and compare it with its own parent — that pair differs by
    # construction, whatever the history looks like later.
    hot_file = "api/services/breadth_daily_ohlc.py"
    p = subprocess.run(["git", "log", "-1", "--format=%H", "--", hot_file],
                       cwd=str(REPO), capture_output=True, encoding="utf-8")
    changer = p.stdout.strip()
    if not changer:
        pytest.skip("no commit touching the hot file in this checkout")
    parent = rev(changer + "^")
    if not parent:
        pytest.skip("that commit has no parent here")
    same2, diff2 = rep.hot_path_identical(parent, changer, files)
    assert not same2, (
        f"{changer[:9]} changed {hot_file} but the pool rule says it is identical to "
        f"its parent {parent[:9]} — the split would never happen")
    assert hot_file in diff2, diff2


# ─────────────────────────────────────────────────────────────────────────────
# C.4 — the report must refuse to print a p95 it cannot support.
# ─────────────────────────────────────────────────────────────────────────────

def test_the_report_refuses_a_p95_below_the_required_n():
    """⛔ Session 10 measured P(true p95 above the worst read) = 0.358 at n=20. A printed
    p95 is read as an estimate whatever caveat sits beside it, so the cell itself must
    say `not est` — and BOTH directions are driven, because a report that always says
    `not est` is equally useless."""
    from tools import breadth_sampler_report as rep
    twenty = [float(i) for i in range(20)]
    out = rep.stats(twenty)
    assert "not est" in out, f"n=20 must not print a p95: {out}"
    assert "p50=" in out and "max=" in out, "the other statistics must still print"

    enough = [float(i) for i in range(rep.N_FOR_P95)]
    out2 = rep.stats(enough)
    assert "not est" not in out2, f"n={rep.N_FOR_P95} must print a p95: {out2}"
    assert "p95=" in out2


def test_the_required_n_is_the_figure_session_10_derived():
    from tools import breadth_sampler_report as rep
    assert rep.N_FOR_P95 == 59


def test_the_generated_summary_declares_itself_generated_and_data_free():
    """⛔ It is published. The header must say it is generated (so nobody edits it) and
    must state WHY it is safe to publish — a property of what the sampler records, not a
    promise about redaction."""
    from tools import breadth_sampler_report as rep
    h = rep.SUMMARY_HEADER
    assert "GENERATED FILE" in h
    assert "NOT A SOURCE" in h, "a generated file must not become an authority"
    assert "NO MEMBER DATA" in h
    assert rep.SUMMARY.name == "sampler-summary.md"



class _Console:
    """A console that writes exactly like a real one: it RAISES on anything its encoding
    cannot represent. ⛔ The whole point of the rail below is that the text contains ⛔."""

    def __init__(self, encoding):
        self.encoding = encoding
        self.written = []

    def write(self, s):
        s.encode(self.encoding)          # UnicodeEncodeError on ⛔ under cp1252
        self.written.append(s)
        return len(s)

    def flush(self):
        pass


def _stub_report(rep, monkeypatch, tmp_path, text="\u26d4 a line the console cannot encode"):
    """Point the report at a throwaway summary path and give `main` REAL OUTPUT.

    ⛔ THE OUTPUT IS THE WHOLE FIXTURE. The first version of this rail stubbed `main` to
    return 0 silently, so the captured text was EMPTY — `"".encode("cp1252")` raises
    nothing, and the rail stayed green against the very ordering it was written to catch.
    """
    summary = tmp_path / "sampler-summary.md"
    monkeypatch.setattr(rep, "SUMMARY", summary)
    monkeypatch.setattr(rep, "REPO", tmp_path)
    monkeypatch.setattr(rep, "SUMMARY_HEADER", "<!-- GENERATED FILE -->\n")
    monkeypatch.setattr(rep, "main", lambda: (print(text), 0)[1])
    return summary


def test_the_fixture_console_really_refuses_the_character(tmp_path):
    """⛔ Non-vacuity control for the two rails below: if this stops raising, they both
    pass for the wrong reason and prove nothing about the ordering."""
    with pytest.raises(UnicodeEncodeError):
        _Console("cp1252").write("\u26d4")
    _Console("utf-8").write("\u26d4")          # and the capable one must NOT raise


def test_a_console_that_cannot_encode_the_text_still_gets_the_summary_file(tmp_path,
                                                                          monkeypatch):
    """⛔⛔ THE DURABLE HALF OF C.1 MUST NOT BE LOST TO THE DISPOSABLE HALF.

    This box's console is cp1252 and the report's text is full of ⛔. With the terminal
    echo ordered BEFORE the file write, `sys.stdout.write` raised UnicodeEncodeError and
    took the summary file down with it: exit 1, nothing on disk, on the very box Task
    Scheduler runs this on. Measured 2026-09-15.
    """
    from tools import breadth_sampler_report as rep
    summary = _stub_report(rep, monkeypatch, tmp_path)
    monkeypatch.setattr(sys, "stdout", _Console("cp1252"))

    rc = rep._run_and_capture()          # must not raise

    assert rc == 0
    assert summary.exists(), "the summary must survive a console that cannot encode it"
    assert "\u26d4" in summary.read_text(encoding="utf-8"), \
        "and it must keep the character verbatim — the file is utf-8, not the console"


def test_a_console_that_can_encode_is_still_printed_to(tmp_path, monkeypatch):
    """⛔ The other direction. "Never fails" is trivially satisfied by never printing, so
    a capable console must still receive the text, character intact."""
    from tools import breadth_sampler_report as rep
    _stub_report(rep, monkeypatch, tmp_path)
    console = _Console("utf-8")
    monkeypatch.setattr(sys, "stdout", console)

    rep._run_and_capture()

    joined = "".join(console.written)
    assert "\u26d4" in joined, "a capable console must still be printed to"
    assert "sampler-summary.md" in joined, "and told where the summary went"


# ─────────────────────────────────────────────────────────────────────────────
# SD-1.1 A2.4 — the real tool, in a real subprocess, with a real cp1252 stdout.
# The in-process rails above use a fake console object; this one forces the actual
# encoding the way Task Scheduler will, because those are different claims.
# ─────────────────────────────────────────────────────────────────────────────

def _run_report(tmp_path, encoding):
    import os as _os
    import subprocess as _sp
    summary = tmp_path / "sampler-summary.md"
    env = {**_os.environ, "PYTHONIOENCODING": encoding,
           "BREADTH_SAMPLER_SUMMARY": str(summary)}
    repo = pathlib.Path(__file__).resolve().parents[1]
    p = _sp.run([sys.executable, str(repo / "tools" / "breadth_sampler_report.py")],
                cwd=str(repo), env=env, capture_output=True)
    return p, summary


def test_the_report_survives_a_forced_cp1252_stdout_and_writes_a_complete_summary(tmp_path):
    """⛔⛔ THE FAILURE THIS REPLACES: exit 1 and NO FILE, on the box Task Scheduler runs
    it on. The tool reconfigures stdout at entry, and writes the artifact before it echoes.
    """
    p, summary = _run_report(tmp_path, "cp1252")
    assert p.returncode == 0, (f"exit {p.returncode}\n"
                               f"{p.stderr.decode('utf-8', 'replace')[-800:]}")
    assert summary.exists(), "the summary was not written under a cp1252 stdout"

    text = summary.read_text(encoding="utf-8")
    # ⛔ "Complete", not merely "present": a truncated file is the failure mode that a
    # bare exists() check cannot see.
    for marker in ("GENERATED FILE", "NOT A SOURCE", "NO MEMBER DATA",
                   "# Breadth sampler - pool summary", "```"):
        assert marker in text, f"summary is missing {marker!r} — written but incomplete"
    assert text.rstrip().endswith("```"), "the fenced block is not closed — truncated"
    assert "BREADTH SAMPLER" in text, "the report body never reached the file"


def test_the_same_run_under_utf8_produces_the_same_file(tmp_path):
    """The control. If cp1252 and utf-8 disagreed about the FILE, the fix would have
    made the artifact depend on the console — which is the coupling being removed."""
    a, sa = _run_report(tmp_path / "a", "cp1252")
    b, sb = _run_report(tmp_path / "b", "utf-8")
    assert a.returncode == 0 and b.returncode == 0
    assert sa.read_bytes() == sb.read_bytes(), (
        "the summary differs by console encoding — the artifact must not depend on it")


def test_an_unguarded_write_to_a_cp1252_stdout_really_does_die(tmp_path):
    """⛔ Non-vacuity. If this stopped failing, the two rails above would pass on a box
    where nothing was ever at risk, and would prove nothing about the fix."""
    import os as _os
    import subprocess as _sp
    prog = "import sys; sys.stdout.write('\u26d4')"
    p = _sp.run([sys.executable, "-c", prog],
                env={**_os.environ, "PYTHONIOENCODING": "cp1252"}, capture_output=True)
    assert p.returncode != 0, "a bare cp1252 stdout no longer rejects U+26D4 on this box"
    assert b"UnicodeEncodeError" in p.stderr, p.stderr[-300:]


def test_stdout_is_actually_reconfigured_to_utf8_at_entry(tmp_path):
    """⛔ PINS THE MECHANISM, because the property rail above cannot.

    The tool has TWO defences against a cp1252 console: this reconfigure, and `_echo`'s
    guarded write. Removing EITHER leaves the summary file intact, so a rail that asserts
    only "the file survives" passes with one of them deleted and proves neither
    (`lesson_a_guard_repeated_is_a_guard_unproved`). Measured: deleting the reconfigure
    left all rails green.

    They are both kept because they cover DIFFERENT cases — the reconfigure covers every
    write in the tool including future code that does not route through `_echo`, and
    `_echo` covers the case where the reconfigure itself threw (a stream that cannot be
    reconfigured, which is why that call sits in a try). So each gets a rail on its own
    case, rather than one rail that both can satisfy.
    """
    import os as _os
    import subprocess as _sp
    repo = pathlib.Path(__file__).resolve().parents[1]
    prog = ("import sys, runpy;"
            "sys.argv=['breadth_sampler_report.py'];"
            "import importlib.util as u;"
            f"spec=u.spec_from_file_location('r', r'{repo / 'tools' / 'breadth_sampler_report.py'}');"
            "m=u.module_from_spec(spec); spec.loader.exec_module(m);"
            "print('ENC=' + str(sys.stdout.encoding).lower())")
    p = _sp.run([sys.executable, "-c", prog], cwd=str(repo), capture_output=True,
                env={**_os.environ, "PYTHONIOENCODING": "cp1252",
                     "BREADTH_SAMPLER_SUMMARY": str(tmp_path / "s.md")})
    out = p.stdout.decode("utf-8", "replace")
    assert "ENC=" in out, f"probe did not report an encoding: {p.stderr[-400:]!r}"
    enc = out.rsplit("ENC=", 1)[1].strip()
    assert enc.replace("-", "") == "utf8", (
        f"stdout is {enc!r} after import — the entry reconfigure did not take effect, "
        "so any print outside _echo would still raise on this console")
