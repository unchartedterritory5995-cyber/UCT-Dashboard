"""TERM-011 / RM-N09 step 3 — the rails for the OPS-only conversion.

⛔⛔ THE FIRST TWO SECTIONS ARE THE DELIVERABLE, NOT THE ROUTING. Step 3 converts
door B's 22 emit sites as one class plus the direct ops posters of spec §4.1, and
the thing that has to be PROVED is not that the split works — it is that **with the
new variables blank, which is how they ship and what production holds right now,
every alert lands exactly where it lands today, byte for byte.**

⛔ An ops alert that silently goes nowhere is strictly worse than one in the wrong
room: this channel carries the pager, and `chart_health_alerts.py`'s own header
records what that already cost — *"the in-memory deque was admin-pull-only, so a
bars-store problem paged no one — the gap that let the 2026-08-11 daily freeze run
for a week."* So §1 proves the blank path resolves today's destination and §2 proves
it AT THE WIRE for every converted producer: the URL POSTed to, and the exact bytes
sent. §2's expected bodies are LITERALS on purpose — a derived expectation would
follow a payload change instead of failing on it, and the payload change most likely
to arrive here is spec §5.2's `route=fallback:admin` stamp (named and deliberately
NOT implemented; see `api/services/alert_destination.py`'s header for why).

⛔ SCOPED RUN ONLY. `python -m pytest tests/test_alert_destination.py
tests/test_alert_routing.py tests/test_chart_health_severity_vocabulary.py -q` and
the rest of the list in the commit message. Never an unscoped pytest on this box:
one reached 18 GB and was OOM-killed, and `-k` does not help because collection is
where the memory goes.

⛔ WHAT THESE RAILS CANNOT DO. They prove the CLASS reaches the destination today's
code reached, and that the conversion boundary is where it says it is. They cannot
prove the class is the RIGHT one — spec §4's classification is a judgement applied
to a mechanically-derived call-site list, and it is reviewed by a person or it is
not reviewed. Nothing here is evidence about §4.
"""

from __future__ import annotations

import ast
import json
from pathlib import Path

import pytest

from api.services import alert_destination as ad
from api.services import alert_routing as ar

REPO = Path(__file__).resolve().parents[1]

#: Stands in for whatever `DISCORD_WEBHOOK_URL` holds in production. It is
#: deliberately webhook-SHAPED so the leak rails below have something to look for.
TODAY = "https://discord.com/api/webhooks/111/TODAYS-ADMIN-CHANNEL-TOKEN"
OPS_ONLY = "https://discord.com/api/webhooks/222/A-DEDICATED-OPS-CHANNEL-TOKEN"

#: ⭐ DERIVED, never typed — the union severity vocabulary is the resolver's own
#: priority table (`info`, `warning`, `critical`, and the `warn` typo two scales
#: share). A hand-typed list here would drift in the flattering direction.
SEVERITY_UNION = tuple(sorted(ar.SEVERITY_PRIORITY))

# ══════════════════════════════════════════════════════════════════════════════
#  THE CONVERSION ROSTER — one entry per module step 3 converted.
#
#  ⛔ PINNED BY NAME, because a COUNT can be satisfied by the wrong set. Each of
#  these imports `alert_destination`; nothing else under `api/` does, and the rail
#  in §4 asserts both directions, so a surprise consumer and a silently reverted
#  conversion each fail here rather than passing quietly.
# ══════════════════════════════════════════════════════════════════════════════
CONVERTED = {
    # Door B's sink. ⭐ ONE change, 22 emit sites — and not one of them moved: the
    # emit-site population, its severity vocabulary and both throttles are
    # untouched, which is why `tests/test_chart_health_severity_vocabulary.py`'s
    # EXPECTED_EMIT_SITES / EXPECTED_LITERAL_SEVERITY_SITES pins did not move.
    "api/services/chart_health_alerts.py",
    # The direct ops posters of spec §4.1 whose destination was an unconditional
    # single read of `DISCORD_WEBHOOK_URL`. That predicate IS the conversion
    # boundary, and §3 below derives it rather than restating it.
    "api/event_loop_watchdog.py",
    "api/worker_main.py",
    "api/auth_surface_check.py",
    "api/flow_backup.py",
    "api/flow_gap_autofill.py",
}

