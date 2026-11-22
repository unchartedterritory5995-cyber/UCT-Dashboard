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


# ── where the server's time went in the slowest hour ──────────────────────────

@pytest.mark.parametrize("path,cls", [
    ("/api/bars/NVDA?tf=D", "/api/bars/:sym"),
    ("/api/adjustment-basis/BRK.B", "/api/adjustment-basis/:sym"),
    ("/api/j2/notes/123456", "/api/j2/notes"),
    ("/api/share/n/" + "x" * 30, "/api/share/n"),
    ("/api/77/accounts", "/api/:id/accounts"),
    ("/api/j2/accounts/77/coach", "/api/j2/accounts"),
    ("/api/auth/me", "/api/auth/me"),
    ("/charts", "(pages and files)"),
])
def test_paths_are_grouped_without_tickers_or_ids(path, cls):
    assert rs.path_class(path) == cls


def test_endpoints_are_ranked_by_share_of_server_time():
    rows = [{"count": 100, "dimensions": {"clientRequestPath": "/api/auth/me"}, "avg": {"originResponseDurationMs": 50}},
            {"count": 10, "dimensions": {"clientRequestPath": "/api/bars/AAPL"}, "avg": {"originResponseDurationMs": 3000}},
            {"count": 10, "dimensions": {"clientRequestPath": "/api/bars/MSFT"}, "avg": {"originResponseDurationMs": 1000}}]
    out = rs.endpoint_breakdown(rows)
    assert [e["endpoint"] for e in out] == ["/api/bars/:sym", "/api/auth/me"]
    assert out[0] == {"endpoint": "/api/bars/:sym", "requests": 20, "avg_ms": 2000, "share_pct": 88.9}


def test_a_slow_day_also_reports_the_endpoints_of_its_slowest_hour(monkeypatch, tmp_path, capsys):
    monkeypatch.setenv("CLOUDFLARE_ANALYTICS_TOKEN", "token")
    monkeypatch.setenv("CLOUDFLARE_ZONE_ID", "zone-id")
    asked = []

    def fake(query, token):
        asked.append(query)
        if "endpoints:" in query:
            return {"endpoints": [{"count": 5, "dimensions": {"clientRequestPath": "/api/auth/preferences"},
                                   "avg": {"originResponseDurationMs": 2500}}]}
        return day()
    monkeypatch.setattr(rs, "fetch", fake)
    history = tmp_path / "h.jsonl"
    assert rs.main(["--hours", "2", "--history", str(history)]) == 0
    assert len(asked) == 4 and 'datetime_geq:"2026-11-13T15:00:00Z", datetime_lt:"2026-11-13T16:00:00Z"' in asked[1]
    assert "renderers:" in asked[2] and "userAgent_notlike" in asked[3], "renderers are found, then the members-only request"
    assert "/api/auth/preferences" in capsys.readouterr().out
    assert json.loads(history.read_text(encoding="utf-8"))["slowest_endpoints"] == ["/api/auth/preferences"]


def test_a_day_with_no_slow_minutes_asks_once(monkeypatch, capsys):
    monkeypatch.setenv("CLOUDFLARE_ANALYTICS_TOKEN", "token")
    monkeypatch.setenv("CLOUDFLARE_ZONE_ID", "zone-id")
    quiet = day()
    quiet["slow"] = [row(m, 400, 200) for m in range(120)]
    asked = []
    monkeypatch.setattr(rs, "fetch", lambda q, t: asked.append(q) or quiet)
    assert rs.main(["--hours", "2"]) == 0
    assert len(asked) == 3 and not any("endpoints:" in q for q in asked), "the day, the renderers and the members; no endpoint request"

# ── members only ──────────────────────────────────────────────────────────────

MEMBER_ROWS = {"all": [{"count": 300}], "errors": [{"count": 9}], "api": [{"count": 200}], "api_errors": [{"count": 8}],
               "api_gave_up": [{"count": 4}], "timed": [{"count": 100}], "over_1s": [{"count": 21}], "over_3s": [{"count": 8}]}


def test_our_own_clients_are_removed_from_the_members_numbers():
    m = rs.member_summary(MEMBER_ROWS, 1000, ["192.0.2.1"])
    assert (m["our_own_requests"], m["our_own_share_pct"], m["requests"]) == (700, 70.0, 300)
    assert (m["success_pct"], m["api_success_pct"], m["api_server_errors"]) == (97.0, 96.0, 8)
    assert (m["api_gave_up_pct"], m["api_over_1s_pct"], m["api_over_3s_pct"]) == (2.0, 21.0, 8.0)


def test_a_window_with_no_member_requests_has_no_percentages():
    m = rs.member_summary({}, 0, [])
    assert m["requests"] == 0 and m["success_pct"] is None and m["api_over_1s_pct"] is None


