"""The 30-day soak's roll-up (wave 9, lane 9C) — pure functions on fixtures.

Every case starts from ONE healthy soak (35 days of two-hourly rows and reads,
five organic identities' worth of edits, a KEEP every Sunday, a passing drill
every week) and changes exactly one thing. The healthy fixture reading PASS is
the control: it proves PASS is reachable, so every INCONCLUSIVE/FAIL below is
caused by the one thing changed and not by a fixture that could never pass.
"""
from __future__ import annotations

import datetime as dt
import importlib.util
import json
import pathlib
import sys

import pytest

TOOLS = pathlib.Path(__file__).resolve().parents[1] / "tools"


def _load(name):
    spec = importlib.util.spec_from_file_location(name, TOOLS / (name + ".py"))
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


soak = _load("nb_soak")
UTC = dt.timezone.utc
START = dt.datetime(2026, 10, 10, 16, 0, tzinfo=UTC)
NOW = START + dt.timedelta(days=35)
TWO_H = dt.timedelta(hours=2)
HEADER = ("| at (ET) | opt-ins by population (UTC) | opt-in (windowed) | config-served (members) | "
          "blocked-baseline | sync-conflict notes | outbox (rig only, layer off — structurally 0) | "
          "console errors (rig) | flag |\n|---|---|---|---|---|---|---|---|---|\n")
BUDGETS = {"editor": {"open_p95_ms_max": 300}, "search": {"p95_ms_max": 100}}


def _stamp(t):
    return t.astimezone(soak.STAMP_TZ).strftime("%Y-%m-%d %H:%M ET")


def _z(t):
    return t.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def _times():
    t, out = START + TWO_H, []
    while t <= NOW:
        out.append(t)
        t += TWO_H
    return out


def _q1(skip=(), conflicts=None):
    rows = []
    for t in _times():
        flag = "**SKIPPED** — production unreachable (HTTP 5xx, deploy in flight)" if t in skip else "OK"
        c = (conflicts or {}).get(t, 3)
        rows.append(f"| {_stamp(t)} | x · organic 5 | 9 | 5/5 | 0 | {c} | 0 | 0 | {flag} |")
    return HEADER + "\n".join(rows) + "\n"


def _figures(t, edits=5, ids=3, extra=None):
    day = (t - dt.timedelta(seconds=1)).astimezone(soak.ET).date().isoformat()
    f = {
        "events": {"save_failed": {"organic": {"events": 0, "by_reason": {}}},
                   "conflict_forked": {"organic": {"events": 0}},
                   "notebook_blocked_no_baseline": {"organic": {"events": 0}}},
        "config_served": {"organic": "5/5", "synthetic": "0/0", "rig_owner": "1/1",
                          "unknown_internal": "0/0", "unresolved": "0/0"},
        "exposure": {"note_edits_by_day": {"organic": {day: edits}},
                     "identities_editing_by_day": {"organic": {day: ids}}},
        "conflicted_copies": {"offline_layer": {}, "connector": {}},
        "client_errors": {"by_population": {}, "anonymous_errors": 0},
        "speed": {"note_open_ms": {"by_population": {"organic": {"n": 9, "p50_ms": 90.0, "p95_ms": 200.0}}}},
    }
    for path, value in (extra or {}).items():
        node = f
        for k in path[:-1]:
            node = node.setdefault(k, {})
        node[path[-1]] = value
    return f


def _samples(edits=5, ids=3, cum_ids=6, fail_at=(), extra_at=None, speed=None):
    lines = []
    for t in _times():
        line = {"at": _z(t), "row_at": _stamp(t), "interval": {"since": _z(t - TWO_H), "until": _z(t)}}
        if t in fail_at:
            line["skipped"] = "HTTP 502"
        else:
            line["figures"] = _figures(t, edits, ids, (extra_at or {}).get(t))
            line["cumulative"] = {"since": _z(START), "until": _z(t),
                                  "identities_editing": {"organic": cum_ids},
                                  "speed": speed or {"note_open_ms": {"by_population": {
                                      "organic": {"n": 50, "p50_ms": 120.0, "p95_ms": 250.0}}}}}
        lines.append(json.dumps(line))
    return "\n".join(lines) + "\n"


def _sundays(overrides=None):
    out, d = [], START.astimezone(soak.ET).date()
    while d <= NOW.astimezone(soak.ET).date():
        if d.weekday() == 6:
            word = (overrides or {}).get(d.isoformat(), "KEEP")
            if word is not None:
                out.append(f"# Wave Q1 — gate verdict\n\nVERDICT: **{word}**\nat:        {d.isoformat()} 18:05 ET\n")
        d += dt.timedelta(days=1)
    return out


