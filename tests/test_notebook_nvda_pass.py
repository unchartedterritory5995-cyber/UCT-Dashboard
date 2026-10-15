"""Rails on tools/notebook_nvda_pass.py -- the NVDA screen-reader driver.

Windows-only: the module binds user32/kernel32 at import. On any other platform the file skips, and
says so, rather than passing vacuously.

The three things that must stay true, each with its control:
  1. the grader can FAIL (foreign speech, silence) and can PASS (every phrase present);
  2. the ear parses NVDA's `Speaking [...]` line shape into words;
  3. the foreground guard REFUSES -- raises instead of sending -- when no window carries the run
     nonce, and before `ensure()` has ever found one. A key is never sent on a refusal, which is
     the property the 2026-10-09 incident (seven minutes of keys into the owner's Chrome) needs.
"""
from __future__ import annotations

import importlib.util
import pathlib
import sys

import pytest

pytestmark = pytest.mark.skipif(sys.platform != "win32", reason="the driver binds user32 at import")

TOOL = pathlib.Path(__file__).resolve().parents[1] / "tools" / "notebook_nvda_pass.py"


@pytest.fixture(scope="module")
def mod():
    spec = importlib.util.spec_from_file_location("notebook_nvda_pass", TOOL)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def test_the_grader_passes_on_the_phrases_and_fails_on_anything_else(mod):
    assert mod.grade(["Skip to notes list", "link"], ["clickable Skip to notes list link"])[0] == "PASS"
    verdict, why = mod.grade(["Skip to notes list"], ["column 3 Sort by Name button"])
    assert verdict == "FAIL" and "missing" in why
    assert mod.grade(["anything"], [])[0] == "FAIL"           # silence is a FAIL, never a pass


def test_the_ear_reads_nvda_speaking_lines_as_words(mod):
    line = ("IO - speech.speech.speak (02:24:50.302) - MainThread (8976):\n"
            "Speaking [LangChangeCommand ('en_US'), 'row 1', 'column 1', 'Select All', 'check box', 'not checked']\n"
            "IO - inputCore.InputManager.executeGesture (02:24:54.176) - winInputHook (21316):\n"
            "Input: kb(desktop):tab")
    assert mod.parse_speech(line) == ["row 1 column 1 Select All check box not checked"]
    assert mod.parse_speech("Input: kb(desktop):tab") == []  # a gesture line is not speech


def test_the_ear_hears_a_string_python_wrote_with_double_quotes(mod):
    """⚰️ The line that fooled the first grader for seven runs: a string holding an apostrophe is
    written by Python's repr with DOUBLE quotes. The first parser read single-quoted strings only,
    graded "I couldn't find that in this note." as never spoken, and a product defect was written
    up, fixed twice and reverted (#294 F1, #295, #296, #297). The ear must hear both quote styles,
    and a mixed line keeps its order."""
    line = "Speaking [LangChangeCommand ('en_US'), \"I couldn't find that in this note.\"]"
    assert mod.parse_speech(line) == ["I couldn't find that in this note."]
    mixed = "Speaking [LangChangeCommand ('en_US'), 'button', 'expanded', \"Patrick's note\", 'link']"
    assert mod.parse_speech(mixed) == ["button expanded Patrick's note link"]
    # and the grader, fed that speech, PASSES the row it used to fail
    assert mod.grade(["find", "note"], mod.parse_speech(line))[0] == "PASS"


def test_the_foreground_guard_refuses_without_a_nonce_window_and_before_ensure(mod):
    class NoPage:
        def evaluate(self, *_a, **_k):
            return None
    g = mod.Foreground(NoPage(), "no-window-carries-this-nonce-0123456789abcdef")
    with pytest.raises(mod.ForegroundLost):
        g.ensure()
    with pytest.raises(mod.ForegroundLost):
        g.check()
    # and the senders ask the guard first: with the guard in that state, press() sends nothing
    mod.GUARD = g
    with pytest.raises(mod.ForegroundLost):
        mod.press("tab")
    with pytest.raises(mod.ForegroundLost):
        mod.type_text("x")


