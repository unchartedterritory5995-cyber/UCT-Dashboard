"""Pagination of the environment-wide log search.

⛔ The fake below implements Railway's MEASURED behaviour (probed 2026-09-13, four forms
side by side), not the behaviour the code wishes it had:
  * `beforeDate` + `beforeLimit` returns NOTHING, for any date;
  * `anchorDate` + `beforeLimit` + `afterLimit: 0` returns the rows at or before the anchor,
    INCLUDING the anchor row, up to limit + 1.
The first version of this file faked `beforeDate` semantics — the same wrong assumption the
tool made — so it passed while the real tool returned zero rows for eight filters. A fake
that mirrors the caller cannot catch a caller that is wrong about the callee.
"""
from __future__ import annotations

import json

import pytest

from tools import railway_env_logs as envlogs


def _row(ts, msg="m", dep="d1"):
    return {"timestamp": ts, "message": msg, "severity": "warn", "tags": {"deploymentId": dep, "serviceId": "s1"}}


class RailwayLike:
    """environmentLogs as measured: anchor-inclusive, limit + 1, and `beforeDate` returns nothing."""

    def __init__(self, rows, services=None, max_calls=200):
        self.rows = sorted(rows, key=lambda r: r["timestamp"], reverse=True)
        self.services = services or {"s1": "web"}
        self.calls = []
        # ⛔ A pager with a broken stopping rule never returns. Under mutation the first
        # version of the no-progress rail HUNG until pytest's timeout killed the process —
        # no totals line, so the harness could not score it. A runaway now RAISES here and
        # the rail fails like any other assertion.
        self.max_calls = max_calls

    def __call__(self, query, variables):
        self.calls.append(query)
        if len(self.calls) > self.max_calls:
            raise RuntimeError(f"runaway paging: {len(self.calls)} calls")
        if "project(" in query:
            return {"project": {"services": {"edges": [{"node": {"id": k, "name": v}} for k, v in self.services.items()]}}}
        if "beforeDate" in query and "anchorDate" not in query:
            return {"environmentLogs": []}                      # measured: this form never returns rows
        anchor, limit = variables["anchor"], variables["limit"]
        return {"environmentLogs": [r for r in self.rows if r["timestamp"] <= anchor][: limit + 1]}


def test_the_query_uses_the_measured_anchor_form_not_beforeDate():
    assert "anchorDate" in envlogs.QUERY and "afterLimit:0" in envlogs.QUERY.replace(" ", "")
    assert "beforeDate" not in envlogs.QUERY


def test_pages_back_to_since_and_returns_every_line_once_oldest_first():
    rows = [_row(f"2026-09-{d:02d}T12:00:00Z", msg=f"line {d}") for d in range(1, 14)]
    api = RailwayLike(rows)
    got = envlogs.fetch('"x"', "2026-09-03T00:00:00Z", "2026-09-13T23:00:00Z", page=3, sleep_ms=0, gql=api, log=lambda m: None)
    assert [r["message"] for r in got] == [f"line {d}" for d in range(3, 14)]
    assert len({(r["timestamp"], r["message"]) for r in got}) == len(got)      # the inclusive anchor row is deduped
    assert len(api.calls) >= 4


def test_lines_outside_the_window_are_dropped_not_counted():
    api = RailwayLike([_row("2026-09-12T00:00:01Z", "late"), _row("2026-09-10T00:00:00Z", "in"), _row("2026-08-01T00:00:00Z", "old")])
    got = envlogs.fetch('"x"', "2026-09-01T00:00:00Z", "2026-09-11T00:00:00Z", page=10, sleep_ms=0, gql=api, log=lambda m: None)
    assert [r["message"] for r in got] == ["in"]


def test_a_page_that_cannot_advance_stops_and_says_so_instead_of_looping():
    api = RailwayLike([_row("2026-09-10T12:00:00Z", msg=f"burst {i}") for i in range(10)])
    notes = []
    envlogs.fetch('"x"', "2026-09-01T00:00:00Z", "2026-09-12T00:00:00Z", page=3, sleep_ms=0, gql=api, log=notes.append)
    assert len(api.calls) <= 3
    assert any("STOPPED: no progress" in n for n in notes), "a truncated result must announce itself"