# ══════════════════════════════════════════════════════════════════════════════
#  AND THE MODULES THAT STILL READ THE LITERAL — each with the step that owns it.
#
#  ⛔ THIS IS THE OTHER HALF OF THE BOUNDARY AND IT IS NOT DECORATION. Step 3's
#  scope is "the OPS-only producers"; every module below is a row a LATER step
#  decides, and touching one here would either batch a decision (spec §6 step 6:
#  *"Batching them makes a wrong one unattributable"*) or silence a content poster
#  before anything is listening for the silence (step 5's "why not earlier").
#  Pinning them means a future step MOVING a row is a visible diff on this list,
#  and a regression re-adding a literal read to a converted module fails §3.
# ══════════════════════════════════════════════════════════════════════════════
STILL_LITERAL = {
    # ── spec §6 STEP 5 — the ↩ADMIN-FALLBACK posters (D7's nine). `DISCORD_WEBHOOK_URL`
    #    is the TERMINAL `or` of a chain; they stop falling back and fail closed,
    #    following `calendar_week_poster.py`'s *"`live` NEVER falls back"*.
    "api/alpha_gold_eod.py": 5,
    "api/cream_card.py": 5,
    "api/darkpool_eod.py": 5,
    "api/discord_watchlist.py": 5,
    "api/live_massive_router.py": 5,
    "api/liveflow_worker.py": 5,
    "api/oi_morning.py": 5,
    "api/weekly_flow.py": 5,
    # ⚠️ The ops member of D7's nine, and it is STILL step 5's, not step 3's. Its
    #    read is `LIVEFLOW_ALERT_WEBHOOK_URL or DISCORD_WEBHOOK_URL` captured at
    #    MODULE IMPORT, so converting it is two decisions at once — where the
    #    class's variable sits in an existing chain, and whether to fix the
    #    import-time capture — not the single-read conversion step 3 is scoped to.
    "api/services/liveflow_monitor.py": 5,
    #    §4.2: only the `test` target falls back; `live` is fail-closed by design.
    "api/services/calendar_week_poster.py": 5,
    # ── spec §6 STEP 6 — the BOTH rows. Decisions, one commit each, never a batch.
    "api/services/desk_session_recap.py": 6,          # §4.3 row 13
    "api/services/journal_two/books_audit.py": 6,     # §4.3 row 9
    "api/services/journal_two/broker/mirror_check.py": 6,    # §4.3 row 8
    "api/services/journal_two/broker/notifications.py": 6,   # §4.3 row 7
    # ── door C. The shared sink for the BUSINESS notifiers AND four BOTH rows, so
    #    giving it a class is an edit to the business path, which step 3 does not
    #    own. Spec §9 leaves sequencing its import-time capture to this step's
    #    implementer; this step DECLINED, and the reason is that fixing the capture
    #    changes what "blank the variable" means for every business event in the
    #    same commit that must not change any behaviour at all.
    "api/services/discord_notify.py": 6,
    "api/services/discord_relay.py": 6,               # §4.2, a member's own post
}


@pytest.fixture(autouse=True)
def production_env(monkeypatch):
    """⭐ REPRODUCE PRODUCTION: the two new variables and the gate are ABSENT.

    Step 2's own words are *"the three destination variables are absent from every
    Railway service"*. Removing them here means no leaked value from another test
    can make an invariant test pass for the wrong reason — the blank-path rails
    below would be measuring a configured primary and reading as green.
    """
    for name in (ar.OPS_WEBHOOK_ENV, ar.BUSINESS_WEBHOOK_ENV, ar.OPS_EMAIL_ENV,
                 ar.ROUTING_FLAG_ENV):
        monkeypatch.delenv(name, raising=False)


# ═══════════════════════════════════════════════════════════════════════════════
#  §1 — THE INVARIANT. A blank or unset variable resolves TODAY'S destination.
# ═══════════════════════════════════════════════════════════════════════════════

def test_the_INVARIANT_an_UNSET_ops_variable_resolves_todays_destination(monkeypatch):
    """⛔⛔ THE ONE THAT MATTERS MORE THAN THE FEATURE.

    This is production's exact state: `DISCORD_OPS_WEBHOOK_URL` absent,
    `DISCORD_WEBHOOK_URL` set. Every converted producer inherits this answer.
    """
    monkeypatch.setenv(ar.ADMIN_WEBHOOK_ENV, TODAY)
    assert ad.ops_webhook() == TODAY


def test_the_INVARIANT_a_BLANK_ops_variable_resolves_todays_destination(monkeypatch):
    """⛔ BLANKED with `setenv(..., "")`, NEVER `delenv` — `tools/audit_sandbox_env.py:57-58`
    states the rule for this exact variable: *"BLANK, never popped — a blank webhook
    posts nothing; removing the var lets a default re-appear."* Step 1's landing
    calls a blank variable *"observable and inert"*; inert is what this asserts.
    """
    monkeypatch.setenv(ar.ADMIN_WEBHOOK_ENV, TODAY)
    monkeypatch.setenv(ar.OPS_WEBHOOK_ENV, "")
    assert ad.ops_webhook() == TODAY


@pytest.mark.parametrize("severity", SEVERITY_UNION + ("", "banana"))
def test_the_INVARIANT_holds_at_EVERY_severity_including_the_unknown_ones(monkeypatch, severity):
    """Severity is a within-class priority and never a router. If a severity could
    change the destination, the invariant would hold for whichever one the test
    happened to pick and fail in production for the others."""
    monkeypatch.setenv(ar.ADMIN_WEBHOOK_ENV, TODAY)
    monkeypatch.setenv(ar.OPS_WEBHOOK_ENV, "")
    assert ad.ops_webhook(severity) == TODAY


def test_the_CONTROL_a_SET_ops_variable_WINS(monkeypatch):
    """⛔ WITHOUT THIS, EVERY TEST ABOVE PASSES ON A MODULE THAT IGNORES THE PRIMARY.

    "the blank path resolves the admin webhook" is also true of a resolver that
    resolves the admin webhook unconditionally — i.e. of a step 3 that wired
    nothing. This is the half that proves the routing is real.
    """
    monkeypatch.setenv(ar.ADMIN_WEBHOOK_ENV, TODAY)
    monkeypatch.setenv(ar.OPS_WEBHOOK_ENV, OPS_ONLY)
    assert ad.ops_webhook() == OPS_ONLY

    destination = ad.destination_for(ar.CLASS_OPS)
    assert destination.env_name == ar.OPS_WEBHOOK_ENV
    assert destination.used_fallback is False