def _drills(skip_weeks=(), fail_weeks=()):
    out = []
    for k in range(6):
        if k + 1 in skip_weeks:
            continue
        word = "FAIL" if k + 1 in fail_weeks else "PASS"
        at = START + dt.timedelta(days=7 * k + 3)
        out.append(f"# auth.db restore drill - {word}\n\n- run at: {at.isoformat(timespec='seconds')}\n")
    return out


CANARY = ("## \U0001f4cb THE WINDOW-WATCH LOG — one row per check\n\n"
          f"### sunday-canary — **{_z(START + dt.timedelta(days=2))}**\n\n| | reading |\n|---|---|\n"
          "| **mini-canary** | ✅ **12/12** steps green |\n"
          "|  ↳ 4 reconnect → the queue settled (this step says NOTHING about the body) | "
          "`dirty` **0** · outbox **0** · baseline `x` |\n")


def facts(**kw):
    args = dict(start=START, start_sha="abc1234", now=NOW, q1_text=_q1(), samples_text=_samples(),
                verdict_texts=_sundays(), canary_text=CANARY, drill_texts=_drills(), ruled_text="",
                incident_texts=[], drift=[soak.drift_line("nb_observe.py", b"x\r\n", b"x\n")],
                budgets=BUDGETS, heartbeat={"text": "Last Result 0", "problem": None})
    args.update(kw)
    return soak.build_facts(**args)


# ── the control ─────────────────────────────────────────────────────────────

def test_the_healthy_soak_is_a_PASS():
    f = facts()
    word, fail, inc = soak.verdict(f)
    assert (word, fail, inc) == ("PASS", [], []), inc
    assert f["window"]["unobserved"] == []
    assert f["exposure"]["organic_identities"] == 6 and f["exposure"]["active_days"] >= 30
    assert soak.alerts(f, word, "PASS") == []


# ── unobserved time ─────────────────────────────────────────────────────────

def test_a_SKIPPED_interval_is_UNOBSERVED_and_moves_the_end_by_its_length():
    t = START + dt.timedelta(days=4, hours=6)
    f = facts(q1_text=_q1(skip={t}))
    win = f["window"]
    assert win["unobserved"] == [(t - TWO_H, t, f"SKIPPED row {soak.fmt(t)}")]
    assert win["end"] == START + dt.timedelta(days=30) + TWO_H
    assert win["end"] - win["nominal_end"] == TWO_H


def test_a_heartbeat_gap_is_unobserved_and_extends_the_window():
    gone = {START + dt.timedelta(days=5, hours=2 * k) for k in range(1, 4)}   # 3 runs missing
    rows = _q1().splitlines()
    keep = [ln for ln in rows if not any(_stamp(t) in ln for t in gone)]
    f = facts(q1_text="\n".join(keep) + "\n")
    [(a, b, why)] = f["window"]["unobserved"]
    assert why.startswith("heartbeat gap") and b - a == 3 * TWO_H
    assert f["window"]["end"] == START + dt.timedelta(days=30, hours=6)


def test_a_failed_read_that_the_next_read_recovers_is_not_unobserved():
    """Intervals tile (C6): the read after a failure starts where the last good one ended."""
    t = START + dt.timedelta(days=3)
    lines = [json.loads(x) for x in _samples().splitlines()]
    # the failed run, then a good run whose interval reaches back over it
    idx = next(i for i, x in enumerate(lines) if x["interval"]["until"] == _z(t))
    lines[idx] = {"at": _z(t), "row_at": _stamp(t), "interval": lines[idx]["interval"], "skipped": "HTTP 502"}
    lines[idx + 1]["interval"]["since"] = lines[idx]["interval"]["since"]
    f = facts(samples_text="\n".join(json.dumps(x) for x in lines) + "\n")
    assert f["window"]["unobserved"] == []


def test_an_unrecovered_read_failure_is_unobserved():
    t = START + dt.timedelta(days=3)
    f = facts(samples_text=_samples(fail_at={t}))
    [(a, b, why)] = f["window"]["unobserved"]
    assert (a, b) == (t - TWO_H, t) and "no soak read covers" in why


# ── the exposure floor (D-9C1) ──────────────────────────────────────────────

