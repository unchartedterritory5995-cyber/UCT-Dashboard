"""Delivery hardening — step 2.6 (03-architecture §3.4, §3.5).

The three classes this file exists to keep closed, with the numbers from
`docs/discord-render/01-failure-forensics.md`:

  * **C-03** — 33 × `COMPONENT_INVALID_EMOJI`. One ▲ (U+25B2) on a collapse button made
    Discord refuse the WHOLE component tree, so every expanded chart lost its controls for a
    week. Validated here, before it is sent.
  * **C-04** — 23 double-failed `ATTACHMENT_NOT_FOUND` edits, **0 %** correlation with load
    (random: 1.3 %), i.e. a deterministic payload fault. Terminal, classified on its own, and
    never retried; and the other half of the same coin — a text-only edit re-declares the ids
    it means to keep, so it cannot drop the chart.
  * **C-11** — 23 × 10015 plus 23 × ATT finals produced **no member message at all**, because
    the job read a bool it never checked. Every outcome here is a `DeliveryResult` with a
    named class.

⛔ THE TOKEN TEST IS A RUNTIME TEST, NOT A GREP. `test_the_token_never_reaches_a_log_*` drive
a real failure through the real code and read `caplog.text`; an AST rail can prove nobody
CALLS `log.exception` (that one lives in `test_discord_render_observe.py`) but it cannot prove
the string never lands, which is the property that matters.
"""
from __future__ import annotations

import ast
import json
import logging
import pathlib

import pytest

from api.services.discord_render import breakers, contract, delivery
from api.services.discord_render.delivery import DeliveryResult

APP = "1474900505917653142"
TOKEN = "aW50ZXJhY3Rpb24tdG9rZW4tMjAyNi0wOS0xMw"
ORIGINAL = f"{delivery.DISCORD_API}/webhooks/{APP}/{TOKEN}/messages/@original"


# ── doubles ─────────────────────────────────────────────────────────────────

class Resp:
    def __init__(self, status, body=None, text=None, headers=None):
        self.status_code = status
        self._body = body
        self.text = text if text is not None else json.dumps(body or {})
        self.headers = headers or {}

    @property
    def is_success(self):
        return 200 <= self.status_code < 300

    def json(self):
        if self._body is None:
            raise ValueError("no body")
        return self._body


class Client:
    """Answers with a queued response, or raises it if it is an exception."""

    def __init__(self, *answers):
        self.answers = list(answers)
        self.calls = []

    def _go(self, url, **kw):
        self.calls.append({"url": url, **kw})
        a = self.answers.pop(0) if self.answers else Resp(200, {})
        if isinstance(a, BaseException):
            raise a
        return a

    patch = _go
    post = _go

    def close(self):
        pass


class Clock:
    """A monotonic that only moves when somebody sleeps: request time is zero, so the budget
    arithmetic under test is the only thing that can move it."""

    def __init__(self, budget_spent=0.0):
        self.t = budget_spent
        self.slept = []

    def __call__(self):
        return self.t

    def sleep(self, s):
        self.slept.append(s)
        self.t += s


def _edit(client, **kw):
    kw.setdefault("rand", lambda: 0.0)
    clock = kw.pop("clock", None) or Clock()
    kw.setdefault("sleep", clock.sleep)
    return delivery.edit_text(APP, TOKEN, content="hello", client=client, clock=clock, **kw), clock


# ── C-11: a result, with a class, always ────────────────────────────────────

def test_a_delivery_that_worked_says_so_and_names_no_class():
    res, _ = _edit(Client(Resp(200, {})))
    assert res.ok and res.status == 200 and res.reason == delivery.OK
    assert res.cls == "", "a success must not carry a failure class"
    assert res.attempts == 1 and res.waited_s == 0.0


