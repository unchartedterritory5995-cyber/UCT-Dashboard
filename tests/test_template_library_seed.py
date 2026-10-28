"""Task 11.10 -- the 27 official templates of spec §10 (ruling W11-R4), seeded as gallery rows.

`api/services/journal_two/template_library_seed.json` holds the rows and `template_library.load_library_seed` checks
every one when the module is imported (a broken seed fails the import, never a member's card).
`template_library.seed_template_library` writes them from `template_gallery.ensure_gallery_schema` (INSERT OR IGNORE
by seed key, `kind = 'official'`). What each section proves:

  * THE RULED TABLE: the 27 rows of the brief, item for item and in order (slug, title, group, kind of note,
    category, description, blocks with their targets), and GROUPS exactly.
  * THE IMPORT CHECKS: one broken copy per check, each refused naming its row, beside an unbroken control.
  * THE SEED: the payload shape, idempotent, no uuid4 drawn, an admin hide kept across a reboot.
  * VISIBILITY: listed only while the library switch AND wave 11 are on; listed by group.
  * EVERY ROW FILLS: used by a member whose book is the sample book (as real rows) and by a brand-new member, every
    slot becomes a node or one sentence, never a zero and never a 500.
  * COPY: no bare "plan" (R-33), no internal word, no emoji.
  * RELEASED ROWS NEVER CHANGE (R-P5-4): held against origin/master; FAILS (never skips) when git or origin/master
    cannot be read.

Everything that writes, writes into `tmp_path`; the real seed file and the shelf MANIFEST are only ever read.
"""
from __future__ import annotations

import copy
import json
import os
import re
import shutil
import subprocess
import uuid
from pathlib import Path

import pytest

from api.services.journal_two import journal_styles as js
from api.services.journal_two import template_gallery as gallery
from api.services.journal_two import template_library as tl
from api.services.journal_two.widget_engine import share, shelf
from api.services.journal_two.widget_engine.sources import CATALOG
from tests._gallery_w11_helpers import AUTHOR, MEMBER, OTHER, db, waves, ALL_WAVES  # noqa: F401 -- `db` is a fixture

REPO = Path(__file__).resolve().parents[1]
SEED_REL = "api/services/journal_two/template_library_seed.json"
PAYLOADS_REL = "api/services/journal_two/template_library_payloads.json"
FETCH = "git fetch origin master"

# ── the ruled table: the brief's 27 rows, verbatim ───────────────────────────────────────────────────────────────
# Block notation: a plain id; `b:<slug>:<rev>[:<range>]` a built slot pinned to a shelf revision; `i:<key>` a built
# slot on an inline definition; `r:<template>:<bind>:<display>` a routine slot; `t:<template|ref>:<bind>:<display>`
# a tracker slot.
RULED = (
    ("night-before-prep", "Night-before prep", "night_before", "daily_prep", "research",
     "Tomorrow's watchlist and levels, set the night before.",
     ["prepLevels", "prepEarnings", "r:night_before:next-trading-day:items"]),
    ("pre-market-prep", "Pre-market prep", "before_open", "daily_prep", "research",
     "The wire, your names reporting, your levels and your pre-market routine.",
     ["prepWire", "marketcontext", "myWatchlistToday", "myNamesReporting", "prepLevels",
      "r:premarket_routine:note-day:items"]),
    ("game-plan", "Game plan", "before_open", "daily_prep", "research",
     "Today's read, your room under your loss limit and your rules.",
     ["myGamePlan", "myRiskLeftToday", "myRules", "r:rules_i_keep:note-day:items"]),
    # R-33: the brief's "your plan around each report" reads "your trading plan" (the one allowed form).
    ("earnings-day-prep", "Earnings day prep", "before_open", "earnings", "research",
     "Your names reporting today and your trading plan around each report.",
     ["myNamesReporting", "prepEarnings", "marketcontext", "chart"]),
    ("watchlist-review", "Watchlist review", "before_open", "watchlist_note", "research",
     "Your list today, the names moving and the levels you are waiting for.",
     ["myWatchlistToday", "prepMovers", "prepLevels"]),
    ("mid-day-risk-check", "Mid-day and risk check", "during_day", "daily_prep", "research",
     "Today's P&L, open risk and room left under your daily loss limit.",
     ["myRiskLeftToday", "myPositionsRisk", "myTiltCheck"]),
    ("trade-plan-one-idea", "Trade plan (one idea)", "during_day", "trade_plan", "trade_plan",
     "One idea: the setup, entry, stop, target and size.",
     ["chart", "preEntryChecklist", "positionSizing", "marketcontext", "r:preentry_checks:note-day:items"]),
    ("end-of-day-recap", "End-of-day recap", "after_close", "post_trade_review", "review",
     "Today's trades, the rules you kept, your mistakes and tomorrow's list.",
     ["b:recent-trades:1:today", "b:daily-pnl-bars:1", "myRulesCheck", "myMistakes", "r:eod_review:note-day:items"]),
    ("tag-todays-trades", "Tag today's trades", "after_close", "post_trade_review", "review",
     "Today's trades, one row each, to tag setup, mistakes and emotions.",
     ["i:a", "myMistakes"]),
    ("trade-post-mortem", "Trade replay and rules check", "after_close", "post_trade_review", "review",
     "Replay one trade from its record and chart, then check it against your rules.",
     ["tradeReview", "chart", "myRules"]),
    ("mistake-log-entry", "Mistake log entry", "after_close", "post_trade_review", "review",
     "One mistake, what caused it and the rule that would have stopped it.",
     ["myMistakes", "myRulesCheck"]),
    ("tilt-reset", "Tilt reset", "after_close", "post_trade_review", "review",
     "A short reset after a loss: what happened, your room left and your next step.",
     ["myTiltCheck", "myRiskLeftToday", "r:tilt_reset:note-day:items"]),
    ("weekly-review", "Weekly review", "weekly_monthly", "weekly_review", "review",
     "Your week's numbers, rules kept, recurring mistakes and one thing to change.",
     ["b:weekly-scorecard:1", "b:equity-curve:1:this_week", "myRulesCheck", "myMistakes",
      "r:weekly_review_routine:week:items"]),
    ("weekend-swing-review", "Weekend swing review", "weekly_monthly", "weekend_prep", "research",
     "Open positions, stops and earnings next week, with your routine for the trading week.",
     ["myPositionsRisk", "prepEarnings", "b:weekly-scorecard:1", "r:swing_weekend:week:items"]),
    ("monthly-review", "Monthly review", "weekly_monthly", "weekly_review", "review",
     "This month's results, the curve, the best trades and your symbols.",
     ["b:month-in-review:1", "b:equity-curve:1:this_month", "b:best-trades:1:this_month",
      "b:performance-by-symbol:1:this_month"]),
    ("quarterly-edge-review", "Quarterly edge review", "weekly_monthly", "weekly_review", "review",
     "Where your edge came from this quarter: expectancy, time of day, hold time and R.",
     ["b:expectancy:1:this_quarter", "b:pnl-by-time-of-day:1:this_quarter", "b:pnl-by-hold-time:1:this_quarter",
      "b:r-multiple-distribution:1:this_quarter"]),
    ("year-in-review", "Year in review", "weekly_monthly", "weekly_review", "review",
     "Your year: the curve, the drawdown, the best trades and your weekdays.",
     ["b:equity-curve:1:ytd", "b:max-drawdown:1:ytd", "b:best-trades:1:ytd", "b:pnl-by-weekday:1:ytd"]),
    ("goal-setting", "Goal setting", "weekly_monthly", "weekly_review", "review",
     "Your goals for the period and the numbers they rest on.",
     ["b:goals-progress:1", "b:win-rate:1", "b:expectancy:1"]),
    ("setup-study", "Setup study", "playbook", "thesis", "research",
     "Your own stats on one setup: trades, win rate, expectancy and when it works.",
     ["i:a", "i:b"]),
    ("new-setup-idea", "New setup idea", "playbook", "thesis", "research",
     "A new setup: what it is, its rules and how you'll test it.",
     ["chart", "myRules"]),
    ("rules-review", "Rules review", "playbook", "weekly_review", "review",
     "Your rules, how often you kept them and what keeping them was worth.",
     ["myRules", "myRulesCheck", "b:process-vs-results:1", "r:rules_i_keep:note-day:pnl"]),
    ("options-trade-plan", "Options trade plan", "playbook", "trade_plan", "trade_plan",
     "One options trade: strategy, max loss, IV and expiry.",
     ["chart", "preEntryChecklist", "marketcontext"]),
    ("pre-session-check-in", "Pre-session check-in", "mindset", "daily_prep", "research",
     "Sleep, mood and focus before the session, and how they compare with your P&L.",
     ["moodCheckIn", "t:sleep:note-day:chart", "t:checkin:mood:note-day:pnl", "t:checkin:focus:note-day:pnl"]),
    ("prop-firm-challenge", "Prop-firm challenge tracker", "challenges", "daily_prep", "research",
     "Room left under your daily loss and max drawdown limits, and today's risk.",
     ["myPropFirm", "myRiskLeftToday", "b:equity-curve:1", "r:rules_i_keep:note-day:items"]),
    ("consistency-30", "30-day consistency challenge", "challenges", "weekly_review", "review",
     "Thirty trading days of the same routine, and how those days compare with your P&L.",
     ["r:consistency_30:note-day:pnl", "myRevengeClean", "b:daily-pnl-bars:1"]),
    ("morning-routine", "Morning routine", "habits", "daily_prep", "research",
     "Your morning routine, ticked every trading day.",
     ["r:morning_routine:note-day:items", "t:sleep:note-day:chart"]),
    ("trading-day-trackers", "Trading-day tracker set", "habits", "daily_prep", "research",
     "Sleep, energy, exercise and whether you kept your trading plan, once a day.",
     ["t:sleep:note-day:chart", "t:energy:note-day:chart", "t:exercise:note-day:chart",
      "t:plan_followed:note-day:chart"]),
)