def test_zero_organic_members_is_INCONCLUSIVE_from_day_one():
    f = facts(samples_text=_samples(edits=0, ids=0, cum_ids=0))
    word, fail, inc = soak.verdict(f)
    assert word == "INCONCLUSIVE" and not fail
    assert any("0 organic identities" in r for r in inc), inc
    assert any("0 organic note-edit-days" in r for r in inc), inc


def test_too_few_organic_IDENTITIES_alone_is_INCONCLUSIVE():
    """Plenty of edits, four people: the identities clause on its own."""
    f = facts(samples_text=_samples(cum_ids=4))
    word, fail, inc = soak.verdict(f)
    assert word == "INCONCLUSIVE" and inc == [
        "exposure floor: 4 organic identities of 5 (exact, from the soak's first minute)"]


def test_without_a_cumulative_read_the_identity_count_is_labelled_a_lower_bound():
    lines = [json.loads(x) for x in _samples().splitlines()]
    for x in lines:
        x.pop("cumulative", None)
    f = facts(samples_text="\n".join(json.dumps(x) for x in lines) + "\n")
    assert f["exposure"]["organic_identities"] == 3
    assert f["exposure"]["identities_basis"].startswith("lower bound")


# ── Sunday verdicts (D-9C5) ─────────────────────────────────────────────────

def _first_sunday():
    d = START.astimezone(soak.ET).date()
    while d.weekday() != 6:
        d += dt.timedelta(days=1)
    return d.isoformat()


def test_an_unruled_REVERT_is_a_FAIL():
    sun = _first_sunday()
    word, fail, _ = soak.verdict(facts(verdict_texts=_sundays({sun: "REVERT"})))
    assert word == "FAIL" and fail == [f"Sunday {sun} verdict is REVERT and no FOREIGN ruling names it"]


def test_a_REVERT_ruled_FOREIGN_in_writing_is_not_a_FAIL():
    sun = _first_sunday()
    ruled = f"# rulings\n\n- VERDICT {sun}: FOREIGN — a barspack 401, not the Notebook (owner)\n"
    word, fail, inc = soak.verdict(facts(verdict_texts=_sundays({sun: "REVERT"}), ruled_text=ruled))
    assert (word, fail, inc) == ("PASS", [], [])


def test_KEEP_with_no_independent_member_exposure_is_INCONCLUSIVE():
    sun = _first_sunday()
    keep0 = ("KEEP — no independent member exposure; 0 blocked-baseline events measured "
             "over 0 real members")
    word, fail, inc = soak.verdict(facts(verdict_texts=_sundays({sun: keep0})))
    assert word == "INCONCLUSIVE" and not fail
    assert inc == [f"Sunday {sun} is KEEP with no independent member exposure"]


def test_a_missing_Sunday_verdict_is_named():
    sun = _first_sunday()
    word, _, inc = soak.verdict(facts(verdict_texts=_sundays({sun: None})))
    assert word == "INCONCLUSIVE" and inc == [f"no Sunday verdict for {sun}"]


# ── loss, forks, drills ─────────────────────────────────────────────────────

@pytest.mark.parametrize("body,word", [
    ("# lost words\nopened: 2026-10-20\nclass: CONFIRMED LOSS\n", "FAIL"),
    ("# lost words?\nopened: 2026-10-20\nclass: UNRESOLVED\n", "FAIL"),
    ("# lost words?\nopened: 2026-10-20\n", "FAIL"),                  # untriaged = UNRESOLVED
    ("# found it\nopened: 2026-10-20\nclass: RECOVERED\n", "PASS"),
    ("# not ours\nopened: 2026-10-20\nclass: NOT LOSS\n", "PASS"),
])
def test_an_incident_is_judged_by_its_class(body, word):
    assert soak.verdict(facts(incident_texts=[("inc-1.md", body)]))[0] == word


def test_an_unattributed_fork_blocks_PASS_and_pages_until_ruled():
    t = START + dt.timedelta(days=6, hours=4)
    day = (t - dt.timedelta(seconds=1)).astimezone(soak.ET).date().isoformat()
    s = _samples(extra_at={t: {("conflicted_copies", "offline_layer", "organic"): 1}})
    f = facts(samples_text=s)
    word, _, inc = soak.verdict(f)
    assert word == "INCONCLUSIVE" and any(f"on {day} not attributed" in r for r in inc)
    assert any(k == f"integrity:fork:{day}" for k, _ in soak.alerts(f, word, "PASS"))
    ruled = f"- FORK {day}: ATTRIBUTED — the member had two tabs open\n"
    assert soak.verdict(facts(samples_text=s, ruled_text=ruled))[0] == "PASS"


