"""`tools/reliability_scoreboard.py`: a day of the site's reliability from Cloudflare's counts.

No Cloudflare here. These pin how rows become the report (what a gap is, what success means,
which minutes are slow), the exact request it sends, and that it says "could not measure"
instead of printing a report it has no data for. The request text itself was run against the
live API on 2026-11-14 (five answers, no errors).

Mutation proof (run before calling these done):
    1. `gaps` joins only the very same minute            -> test_adjacent_bad_minutes_are_one_gap RED
    2. `gaps` ignores its threshold                      -> test_a_few_errors_in_a_minute_is_not_a_gap RED
    3. success is computed from gateway errors only      -> test_success_counts_every_server_error RED
    4. `main` prints a report with no token              -> test_without_a_token_it_says_so_and_exits_2 RED
    5. the history line carries the long lists           -> test_a_run_appends_one_compact_line_to_the_history RED
    6. `fetch` treats an `errors` answer as data         -> test_cloudflare_refusals_are_could_not_measure RED
"""
from __future__ import annotations

import datetime as dt
import io
import json
import urllib.error

import pytest

from tools import reliability_scoreboard as rs

T0 = dt.datetime(2026, 11, 13, 15, 0, tzinfo=dt.timezone.utc)


def row(minute: int, count: int, p95: float | None = None, p50: float | None = None) -> dict:
    stamp = (T0 + dt.timedelta(minutes=minute)).strftime("%Y-%m-%dT%H:%M:%SZ")
    r = {"count": count, "dimensions": {"datetimeMinute": stamp}}
    if p95 is not None:
        r["quantiles"] = {"originResponseDurationMsP95": p95, "originResponseDurationMsP50": p50 if p50 is not None else p95 / 4}
    return r


def hour(index: int, count: int, p50: float, p95: float) -> dict:
    stamp = (T0 + dt.timedelta(hours=index)).strftime("%Y-%m-%dT%H:00:00Z")
    return {"count": count, "dimensions": {"datetimeHour": stamp},
            "quantiles": {"originResponseDurationMsP50": p50, "originResponseDurationMsP95": p95}}


def day() -> dict:
    """Two hours: a two-minute gap, a lone bad minute, three stray errors, twenty slow minutes."""
    return {
        "all": [row(m, 500) for m in range(120)],
        "errors": [row(10, 60), row(11, 45), row(50, 3), row(70, 30), row(90, 12)],     # 90: plain 500s, no gateway error
        "gateway": [row(10, 60), row(11, 40), row(50, 3), row(70, 30)],
        "slow": [row(m, 400, 1500 if m < 20 else 300) for m in range(120)],
        "hourly": [hour(0, 24000, 350, 1400), hour(1, 24000, 80, 310)],
    }


SINCE, UNTIL = "2026-11-13T15:00:00Z", "2026-11-13T17:00:00Z"


# ── gaps ──────────────────────────────────────────────────────────────────────

def test_adjacent_bad_minutes_are_one_gap():
    found = rs.gaps([row(10, 60), row(11, 40), row(12, 9), row(30, 20)])
    assert [(g["start"], g["minutes"], g["errors"]) for g in found] == [("2026-11-13 15:10", 3, 109), ("2026-11-13 15:30", 1, 20)]


def test_a_few_errors_in_a_minute_is_not_a_gap():
    assert rs.gaps([row(5, 4), row(6, 1)]) == []
    assert len(rs.gaps([row(5, 5)])) == 1
    assert rs.gaps([row(5, 4), row(6, 9), row(7, 4)])[0]["minutes"] == 1, "a quiet minute beside a gap does not extend it"


def test_rows_out_of_order_and_empty_input():
    assert rs.gaps([]) == []
    assert [g["minutes"] for g in rs.gaps([row(31, 9), row(10, 9), row(30, 9)])] == [1, 2]


# ── the summary ───────────────────────────────────────────────────────────────

def test_success_counts_every_server_error():
    s = rs.summarize(day(), SINCE, UNTIL)
    assert s["requests"] == 60000 and s["server_errors"] == 150 and s["gateway_errors"] == 133
    assert s["success_pct"] == round(100 * (1 - 150 / 60000), 3) == 99.75


def test_gaps_are_summarised():
    s = rs.summarize(day(), SINCE, UNTIL)
    assert (s["gaps"], s["gap_minutes"], s["longest_gap_minutes"]) == (2, 3, 2)
    assert s["gateway_errors_inside_gaps_pct"] == 97.7          # 130 of 133


def test_slow_minutes_are_counted_per_hour():
    s = rs.summarize(day(), SINCE, UNTIL)
    assert s["minutes_over_1s"] == 20
    assert [(h["hour"], h["minutes_over_1s"], h["p95_ms"]) for h in s["hours"]] == [("2026-11-13 15:00", 20, 1400), ("2026-11-13 16:00", 0, 310)]
    assert s["worst_hour"]["hour"] == "2026-11-13 15:00"


def test_a_minute_at_exactly_one_second_is_not_slow():
    data = day()
    data["slow"] = [row(0, 10, 1000), row(1, 10, 1000.5)]
    assert rs.summarize(data, SINCE, UNTIL)["minutes_over_1s"] == 1