def test_the_fallback_is_REPORTED_as_a_fallback_even_though_nothing_acts_on_it(monkeypatch):
    """The seam spec §5.3's roll-up and §5.2's stamp will read, asserted now so the
    step that needs it does a read rather than a re-derivation. ⚠️ Nothing acts on
    it today ON PURPOSE: with the variable unset every OPS post falls back, so a
    counter would report the migration's starting state as a 100% defect rate and
    a stamp would change the payload this commit must not change."""
    monkeypatch.setenv(ar.ADMIN_WEBHOOK_ENV, TODAY)
    monkeypatch.setenv(ar.OPS_WEBHOOK_ENV, "")
    destination = ad.destination_for(ar.CLASS_OPS)
    assert destination.url == TODAY
    assert destination.env_name == ar.ADMIN_WEBHOOK_ENV
    assert destination.used_fallback is True
    assert destination.routed is True


def test_nothing_configured_reads_as_EMPTY_and_never_raises(monkeypatch):
    """Both variables blank ⇒ `""`, which is how every converted call site already
    reads "no channel". ⛔ It must not raise: two callers are pagers, and an
    exception thrown while looking up somewhere to report a problem would silence
    the alarm it was looking the destination up for."""
    monkeypatch.setenv(ar.ADMIN_WEBHOOK_ENV, "")
    monkeypatch.setenv(ar.OPS_WEBHOOK_ENV, "")
    assert ad.ops_webhook() == ""
    assert ad.destination_for(ar.CLASS_OPS).env_name == ""


def test_the_destination_is_read_PER_CALL_and_never_captured(monkeypatch):
    """⭐ The idiom is `tests/test_hub_preview_flag.py`'s: same process, same imported
    module, NO reload, one environment change between two calls.

    `api/services/discord_notify.py:11` is the defect — a module constant captured
    at import, so blanking the variable reaches nothing until a restart while the
    operator reads it back as empty and `--kv` agrees.
    """
    monkeypatch.setenv(ar.ADMIN_WEBHOOK_ENV, TODAY)
    assert ad.ops_webhook() == TODAY
    monkeypatch.setenv(ar.OPS_WEBHOOK_ENV, OPS_ONLY)     # no reimport between these
    assert ad.ops_webhook() == OPS_ONLY
    monkeypatch.setenv(ar.OPS_WEBHOOK_ENV, "")
    assert ad.ops_webhook() == TODAY


# ═══════════════════════════════════════════════════════════════════════════════
#  §2 — THE WIRE. Per converted producer: the URL, and the exact bytes.
# ═══════════════════════════════════════════════════════════════════════════════

class _Response:
    """A context-manager stand-in for a urlopen response. Opens no socket."""

    def __enter__(self):
        return self

    def __exit__(self, *_exc):
        return False

    def read(self, _n=None):
        return b""


class _Wire:
    """Records `(url, body, headers)`. ⛔ Never a socket, never a real Discord post."""

    def __init__(self):
        self.posts: list[tuple[str, bytes | None, dict]] = []

    # `urllib.request`'s two-call shape
    def Request(self, url, data=None, headers=None):          # noqa: N802 - mimics urllib
        self.posts.append((url, data, dict(headers or {})))
        return object()

    def urlopen(self, _req, timeout=None):                    # noqa: ARG002
        return _Response()

    # `httpx.post`'s one-call shape
    def post(self, url, json=None, timeout=None, headers=None):   # noqa: A002,ARG002
        self.posts.append((url, json, dict(headers or {})))


class _ImmediateThread:
    """Runs the target inline. `_page_discord` posts on a daemon thread so it never
    blocks a caller; a real thread would make this test a race."""

    def __init__(self, target=None, args=(), name=None, daemon=None):   # noqa: ARG002
        self._target, self._args = target, args

    def start(self):
        if self._target is not None:
            self._target(*self._args)

    def is_alive(self):
        return False


class _CapturingThread:
    """Records the target and its args and starts NOTHING — for the two producers
    that resolve the destination once per process START and hand it to a thread."""

    made: list["_CapturingThread"] = []

    def __init__(self, target=None, args=(), name=None, daemon=None):   # noqa: ARG002
        self.target, self.args, self.name = target, args, name
        _CapturingThread.made.append(self)

    def start(self):
        return None

    def is_alive(self):
        return False


class _ThreadingShim:
    Thread = _ImmediateThread


class _CapturingShim:
    Thread = _CapturingThread


def _closure_of(fn) -> dict:
    """`{free variable: value}` for a closure.

    ⛔ THE CALLER ASSERTS THE NAME IS PRESENT, so renaming the local reds instead of
    this quietly answering `None` — the empty-result trap in miniature.
    """
    out = {}
    for name, cell in zip(fn.__code__.co_freevars, fn.__closure__ or ()):
        try:
            out[name] = cell.cell_contents
        except ValueError:                     # pragma: no cover - unassigned cell
            out[name] = "<unassigned>"
    return out


