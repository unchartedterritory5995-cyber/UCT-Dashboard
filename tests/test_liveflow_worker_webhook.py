"""TERM-011 step 5 — `api/liveflow_worker.py` fails CLOSED, and does so visibly.

Mirrors `tests/test_discord_watchlist_webhook.py`'s shape exactly (same commit
family, `26b3a1cef` / `9b28d4fa4`). This poster forwards live options-flow
alerts to Discord; unlike `discord_watchlist.py` it has no legacy variable name
to also check, because it only ever read one dedicated var before falling
through.

⛔ THE PROPERTY UNDER TEST IS NEGATIVE: this poster must NEVER fall back to
`DISCORD_WEBHOOK_URL`. `webhook_url()` reads `DISCORD_LIVE_FLOW_WEBHOOK_URL`
only. A regression that restores the old `or os.getenv("DISCORD_WEBHOOK_URL",
"")` tail would make this poster's "nothing configured" state silently forward
into the admin/ops room — a card in the wrong room reading as a success.

⭐ MEASURED, NOT ASSUMED, that this changes no production behaviour today:
`DISCORD_LIVE_FLOW_WEBHOOK_URL` is SET on the `web` service and resolves to a
DIFFERENT webhook id than `DISCORD_WEBHOOK_URL` (`railway variables --service
web --kv`, 2026-09-27, ids compared without printing either URL). So this
poster was never actually reaching the admin room in production — the fallback
was dead code, made structurally impossible rather than merely unused.
"""

from __future__ import annotations

import ast
from pathlib import Path

import pytest

from api import liveflow_worker as lw

REPO = Path(__file__).resolve().parents[1]


# ── webhook_url(): call-time, no literal DISCORD_WEBHOOK_URL fallback ──────────

def test_webhook_url_reads_the_named_variable_at_CALL_time(monkeypatch):
    monkeypatch.delenv(lw.WEBHOOK_ENV, raising=False)
    assert lw.webhook_url() == ""

    monkeypatch.setenv(lw.WEBHOOK_ENV, "https://discord.example/live-flow")
    assert lw.webhook_url() == "https://discord.example/live-flow"

    # ⭐ CALL TIME, not import time — the SAME process sees the flip with no reload.
    monkeypatch.delenv(lw.WEBHOOK_ENV, raising=False)
    assert lw.webhook_url() == ""


def test_webhook_url_NEVER_reads_DISCORD_WEBHOOK_URL(monkeypatch):
    """⛔⛔ THE ACCEPTANCE TEST. With the admin webhook SET and this poster's own
    variable UNSET, `webhook_url()` must still answer "" — never the admin
    channel. This is the one property step 5 exists to establish."""
    monkeypatch.delenv(lw.WEBHOOK_ENV, raising=False)
    monkeypatch.setenv("DISCORD_WEBHOOK_URL", "https://discord.example/ADMIN-ROOM")
    assert lw.webhook_url() == ""


# ── _discord_post_url() / _discord_patch_url(): pure functions, call-time ─────

def test_discord_post_and_patch_urls_use_webhook_url_at_call_time(monkeypatch):
    monkeypatch.setenv(lw.WEBHOOK_ENV, "https://discord.example/live-flow")
    assert lw._discord_post_url() == "https://discord.example/live-flow?wait=true"
    assert lw._discord_patch_url("123") == "https://discord.example/live-flow/messages/123"

    # ⭐ CALL TIME — the same functions see a later flip with no reimport.
    monkeypatch.delenv(lw.WEBHOOK_ENV, raising=False)
    assert lw._discord_post_url() == "?wait=true"


# ── get_status()['discord_configured']: reflects webhook_url(), IMPORT TIME ───

def test_status_discord_configured_is_a_plain_bool_present_and_non_raising():
    """⚠️ NOT a call-time property, and this test cannot assert a VALUE: `_status`
    is a module-level dict literal, computed once at import — this test process
    already imported the module before any monkeypatch could run, so the field
    reflects whatever `DISCORD_LIVE_FLOW_WEBHOOK_URL` was in THIS process's real
    environment at import, not a value this test controls. That timing is
    UNCHANGED by this conversion (the field was always an import-time snapshot;
    only the source it snapshots changed, from a constant with a fallback to one
    without). What this test can and does assert: the key exists, is a bool, and
    `get_status()` does not raise — the boring but real regression to catch is
    `webhook_url` no longer existing or the dict construction throwing."""
    status = lw.get_status()
    assert "discord_configured" in status
    assert isinstance(status["discord_configured"], bool)


# ── replay_post_alerts_to_discord(): fails closed, visibly, never falls through ─