#: The brief's GROUPS, verbatim.
RULED_GROUPS = (("night_before", "The night before"), ("before_open", "Before the open"),
                ("during_day", "During the day"), ("after_close", "After the close"),
                ("weekly_monthly", "Weekly / monthly"), ("playbook", "Playbook"), ("mindset", "Mindset"),
                ("challenges", "Challenges"), ("habits", "Habits"))


def _notation(block: dict) -> str:
    bid, s = block["block"], block["settings"]
    fam = js.slot_family(bid)
    if fam == "built":
        if s["ref"].startswith("inline:"):
            return "i:" + s["ref"][len("inline:"):]
        out = f"b:{s['ref'][len('shelf:'):]}:{s['defRev']}"
        return out + (f":{s['range']['token']}" if "range" in s else "")
    if fam in ("routine", "tracker"):
        target = s.get("template") or s.get("ref")
        return f"{fam[0]}:{target}:{s['bind']}:{s['display']}"
    assert s == {}, bid                                    # a plain block keeps its defaults (no settings)
    return bid


#: The rows replaced by a newer version (the seed's `retired` list), and the version each replaced slug lives at now.
#: 2026-10-27: "Trade post-mortem" (v1) read as a twin of the built-in Trade Post-Mortem under "Around a trade", so
#: v2 renames it "Trade replay and rules check"; its blocks, sections and stored payload are v1's.
RETIRED = ("uct-template-trade-post-mortem-v1",)
LIVE_VERSION = {"trade-post-mortem": 2}


def _live() -> list[dict]:
    return tl.live_rows()


def test_twenty_seven_rows_in_spec_order_and_groups():
    assert tl.GROUPS == RULED_GROUPS and tl.GROUP_KEYS == tuple(k for k, _ in RULED_GROUPS)
    rows = _live()
    got = [(r["slug"], r["title"], r["group"], r["kindId"], r["category"], r["description"],
            [_notation(b) for b in r["blocks"]]) for r in rows]
    assert got == [(s, t, g, k, c, d, list(bl)) for s, t, g, k, c, d, bl in RULED]
    assert [r["seedKey"] for r in rows] == [f"uct-template-{s}-v{LIVE_VERSION.get(s, 1)}" for s, *_ in RULED]
    assert all(r["blocks"][i]["enabled"] is True for r in rows for i in range(len(r["blocks"])))
    # every group is used, and the rows come in group order (the section draws GROUPS order)
    order = [tl.GROUP_KEYS.index(r["group"]) for r in rows]
    assert order == sorted(order) and set(order) == set(range(len(tl.GROUPS)))
    # Setup study's choice: one setup, Any not offered (Review Focus 5)
    study = next(r for r in rows if r["slug"] == "setup-study")
    assert study["slots"] == [{"id": "p1", "type": "setup", "label": "Setup", "any": False,
                               "source": "closed_trades", "field": "setup"}]
    for d in study["definitions"]:
        assert d["plan"]["filters"] == [{"field": "setup", "op": "in", "values": [{"pick": "p1"}]}]
        assert d["plan"]["range"] == {"token": "last_12m"}
    a, b = study["definitions"]
    assert [m["key"] for m in a["plan"]["measures"]] == ["trades", "win_rate", "expectancy_r"]
    assert a["plan"]["view"]["type"] == "number"
    assert b["plan"]["split"] == {"by": "hour_et"} and b["plan"]["view"]["type"] == "bar"
    assert [m["key"] for m in b["plan"]["measures"]] == ["net_pnl"]
    tag = next(r for r in rows if r["slug"] == "tag-todays-trades")["definitions"][0]["plan"]
    assert tag["source"] == "closed_trades" and tag["range"] == {"token": "today"}
    assert [m["key"] for m in tag["measures"]] == ["net_pnl", "total_r"] and tag["view"]["type"] == "list"
    assert "sort" not in tag                               # a list reads newest first by default


def _stored_blob(rel: str) -> bytes:
    """The bytes git STORES for `rel` (the index blob; `core.autocrlf` may rewrite the working copy's endings)."""
    r = subprocess.run([shutil.which("git") or "git", "-C", str(REPO), "cat-file", "blob", f":{rel}"],
                       capture_output=True, env=_scrubbed_env())
    if r.returncode != 0:
        pytest.fail(f"git could not read the stored blob of {rel}: {r.stderr.decode(errors='replace').strip()}")
    return r.stdout


def _cr_free(blob: bytes) -> bool:
    return b"\r" not in blob


