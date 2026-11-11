"""Rails for `api/services/rs_evidence_pull.py` (UCT Relative Strength, Phase 2b,
unit 2b-03) and its `rs_evidence_pull` job in `api.main`.

The pull: a real artifact is written atomically and byte-for-byte; a short,
unparseable or wrong-shaped payload is refused and the PREVIOUS file is kept
byte-for-byte (the map's "web pull preserves the prior artifact on a short
payload"); a raising `get_bytes` is a receipt, never a raise. The read:
`load_local` caches on the file's mtime; `evidence_for` judges displayability by
the floor the artifact carries and invents nothing for a null statistic;
`summary_line` prints the exact operator sentence or the honesty sentence. The
job: its own 04:30 ET cron with the sibling's coalesce and grace, registered
under no flag (AST), one log line, never raises.

The fixture artifact is BUILT BY THE 2b-01 BUILDER (`rs_evidence.build_artifact`),
so the shape the pull validates and the card reads is the shape the worker
publishes, never one retyped here. `tests/test_rs_columns_provider.py` imports it.
"""
from __future__ import annotations

import ast
import json
import os
import pathlib
from datetime import datetime, timezone

import pytest

import api.main as m
from api.services import rs_evidence as E
from api.services import rs_evidence_pull as ep
from tests.test_screener_schedule import _FakeSched, _cron_field, _register

JOB = "rs_evidence_pull"
SIGNALS = ("rs_new_high", "rs_new_high_before_price", "rs_new_high_red_day", "rs_cross_up_21ema",
           "mansfield_cross_up")
# Pin moved 2026-11-07 (RS review #6, #7): the sentence names the sessions the
# events fell on, says "sessions" and "daily bars" (true on a weekly chart too)
# and reads the hit rate against the all-bars baseline. Moved again 2026-11-07
# (owner decision N6): the hit rate states its base, the next session's open.
# Moved again 2026-11-07 (unit VA3): the hit rate carries its likely range, a 95%
# Wilson interval over the effective n (240 sessions, not 1,284 events).
BEFORE_PRICE_SENTENCE = ("1,284 RS new highs before price on 240 sessions, 2025-11-05 to 2026-11-04, daily bars: "
                         "58.3% (likely between 52.0% and 64.4%) beat SPY from the next session's open to the "
                         "close 63 sessions later "
                         "(about 3 months; median +2.1%), against 50.2% for all bars. "
                         "Universe as held, survivorship not yet corrected.")


# ── the fixture ─────────────────────────────────────────────────────────────

def _h(n, hit, med, incomplete=0):
    total = n + incomplete
    return {"n": n, "incomplete": incomplete, "incomplete_share": (incomplete / total) if total else None,
            "hit_rate": hit, "median_excess": med, "mean_excess": med}


def fixture_artifact() -> dict:
    """A 2b-01 artifact from the 2b-01 builder. beforePrice clears the display
    floor at 63 bars (1,284; 58.3 %; median +2.1 %), redDay sits under it (40),
    the Mansfield cross has no complete 63-bar window yet (null statistics)."""
    per_signal = {
        "rs_new_high": {"n_signals": 5000, "dates": 250, "tickers": 1500, "horizons": {
            "21": _h(4900, 0.541, 0.8), "63": _h(4700, 0.552, 1.4), "126": _h(4300, 0.56, 2.9)}},
        "rs_new_high_before_price": {"n_signals": 1400, "dates": 240, "tickers": 800, "horizons": {
            "21": _h(1350, 0.57, 1.2), "63": _h(1284, 0.583, 2.1), "126": _h(1100, 0.59, 3.3)}},
        "rs_new_high_red_day": {"n_signals": 45, "dates": 12, "tickers": 40, "horizons": {
            "21": _h(44, 0.5, 0.1), "63": _h(40, 0.55, 0.9), "126": _h(30, 0.6, 1.5)}},
        "rs_cross_up_21ema": {"n_signals": 9000, "dates": 250, "tickers": 2000, "horizons": {
            "21": _h(8800, 0.503, 0.1), "63": _h(8500, 0.511, 0.4), "126": _h(8000, 0.52, 0.9)}},
        "mansfield_cross_up": {"n_signals": 300, "dates": 100, "tickers": 250, "horizons": {
            "21": _h(290, 0.52, 0.3), "63": _h(0, None, None, incomplete=300), "126": _h(0, None, None, incomplete=300)}},
    }
    summary = {"rows": 600000, "per_signal": per_signal,
               "baseline": {"21": _h(600000, 0.5, 0.0), "63": _h(590000, 0.502, 0.05), "126": _h(560000, 0.505, 0.1)}}
    return E.build_artifact(summary, asof_ymd=20261104, benchmark="SPY", window_from=20251105, window_to=20261104,
                            sessions=250, sessions_open=126, universe=3600, universe_requested=3640,
                            delisted_fn=lambda a, b: 12)