@pytest.mark.parametrize("resp,reason", [
    (Resp(404, {"code": 10015, "message": "Unknown Webhook"}), delivery.TOKEN_DEAD),
    (Resp(429, {"retry_after": 99.0}), delivery.RATE_LIMIT_OVER_DEADLINE),
    (Resp(400, {"code": 50035, "errors": {"attachments": {"0": {}}}}), delivery.ATTACHMENT_NOT_FOUND),
    (Resp(400, {"code": 50035, "errors": {"components": {"1": {}}}}), delivery.COMPONENTS_REJECTED),
    (Resp(413, {"code": 40005}), delivery.TOO_LARGE),
    (Resp(403, {"code": 50013}), delivery.FORBIDDEN),
    (Resp(400, {"code": 50006}), delivery.REJECTED),
    (Resp(503, None, text="upstream"), delivery.SERVER_ERROR),
])
def test_every_outcome_is_a_named_reason_and_a_class_a_member_can_be_told(resp, reason):
    """C-11: the old jobs read a bool, so a failed delivery reported "ok". Every failure here
    carries BOTH what happened (the reason) and what the member hears (a §3.5 class)."""
    res, _ = _edit(Client(resp), deadline_s=0.5)
    assert isinstance(res, DeliveryResult) and res.ok is False
    assert res.reason == reason
    assert res.cls in contract.FAILURE_CLASSES, f"{res.cls!r} is not a class contract can speak"
    assert contract.plain(res.cls)


def test_a_failed_result_is_still_a_truthy_object_which_is_the_whole_point():
    """⛔ The C-11 shape: `if client.edit(...)` on a bare bool read False and got ignored; on a
    RESULT it reads True and is still wrong. The caller must unpack `.ok`, and this pins that
    the object cannot be mistaken for the answer."""
    res, _ = _edit(Client(Resp(500, None, text="nope")), deadline_s=0.3)
    assert bool(res) is True and res.ok is False


# ── 10015: terminal, classified apart, never retried ────────────────────────

def test_an_unknown_webhook_is_terminal_and_costs_exactly_one_request():
    """23 of these in the fortnight. Retrying spends the job's budget on a request whose
    answer is already known: the token is gone."""
    c = Client(Resp(404, {"code": 10015, "message": "Unknown Webhook"}), Resp(200, {}))
    res, clock = _edit(c, deadline_s=5.0)
    assert res.ok is False and res.attempts == 1 and clock.slept == []
    assert len(c.calls) == 1, "a dead token was asked a second time"


def test_an_unknown_webhook_is_classified_apart_from_every_other_rejection():
    res, _ = _edit(Client(Resp(404, {"code": 10015})))
    assert res.reason == delivery.TOKEN_DEAD and res.token_dead is True
    assert res.cls == "ack_late", "the member is told Discord closed the request, not 'internal'"
    other, _ = _edit(Client(Resp(400, {"code": 50006})))
    assert other.token_dead is False and other.cls == "discord_rejected"


def test_a_bare_404_is_a_dead_token_too_because_the_message_is_gone():
    res, _ = _edit(Client(Resp(404, None, text="not found")))
    assert res.token_dead is True and res.reason == delivery.TOKEN_DEAD


def test_a_dead_token_wrapped_in_a_5xx_is_still_dead():
    """⛔ THE CODE DECIDES, NOT THE NUMBER IN FRONT OF IT. Discord can answer 5xx while the JSON
    body still says 10015, and a status-only rule would retry it twice for nothing."""
    c = Client(Resp(503, {"code": 10015, "message": "Unknown Webhook"}), Resp(200, {}))
    res, clock = _edit(c, deadline_s=10.0)
    assert len(c.calls) == 1 and clock.slept == [] and res.ok is False
    assert res.token_dead is True


def test_the_terminal_codes_are_the_ones_that_cannot_succeed_on_a_second_try():
    for code in (10015, 10008, 50035, 40005, 50013):
        assert delivery._retryable(503, code, delivery.REJECTED) is False, code
    assert delivery._retryable(500, None, delivery.SERVER_ERROR) is True
    assert delivery._retryable(None, None, delivery.TRANSPORT) is True


# ── 429: honour retry_after, bounded by the budget ──────────────────────────

def test_a_rate_limit_is_waited_out_when_the_wait_fits_the_budget():
    c = Client(Resp(429, {"retry_after": 0.2}), Resp(200, {}))
    res, clock = _edit(c, deadline_s=5.0)
    assert res.ok and res.attempts == 2
    assert clock.slept == [pytest.approx(0.2)], clock.slept
    assert res.waited_s == pytest.approx(0.2)