def test_the_seed_files_are_lf_json():
    for rel in (SEED_REL, PAYLOADS_REL):
        blob = _stored_blob(rel)
        assert _cr_free(blob), rel                        # not one CR byte, CRLF or bare
        assert blob.endswith(b"}\n") and json.loads(blob)
    assert json.loads(_stored_blob(SEED_REL))["retired"] == list(RETIRED)
    # control: the check sees a CR, CRLF and bare alike
    assert not _cr_free(b'{"a": 1}\r\n') and not _cr_free(b'{"a":\r 1}\n') and _cr_free(b'{"a": 1}\n')


# ── the import checks ────────────────────────────────────────────────────────────────────────────────────────────

def _seed_doc() -> dict:
    return json.loads((REPO / SEED_REL).read_text(encoding="utf-8"))


def _row(doc: dict, slug: str) -> dict:
    return next(r for r in doc["templates"] if r["slug"] == slug)


def _write(tmp_path: Path, doc: dict, name: str = "seed.json") -> Path:
    p = tmp_path / name
    p.write_text(json.dumps(doc), encoding="utf-8")
    return p


def _break(fn):
    def apply(doc):
        fn(doc)
        return doc
    return apply


#: One broken copy per check: (what is broken, the row the refusal must name, the edit).
BREAKS = [
    ("seed key shape", "uct-template-game-plan-1", _break(lambda d: _row(d, "game-plan").update(
        seedKey="uct-template-game-plan-1"))),
    ("seed key twice", "uct-template-tilt-reset-v1", _break(lambda d: d["templates"].append(
        copy.deepcopy(_row(d, "tilt-reset"))))),
    ("slug and key disagree", "uct-template-game-plan-v1", _break(lambda d: _row(d, "game-plan").update(
        slug="game-plans"))),
    ("unknown group", "uct-template-game-plan-v1", _break(lambda d: _row(d, "game-plan").update(group="evening"))),
    ("unknown kind of note", "uct-template-game-plan-v1", _break(lambda d: _row(d, "game-plan").update(
        kindId="my_kind"))),
    ("unknown category", "uct-template-game-plan-v1", _break(lambda d: _row(d, "game-plan").update(
        category="mindset"))),
    ("a block the grammar refuses", "uct-template-new-setup-idea-v1", _break(lambda d: _row(
        d, "new-setup-idea")["blocks"][0].update(settings={"tf": "2"}))),
    ("a block not in its reduced form", "uct-template-tilt-reset-v1", _break(lambda d: _row(
        d, "tilt-reset")["blocks"][2]["settings"].pop("display"))),
    ("an unpinned shelf revision", "uct-template-goal-setting-v1", _break(lambda d: _row(
        d, "goal-setting")["blocks"][1]["settings"].update(defRev=9))),
    ("a member's own widget", "uct-template-goal-setting-v1", _break(lambda d: _row(
        d, "goal-setting")["blocks"][1].update(settings={"ref": f"def:{uuid.uuid4()}", "defRev": 1}))),
    ("an unknown routine template", "uct-template-tilt-reset-v1", _break(lambda d: _row(
        d, "tilt-reset")["blocks"][2]["settings"].update(template="no_such_routine"))),
    ("a member's own routine", "uct-template-tilt-reset-v1", _break(lambda d: _row(
        d, "tilt-reset")["blocks"][2].update(settings={"ref": f"routine:{uuid.uuid4()}", "bind": "note-day",
                                                       "display": "items"}))),
    ("a plan that does not validate", "uct-template-setup-study-v1", _break(lambda d: _row(
        d, "setup-study")["definitions"][0]["plan"]["measures"].append({"key": "no_such_measure"}))),
    ("an undeclared choice", "uct-template-setup-study-v1", _break(lambda d: _row(
        d, "setup-study")["definitions"][1]["plan"]["filters"][0].update(values=[{"pick": "p2"}]))),
    ("a choice no plan uses", "uct-template-tag-todays-trades-v1", _break(lambda d: _row(
        d, "tag-todays-trades")["slots"].append({"id": "p1", "type": "tag", "label": "Tag", "any": True,
                                                 "source": "closed_trades", "field": "tags"}))),
    ("an unknown choice type", "uct-template-setup-study-v1", _break(lambda d: _row(
        d, "setup-study")["slots"][0].update(type="color"))),
    ("an inline ref with no definition", "uct-template-setup-study-v1", _break(lambda d: _row(
        d, "setup-study")["blocks"][1]["settings"].update(ref="inline:z"))),
    ("a definition no block names", "uct-template-tag-todays-trades-v1", _break(lambda d: _row(
        d, "tag-todays-trades")["definitions"].append(dict(copy.deepcopy(_row(d, "tag-todays-trades")[
            "definitions"][0]), key="b")))),
    ("a block in no section", "uct-template-mistake-log-entry-v1", _break(lambda d: _row(
        d, "mistake-log-entry")["sections"][1].update(blocks=[]))),
    ("a block in two sections", "uct-template-mistake-log-entry-v1", _break(lambda d: _row(
        d, "mistake-log-entry")["sections"][1]["blocks"].append("myMistakes"))),
    ("one section", "uct-template-morning-routine-v1", _break(lambda d: _row(d, "morning-routine").update(
        sections=[{"heading": "All", "prompt": "Everything.", "blocks": ["routine_a", "tracker_a"]}]))),
    ("an empty heading", "uct-template-morning-routine-v1", _break(lambda d: _row(
        d, "morning-routine")["sections"][0].update(heading="  "))),
    ("an extra key", "uct-template-morning-routine-v1", _break(lambda d: _row(d, "morning-routine").update(
        icon="sun"))),
    ("a second live row for one slug", "uct-template-morning-routine-v2", _break(lambda d: d["templates"].append(
        dict(copy.deepcopy(_row(d, "morning-routine")), seedKey="uct-template-morning-routine-v2")))),
    ("a retired key that is no row", "uct-template-nothing-v1", _break(lambda d: d.update(
        retired=d["retired"] + ["uct-template-nothing-v1"]))),
    ("a retired row with no newer row", "uct-template-morning-routine-v1", _break(lambda d: d.update(
        retired=d["retired"] + ["uct-template-morning-routine-v1"]))),
    ("a retirement undone: two live rows for one slug", "uct-template-trade-post-mortem-v2", _break(lambda d: d.update(
        retired=[k for k in d["retired"] if k != "uct-template-trade-post-mortem-v1"]))),
]


def test_an_unbroken_copy_loads(tmp_path):
    rows = tl.load_library_seed(_write(tmp_path, _seed_doc()))
    assert [r["seedKey"] for r in rows] == [r["seedKey"] for r in tl.rows()]


@pytest.mark.parametrize("what, names, edit", BREAKS, ids=[b[0] for b in BREAKS])
def test_seed_validates_at_import(tmp_path, what, names, edit):
    with pytest.raises(tl.LibrarySeedError) as e:
        tl.load_library_seed(_write(tmp_path, edit(_seed_doc())))
    assert names in str(e.value), (what, str(e.value))


def test_a_retired_row_may_share_its_slug_with_its_replacement(tmp_path):
    doc = _seed_doc()
    doc["templates"].append(dict(copy.deepcopy(_row(doc, "morning-routine")), seedKey="uct-template-morning-routine-v2"))
    doc["retired"] = doc["retired"] + ["uct-template-morning-routine-v1"]
    rows = tl.load_library_seed(_write(tmp_path, doc))
    assert rows[-1]["seedKey"] == "uct-template-morning-routine-v2"