def write_artifact(data_dir, artifact) -> pathlib.Path:
    p = pathlib.Path(data_dir) / ep.LOCAL_NAME
    p.write_bytes(E.artifact_bytes(artifact))
    return p


def _get(raw):
    """An injectable `get_bytes` that records the key it was asked for."""
    calls = []

    def get_bytes(key):
        calls.append(key)
        return raw
    get_bytes.calls = calls
    return get_bytes


def _good_file(tmp_path):
    raw = E.artifact_bytes(fixture_artifact())
    assert ep.pull_once(get_bytes=_get(raw), data_dir=str(tmp_path))["pulled"] is True
    p = tmp_path / ep.LOCAL_NAME
    return p, raw, p.stat().st_mtime_ns


def _padded(obj) -> bytes:
    """A payload OVER the byte floor, so the schema refusal is the one under test."""
    if isinstance(obj, dict):
        return json.dumps({**obj, "_pad": "x" * (ep.MIN_BYTES + 100)}).encode()
    return json.dumps(obj).encode() + b" " * (ep.MIN_BYTES + 100)


def test_the_fixture_is_the_builders_shape_and_names_the_five_signals():
    art = fixture_artifact()
    assert ep.validate_artifact(art) is None
    assert set(art["per_signal"]) == set(SIGNALS) == set(E.SIGNALS)
    assert art["method"]["display_floor_n"] == E.DISPLAY_FLOOR_N == 100
    assert art["window"] == {"from": "2025-11-05", "to": "2026-11-04"} and art["asof"] == "2026-11-04"
    assert set(ep.CARD_SIGNALS.values()) == set(SIGNALS)


# ── the pull ────────────────────────────────────────────────────────────────

def test_a_real_artifact_is_written_atomically_byte_for_byte_with_a_receipt(tmp_path):
    raw = E.artifact_bytes(fixture_artifact())
    gb = _get(raw)
    now = datetime(2026, 11, 5, 9, 30, tzinfo=timezone.utc)
    r = ep.pull_once(get_bytes=gb, data_dir=str(tmp_path), now=now)
    assert gb.calls == [E.ARTIFACT_KEY] == ["rs/evidence.json"]
    assert r == {"pulled": True, "reason": None, "bytes": len(raw), "asof": "2026-11-04",
                 "path": os.path.join(str(tmp_path), "rs_evidence.json"), "key": "rs/evidence.json",
                 "pulled_at": "2026-11-05T09:30:00+00:00"}
    assert (tmp_path / "rs_evidence.json").read_bytes() == raw
    assert [p.name for p in tmp_path.iterdir()] == ["rs_evidence.json"], "no temp file left beside the artifact"
    assert ep.last_receipt() == r
    assert ep.load_local(str(tmp_path))["rows"] == 600000