@pytest.fixture
def blank_ops(monkeypatch):
    """Production's state: the ops variable blank, `DISCORD_WEBHOOK_URL` = TODAY."""
    monkeypatch.setenv(ar.ADMIN_WEBHOOK_ENV, TODAY)
    monkeypatch.setenv(ar.OPS_WEBHOOK_ENV, "")
    return TODAY


# ── door B's sink — the 22 emit sites, as one class ───────────────────────────

def test_WIRE_door_B_posts_to_todays_channel_with_byte_identical_content(monkeypatch, blank_ops):
    """⛔⛔ THE HEADLINE PROOF. `chart_health_alerts.emit` is the sink all 22 of
    door B's call sites reach, so this one assertion covers the whole class.

    The expected body is a LITERAL. A route stamp, a class field or a severity
    label appended to the post would fail here, which is exactly what the payload
    half of the invariant means.
    """
    from api.services import chart_health_alerts as cha

    wire = _Wire()
    monkeypatch.setattr(cha, "_urllib", wire)
    monkeypatch.setattr(cha, "threading", _ThreadingShim)
    monkeypatch.setenv("CHART_HEALTH_DISCORD_ENABLED", "1")
    cha.clear()

    assert cha.emit("bars_daily_store_stale", "critical", "the daily store is stale") is True

    assert len(wire.posts) == 1, wire.posts
    url, body, headers = wire.posts[0]
    assert url == TODAY, "door B's page went somewhere other than today's channel"
    assert body == json.dumps({
        "content": "\U0001f534 **Chart health — bars_daily_store_stale**: "
                   "the daily store is stale",
    }).encode()
    assert headers == {"Content-Type": "application/json",
                       "User-Agent": "uct-chart-health/1"}


def test_WIRE_door_B_posts_NOTHING_when_no_channel_is_configured(monkeypatch):
    """The other half of byte-identical: with everything blank the producer is inert,
    exactly as it was when it read the literal. ⭐ And the alert still QUEUES — the
    deque is the admin-pull surface and losing it would be a real behaviour change
    hiding behind a routing commit."""
    from api.services import chart_health_alerts as cha

    wire = _Wire()
    monkeypatch.setattr(cha, "_urllib", wire)
    monkeypatch.setattr(cha, "threading", _ThreadingShim)
    monkeypatch.setenv(ar.ADMIN_WEBHOOK_ENV, "")
    monkeypatch.setenv(ar.OPS_WEBHOOK_ENV, "")
    cha.clear()

    assert cha.emit("bars_store_unhealthy", "critical", "no channel") is True
    assert wire.posts == []
    assert cha.list_recent()[0]["alert_key"] == "bars_store_unhealthy"


def test_WIRE_door_B_follows_the_ops_variable_once_it_is_SET(monkeypatch):
    """⛔ THE CONTROL FOR THE TWO ABOVE. Both would pass on a sink that still read
    the literal and had never been converted at all."""
    from api.services import chart_health_alerts as cha

    wire = _Wire()
    monkeypatch.setattr(cha, "_urllib", wire)
    monkeypatch.setattr(cha, "threading", _ThreadingShim)
    monkeypatch.setenv(ar.ADMIN_WEBHOOK_ENV, TODAY)
    monkeypatch.setenv(ar.OPS_WEBHOOK_ENV, OPS_ONLY)
    cha.clear()

    cha.emit("render_stall", "critical", "stalled")
    assert wire.posts[0][0] == OPS_ONLY


# ── the direct ops posters ─────────────────────────────────────────────────────

def test_WIRE_flow_backup_integrity_alert(monkeypatch, blank_ops):
    import urllib.request as urllib_request

    from api import flow_backup

    wire = _Wire()
    monkeypatch.setattr(urllib_request, "Request", wire.Request)
    monkeypatch.setattr(urllib_request, "urlopen", wire.urlopen)

    assert flow_backup._post_discord("flow.db integrity_check failed") is True
    url, body, headers = wire.posts[0]
    assert url == TODAY
    assert body == json.dumps({"content": "flow.db integrity_check failed"}).encode()
    assert headers == {"Content-Type": "application/json",
                       "User-Agent": "uct-flow-backup/1"}


def test_WIRE_flow_gap_autofill_alert(monkeypatch, blank_ops):
    import urllib.request as urllib_request

    from api import flow_gap_autofill

    wire = _Wire()
    monkeypatch.setattr(urllib_request, "Request", wire.Request)
    monkeypatch.setattr(urllib_request, "urlopen", wire.urlopen)

    assert flow_gap_autofill._post_discord("a market-hours write gap") is True
    url, body, headers = wire.posts[0]
    assert url == TODAY
    assert body == json.dumps({"content": "a market-hours write gap"}).encode()
    assert headers == {"Content-Type": "application/json",
                       "User-Agent": "uct-flow-gap-fill/1"}


def test_WIRE_auth_surface_check_alert(monkeypatch, blank_ops):
    """⚠️ `_alert`'s docstring promises *"Never raises"*, and it reads the webhook
    BEFORE its try/except — which is why the import of the destination reader is at
    module level in that file and not inside the function."""
    import httpx

    from api import auth_surface_check

    wire = _Wire()
    monkeypatch.setattr(httpx, "post", wire.post)

    auth_surface_check._alert("web", "a mutating route is ungated")
    url, body, headers = wire.posts[0]
    assert url == TODAY
    assert body == {"content": "a mutating route is ungated"}
    assert headers == {"User-Agent": "Mozilla/5.0"}