def test_the_shipped_seed_is_valid():
    """The CI guard (W11-R37): the committed seed loads with no error, so a broken seed cannot ship."""
    tl.reset_library_state()
    state = tl.library_state()
    assert state.error is None and len(state.rows) == 27 + len(RETIRED) and state.retired == RETIRED
    assert len(tl.live_rows()) == 27
    assert [r["seedKey"] for r in tl.load_library_seed()] == [r["seedKey"] for r in state.rows]


_BROKEN_IMPORT = r"""
import pathlib, sys
real = pathlib.Path.read_text
def read_text(self, *a, **k):
    if self.name == "template_library_seed.json":
        return '{"templates": [{"seedKey": "broken"}]}'
    return real(self, *a, **k)
pathlib.Path.read_text = read_text
from api.services.journal_two import template_library as tl
st = tl.library_state()
print("IMPORTED", tl.GROUP_KEYS[-1], st.error is not None, len(st.rows))
"""


def test_the_module_imports_even_when_the_seed_is_broken():
    """W11-R37: importing `template_library` never raises, whatever the seed holds; the error is the state's."""
    import sys
    r = subprocess.run([sys.executable, "-c", _BROKEN_IMPORT], capture_output=True, text=True, cwd=str(REPO),
                       env=_scrubbed_env(), timeout=120)
    assert r.returncode == 0, r.stderr[-2000:]
    assert "IMPORTED habits True 0" in r.stdout, r.stdout[-2000:]
    assert "the official template seed is broken" in r.stdout
    # control: the same probe with the real seed reports a valid library, so the patch above is what broke it
    ok = subprocess.run([sys.executable, "-c", _BROKEN_IMPORT.replace('"template_library_seed.json"', '"nothing"')],
                        capture_output=True, text=True, cwd=str(REPO), env=_scrubbed_env(), timeout=120)
    want = f"IMPORTED habits False {27 + len(RETIRED)}"                    # every row, the retired ones included
    assert ok.returncode == 0 and want in ok.stdout, ok.stdout[-2000:] + ok.stderr[-2000:]


@pytest.fixture
def broken_seed(tmp_path):
    """`SEED_FILE` pointed at a corrupted copy (one row's group unknown), the cached state reset around the test."""
    doc = _seed_doc()
    _row(doc, "morning-routine")["group"] = "evening"
    real = tl.SEED_FILE
    tl.SEED_FILE = _write(tmp_path, doc)
    tl.reset_library_state()
    try:
        yield
    finally:
        tl.SEED_FILE = real
        tl.reset_library_state()


def test_a_broken_seed_boots_and_every_read_keeps_working(db, broken_seed, capsys):
    """W11-R37: a corrupted seed -> the boot succeeds, the official rows are absent, the error is logged loudly, and
    `list_gallery(group=...)` still answers (no LibrarySeedError, no 500)."""
    db.execute("DELETE FROM j2_template_gallery")
    db.commit()
    gallery.ensure_gallery_schema(db)                                         # a boot: never raises
    out = capsys.readouterr().out
    assert "ERROR" in out and "uct-template-morning-routine-v1" in out
    assert _official(db) == []
    st = tl.library_state()                                                   # never raises: the error is state
    assert st.error and "uct-template-morning-routine-v1" in st.error and st.rows == () and st.retired == ()
    assert tl.seed_template_library(db) == 0 and tl.rows() == [] and tl.live_rows() == []
    assert gallery.list_gallery(MEMBER, group="habits", conn=db) == []
    assert gallery.list_gallery(MEMBER, conn=db) is not None                  # the other rows still list
    with pytest.raises(gallery.GalleryError):
        gallery.list_gallery(MEMBER, group="evening", conn=db)               # the error class is unchanged
    assert tl.GROUP_KEYS == tuple(k for k, _ in RULED_GROUPS)                 # static, independent of the seed


# ── the shelf pins and the inline plans ──────────────────────────────────────────────────────────────────────────

def _manifest() -> dict:
    return json.loads(shelf.MANIFEST_PATH.read_text(encoding="utf-8"))


def test_every_pinned_shelf_revision_exists(tmp_path):
    files = {e["file"] for e in _manifest()["files"]}
    pins = [(b["settings"]["ref"], b["settings"]["defRev"]) for r in tl.rows() for b in r["blocks"]
            if js.slot_family(b["block"]) == "built" and b["settings"]["ref"].startswith("shelf:")]
    assert len(pins) == 23                                         # non-vacuity: every built shelf slot of the table
    for ref, rev in pins:
        assert f"{ref[len('shelf:'):]}.r{rev}.json" in files, (ref, rev)
        assert shelf.revision(ref, rev) is not None, (ref, rev)
    # control: a MANIFEST without one pinned revision refuses the seed, naming the row that pins it
    man = _manifest()
    man["files"] = [e for e in man["files"] if e["file"] != "goals-progress.r1.json"]
    (tmp_path / "MANIFEST.json").write_text(json.dumps(man), encoding="utf-8")
    with pytest.raises(tl.LibrarySeedError, match="uct-template-goal-setting-v1"):
        tl.load_library_seed(manifest_path=tmp_path / "MANIFEST.json")


def test_every_inline_plan_validates():
    seen = 0
    for r in tl.rows():
        answers = {s["id"]: ({"any": True} if s["any"] else "Breakout") for s in r["slots"]}
        for d in r["definitions"]:
            resolved = share.resolve_plan(copy.deepcopy(d["plan"]), r["slots"], answers, catalog=CATALOG)
            assert not share.has_unresolved(resolved)
            seen += 1
        for s in r["slots"]:
            if not s["any"]:
                # control: the choice is really required -- Any is refused for it
                with pytest.raises(share.ShareError):
                    for d in r["definitions"]:
                        share.resolve_plan(copy.deepcopy(d["plan"]), r["slots"], {**answers, s["id"]: {"any": True}},
                                           catalog=CATALOG)
    assert seen == 3


# ── the seed ─────────────────────────────────────────────────────────────────────────────────────────────────────

def _official(c):
    return c.execute("SELECT * FROM j2_template_gallery WHERE kind = 'official' ORDER BY rowid").fetchall()


def test_the_rows_are_the_payload_shape_the_library_reads(db):
    assert tl.seed_template_library(db) == 27
    rows = _official(db)
    assert [r["id"] for r in rows] == [gallery.firm_style_id(r["seedKey"]) for r in _live()]
    for stored, seed in zip(rows, _live()):
        assert (stored["item_type"], stored["status"], stored["featured"], stored["version"], stored["user_id"],
                stored["hidden"], stored["template_group"], stored["title"], stored["category"]) == (
            "style", "approved", 1, 1, None, 0, seed["group"], seed["title"], seed["category"])
        payload = json.loads(stored["payload_json"])
        assert set(payload) == {"kindId", "outlineBodyJson", "blocks", "properties", "definitions", "routines",
                                "trackers", "slots", "format"}
        assert payload["format"] == share.FORMAT and payload["properties"] == {} and payload["routines"] == []
        assert payload["blocks"] == seed["blocks"] and payload["definitions"] == seed["definitions"]
        assert json.loads(stored["body_json"]) == payload["outlineBodyJson"]
        # the outline: per section a heading, its prompt, then one placeholder per block, all through the reducer
        content = payload["outlineBodyJson"]["content"]
        want = []
        for sec in seed["sections"]:
            want += [("heading", sec["heading"]), ("paragraph", sec["prompt"])]
            want += [("paragraph", "{{block:%s}}" % b) for b in sec["blocks"]]
        assert [(n["type"], gallery._node_text(n)) for n in content] == want
        assert gallery.sanitize_body(payload["outlineBodyJson"], "") == payload["outlineBodyJson"]
        preview = json.loads(stored["preview_json"])
        assert preview and not any("{{block:" in ln["text"] for ln in preview)
        # the library's own reader keeps every block and part (the slots are shared targets only)
        safe = gallery._safe_listed(payload)
        assert [b["block"] for b in safe["blocks"]] == [b["block"] for b in seed["blocks"]]
        assert safe["slots"] == seed["slots"] and safe["format"] == share.FORMAT