def test_rows_28_to_38_are_not_run_unless_the_journal_styles_switch_is_a_boolean_true(mod):
    """Rows 28-38 exist only while NOTEBOOK_JOURNAL_STYLES_ENABLED is on for the server under test.
    The reader answers the NOT RUN reason for absent / off / a non-boolean, and None only for True."""
    base = "https://example.invalid"
    off = f"journal styles switch is off on {base}"
    assert mod.journal_styles_off({mod.STYLES_FLAG_KEY: False}, base) == off
    absent = mod.journal_styles_off({"user": {}}, base)
    assert absent.startswith(off) and "carries no" in absent
    for v in ("true", 1, None):
        assert mod.journal_styles_off({mod.STYLES_FLAG_KEY: v}, base).startswith(off)
    assert mod.journal_styles_off(None, base).startswith(off)
    assert mod.journal_styles_off({mod.STYLES_FLAG_KEY: True}, base) is None     # the control: ON proceeds


def test_the_ear_hears_every_new_rows_words_as_nvda_logs_them(mod):
    """Walk the ear over its blind-spot list before grading: each row's own words, written the way
    NVDA writes them (Python's repr). Row 37's name holds ASCII quotes (repr switches to double
    quotes) and row 30's a typographic apostrophe (it does not)."""
    assert [r["n"] for r in mod.P1P2_ROWS] == list(range(28, 39))
    for r in mod.P1P2_ROWS:
        line = "Speaking [LangChangeCommand ('en_US'), " + ", ".join(repr(s) for s in r["logged"]) + "]"
        assert mod.grade(r["expected"], mod.parse_speech(line))[0] == "PASS", r["n"]
    assert '"' + mod.RULE_EDIT_NAME + '"' in repr(mod.RULE_EDIT_NAME)            # the double-quoted shape
    assert "’" in mod.TIMEFRAME_NAME and repr(mod.TIMEFRAME_NAME).startswith("'")
    # the control: a row whose words were never spoken still FAILS
    assert mod.grade(mod.P1P2_ROWS[0]["expected"], ["Styles button"])[0] == "FAIL"


def test_the_block_catalog_is_read_from_the_server_file_not_retyped(mod):
    kinds = mod.block_kinds()
    for wid in ("preEntryChecklist", "priceStamps", "positionSizing", "myRules", "prepWire", "tradeReview"):
        node = mod.block_node(wid, mod.block_params(wid, kinds), kinds)
        assert node["type"] == "widgetEmbed" and node["attrs"]["widgetId"] == wid
        assert node["attrs"]["searchText"] == kinds[wid]["search"] and node["attrs"]["searchText"].startswith("[")
    assert mod.block_params("preEntryChecklist", kinds)["setup"]                  # a setup, so items list
    assert mod.block_params("prepWire", kinds) == {}                              # uncaptured: Capture now


def test_row_28_listens_only_after_the_openers_own_opens_dialog(mod):
    """Fix round 1, I-1: the Styles button carries aria-haspopup="dialog", spoken "opens dialog" on
    focus, so row 28's window opens after the focus has been spoken and before Enter."""
    assert mod.listening_starts_after_the_opener(mod.OPEN_STYLES_STEPS) is None
    # the control: the order the first version had (mark, then focus) is refused
    assert mod.listening_starts_after_the_opener(("goto", "mark", "focus", "settle", "enter")) is not None


class _Resp:
    def __init__(self, status, body):
        self.status, self._body = status, body

    def json(self):
        return self._body

    def text(self):
        return str(self._body)


class _StubApi:
    """Playwright's APIRequestContext shape; records every call and answers like the server would."""

    def __init__(self, block_kinds):
        self.calls = []
        self.block_kinds = block_kinds

    def _call(self, method, url, **kw):
        self.calls.append((method, url))
        if method == "get" and url.endswith("/api/j2/journal-styles"):
            return _Resp(200, {"kinds": [{"id": "trade_plan"}], "styles": [], "blockKinds": self.block_kinds})
        if method == "get" and url.endswith("/api/j2/accounts"):
            return _Resp(200, {"accounts": [{"id": "acct-1"}]})
        if method == "get" and url.endswith("/review/trades"):
            return _Resp(200, {"trades": []})
        return _Resp(200, {"id": f"made-{len(self.calls)}", "note": {"id": f"note-{len(self.calls)}"},
                           "style": {"id": f"style-{len(self.calls)}"}})

    def get(self, url, **kw):
        return self._call("get", url, **kw)

    def post(self, url, **kw):
        return self._call("post", url, **kw)

    def put(self, url, **kw):
        return self._call("put", url, **kw)

    def delete(self, url, **kw):
        return self._call("delete", url, **kw)


