"""Slice 2 — NO LOOK-AHEAD, proven by future invariance (synthetic, deterministic, no network).

The property: whatever is published AFTER a cutoff (new releases, revisions of old periods, a lapse
ending) must not change any event the study found BEFORE that cutoff — not its date, its entry, or the
condition values it was decided on. If a study ever used a value before it was public, truncating the
world at the cutoff would change an earlier event, and these tests fail.

Exercised over seeded random worlds: monthly economic releases at pre-open, intraday, after-close and
weekend times; revisions of older AND latest periods; first-release (V) and backfilled (L) rows; every
operator, both transforms, both episode modes; and compound conditions mixing a released series with
daily breadth. Plus the staleness edge (a value going stale is decided by the calendar, never by a later
publication) and the validator disjointness the Agent's history note relies on.
"""
from __future__ import annotations

import random

import pytest

from api.services.market_intel import event_study as es
from tests import market_intel_event_fixtures as fx
from tests.market_intel_event_fixtures import S

ECON = {"kind": "econ", "symbol": "USCPIYOY"}
BREADTH = {"kind": "breadth", "universe": "nasdaq", "metric": "pct_above_50sma"}


def _et_unix(day: str, hhmm: str) -> int:
    from datetime import datetime
    from api.services import session_calendar as sc
    h, m = map(int, hhmm.split(":"))
    return int(datetime.fromisoformat(day).replace(hour=h, minute=m, tzinfo=sc.ET).timestamp())


@pytest.fixture
def world(monkeypatch):
    monkeypatch.setattr(es, "MAX_EVENTS_LISTED", 10 ** 9)     # compare EVERY event, not the latest 60
    return fx.install(monkeypatch)


def _econ(monkeypatch, vrows):
    from api.services.econ import publish as P, serving as Sv

    class _St:
        def close(self):
            pass
    monkeypatch.setattr(Sv, "mode", lambda: "db")
    monkeypatch.setattr(Sv, "_open_db", lambda: _St())
    monkeypatch.setattr(P, "build_vintages_payload", lambda st, sym: {"rows": [list(r) for r in vrows]})


_TIMES = ("08:30", "10:00", "13:30", "16:00", "16:30", "20:00")


def _random_vintages(rng: random.Random) -> list:
    """Monthly periods Jan–Nov 2024, each released mid-next-month at a random time (some on weekends),
    with random later revisions of that period (some long after) — rows [ps, pe, t, v, pit, rid]."""
    from datetime import date, timedelta
    rows, rid = [], 0
    for m in range(1, 12):
        ps, pe = f"2024-{m:02d}-01", f"2024-{m:02d}-28"
        rel = date(2024, m + 1 if m < 12 else 12, 1) + timedelta(days=rng.randint(5, 20))
        rid += 1
        v = round(rng.uniform(-2.0, 2.0), 2)
        rows.append([ps, pe, _et_unix(rel.isoformat(), rng.choice(_TIMES)), v, rng.choice("VL"), rid])
        for _ in range(rng.randint(0, 2)):                       # revisions: days to months later
            rel2 = rel + timedelta(days=rng.randint(1, 120))
            if rel2.year > 2024:
                continue
            rid += 1
            rows.append([ps, pe, _et_unix(rel2.isoformat(), rng.choice(_TIMES)),
                         round(v + rng.uniform(-0.5, 0.5), 2), rng.choice("VL"), rid])
    return rows


def _cutoffs(rng: random.Random) -> list[str]:
    return sorted(rng.sample([d for d in S if "2024-03-01" <= d <= "2024-11-29"], 4))


def _events_before(res: dict, day: str) -> list:
    assert res["status"] == "ok", res
    return [(e["event_date"], e["entry_date"], e["condition_values"]) for e in res["events"] if e["event_date"] <= day]


def _known_at(vrows: list, day: str) -> list:
    """Only what had been PUBLISHED by the close of `day` (the cutoff world)."""
    end = _et_unix(day, "16:00")
    return [r for r in vrows if r[2] <= end]