def test_a_complete_pull_is_reported_as_EXACT_not_as_a_floor():
    """⛔⛔ THE DISCRIMINATOR BETWEEN "THE END" AND "A STALL", AND IT IS THE WHOLE POINT.

    ⚰️ Both looked identical until 2026-09-14: a page with nothing new printed *"results before it
    may be missing"* whether the API had run out of data or the pager genuinely could not advance.
    So a complete 8-row pull had to be quoted as `>= 8`, and the Monday shadow line could not tell
    "nobody ran /chart" from "the pager stopped early" — an instrument that cannot say whether it
    saw everything turns every absence into an open question.

    An UNDER-FULL page means the API returned everything it had at that anchor. (Railway's form is
    anchor-inclusive and returns `limit + 1`, so "full" is `page + 1` rows — `RailwayLike` models
    that, which is why this fixture uses two rows against a page of 5.)"""
    api = RailwayLike([_row("2026-09-10T12:00:00Z", msg="a"), _row("2026-09-10T12:00:00Z", msg="b")])
    notes = []
    envlogs.fetch('"x"', "2026-09-01T00:00:00Z", "2026-09-12T00:00:00Z", page=5, sleep_ms=0,
                  gql=api, log=notes.append)
    assert any("EXACT" in n for n in notes), f"a complete pull was not called exact: {notes}"
    assert not any("STOPPED" in n for n in notes), "a complete pull announced itself as truncated"
    assert envlogs.fetch.last_exact is True


def test_the_output_file_says_whether_its_own_count_is_exact(tmp_path):
    """⛔ THE HEADER TRAVELS IN THE FILE, because stderr is not what gets read a week later, and a
    consumer that has to be TOLD to pass `--pager-stopped` is a consumer that will forget once."""
    out = tmp_path / "x.jsonl"
    api = RailwayLike([_row("2026-09-10T12:00:00Z", msg="a")])
    assert envlogs.main(["--filter", '"x"', "--since", "2026-09-01T00:00:00Z",
                         "--until", "2026-09-12T00:00:00Z", "--out", str(out), "--page", "5"],
                        gql=api) == envlogs.EXIT_OK
    first = json.loads(out.read_text(encoding="utf-8").splitlines()[0])
    assert first["_meta"]["exact"] is True and first["_meta"]["count"] == 1
    # the control: the header must not be mistaken for a log row by anything reading the file
    assert "timestamp" not in first


def test_a_stalled_pull_says_so_in_the_file_too(tmp_path):
    out = tmp_path / "x.jsonl"
    api = RailwayLike([_row("2026-09-10T12:00:00Z", msg=f"burst {i}") for i in range(10)])
    envlogs.main(["--filter", '"x"', "--since", "2026-09-01T00:00:00Z",
                  "--until", "2026-09-12T00:00:00Z", "--out", str(out), "--page", "3"], gql=api)
    first = json.loads(out.read_text(encoding="utf-8").splitlines()[0])
    assert first["_meta"]["exact"] is False, "a stalled pull claimed its count was exact"


def test_an_empty_first_page_is_announced():
    notes = []
    assert envlogs.fetch('"x"', "2026-09-01T00:00:00Z", "2026-09-12T00:00:00Z", page=5, sleep_ms=0,
                         gql=RailwayLike([]), log=notes.append) == []
    assert any("first page EMPTY" in n for n in notes)


def test_a_control_that_finds_nothing_is_INCONCLUSIVE_and_writes_nothing(tmp_path):
    out = tmp_path / "x.jsonl"
    api = RailwayLike([])                                  # the known positive is not there
    rc = envlogs.main(["--filter", '"x"', "--since", "2026-09-01T00:00:00Z", "--until", "2026-09-12T00:00:00Z",
                       "--out", str(out), "--control-filter", '"known"', "--control-at", "2026-09-11T00:00:00Z"], gql=api)
    assert rc == envlogs.EXIT_INCONCLUSIVE and not out.exists()


def test_a_control_that_finds_its_line_lets_the_search_run(tmp_path):
    out = tmp_path / "x.jsonl"
    api = RailwayLike([_row("2026-09-10T12:00:00Z", "known positive")])
    rc = envlogs.main(["--filter", '"x"', "--since", "2026-09-01T00:00:00Z", "--until", "2026-09-12T00:00:00Z",
                       "--out", str(out), "--control-filter", '"known"', "--control-at", "2026-09-11T00:00:00Z",
                       "--sleep-ms", "0"], gql=api)
    assert rc == envlogs.EXIT_OK and out.exists() and '"service": "web"' in out.read_text(encoding="utf-8")


def test_the_cli_refuses_a_bracketed_filter(tmp_path):
    with pytest.raises(SystemExit):
        envlogs.main(["--filter", '"[flow]"', "--since", "2026-09-01T00:00:00Z", "--until", "2026-09-02T00:00:00Z",
                      "--out", str(tmp_path / "x.jsonl")])