def _drive_p2_rows(mod, api, styles_off, monkeypatch):
    """Rows 28-38 through the REAL p2_row and the REAL fixture factories over a stubbed API client,
    with every OS key recorded instead of sent. Returns (outcomes, keys sent, made)."""
    keys = []
    monkeypatch.setattr(mod, "_key", lambda vk, up=False: keys.append(vk))
    made = {"notes": [], "folders": [], "views": [], "styles": [], "rules": [], "trades": []}
    fxs = mod.P2Fixtures(api, "https://example.invalid", made)
    outcomes = {}

    def row(num, keys_, expected, action, note=None):
        outcomes[num] = "row"                       # the real row() is where the guard and every key live

    def not_run(num, keys_, expected, why):
        outcomes[num] = ("not_run", why)

    def inconclusive(num, keys_, expected, why):
        outcomes[num] = ("inconclusive", why)

    needs = {28: [], 29: [fxs.style], 30: [fxs.style], 31: [lambda: fxs.note("preEntryChecklist")],
             32: [lambda: fxs.note("preEntryChecklist"), fxs.rule], 33: [lambda: fxs.note("priceStamps")],
             34: [lambda: fxs.note("positionSizing")], 35: [lambda: fxs.note("positionSizing")],
             36: [lambda: fxs.note("prepWire")], 37: [lambda: fxs.note("myRules"), fxs.rule],
             38: [lambda: fxs.note("tradeReview"), fxs.trade]}
    for r in mod.P1P2_ROWS:
        mod.p2_row(r["n"], needs[r["n"]], lambda *_: None, only=set(), styles_off=styles_off,
                   served=fxs.served_blocks, row=row, not_run=not_run, inconclusive=inconclusive)
    return outcomes, keys, made


def test_switch_off_makes_no_fixtures_and_sends_no_keys(mod, monkeypatch):
    """Fix round 1, M-4: with the switch off, every row 28-38 is NOT RUN, the API client is never
    called (zero creates, zero reads), nothing is registered for removal and no key is sent."""
    api = _StubApi(["chart", "preEntryChecklist", "myRules", "prepWire", "tradeReview", "priceStamps", "positionSizing"])
    off = "journal styles switch is off on https://example.invalid"
    outcomes, keys, made = _drive_p2_rows(mod, api, off, monkeypatch)
    assert outcomes == {n: ("not_run", off) for n in range(28, 39)}
    assert api.calls == [] and not any(made.values()) and keys == []
    # the control: with the switch ON the same drive DOES make fixtures (so the zero above is not vacuous)
    api_on = _StubApi(api.block_kinds)
    outcomes_on, keys_on, made_on = _drive_p2_rows(mod, api_on, None, monkeypatch)
    assert all(v == "row" for v in outcomes_on.values())
    assert any(m == "post" for m, _ in api_on.calls) and made_on["notes"] and made_on["rules"]
    assert keys_on == []                            # fixtures are API calls, never keys


def test_a_server_without_the_p2b_blocks_is_not_run_and_makes_none_of_them(mod, monkeypatch):
    """Fix round 1, M-5: the capability is read from GET /api/j2/journal-styles blockKinds. A P2a-only
    build's rows that need P2b blocks are NOT RUN "server lacks P2b blocks", never FAIL, and their
    fixtures are not made."""
    api = _StubApi(["chart", "preEntryChecklist", "priceStamps", "positionSizing", "marketcontext"])
    outcomes, keys, made = _drive_p2_rows(mod, api, None, monkeypatch)
    for n in (32, 36, 37, 38):
        assert outcomes[n][0] == "not_run" and outcomes[n][1].startswith("server lacks P2b blocks"), n
    for n in (28, 29, 30, 31, 33, 34, 35):
        assert outcomes[n] == "row", n
    assert made["rules"] == [] and made["trades"] == [] and keys == []
    assert not any("/rules" in url or "/api/j2/trades" in url for _, url in api.calls)
    # an unreadable answer is never a guessed shape: INCONCLUSIVE, no key sent
    api_bad = _StubApi(None)
    outcomes_bad, _, made_bad = _drive_p2_rows(mod, api_bad, None, monkeypatch)
    assert outcomes_bad[37][0] == "inconclusive" and not made_bad["notes"]