def test_seed_is_idempotent_and_never_undoes_an_admin_hide(db, monkeypatch):
    db.execute("DELETE FROM j2_template_gallery")
    db.commit()

    def refuse():
        raise AssertionError("the official seed drew a uuid4")
    monkeypatch.setattr(gallery.uuid, "uuid4", refuse)
    assert tl.seed_template_library(db) == 27
    monkeypatch.undo()
    waves(monkeypatch, *ALL_WAVES)
    monkeypatch.setenv("NOTEBOOK_STYLE_LIBRARY_ENABLED", "1")
    monkeypatch.setenv("NOTEBOOK_JOURNAL_STYLES_ENABLED", "1")
    assert tl.seed_template_library(db) == 0
    target = _official(db)[3]["id"]
    assert gallery.admin_act("admin", target, "hide", conn=db) is not None
    gallery.ensure_gallery_schema(db)                                                    # a reboot
    assert db.execute("SELECT hidden FROM j2_template_gallery WHERE id = ?", (target,)).fetchone()[0] == 1
    assert len(_official(db)) == 27
    assert target not in {x["id"] for x in gallery.list_gallery(MEMBER, conn=db)}


def test_a_boot_seeds_the_official_templates(db):
    db.execute("DELETE FROM j2_template_gallery")
    db.commit()
    gallery.ensure_gallery_schema(db)
    assert len(_official(db)) == 27


def test_a_failed_official_seed_is_logged_and_writes_nothing(db, monkeypatch, capsys):
    db.execute("DELETE FROM j2_template_gallery")
    db.commit()
    monkeypatch.setattr(tl, "row_parts", lambda row: (_ for _ in ()).throw(RuntimeError("broken outline")))
    assert tl.seed_template_library(db) == 0
    assert _official(db) == []
    assert "official template seed skipped" in capsys.readouterr().out


def test_a_retired_row_is_hidden_only_when_its_replacement_is_new_and_an_unhide_stays(db, tmp_path):
    """M-3: the seed sets visibility only for rows it newly creates. A stored -v1 is hidden in the pass that inserts
    its -v2; an admin who unhides it afterwards keeps it as they left it across reboots."""
    db.execute("DELETE FROM j2_template_gallery")
    db.commit()
    tl.reset_library_state()
    assert tl.seed_template_library(db) == 27
    v1, v2 = "uct-template-morning-routine-v1", "uct-template-morning-routine-v2"
    doc = _seed_doc()
    doc["templates"].append(dict(copy.deepcopy(_row(doc, "morning-routine")), seedKey=v2))
    doc["retired"] = doc["retired"] + [v1]
    real = tl.SEED_FILE
    tl.SEED_FILE = _write(tmp_path, doc)
    tl.reset_library_state()
    try:
        state = lambda k: db.execute("SELECT hidden, hidden_by FROM j2_template_gallery WHERE seed_key = ?",  # noqa
                                     (k,)).fetchone()
        assert tl.seed_template_library(db) == 1                              # the -v2 is new
        assert tuple(state(v1)) == (1, tl.RETIRED_BY) and tuple(state(v2)) == (0, None)
        gid = gallery.firm_style_id(v1)
        assert gallery.admin_act("admin", gid, "unhide", conn=db) is not None
        for _ in range(2):                                                    # reboots
            assert tl.seed_template_library(db) == 0
            assert tuple(state(v1)) == (0, None)
        # a fresh install never inserts the retired row
        db.execute("DELETE FROM j2_template_gallery")
        db.commit()
        assert tl.seed_template_library(db) == 27
        assert state(v1) is None and tuple(state(v2)) == (0, None)
    finally:
        tl.SEED_FILE = real
        tl.reset_library_state()


def test_the_shipped_retirement_on_an_install_that_holds_v1_keeps_every_members_copy(db, tmp_path):
    """The first real retirement (2026-10-27, Trade post-mortem v1 -> Trade replay and rules check v2), on an install
    seeded BEFORE it: the boot that inserts v2 hides the stored v1 (never deletes it), the library lists v2 in its
    place, and a member who already used v1 keeps their copy and their note, can still make notes from the copy, and
    a Use of the hidden v1 answers None (the route's 404), never a 500."""
    from api.services.journal_two import notes as notes_service
    v1, v2 = RETIRED[0], "uct-template-trade-post-mortem-v2"
    released = _seed_doc()                       # the seed as it was released: v1 live, v2 absent, nothing retired
    released["templates"] = [r for r in released["templates"] if r["seedKey"] != v2]
    released["retired"] = []
    db.execute("DELETE FROM j2_template_gallery")
    db.commit()
    real = tl.SEED_FILE
    tl.SEED_FILE = _write(tmp_path, released)
    tl.reset_library_state()
    try:
        assert tl.seed_template_library(db) == 27
    finally:
        tl.SEED_FILE = real
        tl.reset_library_state()
    g1, g2 = gallery.firm_style_id(v1), gallery.firm_style_id(v2)
    assert g1 in _listed_official(db) and g2 not in _listed_official(db)
    used = _fill(db, MEMBER, next(r for r in tl.rows() if r["seedKey"] == v1), None)
    assert used is not None
    copy_id, note_id = used["style"]["id"], used["note"]["id"]

    gallery.ensure_gallery_schema(db)                                         # the boot that ships this seed
    row = lambda k: db.execute("SELECT hidden, hidden_by, status FROM j2_template_gallery WHERE seed_key = ?",  # noqa
                               (k,)).fetchone()
    assert tuple(row(v1)) == (1, tl.RETIRED_BY, "approved")                   # hidden, kept, never deleted
    assert tuple(row(v2)) == (0, None, "approved")
    listed = _listed_official(db)
    assert g1 not in listed and g2 in listed and len(listed) == 27
    titles = {x["id"]: x["title"] for x in gallery.list_gallery(MEMBER, conn=db)}
    assert titles[g2] == "Trade replay and rules check" and "Trade post-mortem" not in titles.values()
    # the member's copy and note are untouched, and the copy still makes notes
    style = db.execute("SELECT source_gallery_id, deleted_at, archived_at FROM j2_journal_styles WHERE id = ?",
                       (copy_id,)).fetchone()
    assert tuple(style) == (g1, None, None)
    assert notes_service.get_note(MEMBER, note_id, db) is not None
    again, _ = js.create_styled_note(MEMBER, {"styleId": copy_id, "title": "After the rename"}, conn=db)
    assert again["id"] != note_id
    # a Use of the retired row is an absent item (the route's 404); a Use of v2 makes the member a fresh copy
    assert gallery.use_library_template(MEMBER, g1, conn=db) is None
    fresh = gallery.use_library_template(MEMBER, g2, conn=db)
    assert fresh is not None and fresh["style"]["id"] != copy_id
    # a second boot changes nothing
    assert tl.seed_template_library(db) == 0 and tuple(row(v1)) == (1, tl.RETIRED_BY, "approved")