def test_a_rate_limit_longer_than_the_budget_is_never_slept():
    """⛔ THE RULE THIS STEP EXISTS FOR. A delivery that sleeps 30 s inside a 15 s deadline has
    already lost: the watchdog told the member something else 15 seconds ago, and the worker
    was held for nothing."""
    c = Client(Resp(429, {"retry_after": 30.0}), Resp(200, {}))
    res, clock = _edit(c, deadline_s=15.0)
    assert clock.slept == [], "it slept past the budget"
    assert res.ok is False and res.attempts == 1 and res.waited_s == 0.0
    assert res.reason == delivery.RATE_LIMIT_OVER_DEADLINE and res.cls == "rate_limited"
    assert len(c.calls) == 1


def test_the_wait_AND_a_round_trip_must_fit_not_just_the_wait():
    """Sleeping out the rest of the budget and then failing is strictly worse than failing
    now with a named class: the member waits the same and learns nothing."""
    tight, clock_a = _edit(Client(Resp(429, {"retry_after": 0.9}), Resp(200, {})), deadline_s=1.0)
    assert clock_a.slept == [] and tight.reason == delivery.RATE_LIMIT_OVER_DEADLINE
    roomy, clock_b = _edit(Client(Resp(429, {"retry_after": 0.9}), Resp(200, {})), deadline_s=1.5)
    assert clock_b.slept == [pytest.approx(0.9)] and roomy.ok, "the control: 0.9 s does fit in 1.5 s"


def test_retry_after_comes_from_the_body_first_then_the_header():
    assert delivery.retry_after_s(Resp(429, {"retry_after": 1.5})) == pytest.approx(1.5)
    assert delivery.retry_after_s(Resp(429, None, text="x", headers={"Retry-After": "2"})) == 2.0
    assert delivery.retry_after_s(Resp(429, {}, headers={"retry-after": "3"})) == 3.0
    assert delivery.retry_after_s(Resp(429, {})) is None


def test_a_rate_limit_that_says_nothing_still_backs_off_rather_than_hammering():
    c = Client(Resp(429, {}), Resp(200, {}))
    res, clock = _edit(c, deadline_s=5.0)
    assert res.ok and clock.slept and clock.slept[0] > 0.0


def test_the_budget_already_spent_counts_against_the_wait():
    """The budget is wall clock from the start of the delivery, so a first attempt that took
    time leaves less for the retry — measured, not assumed."""
    clock = Clock()
    c = Client(Resp(429, {"retry_after": 0.5}), Resp(200, {}))
    res = delivery.edit_text(APP, TOKEN, content="x", client=c, deadline_s=0.6,
                             rand=lambda: 0.0, sleep=clock.sleep, clock=clock)
    assert clock.slept == [], "0.5 s of wait plus a round trip does not fit 0.6 s"
    assert res.reason == delivery.RATE_LIMIT_OVER_DEADLINE


# ── 5xx / transport: bounded retries with jitter, one delay authority ───────

def test_a_server_error_is_retried_and_the_delay_comes_from_breakers_retry_delay(monkeypatch):
    """⛔ ONE DELAY AUTHORITY. A second backoff policy in this module is how the bars path
    ended up with a fixed 1.5 s that re-synchronised every caller that failed together."""
    seen = []

    def spy(attempt, base_s=0.4, spread_s=0.5, *, rand=None):
        seen.append((attempt, base_s, spread_s))
        return 0.01
    monkeypatch.setattr(delivery.breakers, "retry_delay", spy)
    c = Client(Resp(500, None, text="a"), Resp(502, None, text="b"), Resp(200, {}))
    res, clock = _edit(c, deadline_s=5.0)
    assert res.ok and res.attempts == 3 and len(clock.slept) == 2
    assert [a for a, _, _ in seen] == [1, 2], f"the one delay authority was not asked: {seen}"


def test_the_delay_is_jittered_so_callers_that_failed_together_do_not_return_together():
    a, clock_a = _edit(Client(Resp(500, None, text="x"), Resp(200, {})), deadline_s=5.0,
                       rand=lambda: 0.0)
    b, clock_b = _edit(Client(Resp(500, None, text="x"), Resp(200, {})), deadline_s=5.0,
                       rand=lambda: 1.0)
    assert clock_a.slept and clock_b.slept
    assert clock_a.slept[0] != clock_b.slept[0], "a fixed delay: every caller comes back at once"


