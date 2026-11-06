"""The hosted queue checks cannot pass without proof, and cannot touch promotion. No network: the API is a fake."""
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


def runner(status="online", labels=("self-hosted", "uct-vps"), name="r1", busy=False):
    return {"name": name, "status": status, "busy": busy, "labels": [{"name": n} for n in labels]}


# ---- online: one shot

def test_an_online_labelled_runner_passes():
    assert qw.check_online(repo="o/r", label="uct-vps", token="t", get=lambda u, t: {"runners": [runner()]}) == ["r1"]


def test_a_busy_runner_still_counts_as_online():
    doc = {"runners": [runner(busy=True)]}
    assert qw.check_online(repo="o/r", label="uct-vps", token="t", get=lambda u, t: doc) == ["r1"]


def test_it_asks_exactly_once_and_never_waits():
    calls = []

    def get(url, token):
        calls.append(url)
        return {"runners": []}

    with pytest.raises(qw.Unproved):
        qw.check_online(repo="o/r", label="uct-vps", token="t", get=get)
    assert len(calls) == 1


@pytest.mark.parametrize("label,doc", [
    ("no runners", {"runners": []}),
    ("offline", {"runners": [runner(status="offline")]}),
    ("another machine's label", {"runners": [runner(labels=("self-hosted", "uct-pc"))]}),
    ("self-hosted without the label", {"runners": [runner(labels=("self-hosted",))]}),
    ("a malformed answer", {"message": "Not Found"}),
])
def test_anything_else_is_not_proved(label, doc):
    with pytest.raises(qw.Unproved):
        qw.check_online(repo="o/r", label="uct-vps", token="t", get=lambda u, t: doc)


def test_a_missing_token_is_not_proved():
    with pytest.raises(qw.Unproved, match="CI_RUNNER_READ_TOKEN"):
        qw.check_online(repo="o/r", label="uct-vps", token="", get=lambda u, t: {"runners": [runner()]})


def test_an_api_error_is_exit_1_never_a_pass(monkeypatch, capsys):
    def boom(url, token):
        raise urllib.error.URLError("denied")

    monkeypatch.setattr(qw, "fetch", boom)
    monkeypatch.setattr(qw.check_online, "__kwdefaults__", {"get": boom})
    monkeypatch.setenv("CI_RUNNER_READ_TOKEN", "t")
    assert qw.main(["online", "--label", "uct-vps", "--repo", "o/r"]) == 1
    assert "::error" in capsys.readouterr().out


def test_the_cli_returns_1_without_a_token(monkeypatch, capsys):
    monkeypatch.delenv("CI_RUNNER_READ_TOKEN", raising=False)
    monkeypatch.delenv("GH_TOKEN", raising=False)
    assert qw.main(["online", "--label", "uct-vps", "--repo", "o/r"]) == 1
    assert qw.main(["watch", "--labels", "uct-vps", "--repo", "o/r"]) == 1
    assert "::error" in capsys.readouterr().out


# ---- watch: finds stuck jobs, cancels only the gate

def job(status="queued", labels=("uct-vps",), created="2026-11-06T11:00:00Z", name="shard"):
    return {"name": name, "status": status, "labels": list(labels), "created_at": created}


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
    return qw.watch(repo="o/r", labels={"uct-vps"}, minutes=minutes, cancel=set(cancel), token="t", get=get, send=send,
                    now=NOW), sent


def test_a_stuck_gate_is_reported_and_cancelled():
    out, sent = go([run()], {1: [job()]})
    assert len(out["stale"]) == 1 and out["cancelled"] == [1]
    assert sent == ["https://api.github.com/repos/o/r/actions/runs/1/cancel"]


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