# ── visibility ───────────────────────────────────────────────────────────────────────────────────────────────────

def _listed_official(c, **kw):
    return [x["id"] for x in gallery.list_gallery(MEMBER, conn=c, **kw) if x["itemType"] == "style" and x["firm"]
            and x["id"] in {r["id"] for r in _official(c)}]


def test_official_rows_hidden_while_w11_off(db, monkeypatch):
    db.execute("DELETE FROM j2_template_gallery")
    db.commit()
    tl.seed_template_library(db)
    ids = [r["id"] for r in _official(db)]
    assert len(_listed_official(db)) == 27                                   # library on, wave 11 on
    assert all(gallery.get_item(MEMBER, i, conn=db) is not None for i in ids)
    monkeypatch.delenv("NOTEBOOK_WIDGETS_W11_ENABLED", raising=False)
    assert _listed_official(db) == [] and _listed_official(db, section="picks") == []
    assert all(gallery.get_item(MEMBER, i, conn=db) is None for i in ids)
    assert all(gallery.get_item("admin", i, is_admin=True, conn=db) is None for i in ids)
    monkeypatch.setenv("NOTEBOOK_WIDGETS_W11_ENABLED", "1")
    monkeypatch.setenv("NOTEBOOK_STYLE_LIBRARY_ENABLED", "0")
    assert _listed_official(db) == []
    monkeypatch.setenv("NOTEBOOK_STYLE_LIBRARY_ENABLED", "1")
    assert len(_listed_official(db)) == 27                                   # stored, never deleted: back on re-arm


def test_official_rows_listed_by_group(db):
    db.execute("DELETE FROM j2_template_gallery")
    db.commit()
    tl.seed_template_library(db)
    by_id = {gallery.firm_style_id(r["seedKey"]): r["group"] for r in _live()}
    total = 0
    for key, _label in tl.GROUPS:
        got = _listed_official(db, group=key)
        assert got and all(by_id[i] == key for i in got)
        assert sorted(got) == sorted(i for i, g in by_id.items() if g == key)
        total += len(got)
    assert total == 27
    assert len(_listed_official(db, group=None)) == len(_listed_official(db, group="")) == 27
    with pytest.raises(gallery.GalleryError):
        gallery.list_gallery(MEMBER, group="evening", conn=db)


# ── every row fills ──────────────────────────────────────────────────────────────────────────────────────────────

BOOK_MEMBER = MEMBER
NEW_MEMBER = OTHER