def _conditions(rng: random.Random) -> list[dict]:
    t = round(rng.uniform(-1.0, 1.0), 2)
    return [
        {"series": ECON, "op": "below", "threshold": t},
        {"series": ECON, "op": "above", "threshold": t},
        {"series": ECON, "op": "cross_below", "threshold": t},
        {"series": ECON, "op": "cross_above", "threshold": t},
        {"series": ECON, "op": "below", "threshold": 0, "transform": "change"},
        {"series": ECON, "op": "on_release"},
        {"all": [{"series": ECON, "op": "above", "threshold": t},
                 {"series": BREADTH, "op": "below", "threshold": 50}]},
        {"all": [{"series": ECON, "op": "on_release"},
                 {"series": BREADTH, "op": "above", "threshold": 20}]},
    ]


@pytest.mark.parametrize("seed", range(12))
def test_nothing_published_after_a_cutoff_changes_any_earlier_event(world, monkeypatch, seed):
    rng = random.Random(seed)
    full = _random_vintages(rng)
    cuts = _cutoffs(rng)
    for cond in _conditions(rng):
        for episodes in ("first", "all"):
            request = {"condition": cond, "symbol": "QQQ", "horizons": [{"sessions": 1}], "episodes": episodes}
            _econ(monkeypatch, full)
            whole = es.run(request)
            if whole["status"] != "ok":                     # e.g. no overlap in a degenerate world
                assert whole["status"] in ("refused", "unavailable")
                continue
            for day in cuts:
                known = _known_at(full, day)
                if not known:
                    continue
                _econ(monkeypatch, known)
                then = es.run(request)
                if then["status"] != "ok":
                    # too little was public yet (e.g. one release, no change): then nothing before the
                    # cutoff may be an event in the full world either
                    assert then["reason"] in ("no_data", "not_enough_history", "no_overlap"), then
                    assert _events_before(whole, day) == [], (seed, cond, episodes, day)
                    continue
                assert _events_before(whole, day) == _events_before(then, day), (seed, cond, episodes, day)


def test_a_revision_of_the_triggering_period_never_rewrites_the_event(world, monkeypatch):
    """Jan is released at 2.0 (above 1.5 → an event on its release session); in March Jan is revised to
    0.5. The event stays, decided on the value public at the time — and the March revision is not a new
    January event (only the NEWEST period's value is the series' level)."""
    t = lambda d, h="08:30": _et_unix(d, h)  # noqa: E731
    vrows = [["2024-01-01", "2024-01-31", t("2024-02-13"), 2.0, "V", 1],
             ["2024-02-01", "2024-02-29", t("2024-03-12"), 1.0, "V", 2],
             ["2024-01-01", "2024-01-31", t("2024-03-20"), 0.5, "V", 3]]
    _econ(monkeypatch, vrows)
    r = es.run({"condition": {"series": ECON, "op": "above", "threshold": 1.5}, "symbol": "QQQ",
                "horizons": [{"sessions": 1}], "episodes": "all"})
    assert [(e["event_date"], e["condition_values"]) for e in r["events"]] == [("2024-02-13", [2.0])]


def test_an_after_close_release_is_first_acted_on_the_next_session(world, monkeypatch):
    vrows = [["2024-01-01", "2024-01-31", _et_unix("2024-02-13", "08:30"), 0.0, "V", 1],
             ["2024-02-01", "2024-02-29", _et_unix("2024-03-12", "16:30"), 5.0, "V", 2]]
    _econ(monkeypatch, vrows)
    r = es.run({"condition": {"series": ECON, "op": "cross_above", "threshold": 1}, "symbol": "QQQ",
                "horizons": [{"sessions": 1}], "entry": "event_close"})
    assert [(e["event_date"], e["entry_date"]) for e in r["events"]] == [("2024-03-13", "2024-03-13")]


def test_staleness_is_decided_by_the_calendar_not_by_a_later_publication(world, monkeypatch):
    """A lapse makes the value unknown from the day it goes stale; a release that arrives LATER must not
    make the stale sessions retroactively known (that would be the future filling the past)."""
    t = lambda d: _et_unix(d, "08:30")  # noqa: E731
    lapse = [["2024-01-01", "2024-01-31", t("2024-02-13"), 2.0, "V", 1]]
    later = lapse + [["2024-02-01", "2024-02-29", t("2024-09-12"), 2.0, "V", 2]]
    request = {"condition": {"series": ECON, "op": "above", "threshold": 1}, "symbol": "QQQ",
               "horizons": [{"sessions": 1}], "episodes": "all"}
    _econ(monkeypatch, lapse)
    a = es.run(request)
    _econ(monkeypatch, later)
    b = es.run(request)
    stale_from = max(e["event_date"] for e in a["events"])
    assert [e["event_date"] for e in b["events"] if e["event_date"] <= stale_from] == \
        [e["event_date"] for e in a["events"]]
    assert not [e for e in b["events"] if stale_from < e["event_date"] < "2024-09-12"]