@pytest.mark.parametrize("raw, reason", [
    (None, "no_r2_object"),
    (b"", "short_payload"),
    (b'{"version": 2, "per_signal": {}, "asof": "2026-11-04"}', "short_payload"),
    (b"{" + b" " * ep.MIN_BYTES, "bad_json"),
    (_padded([1, 2, 3]), "not_an_object"),
    (_padded({"version": E.ARTIFACT_VERSION + 1, "per_signal": {}, "asof": "2026-11-04"}), "bad_version"),
    # 2026-11-07: a version-1 artifact was measured from the signal close (before N6)
    # and without the split guard (N5): refused, never printed under the new wording.
    (_padded({"version": 1, "per_signal": {}, "asof": "2026-11-04"}), "bad_version"),
    (_padded({"per_signal": {}, "asof": "2026-11-04"}), "bad_version"),
    (_padded({"version": E.ARTIFACT_VERSION, "per_signal": [], "asof": "2026-11-04"}), "no_per_signal"),
    (_padded({"version": E.ARTIFACT_VERSION, "asof": "2026-11-04"}), "no_per_signal"),
    (_padded({"version": E.ARTIFACT_VERSION, "per_signal": {}}), "no_asof"),
    (_padded({"version": E.ARTIFACT_VERSION, "per_signal": {}, "asof": "  "}), "no_asof"),
    (_padded({"version": E.ARTIFACT_VERSION, "per_signal": {}, "asof": 20261104}), "no_asof"),
])
def test_a_refused_payload_keeps_the_previous_file_byte_for_byte(tmp_path, raw, reason):
    p, good, mtime = _good_file(tmp_path)
    r = ep.pull_once(get_bytes=_get(raw), data_dir=str(tmp_path))
    assert r["pulled"] is False and r["reason"] == reason
    assert r["bytes"] == (len(raw) if raw is not None else 0)
    assert p.read_bytes() == good and p.stat().st_mtime_ns == mtime
    assert [q.name for q in tmp_path.iterdir()] == ["rs_evidence.json"], "a refusal leaves no temp file"
    assert ep.load_local(str(tmp_path))["asof"] == "2026-11-04"
    assert ep.last_receipt()["reason"] == reason


def test_get_bytes_raising_is_a_refusal_not_a_raise(tmp_path):
    p, good, mtime = _good_file(tmp_path)

    def boom(key):
        raise RuntimeError("r2 down")
    r = ep.pull_once(get_bytes=boom, data_dir=str(tmp_path))
    assert r["pulled"] is False and r["reason"] == "get_bytes_raised" and r["asof"] is None and r["bytes"] == 0
    assert p.read_bytes() == good and p.stat().st_mtime_ns == mtime


def test_a_missing_data_dir_is_a_refusal_and_is_never_created(tmp_path):
    missing = tmp_path / "nope"
    gb = _get(E.artifact_bytes(fixture_artifact()))
    r = ep.pull_once(get_bytes=gb, data_dir=str(missing))
    assert r["pulled"] is False and r["reason"] == "no_data_dir"
    assert gb.calls == [], "nothing is downloaded for a box with nowhere to put it"
    assert not missing.exists()


def test_the_default_reader_is_data_sync_get_bytes_on_the_artifact_key(tmp_path, monkeypatch):
    from api.services import data_sync
    seen = []
    monkeypatch.setattr(data_sync, "get_bytes", lambda key: seen.append(key) or None)
    r = ep.pull_once(data_dir=str(tmp_path))
    assert seen == ["rs/evidence.json"] and r["reason"] == "no_r2_object" and r["pulled"] is False


def test_the_default_data_dir_is_DATA_DIR(monkeypatch, tmp_path):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    assert ep.local_path() == os.path.join(str(tmp_path), "rs_evidence.json")
    monkeypatch.delenv("DATA_DIR")
    assert ep.local_path() == os.path.join("/data", "rs_evidence.json")


def test_a_failed_write_is_a_refusal_and_the_previous_file_survives(tmp_path, monkeypatch):
    p, good, mtime = _good_file(tmp_path)
    monkeypatch.setattr(ep, "_atomic_write_bytes",
                        lambda path, data: (_ for _ in ()).throw(OSError("disk full")))
    r = ep.pull_once(get_bytes=_get(E.artifact_bytes(fixture_artifact())), data_dir=str(tmp_path))
    assert r["pulled"] is False and r["reason"] == "write_failed" and r["asof"] == "2026-11-04"
    assert p.read_bytes() == good and p.stat().st_mtime_ns == mtime


def test_the_atomic_write_leaves_no_temp_file_when_the_write_itself_fails(tmp_path, monkeypatch):
    import os as _os
    real_replace = _os.replace

    def refuse(src, dst):
        raise OSError("replace refused")
    monkeypatch.setattr(ep.os, "replace", refuse)
    with pytest.raises(OSError):
        ep._atomic_write_bytes(str(tmp_path / "x.json"), b"abc")
    monkeypatch.setattr(ep.os, "replace", real_replace)
    assert list(tmp_path.iterdir()) == []