def _seed_book(c, uid: str) -> dict:
    """The sample book's accounts, trades and positions, written as the journal stores them, for `uid`."""
    from api.services.journal_two.widget_engine import run
    book = json.loads(run.SAMPLE_BOOK_PATH.read_text(encoding="utf-8"))
    now = "2026-10-24T00:00:00Z"
    for a in book["accounts"]:
        c.execute("INSERT INTO j2_accounts (id, user_id, name, color, starting_balance, account_size,"
                  " account_size_set, created_at, updated_at) VALUES (?, ?, ?, '#fff', 0, ?, 1, ?, ?)",
                  (f"{uid}-{a['id']}", uid, a["name"], a["size"] or 0, now, now))
    for t in book["closed_trades"]:
        c.execute(
            """INSERT INTO j2_trades (id, user_id, position_id, symbol, side, shares, entry_price,
                   entry_date, exit_price, exit_date, original_stop, setup, pnl_dollar,
                   pnl_percent, r_multiple, hold_days, result, context_at_entry, account_id,
                   created_at, trading_day_et, hour_et, fees, analytics_excluded, mistake_tags,
                   emotion_tags, source, regime)
               VALUES (?, ?, 'manual', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '{}', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (f"{uid}-{t['id']}", uid, t["symbol"], t["side"], t["shares"], t["entry_price"], t["entry_at"],
             t["exit_price"], t["exit_at"], t["stop"], t["setup"], t["gross"], t["pct_return"] / 100.0, t["r"],
             t["hold_days"], t["result"], f"{uid}-{t['account']}", now, t["day"], t["hour_et"], t["fees"],
             1 if t["flagged"] else 0, json.dumps(t["mistake"]) if t["mistake"] else None,
             json.dumps(t["emotion"]) if t["emotion"] else None,
             None if t["origin"] == "manual" else t["origin"], t["regime"]))
    for p in book["open_positions"]:
        c.execute(
            """INSERT INTO j2_positions (id, user_id, symbol, side, entry_date, shares, original_shares,
                   entry_price, stop_price, setup, context_at_entry, created_at, updated_at, entry_estimated,
                   broker_price, account_id, source)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '{}', ?, ?, ?, ?, ?, ?)""",
            (f"{uid}-{p['id']}", uid, p["symbol"], p["side"], p["entry_at"], p["shares"], p["shares"],
             p["entry_price"], p["stop"], p["setup"], now, now, 1 if p["entry_estimated"] else 0, p["mark"],
             f"{uid}-{p['account']}", None if p["origin"] == "manual" else p["origin"]))
    c.commit()
    return book


def _walk(node):
    if isinstance(node, dict):
        yield node
        for v in node.values():
            yield from _walk(v)
    elif isinstance(node, list):
        for v in node:
            yield from _walk(v)


def _zeros(params) -> list:
    """Every zero a built card would SHOW from nothing (W9-R7): an empty result is the card's own sentence
    (`params.empty`, count 0), and in a card that has data, a figure of exactly 0 must have rows behind it (its own
    `n<k>` above 0: a real computed zero, a symbol with no wins, is data)."""
    if params.get("count") == 0:
        return [] if isinstance(params.get("empty"), str) and params["empty"].strip() else [("empty", params)]
    out = []
    for n in _walk(params):
        for k in ("1", "2", "3"):
            v = n.get("v" + k)
            if isinstance(v, (int, float)) and not isinstance(v, bool) and v == 0 and not n.get("n" + k):
                out.append(("v" + k, n))
    return out


def _fill(c, uid, row, setup):
    gid = gallery.firm_style_id(row["seedKey"])
    choices = {b["block"]: {"create": True} for b in row["blocks"]
               if js.slot_family(b["block"]) in ("routine", "tracker")
               and "template" in b["settings"]}
    answers = {s["id"]: setup for s in row["slots"]}
    return gallery.use_library_template(uid, gid, answers=answers, choices=choices, conn=c)


_FAMILY_KIND = {"built": "builtWidget", "routine": "routine", "tracker": "tracker"}


def _slot_accounting(row: dict, embeds: list, skipped: list) -> tuple[list, list]:
    """(slots unaccounted for, malformed skip lines). EVERY family slot of the row must become exactly one node of
    its kind or exactly one skip line naming its block (I-2): per family, nodes + skipped slots == slots."""
    from collections import Counter
    bad_skips = [s for s in skipped if not (isinstance(s, dict) and isinstance(s.get("block"), str)
                                            and isinstance(s.get("reason"), str) and s["reason"])]
    skipped_ids = Counter(s.get("block") for s in skipped if isinstance(s, dict))
    slots = Counter(_FAMILY_KIND[js.slot_family(b["block"])] for b in row["blocks"] if js.slot_family(b["block"]))
    got = Counter(n["attrs"]["widgetId"] for n in embeds if n["attrs"]["widgetId"] in _FAMILY_KIND.values())
    for b in row["blocks"]:
        fam = js.slot_family(b["block"])
        if fam and skipped_ids[b["block"]]:
            got[_FAMILY_KIND[fam]] += skipped_ids[b["block"]]
    missing = sorted((k, slots[k], got[k]) for k in set(slots) | set(got) if slots[k] != got[k])
    return missing, bad_skips


def test_slot_accounting_sees_one_missing_slot_of_several():
    """Control for I-2: three of four built nodes present (no skip line) is refused, all four is accepted."""
    row = next(r for r in _live() if r["slug"] == "monthly-review")
    node = {"attrs": {"widgetId": "builtWidget"}}
    assert _slot_accounting(row, [node] * 4, []) == ([], [])
    assert _slot_accounting(row, [node] * 3, [])[0] == [("builtWidget", 4, 3)]
    assert _slot_accounting(row, [node] * 3, [{"block": "built_d", "reason": "slot-missing:built_d"}]) == ([], [])
    assert _slot_accounting(row, [node] * 4, [{"reason": "x"}])[1] == [{"reason": "x"}]


def test_every_row_fills_on_the_sample_book_without_a_500(db):
    db.execute("DELETE FROM j2_template_gallery")
    db.commit()
    tl.seed_template_library(db)
    book = _seed_book(db, BOOK_MEMBER)
    setup = next(t["setup"] for t in book["closed_trades"] if t["setup"])
    for uid in (BOOK_MEMBER, NEW_MEMBER):
        for row in _live():
            out = _fill(db, uid, row, setup)
            assert out is not None, (uid, row["slug"])
            body = out["note"]["bodyJson"] if "bodyJson" in out["note"] else json.loads(out["note"]["body_json"])
            text = json.dumps(body)
            assert "{{block:" not in text, (uid, row["slug"])
            embeds = [n for n in _walk(body) if n.get("type") == "widgetEmbed"]
            assert _slot_accounting(row, embeds, out["skipped"]) == ([], []), (uid, row["slug"])
            for n in embeds:
                if n["attrs"]["widgetId"] == "builtWidget":
                    assert _zeros(n["attrs"]["params"]) == [], (uid, row["slug"])


def _today_et() -> str:
    from datetime import datetime
    from zoneinfo import ZoneInfo
    return datetime.now(ZoneInfo("America/New_York")).date().isoformat()


def test_tag_todays_trades_lists_newest_day_first(db):
    """M-1: "sort newest" is the list view's own order, which the closed-trades scan sets: newest ET day first
    (`ORDER BY <ET day> DESC, t.id DESC`). Tag today's trades' own plan, run over a wider range, puts three trades on
    three days newest day first. (Within ONE day the scan's tiebreak is the trade id, not the exit time: recorded
    in the 11.10 report as an engine limit, not railed here.)"""
    from datetime import date, timedelta
    from tests.test_widget_sources import add_trade
    from api.services.journal_two.widget_engine import run
    today = date.fromisoformat(_today_et())
    for sym, back in (("AAA", 3), ("CCC", 1), ("BBB", 2)):
        d = (today - timedelta(days=back)).isoformat()
        add_trade(db, AUTHOR, day=d, symbol=sym)
    row = next(r for r in _live() if r["slug"] == "tag-todays-trades")
    plan = copy.deepcopy(row["definitions"][0]["plan"])
    assert plan["range"] == {"token": "today"} and "sort" not in plan
    out = run.run_plan(AUTHOR, plan, {"range": {"token": "last_30d"}}, lane="run")
    labels = [r["label"] for r in out["rows"]]
    assert labels == ["CCC", "BBB", "AAA"], labels


@pytest.mark.parametrize("slug, wave10_blocks", [("goal-setting", {"built_a"}), ("rules-review", {"built_a"})])
def test_wave10_off_hides_its_shelf_slot_and_the_rest_fills(db, monkeypatch, slug, wave10_blocks):
    """M-2 (Review Focus 5): wave 10 off, wave 11 on. A shelf slot whose plan needs wave 10 is HIDDEN by the one
    decider (`journal_styles.slot_wave_off`): no node and no sentence. Every other slot still fills."""
    from collections import Counter
    db.execute("DELETE FROM j2_template_gallery")
    db.commit()
    tl.seed_template_library(db)
    row = next(r for r in _live() if r["slug"] == slug)
    monkeypatch.delenv("NOTEBOOK_WIDGETS_W10_ENABLED", raising=False)
    hidden = {b["block"] for b in row["blocks"] if js.slot_family(b["block"])
              and js.slot_wave_off(b["block"], b["settings"])}
    assert hidden == wave10_blocks                                   # the one decider names exactly these
    out = _fill(db, MEMBER, row, None)
    embeds = [n for n in _walk(out["note"]["bodyJson"]) if n.get("type") == "widgetEmbed"]
    assert not any(isinstance(s, dict) and s.get("block") in hidden for s in out["skipped"])
    shown = dict(row, blocks=[b for b in row["blocks"] if b["block"] not in hidden])
    assert _slot_accounting(shown, embeds, out["skipped"]) == ([], [])
    assert "{{block:" not in json.dumps(out["note"]["bodyJson"])
    # control: with wave 10 on, the same slot fills (so the absence above is the wave, not a broken slot)
    monkeypatch.setenv("NOTEBOOK_WIDGETS_W10_ENABLED", "1")
    out_on = _fill(db, OTHER, row, None)
    on = Counter(n["attrs"]["widgetId"] for n in _walk(out_on["note"]["bodyJson"]) if n.get("type") == "widgetEmbed")
    assert on["builtWidget"] == sum(1 for b in row["blocks"] if js.slot_family(b["block"]) == "built")


# ── copy (R-33, member words) ────────────────────────────────────────────────────────────────────────────────────

#: Spec §10 names three templates with a trader's own word for one idea's write-up; R-33 governs the app's word for
#: a widget's settings. These three TITLES are kept as the spec names them; nothing else may say "plan" bare.
SPEC_TITLES_WITH_PLAN = ("Game plan", "Trade plan (one idea)", "Options trade plan")
_BANNED = ("plan", "definition", "shelf", "slot", "payload", "reducer", "scope", "journal style", "inline",
           "source", "built widget", "checklist")
_EMOJI = re.compile("[\U0001F000-\U0001FAFF☀-➿⬀-⯿️]")


def _copy_texts() -> list[str]:
    out = []
    for r in tl.rows():
        if r["title"] not in SPEC_TITLES_WITH_PLAN:
            out.append(r["title"])
        out.append(r["description"])
        for sec in r["sections"]:
            out += [sec["heading"], sec["prompt"]]
        for d in r["definitions"]:
            out += [d["name"], d["description"]]
        out += [s["label"] for s in r["slots"]]
    out += [label for _, label in tl.GROUPS]
    return out


def test_no_bare_plan_word_in_seed_copy():
    texts = _copy_texts()
    assert len(texts) > 150                                            # non-vacuity: the sweep read the seed
    bad = [t for t in texts if any(re.search(rf"\b{w}", t.lower().replace("trading plan", "")) for w in _BANNED)]
    assert bad == []
    assert any("trading plan" in t.lower() for t in texts)              # the allowance is used, not dead
    assert [t for t in texts + [r["title"] for r in tl.rows()] if _EMOJI.search(t)] == []
    # the exemption is exactly the spec's three titles, each used once
    assert sorted(r["title"] for r in tl.rows() if re.search(r"\bplan\b", r["title"].lower())) == sorted(
        SPEC_TITLES_WITH_PLAN)
    # control: the sweep sees a bare "plan" where it would be wrong
    assert any(re.search(r"\bplan", t.lower().replace("trading plan", "")) for t in ["Your plan for today"])


# ── released rows never change (R-P5-4, the rail against origin/master) ──────────────────────────────────────────

def released_violations(released: list[dict], local: list[dict], base: list[dict] | None) -> list[str]:
    """What this tree did to official rows `released` (origin/master's seed) already shipped, by canonical hash.

    `base` is the seed at merge-base(HEAD, origin/master), or None when the base had none. A released row missing
    here because master released it AFTER this branch's base is the world moving, not a violation (merge master); a
    released row that differs here while this branch's copy is still the base's was changed on master."""
    mine = {r["seedKey"]: shelf.canonical_hash(r) for r in local}
    at_base = {r["seedKey"]: shelf.canonical_hash(r) for r in (base or [])}
    out = []
    for r in released:
        key, sha = r["seedKey"], shelf.canonical_hash(r)
        if key in mine:
            if mine[key] != sha and at_base.get(key) != mine[key]:
                out.append(f"{key}: changed after release (add a -v2 row and retire this one)")
        elif key in at_base:
            out.append(f"{key}: removed after release (retire it instead)")
    return out


def _payloads() -> dict:
    return json.loads((REPO / PAYLOADS_REL).read_text(encoding="utf-8"))["payloads"]


def test_every_live_row_stores_its_committed_payload():
    """M-4: what the seeder STORES (outline, payload, preview, derived by code) hashes to the committed value for
    every live row, so a change in the deriving code is seen, not only a change in the seed row."""
    want = _payloads()
    got = {r["seedKey"]: tl.payload_hash(r) for r in _live()}
    assert got == {k: want[k] for k in got}
    # a retired row keeps its entry, unchanged (append-only): existing installs still store it
    assert {r["seedKey"]: tl.payload_hash(r) for r in tl.rows()} == want and set(RETIRED) <= set(want)
    # control: a change to the deriving code moves the hash
    row = _live()[0]
    real = tl._outline_from_sections
    try:
        tl._outline_from_sections = lambda secs: real(secs)[:-1]
        assert tl.payload_hash(row) != want[row["seedKey"]]
    finally:
        tl._outline_from_sections = real


def released_payload_violations(released: dict, local: dict, base: dict | None) -> list[str]:
    """The same rule as `released_violations`, over the committed stored-payload hashes."""
    out = []
    for key, sha in released.items():
        if key in local:
            if local[key] != sha and (base or {}).get(key) != local[key]:
                out.append(f"{key}: its stored payload changed after release")
        elif key in (base or {}):
            out.append(f"{key}: its stored payload was removed after release")
    return out


def test_released_payload_violations_sees_a_change():
    a = {"k1": "1" * 64, "k2": "2" * 64}
    assert released_payload_violations(a, a, a) == []
    assert released_payload_violations(a, {**a, "k1": "9" * 64}, a) == ["k1: its stored payload changed after release"]
    assert released_payload_violations(a, {"k2": a["k2"]}, a) == ["k1: its stored payload was removed after release"]
    assert released_payload_violations({**a, "k3": "3" * 64}, a, a) == []


def test_released_violations_sees_a_changed_or_removed_row():
    rows = copy.deepcopy(tl.rows()[:3])
    assert released_violations(rows, rows, rows) == []                                       # identical: clean
    edited = copy.deepcopy(rows)
    edited[0]["title"] = edited[0]["title"] + "!"
    assert released_violations(rows, edited, rows) == [
        f"{rows[0]['seedKey']}: changed after release (add a -v2 row and retire this one)"]
    assert released_violations(rows, rows[1:], rows) == [
        f"{rows[0]['seedKey']}: removed after release (retire it instead)"]
    # a line ending or key order cannot move a hash (canonical JSON)
    reordered = [dict(reversed(list(r.items()))) for r in rows]
    assert released_violations(rows, reordered, rows) == []
    # the world moving is not a violation: master released a fourth row after this branch's base ...
    ahead = rows + copy.deepcopy(tl.rows()[3:4])
    assert released_violations(ahead, rows, rows) == [] and released_violations(ahead, rows, None) == []
    # ... and master editing a row this branch never touched is master's, not this branch's
    assert released_violations(edited, rows, rows) == []


def _scrubbed_env() -> dict:
    """Every GIT_* variable removed (lane rule; tests/test_widget_shelf_files.py::_throwaway_env): `-C` names the repo."""
    return {k: v for k, v in os.environ.items() if not k.upper().startswith("GIT_")}


def _git(*args: str) -> subprocess.CompletedProcess:
    exe = shutil.which("git")
    if exe is None:
        pytest.fail(f"git is not on PATH, so released official templates cannot be checked; install git and run `{FETCH}`")
    return subprocess.run([exe, "-C", str(REPO), *args], capture_output=True, text=True, encoding="utf-8",
                          errors="replace", env=_scrubbed_env())


def _show(ref: str, rel: str = SEED_REL, key: str = "templates"):
    if _git("cat-file", "-e", f"{ref}:{rel}").returncode != 0:
        return None
    r = _git("show", f"{ref}:{rel}")
    if r.returncode != 0:
        pytest.fail(f"git could not read {ref}:{rel} ({r.stderr.strip()}); run `{FETCH}`")
    return json.loads(r.stdout)[key]


def test_released_rows_never_change():
    head = _git("rev-parse", "--verify", "--quiet", "origin/master^{commit}")
    if head.returncode != 0 or not re.fullmatch(r"[0-9a-f]{40}", head.stdout.strip()):
        pytest.fail(f"origin/master cannot be read here, so released official templates are unchecked; run `{FETCH}`")
    # non-vacuity: git reads origin/master's tree (an absent seed below means "none released", not "broken")
    if _git("cat-file", "-e", "origin/master:api/services/journal_two/template_gallery.py").returncode != 0:
        pytest.fail(f"origin/master's tree cannot be read; run `{FETCH}`")
    released = _show("origin/master")
    if released is None:
        return                                            # the seed is not on master: no official row is released
    base_sha = _git("merge-base", "HEAD", "origin/master")
    if base_sha.returncode != 0:
        pytest.fail(f"no merge-base with origin/master ({base_sha.stderr.strip()}); run `{FETCH}`")
    base = base_sha.stdout.strip()
    bad = released_violations(released, tl.rows(), _show(base))
    released_payloads = _show("origin/master", PAYLOADS_REL, "payloads")
    if released_payloads is not None:
        bad += released_payload_violations(released_payloads, _payloads(), _show(base, PAYLOADS_REL, "payloads"))
    assert bad == [], bad