def test_the_jitter_is_also_spread_on_a_server_dictated_wait():
    a, clock_a = _edit(Client(Resp(429, {"retry_after": 0.5}), Resp(200, {})), deadline_s=5.0,
                       rand=lambda: 0.0)
    b, clock_b = _edit(Client(Resp(429, {"retry_after": 0.5}), Resp(200, {})), deadline_s=5.0,
                       rand=lambda: 1.0)
    assert clock_a.slept[0] == pytest.approx(0.5)
    assert clock_b.slept[0] > 0.5, "every caller in one bucket returns in the same millisecond"


def test_retries_are_bounded_and_a_failure_that_survives_them_is_reported():
    """The ceiling is the spec's, pinned as a literal as well as a name: 03 §3.4 says "max 3
    tries, bounded by the deadline", and a constant quietly raised is a worker held three times
    longer on a dependency that is already down."""
    assert delivery.MAX_ATTEMPTS == 3
    c = Client(*[Resp(500, None, text="down")] * 6)
    res, _ = _edit(c, deadline_s=30.0)
    assert res.attempts == delivery.MAX_ATTEMPTS
    assert len(c.calls) == delivery.MAX_ATTEMPTS, "the ladder is not bounded"
    assert res.ok is False and res.reason == delivery.SERVER_ERROR and res.cls == "internal"


def test_a_server_error_that_cannot_afford_a_backoff_stops_now_rather_than_sleeping_it_out():
    c = Client(Resp(500, None, text="down"), Resp(200, {}))
    res, clock = _edit(c, deadline_s=0.3)
    assert clock.slept == [] and res.attempts == 1 and res.reason == delivery.SERVER_ERROR


def test_a_transport_failure_is_a_result_and_never_an_exception_into_the_job():
    c = Client(OSError("connection reset"), Resp(200, {}))
    res, _ = _edit(c, deadline_s=5.0)
    assert res.ok and res.attempts == 2, "a transport failure is retryable"
    dead = Client(*[OSError("connection reset")] * 5)
    res2, _ = _edit(dead, deadline_s=30.0)
    assert res2.ok is False and res2.status is None and res2.reason == delivery.TRANSPORT
    assert res2.detail == "OSError" and res2.cls == "internal"


# ── the budget reaches the wire ─────────────────────────────────────────────

def test_the_request_timeout_is_the_smaller_of_the_ceiling_and_what_is_left():
    c = Client(Resp(200, {}))
    _edit(c, deadline_s=0.5)
    assert c.calls[0]["timeout"] == pytest.approx(0.5)
    c2 = Client(Resp(200, {}))
    _edit(c2, deadline_s=60.0)
    assert c2.calls[0]["timeout"] == pytest.approx(delivery.TIMEOUT_S), "the ceiling still applies"


def test_the_first_attempt_runs_even_with_no_budget_left():
    """⛔ C-11 WITH EXTRA STEPS. The message a member is owed is exactly the one sent after a
    deadline has already passed; a delivery that declines to try delivers nothing."""
    c = Client(Resp(200, {}))
    res, _ = _edit(c, deadline_s=0.0)
    assert res.ok and len(c.calls) == 1
    assert c.calls[0]["timeout"] == pytest.approx(delivery.MIN_USEFUL_S)


def test_without_a_deadline_the_delivery_still_has_a_ceiling():
    c = Client(*[Resp(500, None, text="down")] * 6)
    res, clock = _edit(c, rand=lambda: 1.0)
    assert res.attempts <= delivery.MAX_ATTEMPTS
    assert sum(clock.slept) <= delivery.DEFAULT_BUDGET_S


# ── C-03: the component tree is validated before it is sent ─────────────────

def _row(*children):
    return [{"type": 1, "components": list(children)}]


def test_the_triangle_that_stripped_every_charts_controls_for_a_week_is_refused():
    """U+25B2 is a geometric shape, not an emoji. Discord answered COMPONENT_INVALID_EMOJI and
    refused the WHOLE tree, 33 times."""
    bad = _row({"type": 2, "style": 2, "emoji": {"name": "▲"}, "custom_id": "c"})
    assert delivery.validate_components(bad), "the ▲ passed pre-flight"
    good = _row({"type": 2, "style": 2, "emoji": {"name": "\U0001F53C"}, "custom_id": "c"})
    assert delivery.validate_components(good) == [], "the 🔼 that replaced it must still pass"


