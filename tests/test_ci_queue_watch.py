"""The hosted queue watch cannot pass without proof, cannot touch promotion, and cannot cancel a healthy gate. No network."""
from __future__ import annotations

import datetime as dt
import pathlib
import sys
import urllib.error

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "tools"))
import ci_queue_watch as qw  # noqa: E402

NOW = dt.datetime(2026, 11, 6, 12, 0, tzinfo=dt.timezone.utc)
GATE = "master deploy gate"


def test_the_cli_returns_1_without_a_token(monkeypatch, capsys):
    monkeypatch.delenv("GH_TOKEN", raising=False)
    assert qw.main(["watch", "--labels", "uct-vps", "--repo", "o/r"]) == 1
    assert "::error" in capsys.readouterr().out


def test_it_has_no_way_to_read_runners():
    """AUDIT Q2: a token that can read runners needs admin on the repo, so this tool must never want one."""
    text = (pathlib.Path(qw.__file__)).read_text(encoding="utf-8")
    assert "actions/runners" not in text and "CI_RUNNER_READ_TOKEN" not in text


# ---- watch: finds stuck jobs, cancels only the gate

def job(status="queued", labels=("uct-vps",), created="2026-11-06T11:00:00Z", name="shard", **stamps):
    return {"name": name, "status": status, "labels": list(labels), "created_at": created, **stamps}


def world(runs, jobs):
    sent = []

    def get(url, token):
        if "/jobs" in url:
            return {"jobs": jobs[int(url.split("/runs/")[1].split("/")[0])]}
        return {"workflow_runs": runs if "status=queued" in url else []}

    def send(url, token):
        sent.append(url)
        return {}

    return get, send, sent


def run(rid=1, name=GATE):
    return {"id": rid, "name": name, "created_at": "2026-11-06T11:00:00Z"}


def go(runs, jobs, cancel=(GATE,), minutes=45):
    get, send, sent = world(runs, jobs)
    return qw.watch(repo="o/r", labels={"uct-vps", "uct-vps-gate"}, minutes=minutes, cancel=set(cancel), token="t", get=get, send=send,
                    now=NOW), sent


def test_a_stuck_gate_is_reported_and_cancelled():
    out, sent = go([run()], {1: [job()]})
    assert len(out["stale"]) == 1 and out["cancelled"] == [1]
    assert sent == ["https://api.github.com/repos/o/r/actions/runs/1/cancel"]


# ---- AUDIT B3: a healthy gate can never be cancelled, however long it waits

def test_a_gate_job_waiting_behind_its_own_running_jobs_is_not_stuck():
    gate = ("uct-vps-gate",)
    out, sent = go([run()], {1: [job(labels=gate, name="union", created="2026-11-06T10:00:00Z"),
                                 job(status="in_progress", labels=gate, created="2026-11-06T10:00:00Z")]})
    assert out["stale"] == [] and sent == []


def test_a_job_waiting_behind_another_runs_work_on_the_same_label_is_not_stuck():
    out, sent = go([run(1), run(2, name="agent ci")],
                   {1: [job(created="2026-11-06T10:00:00Z")], 2: [job(status="in_progress", created="2026-11-06T10:00:00Z")]})
    assert out["stale"] == [] and sent == []


def test_a_label_that_moved_recently_is_healthy_even_with_nothing_running_this_instant():
    """Between two jobs nothing is in_progress for a moment. The clock runs from the last move, not from the queue time."""
    done = job(status="completed", started_at="2026-11-06T10:00:00Z", completed_at="2026-11-06T11:50:00Z")
    out, sent = go([run()], {1: [job(created="2026-11-06T10:00:00Z"), done]})
    assert out["stale"] == [] and sent == []


def test_a_busy_shared_lane_never_counts_for_the_gate_lane():
    """The labels are separate clocks: dispatch work on uct-vps says nothing about the gate's slots."""
    out, sent = go([run(1), run(2, name="agent ci")],
                   {1: [job(labels=("uct-vps-gate",))], 2: [job(status="in_progress", labels=("uct-vps",))]})
    assert len(out["stale"]) == 1 and out["cancelled"] == [1]


def test_a_label_silent_past_the_limit_is_stuck_even_if_it_moved_earlier():
    done = job(status="completed", started_at="2026-11-06T09:00:00Z", completed_at="2026-11-06T10:00:00Z")
    out, sent = go([run()], {1: [job(created="2026-11-06T10:00:00Z"), done]})
    assert len(out["stale"]) == 1 and sent


def test_offline_is_obvious_in_the_output(monkeypatch, capsys):
    get, send, sent = world([run()], {1: [job()]})
    real_watch = qw.watch
    monkeypatch.setattr(qw, "watch", lambda **kw: real_watch(**{**kw, "get": get, "send": send, "now": NOW}))
    monkeypatch.setenv("GH_TOKEN", "t")
    assert qw.main(["watch", "--labels", "uct-vps", "--repo", "o/r", "--cancel-workflow", GATE]) == 1
    out = capsys.readouterr().out
    assert "RUNNER LOOKS OFFLINE" in out and "run cancelled" in out


def test_several_stuck_jobs_cancel_one_run_once():
    out, sent = go([run()], {1: [job(name="a"), job(name="b")]})
    assert len(out["stale"]) == 2 and len(sent) == 1


@pytest.mark.parametrize("j", [job(created="2026-11-06T11:50:00Z"), job(status="in_progress"), job(status="completed"),
                               job(labels=("ubuntu-latest",))])
def test_healthy_jobs_are_left_alone(j):
    out, sent = go([run()], {1: [j]})
    assert out["stale"] == [] and sent == []


def test_a_stuck_job_outside_the_cancel_list_alerts_but_is_not_cancelled():
    out, sent = go([run(name="agent ci")], {1: [job()]})
    assert len(out["stale"]) == 1 and sent == []


def test_promotion_is_never_cancelled_even_if_asked():
    with pytest.raises(qw.Unproved, match="never touches promotion"):
        go([run(name="promote to production")], {1: [job()]}, cancel=("promote to production",))


def test_a_stuck_promotion_job_is_reported_and_left_alone():
    out, sent = go([run(name="promote to production")], {1: [job()]})
    assert len(out["stale"]) == 1 and sent == []


def test_a_run_waiting_on_the_concurrency_queue_is_not_a_stuck_runner():
    """A pending gate behind a running one has no job on the label yet. Cancelling it would drop a commit."""
    out, sent = go([run()], {1: []})
    assert out["stale"] == [] and sent == []


def test_an_unreadable_runs_answer_is_not_a_clear_queue():
    with pytest.raises(qw.Unproved):
        qw.watch(repo="o/r", labels={"uct-vps"}, minutes=45, cancel=set(), token="t", get=lambda u, t: {"message": "x"},
                 send=None, now=NOW)