def test_a_rise_in_the_rigs_sync_conflict_count_is_a_fork_too():
    t = START + dt.timedelta(days=8)
    f = facts(q1_text=_q1(conflicts={t: 4}))
    assert f["signals"]["fork_days"] == {t.astimezone(soak.ET).date().isoformat(): 1}


@pytest.mark.parametrize("skip,fail_,needle", [
    ((2,), (), "restore drill week 2: no drill report"),
    ((), (3,), "restore drill week 3: FAILED and no passing run"),
])
def test_every_week_needs_a_passing_restore_drill(skip, fail_, needle):
    word, _, inc = soak.verdict(facts(drill_texts=_drills(skip_weeks=skip, fail_weeks=fail_)))
    assert word == "INCONCLUSIVE" and inc == [needle]


def test_an_open_window_is_INCONCLUSIVE_and_says_how_long_is_left():
    word, _, inc = soak.verdict(facts(now=START + dt.timedelta(days=12)))
    assert word == "INCONCLUSIVE"
    assert any(r.startswith("window open:") for r in inc)


# ── paging (D-9C3) ──────────────────────────────────────────────────────────

def test_a_speed_figure_over_budget_is_reported_and_NEVER_paged():
    slow = {"note_open_ms": {"by_population": {"organic": {"n": 50, "p50_ms": 800.0, "p95_ms": 9999.0}}},
            "search_used": {"by_population": {"organic": {"n": 5, "p50_ms": 400.0, "p95_ms": 900.0}}}}
    f = facts(samples_text=_samples(speed=slow))
    rows = {r["event"]: r for r in f["speed"]["rows"]}
    assert rows["note_open_ms"]["over"] and rows["search_used"]["over"]
    word = soak.verdict(f)[0]
    assert word == "PASS"
    assert soak.alerts(f, word, "PASS") == []
    board = soak.render_dashboard(f, word, [], [], "desktop only")
    assert "over budget" in board and "never paged" in board


def test_integrity_and_heartbeat_signals_DO_page():
    t = START + dt.timedelta(days=2)
    f = facts(samples_text=_samples(extra_at={t: {("events", "notebook_blocked_no_baseline", "synthetic"):
                                                  {"events": 2}}}),
              heartbeat={"text": "Last Result 1", "problem": "scheduled task: Last Result 1"})
    keys = [k for k, _ in soak.alerts(f, "PASS", "PASS")]
    assert "integrity:blocked:synthetic" in keys and "heartbeat:scheduled-task" in keys


def test_a_trailing_heartbeat_gap_pages():
    rows = [ln for ln in _q1().splitlines()
            if not any(_stamp(t) in ln for t in _times() if t > NOW - dt.timedelta(hours=7))]
    f = facts(q1_text="\n".join(rows) + "\n")
    assert any(k.startswith("heartbeat:") for k, _ in soak.alerts(f, "INCONCLUSIVE", None))


def test_each_alert_goes_out_once_per_signal_per_day():
    items = [("drift:nb_gate.py", "DRIFT nb_gate.py")]
    first, state = soak.due(items, {}, "2026-10-12")
    again, state = soak.due(items, state, "2026-10-12")
    tomorrow, _ = soak.due(items, state, "2026-10-13")
    assert first == items and again == [] and tomorrow == items


def test_a_verdict_change_pages_once():
    f = facts()
    assert ("verdict:INCONCLUSIVE->PASS", "soak verdict changed INCONCLUSIVE -> PASS") in \
        soak.alerts(f, "PASS", "INCONCLUSIVE")
    assert soak.alerts(f, "PASS", "PASS") == []


# ── DRIFT ───────────────────────────────────────────────────────────────────

def test_DRIFT_fires_on_a_differing_hash_and_not_on_an_equal_one():
    diff = soak.drift_line("window_check.py", b"print(1)\n", b"print(2)\n")
    same = soak.drift_line("window_check.py", b"print(1)\n", b"print(1)\n")
    assert diff["state"] == "DRIFT" and same["state"] == "equal"
    assert diff["copy"] != diff["repo"] and same["copy"] == same["repo"]
    f = facts(drift=[diff])
    assert ("drift:window_check.py", f"DRIFT window_check.py: copy {diff['copy'][:12]} != repo "
            f"{diff['repo'][:12]}") in soak.alerts(f, "PASS", "PASS")
    assert soak.alerts(facts(drift=[same]), "PASS", "PASS") == []