@pytest.mark.parametrize("configured,expected", [("", ""), (TODAY, TODAY)])
def test_WIRE_the_three_direct_posters_are_inert_with_no_channel(
        monkeypatch, configured, expected):
    """A parametrised pair rather than three more tests: every one of these posters
    consults the resolved value by truthiness, so `""` (what the reader returns) and
    `None` (what the literal read returned) are the same decision. ⭐ The `TODAY`
    row is the control — without it "nothing posted" would be satisfied by a poster
    that never posts."""
    import urllib.request as urllib_request

    from api import flow_backup

    wire = _Wire()
    monkeypatch.setattr(urllib_request, "Request", wire.Request)
    monkeypatch.setattr(urllib_request, "urlopen", wire.urlopen)
    monkeypatch.setenv(ar.ADMIN_WEBHOOK_ENV, configured)
    monkeypatch.setenv(ar.OPS_WEBHOOK_ENV, "")

    flow_backup._post_discord("x")
    assert [p[0] for p in wire.posts] == ([expected] if expected else [])


def test_WIRE_the_event_loop_watchdog_hands_the_thread_todays_channel(monkeypatch, blank_ops):
    """⚠️ CAPTURED ONCE PER START, exactly as the literal read was — so the proof is
    the value handed to the measuring thread, read off the thread's own args."""
    from api import event_loop_watchdog as elw

    _CapturingThread.made.clear()
    monkeypatch.setattr(elw, "threading", _CapturingShim)
    monkeypatch.setenv("WATCHDOG_OBSERVE", "1")
    monkeypatch.setenv("WATCHDOG_ENABLED", "0")
    elw._reset_for_tests()
    try:
        assert elw.start_watchdog(loop=object()) is True
        assert len(_CapturingThread.made) == 1
        args = _CapturingThread.made[0].args
        # Non-vacuity: the webhook is the LAST positional, and `_run`'s signature is
        # what says so — a reordering must fail here, not slip through on an index.
        from inspect import signature
        params = list(signature(elw._run).parameters)
        assert params[-1] == "webhook", params
        assert args[params.index("webhook")] == TODAY
    finally:
        elw._reset_for_tests()
        _CapturingThread.made.clear()


def test_WIRE_the_worker_bars_freshness_watchdog_captures_todays_channel(monkeypatch, blank_ops):
    """The webhook lives in the loop's CLOSURE rather than in the thread args, so
    the proof reads the closure. ⛔ With a non-vacuity assertion on the free-variable
    name, so a rename reds instead of answering `<unassigned>`."""
    from api import worker_main

    _CapturingThread.made.clear()
    monkeypatch.setattr(worker_main, "threading", _CapturingShim)
    monkeypatch.setenv("BARS_FRESHNESS_WATCHDOG_ENABLED", "1")
    try:
        worker_main._start_bars_freshness_watchdog()
        assert len(_CapturingThread.made) == 1
        closure = _closure_of(_CapturingThread.made[0].target)
        assert "webhook" in closure, closure           # ← the non-vacuity half
        assert closure["webhook"] == TODAY
    finally:
        _CapturingThread.made.clear()


def test_WIRE_the_worker_down_alert_captures_todays_channel(monkeypatch, blank_ops):
    """The second of `worker_main`'s two ops posters — the down-alert that tells the
    owner the public site stopped answering."""
    from api import worker_main

    _CapturingThread.made.clear()
    monkeypatch.setattr(worker_main, "threading", _CapturingShim)
    monkeypatch.setenv("KEEPWARM_ENABLED", "1")
    monkeypatch.setenv("DOWN_ALERT_ENABLED", "1")
    try:
        worker_main._start_keepwarm()
        assert len(_CapturingThread.made) == 1
        closure = _closure_of(_CapturingThread.made[0].target)
        assert "_alert_webhook" in closure, sorted(closure)     # ← non-vacuity
        assert closure["_alert_webhook"] == TODAY
        assert closure.get("_alert_enabled") is True
    finally:
        _CapturingThread.made.clear()


# ═══════════════════════════════════════════════════════════════════════════════
#  §3 — THE CONVERSION BOUNDARY, derived rather than asserted in prose.
# ═══════════════════════════════════════════════════════════════════════════════

LITERAL = ar.ADMIN_WEBHOOK_ENV


def literal_reads_in(source: str) -> list[int]:
    """Line numbers of a direct `DISCORD_WEBHOOK_URL` environment read.

    ⛔ AST, NEVER A GREP. Every module in this subsystem names the variable in a
    docstring or a comment — `alert_destination.py` names it repeatedly — so a text
    search would report prose as a read, which is how a grep in this very programme
    was *"red on arrival, naming two files that mention a table nobody built"*.
    """
    hits: list[int] = []
    for node in ast.walk(ast.parse(source)):
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute):
            root, attr = node.func.value, node.func.attr
            is_environ_get = (isinstance(root, ast.Attribute) and root.attr == "environ"
                              and attr == "get")
            is_getenv = (isinstance(root, ast.Name) and root.id == "os"
                         and attr == "getenv")
            if (is_environ_get or is_getenv) and node.args \
                    and isinstance(node.args[0], ast.Constant) \
                    and node.args[0].value == LITERAL:
                hits.append(node.lineno)
        elif isinstance(node, ast.Subscript) and isinstance(node.value, ast.Attribute) \
                and node.value.attr == "environ" \
                and isinstance(node.slice, ast.Constant) and node.slice.value == LITERAL:
            hits.append(node.lineno)
    return sorted(hits)


