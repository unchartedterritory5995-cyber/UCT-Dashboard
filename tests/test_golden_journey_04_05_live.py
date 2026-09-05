"""Golden Journeys #4 (plain language) and #5 (screenshot) -- REAL model-call
round trips. Phase One, Track E (DEC-008).

⛔ THIS FILE NEEDS A REAL, SCOPED `ANTHROPIC_API_KEY` FOR MOST OF ITS CASES. Per
DEC-008 that key is isolated-environment-only, never production, never a
member's. Every case that would spend it checks for the key FIRST and calls
`pytest.skip(...)` with a loud, specific reason if it is absent -- matching this
repo's own established convention for an environment-gated test (see
`test_screener_auth_surface.py`'s `SCREEN_BACKTEST_ENABLED is off` skip, which
reads in a `-rs` summary exactly as this one is designed to: named, not silent,
and explicitly NOT mistakeable for a pass). One case (the empty-prompt refusal)
needs no key at all and always runs -- see its own docstring.

Run once a key exists:
    ANTHROPIC_API_KEY=sk-ant-... INDICATOR_VISION_ENABLED=1 \\
        pytest tests/test_golden_journey_04_05_live.py -v -rs

DO NOT set ANTHROPIC_API_KEY to a production/member-facing key to make this
file's skips go away -- that is exactly the workaround DEC-008 forbids.
"""
import json
import os
import uuid
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from api.main import app
from api.services.auth_db import init_db as auth_init_db
from api.services.auth_service import create_session, create_user

FIXTURES = Path(__file__).parent / "fixtures" / "golden_journey"
CASES = json.loads((FIXTURES / "cgj4_cases.json").read_text())
SCREENSHOT_PNG = FIXTURES / "cgj5_screenshot_known_answer.png"

_NO_KEY_REASON = (
    "ANTHROPIC_API_KEY not set -- this is Track E's real-model-call gate "
    "working as designed (DEC-008: isolated-environment-only key, provisioned "
    "separately from this test run), not a test failure or a gap in coverage."
)
_VISION_OFF_REASON = (
    "INDICATOR_VISION_ENABLED is not '1' -- deliberate product flag, and "
    "DEC-008 requires it set ONLY in the same isolated environment as the "
    "scoped key, never globally."
)


def _has_real_key() -> bool:
    return bool(os.environ.get("ANTHROPIC_API_KEY", "").strip())


def _vision_on() -> bool:
    return os.environ.get("INDICATOR_VISION_ENABLED", "").strip().lower() in (
        "1", "true", "yes", "on")


@pytest.fixture
def client():
    auth_init_db()
    return TestClient(app)


def _login(client, plan="pro") -> str:
    """Mirrors test_indicator_from_image.py::_login -- same sandboxed auth.db,
    same pattern, so this file needs no new auth machinery."""
    user = create_user(f"cgj_{uuid.uuid4()}@example.com", "password123")
    from api.services.auth_db import get_connection
    conn = get_connection()
    try:
        conn.execute(
            "INSERT INTO subscriptions (id, user_id, plan, status) "
            "VALUES (?, ?, ?, 'active')", (uuid.uuid4().hex, user["id"], plan))
        conn.commit()
    finally:
        conn.close()
    client.cookies.set("uct_session", create_session(user["id"]))
    return user["id"]


# ═══ Always runs, no key needed ═══════════════════════════════════════════

def test_empty_prompt_refuses_before_spending_a_token(client):
    """definition_concierge.propose()'s own first check. No model call is even
    attempted, so this is real coverage today regardless of DEC-008's status."""
    _login(client)
    case = CASES["empty_prompt_should_refuse_before_spending_a_token"]
    res = client.post("/api/user-definitions/propose",
                      json={"prompt": case["prompt"], "kind": case["kind"]})
    assert res.status_code == 200
    body = res.json()
    assert body["ok"] is False
    assert body["gate"] == "prompt:empty"


# ═══ Journey #4 -- plain language, real model call ═════════════════════════