def test_the_byte_floor_sits_under_the_smallest_artifact_the_builder_makes():
    """The floor must refuse truncation, never a legitimate artifact: a ZERO-row
    artifact (five signals, three horizons, the method block) is the smallest the
    2b-01 builder can produce, and it clears the floor with room to spare."""
    empty = {"rows": 0, "per_signal": {}, "baseline": {str(h): _h(0, None, None) for h in E.HORIZONS}}
    art = E.build_artifact(empty, asof_ymd=20261104, benchmark="SPY", window_from=20251105, window_to=20261104,
                           sessions=0, sessions_open=0, universe=0, universe_requested=0,
                           delisted_fn=lambda a, b: None)
    assert ep.MIN_BYTES == 2048
    assert len(E.artifact_bytes(art)) > ep.MIN_BYTES * 1.5
    assert ep.validate_artifact(art) is None


# ── the local read ──────────────────────────────────────────────────────────

def test_load_local_is_none_when_absent_corrupt_or_the_wrong_shape(tmp_path, monkeypatch):
    assert ep.load_local(str(tmp_path)) is None
    monkeypatch.setattr(ep, "_default_data_dir", lambda: str(tmp_path))
    assert ep.load_local() is None and ep.evidence_for("rs_new_high") is None
    assert ep.summary_line("rs_new_high") == ep.HONESTY_SENTENCE
    p = tmp_path / ep.LOCAL_NAME
    p.write_bytes(b"{not json")
    assert ep.load_local(str(tmp_path)) is None
    p.write_bytes(json.dumps({"version": E.ARTIFACT_VERSION + 1, "per_signal": {}, "asof": "2026-11-04"}).encode())
    assert ep.load_local(str(tmp_path)) is None
    write_artifact(tmp_path, fixture_artifact())
    assert ep.load_local(str(tmp_path))["asof"] == "2026-11-04"
    assert ep.evidence_for("rs_new_high_before_price")["n"] == 1284, "the default read is the default dir"


def test_load_local_caches_on_the_file_mtime(tmp_path):
    p = write_artifact(tmp_path, fixture_artifact())
    first = ep.load_local(str(tmp_path))
    assert first["rows"] == 600000
    st = p.stat()
    changed = fixture_artifact()
    changed["rows"] = 1
    p.write_bytes(E.artifact_bytes(changed))
    os.utime(p, ns=(st.st_atime_ns, st.st_mtime_ns))          # same mtime: the cache answers
    again = ep.load_local(str(tmp_path))
    assert again is first and again["rows"] == 600000
    os.utime(p, ns=(st.st_atime_ns, st.st_mtime_ns - 1_000_000_000))   # a different mtime: re-read
    fresh = ep.load_local(str(tmp_path))
    assert fresh is not first and fresh["rows"] == 1
    # a pull replaces the file (os.replace: a new file, a new mtime) and the next read sees it
    ep.pull_once(get_bytes=_get(E.artifact_bytes(fixture_artifact())), data_dir=str(tmp_path))
    assert ep.load_local(str(tmp_path))["rows"] == 600000


# ── the card's read ─────────────────────────────────────────────────────────