def _api_sources():
    for path in sorted((REPO / "api").rglob("*.py")):
        if "__pycache__" in path.parts:
            continue
        yield path.relative_to(REPO).as_posix(), path.read_text(encoding="utf-8")


def test_the_literal_reader_detector_distinguishes_a_READ_from_a_MENTION():
    """⛔ NON-VACUITY IN BOTH DIRECTIONS, and the positive case comes first: a
    detector answering `[]` for everything would make every sweep below pass."""
    real = ('import os\n'
            'a = os.environ.get("DISCORD_WEBHOOK_URL")\n'
            'b = os.getenv("DISCORD_WEBHOOK_URL", "")\n'
            'c = os.environ["DISCORD_WEBHOOK_URL"]\n')
    assert literal_reads_in(real) == [2, 3, 4]

    prose = ('"""DISCORD_WEBHOOK_URL is the admin channel."""\n'
             '# webhook = os.environ.get("DISCORD_WEBHOOK_URL")\n'
             'NAME = "DISCORD_WEBHOOK_URL"\n'
             'x = os.environ.get(NAME)\n'
             'y = os.environ.get("DISCORD_OPS_WEBHOOK_URL")\n')
    assert literal_reads_in(prose) == []


def test_no_CONVERTED_module_still_reads_the_literal():
    """⛔ THE REGRESSION CLAUSE. A converted producer that re-grows a literal read
    has a SECOND authority over its own destination, and the two would disagree the
    day `DISCORD_OPS_WEBHOOK_URL` is set — silently, in the direction of the old
    channel, which is the one nobody is watching any more."""
    offenders = {}
    for rel, source in _api_sources():
        if rel in CONVERTED:
            hits = literal_reads_in(source)
            if hits:
                offenders[rel] = hits
    assert offenders == {}, (
        f"a converted producer reads {LITERAL} directly again: {offenders}. It must "
        f"ask alert_destination.ops_webhook() so there is one authority per class.")


def test_the_modules_that_STILL_read_the_literal_are_EXACTLY_the_pinned_roster():
    """⛔ PINNED, NOT FLOORED — and it is the boundary of step 3 in one assertion.

    FEWER than pinned means a later step's row was converted here, which batches a
    decision spec §6 says must be one commit each. MORE means a NEW direct
    `DISCORD_WEBHOOK_URL` reader landed and nobody classified it, which is how this
    channel grew to 25 transports in the first place. Either way the diff is on
    this list, in the commit that caused it.
    """
    derived = {rel for rel, source in _api_sources() if literal_reads_in(source)}
    pinned = set(STILL_LITERAL)
    assert derived, (
        "no module under api/ reads the literal at all — an empty derivation is a "
        "failed invocation, and every assertion here would pass over it")
    assert derived == pinned, (
        f"the literal-reader roster has moved.\n"
        f"  converted here but still pinned as a later step's: {sorted(pinned - derived)}\n"
        f"  reading the literal but not pinned            : {sorted(derived - pinned)}"
    )
    assert not (CONVERTED & pinned), sorted(CONVERTED & pinned)


def test_the_sweep_really_walks_the_api_tree():
    """⛔ THE OTHER NON-VACUITY: a glob matching no files would report no offenders
    however good the detector is."""
    walked = {rel for rel, _ in _api_sources()}
    assert "api/services/alert_destination.py" in walked
    assert "api/services/chart_health_alerts.py" in walked
    assert len(walked) > 100, len(walked)


def test_the_one_reader_names_the_variable_through_the_RESOLVER_not_a_literal():
    """⭐ The reason `alert_destination.py` is not in the roster above: it reads
    `ADMIN_WEBHOOK_ENV`, the resolver's constant, so the name lives in exactly one
    place. A literal here would be the second authority this module exists to remove.
    """
    source = (REPO / "api" / "services" / "alert_destination.py").read_text(encoding="utf-8")
    assert literal_reads_in(source) == []
    names = set(ad.destination_for.__code__.co_names)
    assert "ADMIN_WEBHOOK_ENV" in names
    assert "resolve_channel" in names
    assert "routing_enabled" in names


# ═══════════════════════════════════════════════════════════════════════════════
#  §4 — ONE CONSUMER OF THE RESOLVER, AND EVERY PRODUCER GOES THROUGH IT.
# ═══════════════════════════════════════════════════════════════════════════════

def imports_module(source: str, tail: str) -> bool:
    """Does `source` IMPORT the module whose dotted tail is `tail`? ⛔ AST, never a
    substring search — and the reason is measured: the first version of the rail this
    replaces was a grep for `alert_routing` and was RED ON ARRIVAL, because
    `alert_taxonomy/db.py` and `delivery.py` name `alert_routing_prefs`, an unbuilt
    TABLE whose name this module's is a prefix of."""
    try:
        tree = ast.parse(source)
    except SyntaxError:                                  # pragma: no cover
        return False
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            if any(a.name.split(".")[-1] == tail for a in node.names):
                return True
        elif isinstance(node, ast.ImportFrom):
            if (node.module or "").split(".")[-1] == tail:
                return True
            if any(a.name == tail for a in node.names):
                return True
    return False


