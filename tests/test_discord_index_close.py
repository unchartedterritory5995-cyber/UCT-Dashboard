"""Into-the-close index + ETF charts posted to the PUBLIC #TSDR channel.

Owner, 2026-08-27: "Lets do scheduled posts in #TSDR channel of a look at the
Indexes into the close… QQQ SPY IWM DIA. Also do 4 ETFs that are important like
SMH IGV and whatever two you think from the day or week are notable".

The channel is public and the job is unattended, so most of what is tested here
is what it REFUSES to do.
"""
import ast
import datetime as _dt
import json
import pathlib

import pytest

from api.services import discord_index_close as idx

PNG = bytes([137, 80, 78, 71, 13, 10, 26, 10]) + b"chart"


def _bars(n=60):
    return [{"t": 20260600 + i, "o": 10.0, "h": 11.0, "l": 9.0, "c": 10.5, "v": 1000} for i in range(1, n + 1)]


def _kit(fail_on=(), house=None):
    def bars_fn(sym, tf, n):
        return [] if sym in fail_on else _bars()

    def house_fn(sym, tf, stats, opts):
        return house(sym) if house else PNG + sym.encode()

    return dict(bars_fn=bars_fn, house_fn=house_fn, stats_fn=lambda b: {"last": 1},
                name_fn=lambda s, tf, t: f"{s}_{tf}_2026-08-27_Chart.png")


@pytest.fixture(autouse=True)
def _isolated(tmp_path, monkeypatch):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.delenv("DISCORD_INDEX_CLOSE_ENABLED", raising=False)
    monkeypatch.delenv("DISCORD_TSDR_WEBHOOK_URL", raising=False)


# ── what it refuses to do ─────────────────────────────────────────────────

def test_it_posts_nothing_unless_deliberately_armed(monkeypatch):
    """#TSDR is the PUBLIC community channel and this runs on a timer. Off is
    the default, and each gate ALONE is enough to post nothing."""
    posts = []
    common = dict(**_kit(), post_fn=lambda *a: posts.append(a) or True,
                  now_et=_dt.datetime(2026, 8, 27, 15, 45))
    assert idx.run_close_post(**common)["skipped"] == "not enabled"
    monkeypatch.setenv("DISCORD_INDEX_CLOSE_ENABLED", "1")
    assert idx.run_close_post(**common)["skipped"] == "no webhook configured"
    monkeypatch.setenv("DISCORD_TSDR_WEBHOOK_URL", "   ")
    assert idx.run_close_post(**common)["skipped"] == "no webhook configured"
    assert posts == [], "nothing reached the channel"
    # …and an armed, configured run on a real session does post
    monkeypatch.setenv("DISCORD_TSDR_WEBHOOK_URL", "https://discord.test/hook")
    monkeypatch.setattr(idx, "pick_notable", lambda **k: [("XLE", 2.4), ("XBI", -3.1)])
    assert idx.run_close_post(**common)["posted"] == 2
    assert len(posts) == 2


def test_a_weekend_or_a_market_holiday_is_skipped(monkeypatch):
    monkeypatch.setenv("DISCORD_INDEX_CLOSE_ENABLED", "1")
    monkeypatch.setenv("DISCORD_TSDR_WEBHOOK_URL", "https://discord.test/hook")
    posts = []
    common = dict(**_kit(), post_fn=lambda *a: posts.append(a) or True)
    saturday = _dt.datetime(2026, 8, 29, 15, 45)
    assert idx.run_close_post(now_et=saturday, **common)["skipped"] == "not a trading day"
    assert not idx.is_trading_day(saturday) and not idx.is_trading_day(_dt.datetime(2026, 8, 30, 15, 45))
    # the holiday table is the BARS layer's, not a second copy that would drift
    from api.services import bars_fetch
    holiday = next(iter(sorted(bars_fetch._NYSE_HOLIDAYS_YYYYMMDD)))
    d = _dt.datetime.strptime(str(holiday), "%Y%m%d")
    if d.weekday() < 5:
        assert not idx.is_trading_day(d.replace(hour=15, minute=45))
    assert posts == []


def test_it_does_not_post_the_same_session_twice(monkeypatch):
    """A pod restart or a double fire must not put the charts up twice."""
    monkeypatch.setenv("DISCORD_INDEX_CLOSE_ENABLED", "1")
    monkeypatch.setenv("DISCORD_TSDR_WEBHOOK_URL", "https://discord.test/hook")
    monkeypatch.setattr(idx, "pick_notable", lambda **k: [])
    posts = []
    common = dict(**_kit(), post_fn=lambda *a: posts.append(a) or True,
                  now_et=_dt.datetime(2026, 8, 27, 15, 45))
    assert idx.run_close_post(**common)["posted"] == 2
    assert idx.run_close_post(**common)["skipped"] == "already posted today"
    assert len(posts) == 2
    # a new session posts again
    assert idx.run_close_post(**{**common, "now_et": _dt.datetime(2026, 8, 28, 15, 45)})["posted"] == 2
    assert len(posts) == 4