def test_service_clients_file_keeps_addresses_and_drops_everything_else(tmp_path):
    f = tmp_path / "service_clients.txt"
    f.write_text('# ours\n192.0.2.1  # renderer\n2001:db8::1\n"], x:[\nnot an address\n\n', encoding="utf-8")
    assert rs.service_clients(str(f)) == ["192.0.2.1", "2001:db8::1"]
    assert rs.service_clients(str(tmp_path / "missing.txt")) == []


def test_the_member_query_excludes_addresses_and_self_named_clients_and_times_only_uncached_non_stream_api():
    q = rs.build_member_query("zone-id", SINCE, UNTIL, ["192.0.2.1"])
    assert q.count('clientIP_notin:["192.0.2.1"]') == 8 and q.count('userAgent_notlike:"uct-%"') == 8
    assert 'over_1s: httpRequestsAdaptiveGroups' in q and 'originResponseDurationMs_gt:1000' in q
    timed = q.split("timed:")[1].split("over_1s:")[0]
    assert 'clientRequestPath_notlike:"/api/stream/%"' in timed and 'cacheStatus:"dynamic"' in timed
    assert "clientIP_notin" not in rs.build_member_query("zone-id", SINCE, UNTIL, [])


def test_the_report_shows_the_members_block_and_says_when_no_address_file_exists():
    s = rs.summarize({}, SINCE, UNTIL)
    s["requests"] = 1000
    s["success_pct"], s["server_errors"], s["gateway_errors"] = 99.0, 10, 0
    s["members"] = rs.member_summary(MEMBER_ROWS, 1000, [])
    text = rs.render(s)
    assert "MEMBERS ONLY" in text and "70.0% of all" in text and "succeeded 96.0%" in text
    assert "no service_clients.txt" in text
    s["members"] = rs.member_summary(MEMBER_ROWS, 1000, ["192.0.2.1"])
    assert "no service_clients.txt" not in rs.render(s)


def test_a_failed_member_request_leaves_the_report_standing(monkeypatch, capsys):
    monkeypatch.setenv("CLOUDFLARE_ANALYTICS_TOKEN", "t")
    monkeypatch.setenv("CLOUDFLARE_ZONE_ID", "z")
    calls = []

    def fake_fetch(query, token):
        calls.append(query)
        if "userAgent_notlike" in query:
            raise rs.CouldNotMeasure("Cloudflare refused the query")
        return {"all": [{"count": 500, "dimensions": {"datetimeMinute": "2026-11-13T15:00:00Z"}}]}

    monkeypatch.setattr(rs, "fetch", fake_fetch)
    assert rs.main([]) == 0
    out = capsys.readouterr().out
    assert "requests            500" in out and "MEMBERS ONLY: could not measure" in out


def test_an_address_that_loads_the_render_page_often_is_a_renderer_and_a_passer_by_is_not():
    rows = {"renderers": [{"count": 900, "dimensions": {"clientIP": "192.0.2.9"}},
                          {"count": 10, "dimensions": {"clientIP": "2001:db8::7"}},
                          {"count": 9, "dimensions": {"clientIP": "192.0.2.50"}},
                          {"count": 500, "dimensions": {"clientIP": 'x"], y:['}}]}
    assert rs.renderer_addresses(rows) == ["192.0.2.9", "2001:db8::7"]
    assert rs.renderer_addresses({}) == []
    q = rs.build_renderer_query("zone-id", SINCE, UNTIL)
    assert 'clientRequestPath:"/r/chart"' in q and "renderers:" in q and 'zoneTag:"zone-id"' in q


def test_found_renderers_are_excluded_together_with_the_listed_ones(monkeypatch, tmp_path, capsys):
    listed = tmp_path / "service_clients.txt"
    listed.write_text("192.0.2.1", encoding="utf-8")
    monkeypatch.setenv("SCOREBOARD_SERVICE_CLIENTS", str(listed))
    monkeypatch.setenv("CLOUDFLARE_ANALYTICS_TOKEN", "t")
    monkeypatch.setenv("CLOUDFLARE_ZONE_ID", "z")
    asked = []

    def fake(query, token):
        asked.append(query)
        if "renderers:" in query:
            return {"renderers": [{"count": 40, "dimensions": {"clientIP": "192.0.2.9"}}]}
        if "userAgent_notlike" in query:
            return MEMBER_ROWS
        return {"all": [{"count": 1000, "dimensions": {"datetimeMinute": "2026-11-13T15:00:00Z"}}]}

    monkeypatch.setattr(rs, "fetch", fake)
    assert rs.main([]) == 0
    assert 'clientIP_notin:["192.0.2.1", "192.0.2.9"]' in asked[-1]
    assert "MEMBERS ONLY" in capsys.readouterr().out
