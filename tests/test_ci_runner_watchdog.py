"""The hosted runner watchdog cannot pass without proof. No network: the API is a fake."""
from __future__ import annotations

import datetime as dt
import pathlib
import sys
import urllib.error

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "tools"))
import ci_runner_watchdog as wd  # noqa: E402

NOW = dt.datetime(2026, 11, 6, 12, 0, tzinfo=dt.timezone.utc)


def runner(status="online", labels=("self-hosted", "uct-vps"), name="r1", busy=False):
    return {"name": name, "status": status, "busy": busy, "labels": [{"name": n} for n in labels]}


class Clock:
    def __init__(self):
        self.t = 0.0

    def __call__(self):
        return self.t

    def sleep(self, s):
        self.t += s


def wait(responses, minutes=1, token="t"):
    clock, seq = Clock(), list(responses)

    def get(url, tok):
        item = seq.pop(0) if len(seq) > 1 else seq[0]
        if isinstance(item, Exception):
            raise item
        return item

    return wd.wait_for_runner(repo="o/r", label="uct-vps", minutes=minutes, token=token, get=get,
                              sleep=clock.sleep, clock=clock)


def test_an_online_labelled_runner_passes():
    assert wait([{"runners": [runner()]}]) == ["r1"]


def test_a_busy_runner_still_counts_as_online():
    assert wait([{"runners": [runner(busy=True)]}]) == ["r1"]


def test_a_runner_that_comes_up_late_passes():
    assert wait([{"runners": []}, {"runners": []}, {"runners": [runner()]}]) == ["r1"]


@pytest.mark.parametrize("label,doc", [
    ("no runners", {"runners": []}),
    ("offline", {"runners": [runner(status="offline")]}),
    ("the PC only: a label the gate must not accept", {"runners": [runner(labels=("self-hosted", "uct-pc"))]}),
    ("self-hosted without the label", {"runners": [runner(labels=("self-hosted",))]}),
    ("a malformed answer", {"message": "Not Found"}),
])
def test_anything_else_fails_at_the_deadline(label, doc):
    with pytest.raises(wd.Unproved):
        wait([doc])


def test_a_missing_token_fails_at_once():
    with pytest.raises(wd.Unproved, match="CI_RUNNER_READ_TOKEN"):
        wait([{"runners": [runner()]}], token="")


def test_a_permanent_api_error_fails_and_names_itself():
    with pytest.raises(wd.Unproved, match="URLError"):
        wait([urllib.error.URLError("denied")])


def test_a_transient_api_error_recovers():
    assert wait([urllib.error.URLError("blip"), {"runners": [runner()]}]) == ["r1"]


def test_the_failure_says_what_to_do_about_it():
    with pytest.raises(wd.Unproved, match="uct-vps came online within 1 minutes"):
        wait([{"runners": []}])


# ---- queue mode

def job(status="queued", labels=("uct-vps",), created="2026-11-06T11:00:00Z", name="shard"):
    return {"name": name, "status": status, "labels": list(labels), "created_at": created}


def stale(jobs, minutes=30):
    runs = [{"id": 1, "created_at": "2026-11-06T11:00:00Z"}]
    return wd.stale_jobs(runs, lambda _: jobs, {"uct-vps", "uct-pc"}, minutes, NOW)


def test_a_job_queued_too_long_is_reported():
    assert stale([job()]) == [("shard", 1, 60)]


@pytest.mark.parametrize("j", [job(created="2026-11-06T11:50:00Z"), job(status="in_progress"), job(status="completed"),
                               job(labels=("ubuntu-latest",))])
def test_healthy_jobs_are_not_reported(j):
    assert stale([j]) == []


def test_an_unreadable_runs_answer_is_not_a_clear_queue():
    with pytest.raises(wd.Unproved):
        wd.queue_check(repo="o/r", labels={"uct-vps"}, minutes=30, token="t", get=lambda u, t: {"message": "x"}, now=NOW)


def test_the_cli_returns_1_rather_than_passing_without_a_token(monkeypatch, capsys):
    monkeypatch.delenv("CI_RUNNER_READ_TOKEN", raising=False)
    assert wd.main(["gate", "--label", "uct-vps", "--minutes", "0", "--repo", "o/r"]) == 1
    monkeypatch.delenv("GH_TOKEN", raising=False)
    assert wd.main(["queue", "--labels", "uct-vps", "--repo", "o/r"]) == 1
    assert "::error" in capsys.readouterr().out