def test_breadth_and_study_validators_are_disjoint():
    """The Agent records local requests as bare args; its history note tries each validator. A breadth
    lookup must never validate as a study and vice versa, so neither note can misdescribe the other."""
    from api.services.market_intel import breadth_reads as br
    breadth_reqs = [{"mode": "value", "universe": "us", "metrics": ["pct_above_50sma"]},
                    {"mode": "compare", "universe": "nyse", "metrics": ["pct_above_50sma"], "date": "2024-05-01", "compare_date": "2024-04-01"},
                    {"mode": "series", "universe": "nasdaq", "metrics": ["pct_above_200sma"], "start": "2024-01-01"}]
    study_reqs = [{"condition": {"series": BREADTH, "op": "below", "threshold": 10}, "symbol": "QQQ",
                   "horizons": [{"sessions": 5}]},
                  {"condition": {"series": ECON, "op": "on_release"}, "symbol": "SPY", "horizons": [{"months": 3}]}]
    for b in breadth_reqs:
        assert br.validate(b)[0] is not None
        assert es.validate(b)[0] is None and es.request_note(b) == ""
    for s in study_reqs:
        assert es.validate(s)[0] is not None and es.request_note(s)
        assert br.validate(s)[0] is None


def test_a_released_value_stays_current_after_its_last_release_until_stale(world, monkeypatch):
    """Found by the future-invariance test: a mixed study (daily breadth AND a released series) used to
    END at the released series' last publication, silently dropping every later session — a study run
    today lost everything since the latest print. Now the latest value is carried until it goes stale
    (the econ registry's own max_age_days for the series: 45 days for CPI YoY), then it is a gap."""
    vrows = [["2024-01-01", "2024-01-31", _et_unix("2024-02-13", "08:30"), 1.0, "V", 1]]
    _econ(monkeypatch, vrows)
    r = es.run({"condition": {"all": [{"series": ECON, "op": "above", "threshold": 0},
                                      {"series": BREADTH, "op": "below", "threshold": 10}]},
                "symbol": "QQQ", "horizons": [{"sessions": 1}], "episodes": "first"})
    assert r["status"] == "ok"
    # S[50] (03-14) is a month after the only release: the old rule ended the study on 02-13 and lost it
    assert [e["event_date"] for e in r["events"]] == [S[50]]
    cov = r["coverage"]
    assert cov["series_last"] == "2024-02-13" and cov["series_known_through"] == "2024-03-29"   # + 45 days
    assert cov["study_end"] == "2024-03-29"                  # never carried past stale: S[99], S[240] excluded


def test_answer_lead_and_caveats_survive_a_collapsed_presentation(world, monkeypatch):
    """The Agent's presentation shows a lead and collapses the rest into details. The warnings that
    change how a result reads must be available separately so they stay visible."""
    from api.services.market_intel import event_study_answer as esa
    t = lambda d: _et_unix(d, "08:30")  # noqa: E731
    vrows = [[f"2024-{m:02d}-01", f"2024-{m:02d}-28", t(d), v, "L", m]
             for m, d, v in [(1, "2024-02-13", 1.0), (2, "2024-03-12", 2.0), (3, "2024-04-10", 1.0)]]
    _econ(monkeypatch, vrows)
    out = esa.answer(es.run({"condition": {"series": ECON, "op": "on_release"}, "symbol": "QQQ",
                             "horizons": [{"sessions": 1}]}))
    assert out["status"] == "ok" and out["lead"] == out["text"].split("\n")[0]
    assert any(c.startswith("Small sample") for c in out["caveats"])
    assert any("backfilled history" in c for c in out["caveats"])
    refused = esa.answer(es.run({"condition": {"series": {"kind": "nope"}, "op": "below", "threshold": 1},
                                 "symbol": "QQQ", "horizons": [{"sessions": 1}]}))
    assert refused["status"] == "refused" and refused["lead"] == refused["text"] and refused["caveats"] == []