def test_line_endings_alone_are_not_drift_but_both_raw_hashes_are_printed():
    eol = soak.drift_line("nb_gate.py", b"a\r\nb\r\n", b"a\nb\n")
    assert eol["state"] == "equal" and eol["copy"] != eol["repo"]


def test_a_missing_copy_is_named_not_counted_equal():
    assert soak.drift_line("nb_soak.py", None, b"x")["state"] == "not deployed"


# ── rendering ───────────────────────────────────────────────────────────────

def test_zero_over_zero_is_never_rendered_as_a_percentage():
    f = facts()
    word, fail, inc = soak.verdict(f)
    board = soak.render_dashboard(f, word, fail, inc, "desktop only")
    assert "synthetic 0/0" in board and "%" not in board


def test_the_dashboard_names_the_window_the_verdict_and_the_alert_mode():
    t = START + dt.timedelta(days=4, hours=6)
    f = facts(q1_text=_q1(skip={t}), start_sha=None)
    word, fail, inc = soak.verdict(f)
    board = soak.render_dashboard(f, word, fail, inc, "desktop only")
    assert f"VERDICT: **{word}**" in board and "alerts: desktop only" in board
    assert "production SHA at start: `NOT RECORDED`" in board
    assert f"SKIPPED row {soak.fmt(t)}" in board
    line = soak.stdout_line(f, word, fail, inc, 0)
    assert line.count("\n") == 0 and word in line


def test_the_parsers_read_what_the_real_instruments_write():
    """⭐ Non-vacuity: every reader returns something from a real-shaped input."""
    assert len(soak.parse_q1_rows(_q1())) == len(_times())
    s, bad = soak.parse_samples(_samples() + "not json\n")
    assert len(s) == len(_times()) and bad == 1
    assert soak.parse_verdict(_sundays()[0])["verdict"] == "KEEP"
    c = soak.parse_canary_doc(CANARY)
    assert c["rows"][0]["state"] == "green" and c["rows"][0]["outbox"] == 0
    assert soak.parse_drill(_drills()[0])["result"] == "PASS"


# ── the edges: main() on real files, and delivery ───────────────────────────

def _tree(tmp_path):
    (tmp_path / "verdicts").mkdir()
    for i, v in enumerate(_sundays()):
        (tmp_path / "verdicts" / f"gate-{i}.md").write_text(v, encoding="utf-8")
    (tmp_path / "drills").mkdir()
    for i, d in enumerate(_drills()):
        (tmp_path / "drills" / f"drill-{i}.md").write_text(d, encoding="utf-8")
    (tmp_path / "log.md").write_text(_q1(), encoding="utf-8")
    (tmp_path / "soak-samples.jsonl").write_text(_samples(), encoding="utf-8")
    (tmp_path / "canary.md").write_text(CANARY, encoding="utf-8")
    repo, copies = tmp_path / "repo", tmp_path / "copies"
    (repo / "tools").mkdir(parents=True)
    (repo / "docs" / "notebook").mkdir(parents=True)
    (repo / "docs" / "notebook" / "perf-budgets.json").write_text(json.dumps(BUDGETS), encoding="utf-8")
    copies.mkdir()
    for name in soak.COPIES:
        (repo / "tools" / name).write_bytes(b"same\n")
        (copies / name).write_bytes(b"same\r\n")
    (copies / "window_check.py").write_bytes(b"older\n")         # one real drift
    return ["--log", str(tmp_path / "log.md"), "--verdicts", str(tmp_path / "verdicts"),
            "--drills", str(tmp_path / "drills"), "--canary-doc", str(tmp_path / "canary.md"),
            "--repo", str(repo), "--copies", str(copies), "--start", _z(START),
            "--start-sha", "abc1234", "--no-schtasks"]


def test_main_writes_the_dashboard_beside_the_log_and_one_stdout_line(tmp_path, monkeypatch, capsys):
    args = _tree(tmp_path)
    assert soak.main(args + ["--no-alerts"], now=NOW) == 0
    board = (tmp_path / "soak-dashboard.md").read_text(encoding="utf-8")
    # DRIFT is a line and an alert, not a verdict condition: the soak's figures
    # are still true; what drifted is the instrument, and the owner is paged.
    assert "VERDICT: **PASS**" in board
    assert "**DRIFT** `window_check.py`" in board and "alerts: desktop only — SUPPRESSED" in board
    assert "equal `nb_gate.py`" in board                  # CRLF copy vs LF repo: not drift
    out = capsys.readouterr().out.strip().splitlines()
    assert len(out) == 1 and "drift 1" in out[0]
    assert not (tmp_path / "soak-alert-state.json").exists()