def test_an_invalid_tree_is_dropped_and_the_message_is_still_delivered():
    """⛔ Losing a button beats losing the message. C-03's members got the chart with NO
    controls and a separate private apology, because Discord refused the payload outright."""
    c = Client(Resp(200, {}))
    res = delivery.edit_text(APP, TOKEN, content="failed — retry?", client=c,
                             components=_row({"type": 2, "style": 2, "emoji": {"name": "▲"},
                                              "custom_id": "c"}))
    assert res.ok and res.dropped == ("components",)
    sent = json.loads(c.calls[0]["content"])
    assert "components" not in sent and sent["content"] == "failed — retry?"


def test_a_valid_tree_is_sent_through_untouched():
    """The control: a validator that refuses everything would pass the test above and ship a
    product with no buttons at all."""
    c = Client(Resp(200, {}))
    tree = contract.failure_components("7f3a9c21")
    res = delivery.edit_text(APP, TOKEN, content="x", client=c, components=tree)
    assert res.dropped == ()
    assert json.loads(c.calls[0]["content"])["components"] == tree


def test_the_contract_builders_own_tree_passes_its_own_pre_flight():
    """The one tree this path sends on every failure. If it could not pass, the Retry button
    would vanish from every failure message and nothing else would say so."""
    assert delivery.validate_components(contract.failure_components("7f3a9c21")) == []


@pytest.mark.parametrize("tree,needle", [
    (_row({"type": 2, "style": 2, "custom_id": "x" * 101}), "custom_id"),
    (_row({"type": 2, "style": 2, "custom_id": "d"}, {"type": 2, "style": 2, "custom_id": "d"}), "repeats"),
    ([{"type": 1, "components": [{"type": 2, "style": 2, "custom_id": f"b{i}"} for i in range(6)]}], "buttons"),
    ([{"type": 1, "components": []}] * 6, "rows"),
    (_row({"type": 2, "style": 2, "custom_id": "x", "label": "L" * 81}), "label"),
    (_row({"type": 3, "custom_id": "s", "placeholder": "P" * 151,
           "options": [{"label": "a", "value": "a"}]}), "placeholder"),
    (_row({"type": 3, "custom_id": "s",
           "options": [{"label": str(i), "value": str(i)} for i in range(26)]}), "options"),
    (_row({"type": 3, "custom_id": "s", "options": [{"label": "a", "value": "a", "default": True},
                                                    {"label": "b", "value": "b", "default": True}]}), "defaults"),
    (_row({"type": 2, "style": 2, "label": "no id"}), "no custom_id"),
    ("not a list", "list"),
])
def test_every_rule_discord_would_refuse_the_whole_message_for_is_checked_here(tree, needle):
    problems = delivery.validate_components(tree)
    assert problems, f"{needle} passed pre-flight"
    assert any(needle in p for p in problems), problems


def test_no_components_at_all_is_not_a_problem():
    assert delivery.validate_components(None) == []
    assert delivery.validate_components([]) == []


def test_the_emoji_allow_list_covers_every_emoji_the_component_builders_actually_use():
    """⛔ DERIVED FROM THE AST, NEVER TYPED. An allow-list that drifts behind the code it guards
    starts refusing correct trees, and a rail that reds on the right answer is a rail somebody
    deletes. This fails at the moment a new emoji lands on a button, not in production."""
    root = pathlib.Path(__file__).resolve().parents[1]
    src = root / "api" / "services" / "discord_interactions.py"
    tree = ast.parse(src.read_text(encoding="utf-8"), str(src))
    used = set()
    for node in ast.walk(tree):
        if not isinstance(node, ast.Dict):
            continue
        for k, v in zip(node.keys, node.values):
            if not (isinstance(k, ast.Constant) and k.value == "emoji" and isinstance(v, ast.Dict)):
                continue
            for ek, ev in zip(v.keys, v.values):
                if isinstance(ek, ast.Constant) and ek.value == "name" and isinstance(ev, ast.Constant):
                    used.add(ev.value)
    assert used, "the walk found no component emoji at all — it is measuring nothing"
    missing = used - delivery.EMOJI_ALLOWED
    assert not missing, (f"{sorted(missing)!r} is put on a component but is not in "
                         "delivery.EMOJI_ALLOWED, so pre-flight would drop that tree")