def test_a_window_with_no_requests():
    s = rs.summarize({}, SINCE, UNTIL)
    assert s["requests"] == 0 and s["success_pct"] is None and s["gaps"] == 0 and s["worst_hour"] is None
    assert "no requests" in rs.render(s)


def test_the_report_names_the_gaps_and_the_slow_hours():
    text = rs.render(rs.summarize(day(), SINCE, UNTIL))
    assert "99.75%" in text and "60,000" in text
    assert "2026-11-13 15:10   2  100" in text and "2026-11-13 16:10   1  30" in text
    assert "2026-11-13 15:00  20  1,400" in text
    assert "16:00  " not in text.split("hours with 10 or more")[1], "an hour with no slow minutes is not listed as slow"


# ── the request ───────────────────────────────────────────────────────────────

def test_the_window_is_whole_hours_ending_at_the_last_full_hour():
    now = dt.datetime(2026, 11, 14, 10, 37, 12, tzinfo=dt.timezone.utc)
    assert rs.window(24, now) == ("2026-11-13T10:00:00Z", "2026-11-14T10:00:00Z")
    assert rs.window(6, now) == ("2026-11-14T04:00:00Z", "2026-11-14T10:00:00Z")


def test_the_query_asks_for_the_five_answers_in_the_window():
    q = rs.build_query("zone-id", SINCE, UNTIL)
    for alias in ("all:", "errors:", "gateway:", "slow:", "hourly:"):
        assert q.count(" " + alias) == 1, alias
    assert q.count('zoneTag:"zone-id"') == 1
    assert q.count(f'datetime_geq:"{SINCE}", datetime_lt:"{UNTIL}", requestSource:"eyeball"') == 5
    assert "edgeResponseStatus_in:[502,504,520,521,522,523,524]" in q and "edgeResponseStatus_geq:500" in q
    assert q.count("{") == q.count("}")


# ── could not measure ─────────────────────────────────────────────────────────

def test_without_a_token_it_says_so_and_exits_2(monkeypatch, capsys):
    monkeypatch.delenv("CLOUDFLARE_ANALYTICS_TOKEN", raising=False)
    monkeypatch.setenv("CLOUDFLARE_ZONE_ID", "zone-id")
    monkeypatch.setattr(rs, "fetch", lambda *a, **k: pytest.fail("no request may be sent without a token"))
    assert rs.main([]) == 2
    out = capsys.readouterr().out
    assert out.startswith("COULD NOT MEASURE") and "Reliability," not in out


class _Answer(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


@pytest.mark.parametrize("answer,needle", [
    ({"errors": [{"message": "not authorized"}], "data": None}, "refused"),
    ({"data": {"viewer": {"zones": []}}}, "no zone"),
])
def test_cloudflare_refusals_are_could_not_measure(monkeypatch, answer, needle):
    monkeypatch.setattr(rs.urllib.request, "urlopen", lambda *a, **k: _Answer(json.dumps(answer).encode()))
    with pytest.raises(rs.CouldNotMeasure, match=needle):
        rs.fetch("{}", "token")


def test_a_403_points_at_the_tokens_permissions(monkeypatch):
    def refuse(*a, **k):
        raise urllib.error.HTTPError(rs.API, 403, "Forbidden", {}, io.BytesIO(b"{}"))
    monkeypatch.setattr(rs.urllib.request, "urlopen", refuse)
    with pytest.raises(rs.CouldNotMeasure, match="permissions"):
        rs.fetch("{}", "token")


def test_the_token_goes_in_the_header_and_nowhere_else(monkeypatch):
    seen = {}

    def capture(req, timeout=None):
        seen["auth"] = req.get_header("Authorization")
        seen["body"] = req.data.decode()
        seen["url"] = req.full_url
        return _Answer(json.dumps({"data": {"viewer": {"zones": [day()]}}}).encode())
    monkeypatch.setattr(rs.urllib.request, "urlopen", capture)
    assert rs.fetch(rs.build_query("zone-id", SINCE, UNTIL), "s3cret-token")["all"]
    assert seen["auth"] == "Bearer s3cret-token"
    assert "s3cret-token" not in seen["body"] and "s3cret-token" not in seen["url"]


# ── a run ─────────────────────────────────────────────────────────────────────

def test_a_run_appends_one_compact_line_to_the_history(monkeypatch, tmp_path, capsys):
    monkeypatch.setenv("CLOUDFLARE_ANALYTICS_TOKEN", "token")
    monkeypatch.setenv("CLOUDFLARE_ZONE_ID", "zone-id")
    monkeypatch.setattr(rs, "fetch", lambda query, token: day())
    history = tmp_path / "scoreboard.jsonl"
    assert rs.main(["--hours", "2", "--history", str(history)]) == 0
    assert rs.main(["--hours", "2", "--history", str(history)]) == 0
    lines = history.read_text(encoding="utf-8").splitlines()
    assert len(lines) == 2
    first = json.loads(lines[0])
    assert first["requests"] == 60000 and first["gaps"] == 2 and "measured_at" in first
    assert "gap_list" not in first and "hours" not in first, "the history keeps the numbers, not the long lists"
    assert "token" not in lines[0]
    assert "Reliability," in capsys.readouterr().out


def test_self_check_passes():
    lines = []
    assert rs.self_check(lines.append) == 0, lines