def test_main_dry_run_writes_nothing(tmp_path, monkeypatch, capsys):
    args = _tree(tmp_path)
    assert soak.main(args + ["--dry-run"], now=NOW) == 0
    assert not (tmp_path / "soak-dashboard.md").exists()
    assert "VERDICT:" in capsys.readouterr().out


@pytest.mark.parametrize("drop", ["--log", "--start"])
def test_main_refuses_without_a_log_or_a_start(tmp_path, monkeypatch, drop):
    monkeypatch.delenv("NB_OBSERVE_LOG", raising=False)
    monkeypatch.delenv("NB_SOAK_START", raising=False)
    args = _tree(tmp_path)
    i = args.index(drop)
    assert soak.main(args[:i] + args[i + 2:], now=NOW) == 2


def test_main_records_what_it_sent_and_sends_it_once(tmp_path, monkeypatch):
    sent = []
    monkeypatch.setattr(soak, "send", lambda items, webhook, **_: sent.append(list(items)) or len(items))
    monkeypatch.delenv(soak.WEBHOOK_ENV, raising=False)
    args = _tree(tmp_path)
    assert soak.main(args, now=NOW) == 0 and soak.main(args, now=NOW) == 0
    assert [k for k, _ in sent[0]] == ["drift:window_check.py"] and sent[1] == []
    state = json.loads((tmp_path / "soak-alert-state.json").read_text(encoding="utf-8"))
    assert state["last_verdict"] == "INCONCLUSIVE" or state["last_verdict"] == "PASS"


def test_a_failed_send_is_not_recorded_as_sent(tmp_path, monkeypatch):

    def boom(*_a, **_k):
        raise OSError("webhook down")
    monkeypatch.setattr(soak, "send", boom)
    assert soak.main(_tree(tmp_path), now=NOW) == 1
    assert not (tmp_path / "soak-alert-state.json").exists()


def test_send_uses_the_webhook_when_set_and_the_desktop_when_blank():
    posted, noted = [], []
    items = [("drift:x", "DRIFT x")]
    soak.send(items, "https://discord.example/webhook", post=lambda u, p: posted.append((u, p)))
    soak.send(items, "", notify=lambda t, b: noted.append((t, b)))
    assert posted and posted[0][1]["content"].endswith("- DRIFT x")
    assert noted == [("UCT Notebook soak", "- DRIFT x")]
    assert soak.send([], "", notify=lambda *_: noted.append("never")) == 0 and "never" not in noted


# ── the weekly verdict archive ───────────────────────────────────────────────

def test_the_gates_overwritten_verdict_is_archived_once_by_its_own_date(tmp_path):
    cur, into = tmp_path / "wave-q1-gate-verdict.md", tmp_path / "verdicts"
    cur.write_text(_sundays()[0], encoding="utf-8")
    first = soak.archive_verdict(cur, into)
    again = soak.archive_verdict(cur, into)
    assert first == again and first.name.startswith("soak-gate-verdict-2026-10-11")
    assert [p.name for p in into.iterdir()] == [first.name]
    # a RE-RUN the same day with a different answer is kept beside, never over
    cur.write_text(_sundays({_first_sunday(): "REVERT"})[0], encoding="utf-8")
    second = soak.archive_verdict(cur, into)
    assert second != first and first.read_text(encoding="utf-8").count("KEEP") == 1
    assert len(list(into.iterdir())) == 2


def test_two_files_for_one_sunday_count_once_the_latest(tmp_path):
    sun = _first_sunday()
    early = f"VERDICT: **REVERT**\nat:        {sun} 18:05 ET\n"
    late = f"VERDICT: **KEEP**\nat:        {sun} 18:40 ET\n"
    rest = _sundays()[1:]
    f = facts(verdict_texts=[early, late] + rest)
    assert soak.verdict(f)[0] == "PASS"
    assert [v["day"] for v in f["sundays"]["verdicts"]].count(sun) == 1


def test_main_archives_the_current_verdict_named_by_NB_GATE_VERDICT(tmp_path):
    args = _tree(tmp_path)
    cur = tmp_path / "wave-q1-gate-verdict.md"
    cur.write_text(_sundays()[-1], encoding="utf-8")
    assert soak.main(args + ["--no-alerts", "--verdict-current", str(cur)], now=NOW) == 0
    assert any(p.name.startswith("soak-gate-verdict-") for p in (tmp_path / "verdicts").iterdir())