def test_evidence_for_reads_one_signal_at_one_horizon_and_judges_displayability():
    art = fixture_artifact()
    # Pin moved 2026-11-07 (RS review #6): the dict carries the sessions, the
    # effective n the floor is checked on, the incomplete count and the baseline;
    # and (N6) the outcome phrase, so whoever prints the number prints its base.
    # Moved again (unit VA3): the likely range, the unchecked-split count (None:
    # the fixture's builder call passes none) and the span rule's minimum.
    assert ep.evidence_for("rs_new_high_before_price", 63, art) == {
        "signal": "rs_new_high_before_price", "label": "RS new highs before price", "n": 1284,
        "sessions": 240, "effective_n": 240, "incomplete": 0,
        "hit_rate_pct": 58.3, "hit_rate_low_pct": 51.98, "hit_rate_high_pct": 64.36,
        "median_excess_pct": 2.1, "baseline_hit_rate_pct": 50.2, "horizon_bars": 63,
        "start": "2025-11-05", "end": "2026-11-04", "benchmark": "SPY", "asof": "2026-11-04",
        "survivorship": "universe as held, survivorship not yet corrected", "survivorship_corrected": False,
        "split_unchecked": None, "display_floor_n": 100, "min_event_dates": 100, "displayable": True,
        "outcome": "beat SPY from the next session's open to the close 63 sessions later"}
    assert ep.evidence_for("rs_new_high_before_price", artifact=art)["horizon_bars"] == 63, "63 is the default horizon"
    # the floor is the ARTIFACT's: 40 red-day signals carry their numbers but are not displayable
    rd = ep.evidence_for("rs_new_high_red_day", 63, art)
    assert rd["n"] == 40 and rd["hit_rate_pct"] == 55.0 and rd["displayable"] is False
    # a null statistic stays null and is not displayable, whatever n says
    mc = ep.evidence_for("mansfield_cross_up", 63, art)
    assert mc["n"] == 0 and mc["hit_rate_pct"] is None and mc["median_excess_pct"] is None
    assert mc["displayable"] is False
    assert ep.evidence_for("mansfield_cross_up", 21, art)["displayable"] is True
    # exactly the floor clears it; one under does not
    # Pin moved 2026-11-07 (RS review #6): the floor is on EFFECTIVE n, so the
    # red-day signal also needs 100 sessions (the fixture carries 12).
    art2 = fixture_artifact()
    art2["per_signal"]["rs_new_high_red_day"]["horizons"]["63"]["n"] = 100
    assert ep.evidence_for("rs_new_high_red_day", 63, art2)["displayable"] is False, "100 events on 12 sessions"
    art2["per_signal"]["rs_new_high_red_day"]["dates"] = 100
    assert ep.evidence_for("rs_new_high_red_day", 63, art2)["displayable"] is True
    art2["per_signal"]["rs_new_high_red_day"]["horizons"]["63"]["n"] = 99
    assert ep.evidence_for("rs_new_high_red_day", 63, art2)["displayable"] is False
    # the floor rides in the artifact; a raised one is honoured, a missing one is the module's
    art2["method"]["display_floor_n"] = 2000
    assert ep.evidence_for("rs_new_high_before_price", 63, art2)["displayable"] is False
    del art2["method"]
    assert ep.evidence_for("rs_new_high_before_price", 63, art2)["display_floor_n"] == E.DISPLAY_FLOOR_N
    # n over the floor but no hit rate, or no window dates: not displayable
    art3 = fixture_artifact()
    art3["per_signal"]["rs_new_high"]["horizons"]["63"]["hit_rate"] = None
    assert ep.evidence_for("rs_new_high", 63, art3)["displayable"] is False
    art3 = fixture_artifact()
    art3["window"] = {"from": None, "to": None}
    assert ep.evidence_for("rs_new_high", 63, art3)["displayable"] is False
    # no artifact, no such signal, no such horizon
    assert ep.evidence_for("rs_new_high", 63, {"version": 1}) is None
    assert ep.evidence_for("not_a_signal", 63, art) is None
    assert ep.evidence_for("rs_new_high", 999, art)["n"] is None
    assert ep.evidence_for("rs_new_high", 999, art)["displayable"] is False


def test_baseline_for_is_the_all_bars_hit_rate_at_the_horizon():
    art = fixture_artifact()
    assert ep.baseline_for(63, art) == {"n": 590000, "hit_rate_pct": 50.2, "median_excess_pct": 0.05, "horizon_bars": 63}
    assert ep.baseline_for(999, art) is None
    assert ep.baseline_for(63, {"version": 1}) is None


def test_summary_line_prints_the_measured_sentence_or_the_honesty_sentence():
    art = fixture_artifact()
    # Pins moved 2026-11-07 (RS review #6, #7, #22): sessions, daily bars, the
    # baseline, and the below-floor / pending sentences in place of the honesty
    # line wherever the artifact carries the signal.
    assert ep.summary_line("rs_new_high_before_price", 63, art) == BEFORE_PRICE_SENTENCE
    assert ep.summary_line("rs_new_high", 63, art) == (
        "4,700 RS new highs on 250 sessions, 2025-11-05 to 2026-11-04, daily bars: 55.2% (likely between 49.0% "
        "and 61.2%) beat SPY from the next session's open to the close 63 sessions later (about 3 months; "
        "median +1.4%), against 50.2% for all bars. "
        "Universe as held, survivorship not yet corrected.")
    assert ep.summary_line("rs_cross_up_21ema", 63, art).startswith(
        "8,500 RS line crosses above its 21-day average on 250 sessions, ")
    assert ep.summary_line("mansfield_cross_up", 21, art).startswith("290 Mansfield crosses above zero on 100 sessions, ")
    assert ep.summary_line("rs_new_high_red_day", 63, art) == (                       # under the floor
        "UCT measured 40 events on 12 sessions, too few to print a hit rate: it needs at least 100 events on "
        "at least 100 different sessions.")
    assert ep.summary_line("mansfield_cross_up", 63, art) == (                        # no complete window yet
        "UCT has recorded 300 events on 100 sessions, none with a complete 63-session window yet, "
        "so no hit rate is printed.")
    assert ep.summary_line("nope", 63, art) == ep.HONESTY_SENTENCE                     # no such signal
    assert ep.sentence_for(None) == ep.HONESTY_SENTENCE
    assert ep.HONESTY_SENTENCE == "No published hit rate exists for this signal and UCT has not measured one yet."
    # a negative median prints its sign; a null median drops it, nothing is invented
    h = art["per_signal"]["rs_new_high_before_price"]["horizons"]["63"]
    h["median_excess"] = -1.2
    assert "63 sessions later (about 3 months; median -1.2%), against" in ep.summary_line("rs_new_high_before_price", 63, art)
    h["median_excess"] = None
    line = ep.summary_line("rs_new_high_before_price", 63, art)
    assert "63 sessions later (about 3 months), against 50.2% for all bars. Universe" in line and "median" not in line
    # the survivorship clause is the artifact's own note, sentence-cased
    art["survivorship"] = "survivorship corrected against the delisted registry"
    assert ep.summary_line("rs_new_high", 63, art).endswith(
        "for all bars. Survivorship corrected against the delisted registry.")


