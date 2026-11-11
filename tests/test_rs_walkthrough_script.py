"""The RS walkthrough capture tool (unit 4-10): its script and its refusals, with no browser.

Nothing here launches Playwright or touches the network: the script is validated as data, and
the safety checks are the pure functions `capture.py` runs before any browser opens.
"""
import copy
import importlib.util
import json
import re
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
TOOL = ROOT / "tools" / "rs_walkthrough"


def _load():
    spec = importlib.util.spec_from_file_location("rs_walkthrough_capture", TOOL / "capture.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


cap = _load()
SCRIPT = json.loads((TOOL / "script.json").read_text(encoding="utf-8"))


# ─── the script ─────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("force_builtin", [False, True])
def test_script_matches_the_schema(force_builtin):
    _, errs = cap.schema_errors(SCRIPT, force_builtin=force_builtin)
    assert errs == []


def test_script_passes_the_semantic_rules():
    assert cap.semantic_errors(SCRIPT) == []


def test_both_viewports_at_the_mapped_sizes():
    vps = SCRIPT["viewports"]
    assert (vps["desktop"]["width"], vps["desktop"]["height"]) == (1920, 1080)
    assert (vps["phone"]["width"], vps["phone"]["height"]) == (390, 844)
    assert vps["phone"]["is_mobile"] is True and vps["desktop"]["is_mobile"] is False


def test_the_scripted_path_in_order():
    want = ["open_chart", "add_rs", "tour", "chip_readout", "benchmark_sector", "preset_stress",
            "rotation_view", "compare_rotation", "anchor_date", "outro"]
    desktop = [s["id"] for s in cap.steps_for(SCRIPT, "desktop")]
    phone = [s["id"] for s in cap.steps_for(SCRIPT, "phone")]
    assert desktop == want
    assert phone == [s for s in want if s != "compare_rotation"]   # the Compare panel is desktop only


def test_steps_whose_ui_may_not_exist_are_optional():
    for step in SCRIPT["steps"]:
        if step["id"] in ("tour", "rotation_view", "anchor_date"):
            assert step["optional"] is True, step["id"]
        if step["id"] in ("open_chart", "add_rs", "benchmark_sector", "preset_stress", "outro"):
            assert step["optional"] is False, step["id"]


def test_every_caption_follows_the_copy_rules():
    for step in SCRIPT["steps"]:
        assert cap.caption_problems(step["caption"]) == [], step["id"]


@pytest.mark.parametrize("text", [
    "Buy when the dot turns gold.",
    "This is when traders sell.",
    "RS works better than RSI here.",
    "Strong line \U0001F680",
    " leading space",
])
def test_caption_rules_refuse_bad_copy(text):
    assert cap.caption_problems(text)


@pytest.mark.parametrize("force_builtin", [False, True])
def test_schema_refuses_a_broken_script(force_builtin):
    bad = copy.deepcopy(SCRIPT)
    del bad["steps"][0]["caption"]
    bad["steps"][1]["actions"][0]["do"] = "teleport"
    bad["steps"][1]["actions"][1]["targets"][0]["by"] = "xpath"
    bad["unknown"] = 1
    _, errs = cap.schema_errors(bad, force_builtin=force_builtin)
    text = "\n".join(errs)
    assert "caption" in text and "teleport" in text and "xpath" in text and "unknown" in text


def test_schema_refuses_a_goto_off_the_sandbox():
    bad = copy.deepcopy(SCRIPT)
    bad["steps"][0]["actions"][0]["path"] = "//uctintelligence.com/charts"
    for force in (False, True):
        _, errs = cap.schema_errors(bad, force_builtin=force)
        assert errs, force


def test_semantic_rules_catch_what_the_schema_cannot():
    bad = copy.deepcopy(SCRIPT)
    next(a for a in bad["steps"][1]["actions"] if a["do"] == "fill").pop("value")  # a fill with nothing to type
    bad["steps"][1]["actions"][0]["targets"] = [{"by": "role"}]    # a role target with no role
    bad["steps"][2]["viewports"] = ["tablet"]                       # an undeclared viewport
    bad["steps"][0]["optional"] = True                              # the opening step may not be skipped
    text = "\n".join(cap.semantic_errors(bad))
    assert "needs 'value'" in text and "needs 'role'" in text and "'tablet'" in text
    assert "first step must be required" in text


# ─── the phone's long press (a11y gate §12.2: the phone readout step was skipped) ──

def _long_press_ms_in_the_hook():
    src = (ROOT / "app" / "src" / "components" / "mobile" / "useLongPress.js").read_text(encoding="utf-8")
    m = re.search(r"\{\s*ms\s*=\s*(\d+)", src)
    assert m, "useLongPress declares its default ms"
    return int(m.group(1))


def test_the_phone_readout_step_long_presses_the_chip_and_desktop_still_clicks():
    def step(vp):
        return next(s for s in cap.steps_for(SCRIPT, vp) if s["id"] == "chip_readout")
    phone = [a["do"] for a in step("phone")["actions"]]
    assert "long_press" in phone and phone.index("long_press") < phone.index("wait")
    assert "long_press" not in [a["do"] for a in step("desktop")["actions"]]
    lp = next(a for a in step("phone")["actions"] if a["do"] == "long_press")
    assert lp["targets"] and lp.get("press_ms", cap.LONG_PRESS_MS) > _long_press_ms_in_the_hook()


def test_the_long_press_outlasts_use_long_press():
    assert cap.LONG_PRESS_MIN_MS == _long_press_ms_in_the_hook() == 450
    assert cap.LONG_PRESS_MS == 600


def test_long_press_is_a_targeted_action_and_press_ms_is_its_own():
    bad = copy.deepcopy(SCRIPT)
    acts = next(s for s in bad["steps"] if s["id"] == "chip_readout" and s["viewports"] == ["phone"])["actions"]
    next(a for a in acts if a["do"] == "long_press").pop("targets")
    acts[0]["press_ms"] = 600                                          # on a click
    text = "\n".join(cap.semantic_errors(bad))
    assert "long_press needs at least one target" in text
    assert "'press_ms' belongs to long_press only" in text
    short = copy.deepcopy(SCRIPT)
    acts = next(s for s in short["steps"] if s["id"] == "chip_readout" and s["viewports"] == ["phone"])["actions"]
    next(a for a in acts if a["do"] == "long_press")["press_ms"] = 300   # shorter than the hook's timer
    for force in (False, True):
        _, errs = cap.schema_errors(short, force_builtin=force)
        assert errs, force


class _FakePage:
    def __init__(self, log):
        self.log = log

    def wait_for_timeout(self, ms):
        self.log.append(("wait", ms))


class _FakeLocator:
    def __init__(self):
        self.log = []
        self.page = _FakePage(self.log)

    def scroll_into_view_if_needed(self, timeout=None):
        pass

    def hover(self, timeout=None):
        pass

    def bounding_box(self, timeout=None):
        return {"x": 10, "y": 20, "width": 40, "height": 10}

    def dispatch_event(self, kind, init=None):
        self.log.append((kind, dict(init or {})))


def test_long_press_is_a_touch_down_held_past_the_timer_then_up():
    loc = _FakeLocator()
    cap._apply(loc, "long_press", None, False, 600)
    events = [e for e in loc.log if e[0] != "wait" or e[1] >= 450]
    assert [e[0] for e in events] == ["pointerdown", "wait", "pointerup"]
    down, hold, up = events
    assert down[1]["pointerType"] == "touch" and up[1]["pointerType"] == "touch"   # the hook ignores a mouse
    assert (down[1]["clientX"], down[1]["clientY"]) == (30, 25)                     # the target's centre
    assert hold[1] == 600 and hold[1] > _long_press_ms_in_the_hook()
    assert down[1]["buttons"] == 1 and up[1]["buttons"] == 0


# ─── the refusals ───────────────────────────────────────────────────────────────

@pytest.mark.parametrize("url,want", [
    ("http://localhost:8077", "http://localhost:8077"),
    ("http://127.0.0.1:8077/", "http://127.0.0.1:8077"),
    ("HTTP://LOCALHOST:9000", "http://localhost:9000"),
])
def test_base_url_accepts_the_local_sandbox(url, want):
    assert cap.check_base_url(url) == want


@pytest.mark.parametrize("url", [
    "https://uctintelligence.com",
    "http://uctintelligence.com:8077",
    "https://localhost:8077",
    "http://localhost",
    "http://127.0.0.1",
    "http://localhost.uctintelligence.com:8077",
    "http://localhost:8077@uctintelligence.com",
    "http://user:pw@localhost:8077",
    "http://127.0.0.2:8077",
    "http://0.0.0.0:8077",
    "http://[::1]:8077",
    "http://localhost:8077/charts",
    "http://localhost:8077/?next=https://uctintelligence.com",
    "http://localhost:99999",
    "ftp://localhost:8077",
    "",
])
def test_base_url_refuses_everything_else(url):
    with pytest.raises(cap.Refused):
        cap.check_base_url(url)


@pytest.mark.parametrize("email", ["smoke@uctintelligence.internal", "BENCH@UctIntelligence.Internal",
                                   "x@sub.uctintelligence.internal", "not-an-email"])
def test_account_argument_refuses_production_accounts(email):
    with pytest.raises(cap.Refused):
        cap.check_account_arg(email)


def test_account_argument_accepts_the_sandbox_account():
    assert cap.check_account_arg("HubTest@Local.dev") == "hubtest@local.dev"
    assert cap.DEFAULT_ACCOUNT == "hubtest@local.dev"


@pytest.mark.parametrize("me", [
    {"user": {"email": "smoke@uctintelligence.internal"}},
    {"user": {"email": "bench@uctintelligence.internal"}},
    {"user": {"email": "owner@example.com"}},
    {"user": {}},
    {},
    None,
])
def test_auth_me_refuses_anything_but_the_named_account(me):
    with pytest.raises(cap.Refused):
        cap.check_me(me, "hubtest@local.dev")


def test_auth_me_refuses_a_smoke_account_even_when_it_was_asked_for():
    with pytest.raises(cap.Refused):
        cap.check_me({"user": {"email": "smoke@uctintelligence.internal"}}, "smoke@uctintelligence.internal")


def test_auth_me_accepts_the_named_account():
    assert cap.check_me({"user": {"email": "HubTest@local.dev"}}, "hubtest@local.dev") == "hubtest@local.dev"


def test_output_never_goes_into_a_git_checkout(tmp_path):
    with pytest.raises(cap.Refused):
        cap.check_out_dir(ROOT / "tools" / "rs_walkthrough" / "out")
    with pytest.raises(cap.Refused):
        cap.check_out_dir(ROOT)
    fake_repo = tmp_path / "repo"
    (fake_repo / ".git").mkdir(parents=True)
    with pytest.raises(cap.Refused):
        cap.check_out_dir(fake_repo / "videos")
    assert cap.check_out_dir(tmp_path / "videos") == (tmp_path / "videos").resolve()


# ─── captions and the dry run ───────────────────────────────────────────────────

def test_srt_is_ordered_wrapped_and_never_overlaps():
    srt = cap.build_srt([(0, 500, "First caption."), (1200, 4000, "A much longer second caption that "
                                                                "has to wrap onto another line.")])
    blocks = srt.strip().split("\n\n")
    assert blocks[0].splitlines()[1] == "00:00:00,000 --> 00:00:01,199"   # lengthened, then trimmed
    assert blocks[1].splitlines()[1] == "00:00:01,200 --> 00:00:04,000"
    assert all(len(line) <= cap.CAPTION_WRAP for line in blocks[1].splitlines()[2:])
    assert cap.srt_timestamp(3_723_456) == "01:02:03,456"


def test_dry_run_starts_no_browser(capsys, tmp_path, monkeypatch):
    monkeypatch.setitem(sys.modules, "playwright", None)          # any import of it would now fail
    monkeypatch.delenv(cap.PASSWORD_ENV, raising=False)
    assert cap.main(["--dry-run", "--out", str(tmp_path / "v")]) == cap.EXIT_OK
    out = capsys.readouterr().out
    assert "no browser was started" in out
    for step in SCRIPT["steps"]:
        assert step["caption"] in out


def test_dry_run_still_refuses_a_production_target(capsys):
    assert cap.main(["--dry-run", "--base", "https://uctintelligence.com"]) == cap.EXIT_REFUSED
    assert "REFUSED" in capsys.readouterr().out


def test_a_real_run_without_the_password_is_refused_before_any_network(capsys, monkeypatch, tmp_path):
    monkeypatch.delenv(cap.PASSWORD_ENV, raising=False)
    monkeypatch.setattr(cap, "check_sandbox_identity",
                        lambda *a, **k: pytest.fail("reached the network without a password"))
    assert cap.main(["--out", str(tmp_path / "v")]) == cap.EXIT_REFUSED
    assert cap.PASSWORD_ENV in capsys.readouterr().out