def test_the_importers_of_this_module_are_EXACTLY_the_converted_roster():
    """⛔ BOTH DIRECTIONS, which is what makes this the successor to step 2's
    "no consumer" rail rather than its deletion.

    MORE: a producer was converted and did not update this roster, so nobody can
    say what step 3's blast radius is. FEWER: a conversion was reverted and the
    invariant above is now being proved about a module nothing calls.
    """
    derived = {rel for rel, source in _api_sources()
               if rel != "api/services/alert_destination.py"
               and imports_module(source, "alert_destination")}
    assert derived == CONVERTED, (
        f"step 3's consumer roster has moved.\n"
        f"  pinned but no longer importing : {sorted(CONVERTED - derived)}\n"
        f"  importing but not pinned       : {sorted(derived - CONVERTED)}")


def test_the_RESOLVER_still_has_exactly_ONE_importer_under_api():
    """⭐ STRICTLY STRONGER THAN STEP 2'S "no consumer", and that is the point.

    Step 2 asserted `alert_routing` had NO importer under `api/`; step 3 gives it
    one. The invariant that survives is that it has exactly ONE — this file's
    subject — so a producer cannot bypass the single reader and retype
    "OPS means DISCORD_OPS_WEBHOOK_URL falling back to DISCORD_WEBHOOK_URL"
    for itself. That retyping is the defect the whole ticket exists to remove, and
    without this clause step 4 inherits an unguarded module.
    """
    derived = {rel for rel, source in _api_sources()
               if rel != "api/services/alert_routing.py"
               and imports_module(source, "alert_routing")}
    assert derived == {"api/services/alert_destination.py"}, sorted(derived)


@pytest.mark.parametrize("source,expected", [
    ("from api.services import alert_destination\n", True),
    ("from api.services.alert_destination import ops_webhook as _w\n", True),
    ("import api.services.alert_destination\n", True),
    ("import api.services.alert_destination as ad\n", True),
    ('"""mentions alert_destination in prose."""\n', False),
    ("# from api.services import alert_destination\n", False),
    ("from api.services import alert_destination_prefs\n", False),
])
def test_the_consumer_detector_distinguishes_an_IMPORT_from_a_MENTION(source, expected):
    """⛔ NON-VACUITY IN BOTH DIRECTIONS for the two roster rails above. The last row
    is the shape that made the original grep red on arrival, one name over."""
    assert imports_module(source, "alert_destination") is expected


# ═══════════════════════════════════════════════════════════════════════════════
#  §5 — THE KILL SWITCH IS PROVABLY A NO-OP TODAY.
# ═══════════════════════════════════════════════════════════════════════════════

def test_the_kill_switch_changes_NOTHING_while_the_new_variables_are_unset(monkeypatch):
    """⭐ WHAT MAKES THIS COMMIT SAFE TO LAND. `ALERT_ROUTING_ENABLED=0` is specified
    to *"restore pre-split behaviour verbatim"*; with the new variables unset the
    split IS pre-split behaviour, so the two answers are identical. An operator who
    flips the switch in a panic changes nothing, which is the honest thing for a
    rollback lever to do before there is anything to roll back."""
    monkeypatch.setenv(ar.ADMIN_WEBHOOK_ENV, TODAY)
    monkeypatch.setenv(ar.ROUTING_FLAG_ENV, "0")
    off = ad.ops_webhook()
    monkeypatch.setenv(ar.ROUTING_FLAG_ENV, "1")
    assert ad.ops_webhook() == off == TODAY


def test_the_CONTROL_the_kill_switch_DOES_bite_once_the_ops_variable_is_set(monkeypatch):
    """⛔ Without this, the test above passes on a switch that is wired to nothing —
    and "the rollback lever works" would be an untested claim on the day it matters.
    """
    monkeypatch.setenv(ar.ADMIN_WEBHOOK_ENV, TODAY)
    monkeypatch.setenv(ar.OPS_WEBHOOK_ENV, OPS_ONLY)
    monkeypatch.setenv(ar.ROUTING_FLAG_ENV, "1")
    assert ad.ops_webhook() == OPS_ONLY
    monkeypatch.setenv(ar.ROUTING_FLAG_ENV, "0")
    assert ad.ops_webhook() == TODAY, "ALERT_ROUTING_ENABLED=0 did not restore the pre-split path"
    assert ad.destination_for(ar.CLASS_OPS).routed is False
    assert ad.destination_for(ar.CLASS_OPS).decision is None


# ═══════════════════════════════════════════════════════════════════════════════
#  §6 — R2 SURVIVES THE EXTRA HOP, AND NAMES THE PRODUCER.
# ═══════════════════════════════════════════════════════════════════════════════