def test_a_custom_emoji_id_is_accepted_without_being_in_the_unicode_allow_list():
    tree = _row({"type": 2, "style": 2, "custom_id": "c",
                 "emoji": {"id": "123456789", "name": "uct_logo"}})
    assert delivery.validate_components(tree) == []


# ── C-04: attachments, both directions ──────────────────────────────────────

def test_a_text_only_edit_re_declares_the_ids_it_means_to_keep():
    """A PATCH that names no attachments is a PATCH that keeps none of them: the context line
    would land where the chart was."""
    c = Client(Resp(200, {}))
    delivery.edit_text(APP, TOKEN, content="context line", client=c,
                       attachments=[{"id": "0", "filename": "chart.png"}])
    sent = json.loads(c.calls[0]["content"])
    assert sent["attachments"] == [{"id": "0", "filename": "chart.png"}]


def test_bare_ids_are_accepted_and_normalised():
    assert delivery.attachments_payload(["0", 1]) == [{"id": "0"}, {"id": "1"}]
    assert delivery.attachments_payload(None) == []


def test_saying_nothing_about_attachments_sends_no_attachments_key():
    c = Client(Resp(200, {}))
    delivery.edit_text(APP, TOKEN, content="x", client=c)
    assert "attachments" not in json.loads(c.calls[0]["content"])


def test_an_empty_list_clears_them_and_that_has_to_be_deliberate():
    c = Client(Resp(200, {}))
    delivery.edit_text(APP, TOKEN, content="x", client=c, attachments=[])
    assert json.loads(c.calls[0]["content"])["attachments"] == []


def test_a_stale_attachment_id_is_terminal_and_not_retried():
    """C-04: BOTH attempts failed, 23 times, with 0 % load correlation. Re-sending the same
    payload cannot produce a different answer — it is a deterministic payload fault."""
    c = Client(Resp(400, {"code": 50035, "errors": {"attachments": {"0": {
        "_errors": [{"code": "ATTACHMENT_NOT_FOUND"}]}}}}), Resp(200, {}))
    res, clock = _edit(c, deadline_s=10.0)
    assert res.reason == delivery.ATTACHMENT_NOT_FOUND and res.cls == "discord_rejected"
    assert len(c.calls) == 1 and clock.slept == []


# ── the follow-up is the same client with the same policy ───────────────────

def test_a_follow_up_is_ephemeral_by_default_and_carries_the_same_policy():
    c = Client(Resp(429, {"retry_after": 0.1}), Resp(200, {}))
    clock = Clock()
    res = delivery.followup(APP, TOKEN, content="x", client=c, deadline_s=5.0,
                            rand=lambda: 0.0, sleep=clock.sleep, clock=clock)
    assert res.ok and res.attempts == 2 and clock.slept == [pytest.approx(0.1)]
    sent = json.loads(c.calls[0]["content"])
    assert sent["flags"] == delivery.EPHEMERAL
    assert c.calls[0]["url"] == f"{delivery.DISCORD_API}/webhooks/{APP}/{TOKEN}"


def test_a_public_follow_up_carries_no_ephemeral_flag():
    c = Client(Resp(200, {}))
    delivery.followup(APP, TOKEN, content="x", client=c, ephemeral=False)
    assert "flags" not in json.loads(c.calls[0]["content"])


def test_content_is_trimmed_to_the_contract_limit_and_mentions_are_never_parsed():
    c = Client(Resp(200, {}))
    delivery.edit_text(APP, TOKEN, content="A" * 5000, client=c)
    sent = json.loads(c.calls[0]["content"])
    assert len(sent["content"]) == contract.CONTENT_MAX
    assert sent["allowed_mentions"] == {"parse": []}


# ── ⛔⛔ the token must never reach a log ────────────────────────────────────

class RaisingHttpx:
    """An httpx client whose error carries the request URL, which is what httpx's own
    exceptions and Playwright's call log both do — and that URL IS the credential."""

    def __init__(self, *a, **kw):
        pass

    def _boom(self, url, **kw):
        raise RuntimeError(f"PATCH {url} -> [Errno 104] Connection reset by peer")

    patch = _boom
    post = _boom

    def close(self):
        pass