def test_block_node_matches_the_servers_own_node_and_builders(mod):
    """Fix round 1, M-3: the REAL trader_blocks._node and BUILDERS, imported, against the tool's
    block_node / block_params for every block the rows use. A server-side shape change reds here."""
    import datetime as dt
    import re
    from api.services.journal_two import trader_blocks
    kinds = mod.block_kinds()
    now = dt.datetime(2026, 10, 13, 15, 0, tzinfo=dt.timezone.utc)
    stamp = re.compile(r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z$")
    for wid in ("preEntryChecklist", "priceStamps", "positionSizing", "myRules", "prepWire", "tradeReview"):
        ours = mod.block_node(wid, mod.block_params(wid, kinds), kinds)
        node, err = trader_blocks.BUILDERS[wid]({"block": wid, "settings": {}}, {"now": now, "mode": "update"})
        assert err is None and ours["type"] == node["type"], wid
        assert set(ours["attrs"]) == set(node["attrs"]), wid
        for k in node["attrs"]:
            if k in ("embedId", "capturedAt", "params"):
                continue
            assert ours["attrs"][k] == node["attrs"][k], (wid, k)
        assert re.fullmatch(r"[0-9a-f]{32}", ours["attrs"]["embedId"]) and re.fullmatch(r"[0-9a-f]{32}", node["attrs"]["embedId"])
        assert stamp.match(ours["attrs"]["capturedAt"]) and stamp.match(node["attrs"]["capturedAt"])
        # params: the builder's shape, with the two declared departures only
        theirs = dict(node["attrs"]["params"])
        if wid == "preEntryChecklist":
            theirs["setup"] = mod.SR_SETUP                   # a setup, so the checklist lists its items
        assert ours["attrs"]["params"] == theirs, wid        # prepWire: the "update" (uncaptured) shape, {}


def _doc_expected_cells():
    import re
    doc = (TOOL.parents[1] / "docs" / "notebook" / "screen-reader-pass.md").read_text(encoding="utf-8")
    section = doc.split("## Steps 28-38", 1)[1].split("## Appendix A", 1)[0]
    out = {}
    for line in section.splitlines():
        m = re.match(r"^\| (\d+) \|", line)
        if m:
            cells = [c.strip() for c in re.split(r"(?<!\\)\|", line)[1:-1]]
            out[int(m.group(1))] = re.findall(r"`([^`]+)`", cells[2])
    return out


def test_the_docs_expected_column_is_exactly_what_the_grader_requires(mod):
    """Fix round 1, M-2: the doc's Expected cell for rows 28-41 holds exactly P1P2_ROWS' and T2A_ROWS'
    expected, one backtick span per phrase, in order (row 37 included: the grader checks three phrases)."""
    cells = _doc_expected_cells()
    assert sorted(cells) == list(range(28, 42))
    for r in (*mod.P1P2_ROWS, *mod.T2A_ROWS):
        assert cells[r["n"]] == r["expected"], r["n"]


# ── Rows 39-41 (Tier 2 part A): the alert chip and the screenshot tag ───────────────────────────
def test_rows_39_to_41_numbers_and_the_ear_hears_their_own_words(mod):
    """Each row's own words, written the way NVDA logs them, PASS; the "once" row also passes only on ONE
    announcement; row 39 speaks no character NVDA may say as a word in its graded phrases."""
    assert [r["n"] for r in mod.T2A_ROWS] == [39, 40, 41]
    for r in mod.T2A_ROWS:
        line = "Speaking [LangChangeCommand ('en_US'), " + ", ".join(repr(x) for x in r["logged"]) + "]"
        assert mod.grade(r["expected"], mod.parse_speech(line), once=r.get("once"))[0] == "PASS", r["n"]
        for phrase in r["expected"]:
            assert not any(c in phrase for c in "+$\u00b7"), (r["n"], phrase)


def test_row_39_fails_an_announcement_spoken_twice_or_not_at_all(mod):
    said = "Alert suggestion: NVDA closes below $120.00 (daily). Press Alt plus Enter to set it, or Escape to dismiss."
    exp, once = mod.T2A_BY_N[39]["expected"], mod.T2A_BY_N[39]["once"]
    assert mod.grade(exp, [said], once=once)[0] == "PASS"          # "plus" for "+" still passes
    verdict, why = mod.grade(exp, [said, said], once=once)
    assert verdict == "FAIL" and "2 times" in why                  # the control: twice is a finding
    assert mod.grade(exp, ["column 3 Sort by Name button"], once=once)[0] == "FAIL"
    assert mod.grade(exp, [], once=once)[0] == "FAIL"              # silence is never a pass
    # and without `once` the same two announcements PASS: the extra check is what catches it
    assert mod.grade(exp, [said, said])[0] == "PASS"


def test_rows_39_to_41_are_not_run_unless_their_switches_are_booleans_true(mod):
    base = "https://example.invalid"
    for me in (None, {}, {mod.SMART_CHIPS_KEY: False}, {mod.SMART_CHIPS_KEY: "true"}, {mod.SMART_CHIPS_KEY: 1}):
        assert mod.t2a_off(me, "chips", base), me
    assert "carries no" in mod.t2a_off({}, "chips", base)
    assert mod.t2a_off({mod.SMART_CHIPS_KEY: True}, "chips", base) is None                   # the control: ON proceeds
    assert mod.t2a_off({mod.SMART_CHIPS_KEY: True}, "chips+docs", base)                      # row 41 needs the second switch
    assert mod.t2a_off({mod.SMART_CHIPS_KEY: True, mod.IMAGE_DOCS_KEY: False}, "chips+docs", base)
    assert mod.t2a_off({mod.SMART_CHIPS_KEY: True, mod.IMAGE_DOCS_KEY: True}, "chips+docs", base) is None
    assert [r["needs"] for r in mod.T2A_ROWS] == ["chips", "chips", "chips+docs"]


def test_rows_39_to_41_with_a_switch_off_make_no_fixture_and_send_no_key(mod, monkeypatch):
    """The gate runs before anything: NOT RUN, the API client never called, no key sent. The control: with the
    switches on the same drive asks for fixtures (so the zero above is not vacuous)."""
    keys = []
    monkeypatch.setattr(mod, "_key", lambda vk, up=False: keys.append(vk))
    base = "https://example.invalid"

    def drive(me):
        api = _StubApi(["chart"])
        made = {"notes": [], "folders": [], "views": [], "styles": [], "rules": [], "trades": []}
        fxs = mod.P2Fixtures(api, base, made)
        out = {}
        for r in mod.T2A_ROWS:
            def row(num, keys_, expected, action, note=None, once=None, _o=out):
                _o[num] = ("row", once)

            def not_run(num, keys_, expected, why, _o=out):
                _o[num] = ("not_run", why)

            def inconclusive(num, keys_, expected, why, _o=out):
                _o[num] = ("inconclusive", why)
            mod.p2_row(r["n"], [lambda t=r["n"]: fxs.plain_note(f"SR row {t}")], lambda *_: None, only=set(),
                       styles_off=mod.t2a_off(me, r["needs"], base), served=fxs.served_blocks,
                       row=row, not_run=not_run, inconclusive=inconclusive)
        return out, api, made

    out, api, made = drive({})
    assert all(v[0] == "not_run" and "smart chips switch is off" in v[1] for v in out.values()) and len(out) == 3
    assert api.calls == [] and not any(made.values()) and keys == []
    out_on, api_on, made_on = drive({mod.SMART_CHIPS_KEY: True, mod.IMAGE_DOCS_KEY: True})
    assert all(v[0] == "row" for v in out_on.values())
    assert out_on[39] == ("row", "Alert suggestion") and out_on[40] == ("row", None)       # only row 39 grades "once"
    assert any(m == "post" for m, _ in api_on.calls) and len(made_on["notes"]) == 3 and keys == []
    # a smart-chips-only server runs 39 and 40 and records 41 NOT RUN for the image-documents switch
    out_half, _, _ = drive({mod.SMART_CHIPS_KEY: True})
    assert out_half[39][0] == "row" and out_half[40][0] == "row"
    assert out_half[41][0] == "not_run" and "image documents switch is off" in out_half[41][1]


def test_the_screenshot_fixture_exists_and_is_the_documented_size(mod):
    from PIL import Image
    assert mod.T2A_FIXTURE.exists()
    with Image.open(mod.T2A_FIXTURE) as im:
        assert im.size == (900, 500)


def test_extended_keys_carry_the_extended_flag_and_a_scan_code(mod):
    # Arrows without KEYEVENTF_EXTENDEDKEY arrive as numpad keys and NVDA swallows them (r4/r5).
    for name in ("down", "right", "insert", "home", "end"):
        assert mod.VK[name] in mod.EXTENDED_VKS
    assert mod.VK["tab"] not in mod.EXTENDED_VKS
    assert mod.user32.MapVirtualKeyW(mod.VK["slash"], 0) != 0   # a real scan code for "?"