def test_the_card_sentence_shares_its_clause_with_the_discord_honesty_line():
    """`HONESTY_SENTENCE` is the per-signal form of `rs_discord_post.HONESTY_LINE`
    (plural, prefixed, two sentences). A rewording of either must touch both."""
    from api.services import rs_discord_post as rp
    for clause in ("published hit rate exists", "UCT has not measured one yet"):
        assert clause in ep.HONESTY_SENTENCE and clause in rp.HONESTY_LINE, clause
    assert ep.HONESTY_SENTENCE != rp.HONESTY_LINE


def test_an_evidence_dict_feeds_the_discord_evidence_line_under_its_label():
    """Unit 2b-08 can hand `evidence_for` straight to the poster's `evidence_line`
    once `signal` is the label: the field names are the poster's contract. Since
    2026-11-07 the dict carries its own `outcome` (`outcome_phrase`, N6), so the
    post states the same base as the card without the caller restating it."""
    from api.services import rs_discord_post as rp
    ev = ep.evidence_for("rs_new_high_before_price", 63, fixture_artifact())
    assert ev["outcome"] == ep.outcome_phrase("SPY", 63)
    # 2026-11-07: and the card's likely range, from the same phrase the card reads
    assert rp.evidence_line({**ev, "signal": ev["label"]}) == (
        "Evidence: 1,284 RS new highs before price from 2025-11-05 to 2026-11-04; 58.3% (likely between "
        "52.0% and 64.4%) beat SPY from the next session's open to the close 63 sessions later. Universe as "
        "held, survivorship not yet corrected.")
    assert ep.likely_range_phrase(ev["hit_rate_low_pct"], ev["hit_rate_high_pct"]) in ep.sentence_for(ev)
    assert ep.outcome_phrase(None, 21) == "beat the benchmark from the next session's open to the close 21 sessions later"


def test_the_pull_module_reads_only_DATA_DIR_from_the_environment():
    src = pathlib.Path(ep.__file__).read_text(encoding="utf-8")
    reads = set()
    for n in ast.walk(ast.parse(src)):
        if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute) and n.func.attr in ("get", "__getitem__"):
            v = n.func.value
            if isinstance(v, ast.Attribute) and v.attr == "environ" and n.args and isinstance(n.args[0], ast.Constant):
                reads.add(n.args[0].value)
    assert reads == {"DATA_DIR"}, reads
    assert "getenv" not in src


# ── the job in api.main ─────────────────────────────────────────────────────