def test_the_token_never_reaches_a_log_when_the_transport_raises(caplog, monkeypatch):
    caplog.set_level(logging.DEBUG, logger="discord_render")
    monkeypatch.setattr("httpx.Client", RaisingHttpx)
    clock = Clock()
    res = delivery.edit_text(APP, TOKEN, content="x", deadline_s=1.0, cid="7f3a9c21",
                             rand=lambda: 0.0, sleep=clock.sleep, clock=clock)
    assert res.ok is False and res.reason == delivery.TRANSPORT
    assert caplog.text, "nothing was logged at all — this proves nothing"
    assert "delivery_error" in caplog.text, "the failure was not reported"
    assert TOKEN not in caplog.text, "THE INTERACTION TOKEN REACHED A LOG"
    assert "[redacted]" in caplog.text, "the scrubber did not fire on the URL"


def test_the_token_never_reaches_a_log_when_discord_echoes_the_url_back(caplog):
    caplog.set_level(logging.DEBUG, logger="discord_render")
    echo = Resp(400, {"code": 50035, "message": f"Invalid Form Body at {ORIGINAL}"},
                text=json.dumps({"message": f"Invalid Form Body at {ORIGINAL}"}))
    res, _ = _edit(Client(echo), cid="7f3a9c21")
    assert res.ok is False
    assert TOKEN not in res.detail, "the token was stored on the result and reaches the jobs table"
    assert TOKEN not in caplog.text, "THE INTERACTION TOKEN REACHED A LOG"


def test_the_token_never_reaches_a_log_through_the_runtimes_own_failure_message(caplog, tmp_path,
                                                                                monkeypatch):
    """End to end on the real path: `JobRuntime.send_failure` → this module → a raising client.
    Nothing is stubbed between the job and the socket."""
    from api.services.discord_render.jobs_store import JobsStore
    from api.services.discord_render.runtime import Job, JobRuntime
    caplog.set_level(logging.DEBUG, logger="discord_render")
    monkeypatch.setattr("httpx.Client", RaisingHttpx)
    monkeypatch.setattr(delivery, "MAX_ATTEMPTS", 1)
    s = JobsStore(str(tmp_path / "jobs.db"))
    try:
        rt = JobRuntime(store=s, handlers={"chart": lambda ctx: ctx.fail("renderer_unavailable")},
                        edit_fn=lambda *a, **k: False, delivery=delivery, workers=1)
        job = Job(corr_id="c0ffee02", command="chart", app_id=APP, token=TOKEN, args={},
                  label="/chart NVDA")
        assert rt.run_job(job)["state"] == "abandoned"
    finally:
        s.close()
    assert "delivery_error" in caplog.text
    assert TOKEN not in caplog.text, "THE INTERACTION TOKEN REACHED A LOG"


def test_the_token_probe_can_actually_see_a_token_in_a_log(caplog):
    """⛔ NON-VACUITY. Three absence assertions above are only evidence if the instrument could
    have seen a presence — a typo in TOKEN would make all of them pass forever."""
    caplog.set_level(logging.DEBUG, logger="discord_render")
    logging.getLogger("discord_render").error("a careless line with %s in it", TOKEN)
    assert TOKEN in caplog.text


def test_the_scrubber_redacts_this_exact_url_shape():
    """The regex that does the work, aimed at the string this module builds. If the app id or
    token alphabet ever stops matching it, the three tests above go quiet, not red."""
    assert TOKEN not in observe_scrub(f"PATCH {ORIGINAL} -> 500")


def observe_scrub(text: str) -> str:
    from api.services.discord_render import observe
    return observe.scrub_text(text)


# ── the harness itself ──────────────────────────────────────────────────────

def test_the_fake_client_is_the_thing_being_measured():
    """⛔ NON-VACUITY for the whole file: an `edit_text` that never called the client would make
    most assertions here pass over an empty call list."""
    c = Client(Resp(200, {}))
    _edit(c)
    assert len(c.calls) == 1
    assert c.calls[0]["url"] == ORIGINAL
    assert c.calls[0]["headers"] == {"Content-Type": "application/json"}


def test_breakers_retry_delay_is_the_real_one_and_is_jittered():
    """The single delay authority, checked directly — this module must not grow a second."""
    assert breakers.retry_delay(1, rand=lambda: 0.0) == pytest.approx(0.4)
    assert breakers.retry_delay(2, rand=lambda: 0.0) == pytest.approx(0.8)
    assert breakers.retry_delay(1, rand=lambda: 1.0) > breakers.retry_delay(1, rand=lambda: 0.0)