@pytest.mark.parametrize("bad", [None, "", "both", "BOTH", "op", 7, ["ops"], object()])
def test_an_unclassified_producer_still_REFUSES_through_this_module(monkeypatch, bad):
    """⛔ The extra hop must not soften R2. A default here routes an ops alarm into
    the channel member signups land in, silently, with every other check green."""
    monkeypatch.setenv(ar.ADMIN_WEBHOOK_ENV, TODAY)
    with pytest.raises(ar.UnroutableAlert):
        ad.destination_for(bad)


def test_the_refusal_names_THE_PRODUCER_and_not_this_modules_plumbing(monkeypatch):
    """⛔⛔ THE CLAUSE THAT WOULD OTHERWISE HAVE BROKEN SILENTLY.

    `alert_routing._producer_of` walks `sys._getframe(2)`, which from inside
    `resolve_channel` is whoever called it — i.e. `alert_destination`, for every
    producer, on every refusal. *"An unclassified emitter fails the rail BY NAME"*
    is the whole point of R2, and a refusal naming the resolver's plumbing names
    nobody. So the reader derives its OWN caller; this asserts the arithmetic.
    """
    monkeypatch.setenv(ar.ADMIN_WEBHOOK_ENV, TODAY)
    with pytest.raises(ar.UnroutableAlert) as raised:
        ad.destination_for("both")
    text = str(raised.value)
    assert __name__ in text, f"the refusal did not name this module: {text}"
    # ⛔ THE PLUMBING'S FULL DOTTED NAME, NEVER THE BARE SUFFIX. This module is
    # `tests.test_alert_destination`, which CONTAINS "alert_destination" — so the
    # bare substring cannot tell "named the plumbing" from "named the producer",
    # and a check that cannot distinguish the right answer from the wrong one is
    # not a rail. The plumbing is `api.services.alert_destination`.
    assert ad.__name__ not in text, (
        f"the refusal named the destination reader instead of the producer: {text}")
    assert text.count(__name__) >= 1, (
        f"CONTROL: the producer's own dotted name must still be present: {text}")

    with pytest.raises(ar.UnroutableAlert) as raised:
        ad.destination_for("both", producer="api/services/made_up.py:99")
    assert "api/services/made_up.py:99" in str(raised.value)


def test_with_the_kill_switch_OFF_an_unknown_class_does_NOT_raise(monkeypatch):
    """⚠️ DELIBERATE, and it is the one place the two gates differ. With the switch
    off nothing routes by class, so there is no class to be wrong about and the
    producer takes the pre-split path — which is exactly what `=0` promises. ⛔ The
    control is one test up: with the switch ON the same input refuses, so this is a
    property of the switch and not of a resolver that stopped checking.
    """
    monkeypatch.setenv(ar.ADMIN_WEBHOOK_ENV, TODAY)
    monkeypatch.setenv(ar.ROUTING_FLAG_ENV, "0")
    assert ad.destination_for("both").url == TODAY


# ═══════════════════════════════════════════════════════════════════════════════
#  §7 — A WEBHOOK VALUE NEVER LEAVES THE `url` FIELD.
# ═══════════════════════════════════════════════════════════════════════════════

def test_the_webhook_VALUE_reaches_no_reportable_surface(monkeypatch):
    """⛔⛔ A DISCORD WEBHOOK URL CARRIES ITS OWN BEARER TOKEN. This module is the
    first thing in the subsystem to hold one, so the blast radius of a careless
    f-string here is a credential in a log or a public channel.

    ⭐ THE NON-VACUITY HALF IS THE NAME: "the secret is absent" is also true of an
    object that holds nothing, so the variable NAME has to be present in the same
    surfaces the value is absent from.
    """
    secret = "https://discord.com/api/webhooks/999/SECRET-TOKEN-DO-NOT-LEAK"
    monkeypatch.setenv(ar.ADMIN_WEBHOOK_ENV, secret)
    monkeypatch.setenv(ar.OPS_WEBHOOK_ENV, secret)

    destination = ad.destination_for(ar.CLASS_OPS, ar.SEVERITY_CRITICAL)
    reportable = (repr(destination.decision)
                  + ar.route_stamp(destination.decision)
                  + ar.route_stamp(destination.decision, used_fallback=True)
                  + destination.env_name)
    assert "SECRET-TOKEN-DO-NOT-LEAK" not in reportable
    assert ar.OPS_WEBHOOK_ENV in reportable           # ← the non-vacuity half
    # …and the value really was resolved, so the absence above means something.
    assert destination.url == secret
    # `url` is the ONLY field that may hold it.
    carriers = [f for f, v in vars(destination).items()
                if isinstance(v, str) and "SECRET-TOKEN-DO-NOT-LEAK" in v]
    assert carriers == ["url"], carriers


def test_this_module_imports_no_transport():
    """⛔ Spec §9: *"Reuse the routing, not a second copy of the poster."* A reader
    that imported an HTTP client would be one commit away from being a
    twenty-sixth Discord transport, and every converted producer already owns one."""
    tree = ast.parse((REPO / "api" / "services" / "alert_destination.py")
                     .read_text(encoding="utf-8"))
    imported = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            imported.update(a.name.split(".")[0] for a in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module:
            imported.add(node.module.split(".")[0])
    for forbidden in ("requests", "httpx", "urllib", "socket", "smtplib", "aiohttp", "json"):
        assert forbidden not in imported, f"the destination reader imports {forbidden}"
    assert "os" in imported, "non-vacuity: the import walk really does see imports"
