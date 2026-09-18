"""R63(d) — tools/r63d_verify_boot_window_stalls.py.

⛔ This cannot produce a real production verdict yet (needs >=10 real pod boots). Every test
here drives the PURE logic against synthetic fixtures, proving the acceptance rule itself is
correct so the tool is trustworthy the moment real data exists.
"""
import json

from tools import r63d_verify_boot_window_stalls as r63d


def _stall(ms=3000.0, uptime_s=10.0, pid=1, at="2026-09-18T00:00:00Z", tier=1):
    return {"at": at, "ms": ms, "uptime_s": uptime_s, "tier": tier, "paged": True,
           "commit": "abc", "pid": pid}


def _call(name, start, end):
    return {"name": name, "at_start": start, "at_end": end, "duration_ms": 1.0,
           "thread": "t", "is_loop_thread": True, "ok": True}


# ────────────────────────────────────────────────────────────────── loading

def test_load_jsonl_on_a_missing_file_returns_empty_not_an_error(tmp_path):
    assert r63d.load_jsonl(str(tmp_path / "nope.jsonl")) == []


def test_load_jsonl_reads_real_lines(tmp_path):
    p = tmp_path / "r.jsonl"
    p.write_text(json.dumps({"a": 1}) + "\n" + json.dumps({"a": 2}) + "\n", encoding="utf-8")
    assert r63d.load_jsonl(str(p)) == [{"a": 1}, {"a": 2}]


# ───────────────────────────────────────────────────────── boot_window_stalls

def test_stalls_below_the_ms_threshold_are_excluded():
    stalls = [_stall(ms=2999.9), _stall(ms=3000.0)]
    out = r63d.boot_window_stalls(stalls, boot_window_s=120.0)
    assert len(out) == 1 and out[0]["ms"] == 3000.0


def test_a_settled_pod_stall_still_qualifies_not_only_boot_window():
    """⭐ The acceptance criterion says 'boot-window AND settled-pod', not boot-window alone —
    R63(a)'s own findings named a stall at uptime 670-893s, well past any boot window."""
    stalls = [_stall(ms=5000.0, uptime_s=800.0)]
    out = r63d.boot_window_stalls(stalls, boot_window_s=120.0)
    assert len(out) == 1


# ──────────────────────────────────────────────────────────────────── verify()

def test_zero_qualifying_stalls_is_an_unconditional_pass():
    result = r63d.verify(stalls=[_stall(ms=100.0)], joined_stalls=[], min_pods=10)
    assert result["pass"] is True
    assert result["total_qualifying_stalls"] == 0


def test_every_qualifying_stall_joined_to_a_cold_call_passes():
    joined = [{**_stall(), "joined_calls": [_call("flow_source", "2026-09-18T00:00:00Z",
                                                  "2026-09-18T00:00:01Z")]}]
    result = r63d.verify(stalls=[_stall()], joined_stalls=joined, min_pods=10)
    assert result["pass"] is True
    assert result["explained_by_a_cold_path"] == 1
    assert result["unexplained_count"] == 0


def test_a_single_unexplained_stall_fails_the_whole_check():
    """⛔⛔ THE ONE THAT MATTERS. The acceptance rule is 'every one', not 'mostly' — one
    unjoined boot-window/settled-pod stall among ninety-nine explained ones is still a FAIL."""
    joined = [{**_stall(pid=1), "joined_calls": [_call("x", "2026-09-18T00:00:00Z",
                                                       "2026-09-18T00:00:01Z")]}
              for _ in range(99)]
    joined.append({**_stall(pid=2), "joined_calls": []})
    result = r63d.verify(stalls=[_stall()] * 100, joined_stalls=joined, min_pods=10)
    assert result["pass"] is False
    assert result["unexplained_count"] == 1


def test_unexplained_stalls_are_NAMED_not_just_counted():
    """⛔ 'each be joined to a named non-cold cause' means the acceptance report must show WHICH
    stall, not just how many — a count alone gives nobody anywhere to look."""
    s = _stall(at="2026-09-18T03:14:15Z", uptime_s=42.0)
    result = r63d.verify(stalls=[s], joined_stalls=[{**s, "joined_calls": []}], min_pods=10)
    assert result["unexplained"] == [{**s, "joined_calls": []}]


# ───────────────────────────────────────────────────────────── pod counting

def test_pods_are_counted_by_DISTINCT_pid_not_by_stall_count():
    stalls = [_stall(pid=1), _stall(pid=1), _stall(pid=2)]
    result = r63d.verify(stalls=stalls, joined_stalls=[], min_pods=10)
    assert result["pods_observed"] == 2


def test_enough_pods_is_false_below_the_minimum_true_at_or_above():
    below = r63d.verify(stalls=[_stall(pid=i) for i in range(5)], joined_stalls=[], min_pods=10)
    at = r63d.verify(stalls=[_stall(pid=i) for i in range(10)], joined_stalls=[], min_pods=10)
    assert below["enough_pods"] is False
    assert at["enough_pods"] is True


def test_a_pass_with_not_enough_pods_is_still_reported_as_provisional_in_main(
        tmp_path, monkeypatch, capsys):
    """⛔ A PASS is not the same claim before and after min_pods — this must be visible in the
    rendered report, not just in a field nobody reads."""
    stall_path = tmp_path / "stall-record.jsonl"
    stall_path.write_text("", encoding="utf-8")
    cold_path = tmp_path / "cold-path-calls.jsonl"
    cold_path.write_text("", encoding="utf-8")
    rc = r63d.main(["--stall-record", str(stall_path), "--cold-path-record", str(cold_path)])
    out = capsys.readouterr().out
    assert rc == 0
    assert "PASS" in out
    assert "NOT YET ENOUGH" in out or "provisional" in out.lower()


# ───────────────────────────────────────────────────────────────── main() exit code

def test_main_exits_1_on_an_unexplained_stall(tmp_path):
    stall_path = tmp_path / "stall-record.jsonl"
    stall_path.write_text(json.dumps(_stall(ms=5000.0)) + "\n", encoding="utf-8")
    cold_path = tmp_path / "cold-path-calls.jsonl"
    cold_path.write_text("", encoding="utf-8")     # no cold-path calls at all -> unjoined
    rc = r63d.main(["--stall-record", str(stall_path), "--cold-path-record", str(cold_path)])
    assert rc == 1


def test_main_exits_0_when_nothing_qualifies(tmp_path):
    stall_path = tmp_path / "stall-record.jsonl"
    stall_path.write_text(json.dumps(_stall(ms=10.0)) + "\n", encoding="utf-8")
    cold_path = tmp_path / "cold-path-calls.jsonl"
    cold_path.write_text("", encoding="utf-8")
    rc = r63d.main(["--stall-record", str(stall_path), "--cold-path-record", str(cold_path)])
    assert rc == 0