async def test_replay_posts_NOTHING_with_no_webhook_configured(monkeypatch):
    monkeypatch.delenv(lw.WEBHOOK_ENV, raising=False)
    monkeypatch.setenv("DISCORD_WEBHOOK_URL", "https://discord.example/ADMIN-ROOM")

    result = await lw.replay_post_alerts_to_discord(alerts=[])

    assert result["attempted"] == 0
    assert "https://discord.example/ADMIN-ROOM" not in str(result)
    # ⭐ VISIBLE SILENCE — the error names the variable that turns replay back on.
    assert lw.WEBHOOK_ENV in result["error"], (
        f"the refusal did not name the variable that turns replay back on: {result}")


async def test_replay_proceeds_when_its_OWN_webhook_is_set(monkeypatch):
    """⛔ THE CONTROL. Without this, the test above would also pass on a function
    that always refuses regardless of configuration."""
    monkeypatch.setenv(lw.WEBHOOK_ENV, "https://discord.example/live-flow")

    result = await lw.replay_post_alerts_to_discord(alerts=[])

    # Empty alert list: nothing attempted, but NOT the "no webhook" refusal shape.
    assert result["attempted"] == 0
    assert "error" not in result or lw.WEBHOOK_ENV not in str(result.get("error", ""))


# ── api/liveflow_router.py: no CODE path still reads the retired attribute ────
#
# ⛔ THIS FILE NEVER CALLED os.getenv("DISCORD_WEBHOOK_URL") DIRECTLY, so
# `tests/test_alert_destination.py`'s literal_reads_in() sweep (which matches
# only os.environ.get / os.getenv / os.environ[...] calls) was structurally
# blind to it — it read `liveflow_worker.DISCORD_WEBHOOK_URL` as an ATTRIBUTE
# and once via `getattr(liveflow_worker, "DISCORD_WEBHOOK_URL", "")`, neither
# of which that sweep's pattern matches. This is the narrower, purpose-built
# check for THIS retired attribute, over the one file that read it.

def _attribute_and_getattr_hits(source: str) -> list[int]:
    """Line numbers of `liveflow_worker.DISCORD_WEBHOOK_URL` (attribute access)
    or `getattr(liveflow_worker, "DISCORD_WEBHOOK_URL", ...)` in `source`.

    ⛔ AST, never a grep — a docstring or comment naming the retired attribute
    (there are two, deliberately, explaining what changed) must not count.
    """
    hits: list[int] = []
    for node in ast.walk(ast.parse(source)):
        if (isinstance(node, ast.Attribute) and node.attr == "DISCORD_WEBHOOK_URL"
                and isinstance(node.value, ast.Name) and node.value.id == "liveflow_worker"):
            hits.append(node.lineno)
        elif (isinstance(node, ast.Call) and isinstance(node.func, ast.Name)
              and node.func.id == "getattr" and len(node.args) >= 2
              and isinstance(node.args[1], ast.Constant)
              and node.args[1].value == "DISCORD_WEBHOOK_URL"):
            hits.append(node.lineno)
    return sorted(hits)


def test_the_detector_distinguishes_a_REAL_hit_from_a_docstring_mention():
    """⛔ CONTROL, run before trusting the real file below. A prose mention must
    vanish; a real attribute access or getattr call must survive."""
    prose_only = (
        '"""See liveflow_worker.DISCORD_WEBHOOK_URL for the old shape."""\n'
        "# also mentions getattr(liveflow_worker, \"DISCORD_WEBHOOK_URL\", \"\") in prose\n"
        "x = 1\n"
    )
    assert _attribute_and_getattr_hits(prose_only) == []

    real_attr = "import api.liveflow_worker as liveflow_worker\nx = liveflow_worker.DISCORD_WEBHOOK_URL\n"
    assert len(_attribute_and_getattr_hits(real_attr)) == 1

    real_getattr = (
        "import api.liveflow_worker as liveflow_worker\n"
        'x = getattr(liveflow_worker, "DISCORD_WEBHOOK_URL", "")\n'
    )
    assert len(_attribute_and_getattr_hits(real_getattr)) == 1


def test_liveflow_router_has_NO_remaining_code_reference_to_the_retired_attribute():
    source = (REPO / "api" / "liveflow_router.py").read_text(encoding="utf-8")
    hits = _attribute_and_getattr_hits(source)
    assert hits == [], (
        f"api/liveflow_router.py still reads the retired "
        f"liveflow_worker.DISCORD_WEBHOOK_URL attribute at line(s) {hits} — "
        f"it must call liveflow_worker.webhook_url() instead")


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch):
    """Belt-and-braces: never let a leaked value from another test's env answer
    for this file's assertions."""
    monkeypatch.delenv("DISCORD_WEBHOOK_URL", raising=False)
    monkeypatch.delenv(lw.WEBHOOK_ENV, raising=False)
