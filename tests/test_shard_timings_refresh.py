"""Weekly refreshed shard timings (2026-11-16): .github/workflows/shard-timings-refresh.yml PRODUCES them, the
Agent browser shards in agent-ci.yml and master-deploy-gate.yml CONSUME them.

The invariant that matters: every shard of ONE run must plan from the SAME timing file, or the shards stop being a
partition and the union rail goes red (on master that blocks every deploy). It holds because:
  - the producer only ever writes the key of a FUTURE week (today + 7 days), and cache entries are immutable;
  - each shard derives the key from its COMMIT's date (UTC), identical for every shard of the run, and restores it
    by EXACT key with no fallback keys, so either all shards hit the same entry or all miss;
  - on a miss every shard uses the committed tools/agent_vitest_shard_timings.json.
"""
from __future__ import annotations

import pathlib
import re

import yaml

ROOT = pathlib.Path(__file__).resolve().parents[1]
WFD = ROOT / ".github" / "workflows"
PRODUCER = WFD / "shard-timings-refresh.yml"
CONSUMERS = {"agent-ci.yml": ("browser", "vitest shard"),
             "master-deploy-gate.yml": ("agent-browser", "UCT Agent browser tests")}
KEY_PREFIX = "agent-shard-timings-"
CACHE_PATH = ".shard-timings/agent_vitest_shard_timings.json"


def _doc(p: pathlib.Path) -> dict:
    return yaml.safe_load(p.read_text(encoding="utf-8"))


def _on(doc: dict) -> dict:
    return doc.get("on", doc.get(True))


# ---- the producer ---------------------------------------------------------------------------------------------------
def test_producer_runs_only_on_schedule_or_by_hand_and_is_no_gate():
    doc = _doc(PRODUCER)
    assert set(_on(doc)) == {"schedule", "workflow_dispatch"}
    assert PRODUCER.read_text(encoding="utf-8").splitlines()[0].startswith("# promotion-gate: no")
    assert doc["permissions"] == {"contents": "read", "actions": "read"}


def test_producer_writes_only_a_future_week():
    steps = _doc(PRODUCER)["jobs"]["refresh"]["steps"]
    key_step = [s for s in steps if s.get("id") == "key"][0]["run"]
    assert f"key={KEY_PREFIX}$(date -u -d '+7 days' +%G-W%V)" in key_step, key_step
    save = [s for s in steps if "actions/cache/save" in (s.get("uses") or "")]
    assert len(save) == 1 and save[0]["with"]["key"] == "${{ steps.key.outputs.key }}"
    assert save[0]["with"]["path"] == CACHE_PATH
    assert not [s for s in steps if "actions/cache@" in (s.get("uses") or "")], "a combined cache action also restores"


def test_producer_refuses_a_thin_result():
    run = " ".join(s.get("run") or "" for s in _doc(PRODUCER)["jobs"]["refresh"]["steps"])
    assert 'test "$files" -ge 30' in run and 'test "$n" -gt 0' in run


# ---- the consumers --------------------------------------------------------------------------------------------------
def _consumer(name):
    job, step = CONSUMERS[name]
    steps = _doc(WFD / name)["jobs"][job]["steps"]
    names = [s.get("name") for s in steps]
    return steps, names, names.index(step)


def test_each_shard_restores_its_commits_week_by_exact_key():
    for name in CONSUMERS:
        steps, names, i_run = _consumer(name)
        week = [s for s in steps if s.get("id") == "tweek"]
        assert len(week) == 1, name
        assert "TZ=UTC git log -1 --format=%cd --date=format-local:%G-W%V" in week[0]["run"], name
        restore = [s for s in steps if "actions/cache/restore" in (s.get("uses") or "")]
        assert len(restore) == 1, name
        w = restore[0]["with"]
        assert w["key"] == KEY_PREFIX + "${{ steps.tweek.outputs.week }}", name
        assert w["path"] == CACHE_PATH, name
        assert "restore-keys" not in w, f"{name}: a fallback key lets two shards read two different files"
        assert names.index(restore[0]["name"]) < i_run and steps.index(week[0]) < steps.index(restore[0]), name
        assert not [s for s in steps if re.search(r"actions/cache@|actions/cache/save", s.get("uses") or "")], name


def test_each_shard_plans_and_slices_with_the_same_timing_file():
    for name in CONSUMERS:
        steps, _, i_run = _consumer(name)
        run = steps[i_run]["run"]
        assert ("T=../tools/agent_vitest_shard_timings.json; [ -s ../" + CACHE_PATH + " ] && T=../" + CACHE_PATH) in run, name
        calls = re.findall(r"agent_vitest_shards\.py[^\n]*", run)
        assert len(calls) == 2 and all('--timings "$T"' in c for c in calls), (name, calls)


def test_producer_and_consumers_agree_on_the_key_and_path():
    text = PRODUCER.read_text(encoding="utf-8")
    assert KEY_PREFIX in text and CACHE_PATH in text
    for name in CONSUMERS:
        t = (WFD / name).read_text(encoding="utf-8")
        assert t.count(KEY_PREFIX) == 1 and CACHE_PATH in t, name