def test_the_marker_is_written_atomically_and_survives_a_bad_write(monkeypatch, tmp_path):
    """`open(w)` truncates before a failing write can be caught, and a
    half-written marker reads as "never posted" - which double-posts publicly."""
    idx.mark_posted("2026-08-27")
    assert idx.last_posted() == "2026-08-27"
    assert json.loads((tmp_path / "discord_index_close.json").read_text())["last_posted"] == "2026-08-27"
    assert not [p for p in tmp_path.iterdir() if p.name.startswith(".idxclose")], "no temp file left behind"
    (tmp_path / "discord_index_close.json").write_text("{not json", encoding="utf-8")
    assert idx.last_posted() == ""          # unreadable = "not posted", never a crash


# ── choosing the two ──────────────────────────────────────────────────────

def test_the_two_notable_etfs_are_the_days_biggest_movers_and_carry_their_number():
    """"whatever two you think from the day or week are notable" - the biggest
    absolute movers of the session, and the message names the move, because a
    pick shown without its number reads as arbitrary."""
    quotes = {"XLE": 2.4, "XBI": -3.9, "XLK": 0.2, "GDX": 1.1, "TLT": -0.05}
    picked = idx.pick_notable(exclude=idx.INDEXES + idx.CORE_ETFS, snapshot_fn=lambda pool: quotes)
    assert picked == [("XBI", -3.9), ("XLE", 2.4)], "largest absolute move first, direction ignored"
    assert all(isinstance(p, float) for _, p in picked)
    # anything already on the post is never chosen twice
    pool_seen = {}
    idx.pick_notable(exclude=("SMH",), snapshot_fn=lambda pool: pool_seen.update({"pool": pool}) or {})
    assert "SMH" not in pool_seen["pool"] and "XLE" in pool_seen["pool"]


def test_a_flat_tape_produces_no_movers_rather_than_two_arbitrary_ones():
    """On a quiet day the two least-flat funds are not "notable", and saying so
    would be a claim the post has not earned."""
    flat = {s: 0.1 for s in idx.CANDIDATE_ETFS}
    assert idx.pick_notable(snapshot_fn=lambda pool: flat) == []
    assert idx.pick_notable(snapshot_fn=lambda pool: {}) == []
    assert idx.pick_notable(snapshot_fn=lambda pool: {"XLE": None, "XLF": "n/a"}) == []
    assert idx.pick_notable(snapshot_fn=lambda pool: (_ for _ in ()).throw(RuntimeError("no quotes"))) == []
    assert idx.pick_notable(snapshot_fn=lambda pool: {"XLE": float("nan")}) == []


def test_the_post_is_still_worth_making_when_one_symbol_has_no_bars():
    """A late feed on one ticker drops that chart. It does not fake one, and it
    does not lose the other seven."""
    charts = idx.render_charts(idx.INDEXES, **_kit(fail_on=("IWM",)))
    assert [s for s, _, _ in charts] == ["QQQ", "SPY", "DIA"]
    assert idx.render_charts(("QQQ",), **_kit(house=lambda s: None)) == []
    boom = _kit(); boom["house_fn"] = lambda *a: (_ for _ in ()).throw(RuntimeError("renderer down"))
    assert idx.render_charts(("QQQ", "SPY"), **boom) == []


# ── what the channel actually sees ────────────────────────────────────────

def test_the_two_messages_name_the_session_and_justify_the_picks():
    now = _dt.datetime(2026, 8, 27, 15, 45)
    idxc = [(s, PNG, f"{s}.png") for s in idx.INDEXES]
    etfc = [(s, PNG, f"{s}.png") for s in ("SMH", "IGV", "XBI", "XLE")]
    msgs = idx.build_messages(now, idxc, etfc, [("XBI", -3.9), ("XLE", 2.4)])
    assert len(msgs) == 2, "four charts per message - eight in one grid is a wall of thumbnails"
    assert all(len(c) <= 4 for _, c in msgs)
    head, etfs = msgs[0][0], msgs[1][0]
    assert "Into the close" in head and "Thursday, August 27" in head
    assert all(s in head for s in idx.INDEXES)
    assert "XBI" in etfs and "-3.9%" in etfs and "+2.4%" in etfs, "the move is the justification"
    # nothing to show = no empty message
    assert idx.build_messages(now, [], [], []) == []
    assert len(idx.build_messages(now, idxc, [], [])) == 1


def test_a_post_never_mentions_anyone_and_stays_inside_discords_limits():
    charts = [(f"S{i}", PNG, f"S{i}.png") for i in range(12)]
    sent = {}
    idx.post_charts("https://discord.test/hook", "@everyone " + "x" * 4000, charts,
                    post_fn=lambda url, payload, files: sent.update(payload=payload, files=files) or True)
    assert sent["payload"]["allowed_mentions"] == {"parse": []}, "a scheduled public post never pings"
    assert len(sent["payload"]["content"]) <= 1900
    assert len(sent["files"]) == 10 and len(sent["payload"]["attachments"]) == 10   # Discord's cap
    assert [a["id"] for a in sent["payload"]["attachments"]] == list(range(10))
    assert idx.post_charts("", "x", charts) is False          # no webhook
    assert idx.post_charts("https://d/h", "x", []) is False   # nothing to say