def test_the_pull_job_has_its_OWN_0430_ET_cron_with_coalesce_and_grace(monkeypatch):
    """Its own cron after the worker's 21:30 ET publish and the web's 04:15
    rating job; `coalesce=True`, the 3600 s grace every once-a-day sibling uses,
    one instance, `replace_existing`."""
    sched = _register(monkeypatch)
    assert JOB in sched.jobs
    fn, kw = sched.jobs[JOB]
    assert fn is m._run_rs_evidence_pull
    assert _cron_field(kw["trigger"], "hour") == "4"
    assert _cron_field(kw["trigger"], "minute") == "30"
    assert str(kw["trigger"].timezone) == "America/New_York"
    assert kw["max_instances"] == 1
    assert kw["replace_existing"] is True
    assert kw["coalesce"] is True
    assert kw["misfire_grace_time"] == 3600
    # after the rating job, before anything reads it; not the build job's function
    _, rs_kw = sched.jobs["rs_history_nightly"]
    rating = (int(_cron_field(rs_kw["trigger"], "hour")), int(_cron_field(rs_kw["trigger"], "minute")))
    assert rating < (4, 30)
    assert sched.jobs["screener_snapshot_nightly"][0] is not fn
    assert sched.ids.count(JOB) == 1


def test_the_pull_add_job_is_wrapped_in_NO_flag_test__BY_AST():
    """Registered unconditionally and under no flag of its own: the `add_job` sits
    under zero `if` statements in `register_screener_jobs`'s body, and the job
    function reads no environment variable. Control: the flag-gated nightly
    sweep comes back gated, so the probe can see."""
    src = pathlib.Path(m.__file__).read_text(encoding="utf-8")
    tree = ast.parse(src)
    fn = next(n for n in ast.walk(tree) if isinstance(n, ast.FunctionDef) and n.name == "register_screener_jobs")
    depth = {}

    def _walk(body, d):
        for stmt in body:
            if isinstance(stmt, ast.If):
                _walk(stmt.body, d + 1)
                _walk(stmt.orelse, d + 1)
                continue
            for node in ast.walk(stmt):
                if isinstance(node, ast.Call) and getattr(node.func, "attr", None) == "add_job":
                    for kw in node.keywords:
                        if kw.arg == "id" and isinstance(kw.value, ast.Constant):
                            depth[kw.value.value] = d

    _walk(fn.body, 0)
    assert depth.get(JOB) == 0
    assert depth.get("screener_scan_sweep", 0) >= 1   # control: the probe sees gating
    job = next(n for n in ast.walk(tree) if isinstance(n, ast.FunctionDef) and n.name == "_run_rs_evidence_pull")
    assert not [n for n in ast.walk(job) if isinstance(n, ast.Attribute) and n.attr == "environ"], \
        "the pull job reads no flag"


def test_the_family_switch_pauses_the_pull_with_the_rest(monkeypatch):
    monkeypatch.setenv("SCREENER_SNAPSHOT_ENABLED", "0")
    sched = _FakeSched()
    assert m.register_screener_jobs(sched) is False
    assert JOB not in sched.ids


def test_the_job_calls_pull_once_with_defaults_logs_one_line_and_never_raises(monkeypatch, capsys):
    calls = []
    receipt = {"pulled": True, "reason": None, "bytes": 5000, "asof": "2026-11-04",
               "path": "/data/rs_evidence.json", "key": "rs/evidence.json", "pulled_at": "x"}
    monkeypatch.setattr(ep, "pull_once", lambda *a, **k: calls.append((a, k)) or dict(receipt))
    assert m._run_rs_evidence_pull() is None
    assert calls == [((), {})], "the module resolves the reader and the data dir itself"
    out = capsys.readouterr().out
    assert out.count("[scheduler] rs evidence pull") == 1
    assert "pulled=True" in out and "reason=None" in out and "bytes=5000" in out and "asof=2026-11-04" in out

    def boom(*a, **k):
        raise RuntimeError("boom")
    monkeypatch.setattr(ep, "pull_once", boom)
    assert m._run_rs_evidence_pull() is None
    assert "[scheduler] rs evidence pull error: boom" in capsys.readouterr().out


def test_the_registered_job_reaches_pull_once_end_to_end(monkeypatch, tmp_path, capsys):
    """The scheduler's function, driven with a real (injected-by-monkeypatch) reader
    and data dir: the file lands and the line says so."""
    sched = _register(monkeypatch)
    monkeypatch.setattr(ep, "_default_data_dir", lambda: str(tmp_path))
    from api.services import data_sync
    raw = E.artifact_bytes(fixture_artifact())
    monkeypatch.setattr(data_sync, "get_bytes", lambda key: raw if key == "rs/evidence.json" else None)
    sched.jobs[JOB][0]()
    assert (tmp_path / "rs_evidence.json").read_bytes() == raw
    assert "pulled=True" in capsys.readouterr().out
    assert ep.load_local()["asof"] == "2026-11-04"