@pytest.mark.skipif(not _has_real_key(), reason=_NO_KEY_REASON)
class TestGoldenJourney04Live:

    def test_positive_case_produces_an_inspectable_ast(self, client):
        _login(client)
        case = CASES["positive"]
        res = client.post("/api/user-definitions/propose",
                          json={"prompt": case["prompt"], "kind": case["kind"]})
        assert res.status_code == 200, "a refusal is 200+ok:false, never a raw 4xx"
        body = res.json()
        assert body["ok"] is True, f"model call failed: {body.get('reason')}"
        assert "ast" in body and "sentence" in body
        # EVIDENCE, not just an assertion: record what the model actually chose
        # for the underspecified "moving average" phrase (sma vs ema), per this
        # case's own note in cgj4_cases.json. Print rather than hard-assert one
        # answer -- both are defensible; what matters is which one it picked
        # gets INTO THE RECORD instead of silently vanishing after the test run.
        print(f"[CGJ4 evidence] prompt={case['prompt']!r} -> "
              f"sentence={body['sentence']!r} ast={body['ast']}")

    def test_ambiguous_prompt_does_not_silently_guess(self, client):
        _login(client)
        case = CASES["ambiguous_should_clarify_or_partially_refuse"]
        res = client.post("/api/user-definitions/propose",
                          json={"prompt": case["prompt"], "kind": case["kind"]})
        assert res.status_code == 200
        body = res.json()
        # This is an OBSERVATION case, not a hard pass/fail gate -- see
        # cgj4_cases.json. Record the actual outcome; only fail if the engine
        # produced a confident-looking formula with no trace of the refused
        # vocabulary anywhere in the response.
        print(f"[CGJ4 evidence] ambiguous prompt -> ok={body.get('ok')} "
              f"gate={body.get('gate')} not_understood={body.get('not_understood')}")
        if body.get("ok") is True:
            pytest.fail(
                "the model silently resolved an unfamiliar phrase ('vibe', "
                "'turns bullish') into a confident formula with no refusal "
                "trace -- this is the silent-wrong-answer failure mode this "
                "program exists to catch. Report as a finding, do not loosen "
                "this assertion.")

    def test_out_of_vocabulary_function_is_refused_by_name(self, client):
        _login(client)
        case = CASES["out_of_vocabulary_function_should_refuse_by_name"]
        res = client.post("/api/user-definitions/propose",
                          json={"prompt": case["prompt"], "kind": case["kind"]})
        assert res.status_code == 200
        body = res.json()
        print(f"[CGJ4 evidence] out-of-vocab prompt -> ok={body.get('ok')} "
              f"gate={body.get('gate')} reason={body.get('reason')}")
        assert body.get("ok") is not True, (
            "'McGinley Dynamic' is not one of closedTable.json's 64 functions; "
            "an ok:true here means the door silently substituted a different "
            "indicator without saying so")

    def test_persistence_survives_a_reload_with_the_same_astHash(self, client):
        """Propose -> accept -> save -> reload -> the AST (and therefore
        astHash) must be byte-identical, proving the save path stores the
        COMPILED tree the read-back described, not a re-interpretation."""
        _login(client)
        case = CASES["positive"]
        proposed = client.post(
            "/api/user-definitions/propose",
            json={"prompt": case["prompt"], "kind": case["kind"]}).json()
        assert proposed["ok"] is True, f"cannot test persistence: {proposed}"

        saved = client.post("/api/user-definitions", json={
            "definition": {
                "meta": {"name": f"cgj4-{uuid.uuid4().hex[:8]}",
                        "kind": case["kind"]},
                "ast": proposed["ast"],
            }
        })
        assert saved.status_code == 200, saved.text
        def_id = saved.json()["id"] if "id" in saved.json() else saved.json().get("def_id")
        assert def_id, f"save response missing an id: {saved.json()}"

        reloaded = client.get(f"/api/user-definitions/{def_id}")
        assert reloaded.status_code == 200
        reloaded_ast = reloaded.json()["definition"]["ast"]
        assert reloaded_ast == proposed["ast"], (
            "the reloaded AST differs from what was proposed and saved -- "
            "the save/load path is not round-tripping the compiled tree")

    def test_saved_definition_is_scan_deliverable(self, client):
        """kind='scan' -- the funnel every screener surface reads from
        (ScreensManager -> ScanResults -> CoverageLine per CLAUDE.md) must be
        able to accept this definition without a second, AI-door-specific
        validation path. Reuses the ordinary save door; no new plumbing."""
        _login(client)
        case = CASES["positive"]
        proposed = client.post(
            "/api/user-definitions/propose",
            json={"prompt": case["prompt"], "kind": "scan"}).json()
        assert proposed["ok"] is True, f"cannot test scan delivery: {proposed}"
        saved = client.post("/api/user-definitions", json={
            "definition": {
                "meta": {"name": f"cgj4-scan-{uuid.uuid4().hex[:8]}", "kind": "scan"},
                "ast": proposed["ast"],
            }
        })
        assert saved.status_code == 200, (
            f"a model-proposed scan condition was rejected by the ordinary "
            f"save door: {saved.text}")


# ═══ Journey #5 -- screenshot, real vision model call ══════════════════════

@pytest.mark.skipif(not _has_real_key(), reason=_NO_KEY_REASON)
@pytest.mark.skipif(not _vision_on(), reason=_VISION_OFF_REASON)
class TestGoldenJourney05Live:

    def test_known_answer_screenshot_produces_a_candidate(self, client):
        """cgj5_screenshot_known_answer.png (see gen_cgj5_screenshot.py) is a
        synthetic candlestick pane + an RSI-SHAPED oscillator pane with 30/70
        reference lines -- the textbook visual signature of RSI. A reasonable
        candidate names an oscillator function (rsi being the obvious guess);
        this test observes and records what actually comes back rather than
        hard-pinning one exact function, since "a defensible guess, clearly
        labeled as a guess" is the actual product promise (per the Screenshot
        tab's own copy, quoted in CORE_GOLDEN_JOURNEY_05_SCREENSHOT_VISION.md),
        not "always guesses rsi specifically."
        """
        assert SCREENSHOT_PNG.exists(), (
            "run gen_cgj5_screenshot.py first to (re)generate the fixture")
        _login(client)
        with open(SCREENSHOT_PNG, "rb") as f:
            res = client.post(
                "/api/indicator-vision/candidates",
                files={"file": ("cgj5.png", f, "image/png")})
        assert res.status_code == 200, "a refusal is 200+ok:false, never a raw 4xx"
        body = res.json()
        print(f"[CGJ5 evidence] candidates response: {body}")
        assert body.get("ok") is True, f"vision call failed: {body.get('reason')}"
        assert body.get("candidates"), "no candidates returned for a known chart"
        for cand in body["candidates"]:
            assert "sentence" in cand, (
                "every candidate must carry a compiler-derived read-back "
                "sentence, never the model's own uninspected prose")