def test_a_failed_post_is_reported_and_does_not_mark_the_session_done(monkeypatch):
    """If Discord refuses, the next run should try again rather than record a
    post that never happened."""
    monkeypatch.setenv("DISCORD_INDEX_CLOSE_ENABLED", "1")
    monkeypatch.setenv("DISCORD_TSDR_WEBHOOK_URL", "https://discord.test/hook")
    monkeypatch.setattr(idx, "pick_notable", lambda **k: [])
    rep = idx.run_close_post(**_kit(), post_fn=lambda *a: False,
                             now_et=_dt.datetime(2026, 8, 27, 15, 45))
    assert rep["posted"] == 0 and idx.last_posted() == ""
    assert idx.post_charts("https://d/h", "x", [("Q", PNG, "q.png")],
                           post_fn=lambda *a: (_ for _ in ()).throw(RuntimeError("boom"))) is False


def test_a_dry_run_renders_everything_and_posts_nothing(monkeypatch):
    """The way to look at a change before a public channel does."""
    monkeypatch.setattr(idx, "pick_notable", lambda **k: [("XLE", 2.4), ("XBI", -3.1)])
    posts = []
    rep = idx.run_close_post(**_kit(), post_fn=lambda *a: posts.append(a) or True,
                             now_et=_dt.datetime(2026, 8, 27, 15, 45), force=True, dry_run=True)
    assert posts == [] and rep["posted"] == 0 and rep["dry_run"] is True
    assert rep["symbols"] == list(idx.INDEXES) + ["SMH", "IGV", "XLE", "XBI"]
    assert len(rep["bytes"]) == 8 and all(b > 0 for b in rep["bytes"])
    assert len(rep["messages"]) == 2


def test_force_is_the_deliberate_one_off_and_ignores_every_gate(monkeypatch):
    """The owner asked for today's set after the 15:45 window had passed."""
    monkeypatch.setattr(idx, "pick_notable", lambda **k: [])
    monkeypatch.setenv("DISCORD_TSDR_WEBHOOK_URL", "https://discord.test/hook")
    posts = []
    saturday = _dt.datetime(2026, 8, 29, 18, 0)   # not armed, not a trading day, off-window
    rep = idx.run_close_post(**_kit(), post_fn=lambda url, p, f: posts.append(url) or True,
                             now_et=saturday, force=True)
    assert rep["posted"] == 2 and len(posts) == 2, "force overrides the JUDGEMENT gates"
    # ⛔ …but not the destination. force is "post anyway", never "find somewhere
    # to post": with no webhook there is nowhere to send it and it says so.
    monkeypatch.delenv("DISCORD_TSDR_WEBHOOK_URL")
    posts.clear()
    rep = idx.run_close_post(**_kit(), post_fn=lambda url, p, f: posts.append(url) or True,
                             now_et=saturday, force=True)
    assert rep["skipped"] == "no webhook configured" and posts == []


# ── the wiring, which is the part that silently never runs ────────────────

def test_the_job_is_registered_and_the_trigger_is_fifteen_minutes_before_the_close():
    """⛔ This repo's own history: the desk insights pass was written,
    documented as scheduled, and wired into NO scheduler for weeks. Read the
    registration out of main.py's AST rather than trusting the docstring."""
    tree = ast.parse(pathlib.Path("api/main.py").read_text(encoding="utf-8"))
    fns = {n.name: n for n in ast.walk(tree) if isinstance(n, ast.FunctionDef)}
    assert "register_discord_index_close_job" in fns, "the registrar exists"
    called = [n.func.id for n in ast.walk(tree)
              if isinstance(n, ast.Call) and isinstance(n.func, ast.Name)]
    assert called.count("register_discord_index_close_job") == 1, "…and something calls it"
    # the trigger itself: 15:45 ET, weekdays, one at a time
    src = ast.get_source_segment(pathlib.Path("api/main.py").read_text(encoding="utf-8"),
                                 fns["register_discord_index_close_job"])
    for must in ('hour=15', 'minute=45', 'day_of_week="mon-fri"', 'timezone=_ET',
                 'id="discord_index_close"', "max_instances=1"):
        assert must in src, must
    # a control: the probe can see a sibling it is not looking for, so a passing
    # assertion is not just "the string search always succeeds"
    assert called.count("register_pattern_vision_jobs") == 1


def test_the_manual_trigger_needs_the_push_secret():
    from api.routers import discord_interactions as r
    paths = [x.path for x in r.router.routes]
    assert "/api/discord/index-close/run" in paths
    assert hasattr(r, "run_index_close"), "one wiring shared by the schedule and the hand-fire"
