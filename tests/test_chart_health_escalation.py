"""⛔⛔ A WARNING MUST NEVER SWALLOW A CRITICAL PAGE.

`chart_health_alerts.emit` returns on the throttle BEFORE `_should_page_discord`
runs, so anything the throttle swallows is also un-pageable. The throttle used to
be keyed on the alert_key ALONE, and `bars_continuous_audit` emits
`intraday_hotset_stale` at BOTH severities under that one key on a 5-minute cycle
(warning at >=0.08 of actively-viewed intraday charts stale, critical at >=0.20).

So a freshness pipeline that degraded past 8% and then past 20% inside one
10-minute window paged nobody: the warning row landed in an admin deque, the
critical never reached the gate, and the one event a page exists for — the
ESCALATION — was the one event that could not produce one.

⭐ WHAT THIS FILE HAS TO PROVE IS TWO THINGS AT ONCE, and a rail that proves only
the first is worse than none:
  1. a critical PAGES even though a warning fired inside its window; and
  2. the throttle IS STILL THERE — a repeated warning is still throttled, the
     600 s boundary is unchanged, and Discord is still bounded by its own
     cooldown. "Fixing" a swallowed page by removing the throttle would let a
     flapping metric flood a ~750-member estate's alert channel, which is the
     failure the throttle was built for.

Every clause below is behavioural and reads the module's own state. Nothing here
greps source: the mechanism is pinned by the throttle dict's key shape at
runtime, not by a sentence about it.
"""
import pytest

from api.services import chart_health_alerts as cha

#: The real product key and severities, taken from the emitter that owns them
#: (`api/services/bars_continuous_audit.py`). Named rather than a stand-in so a
#: reader of a failure knows which member-facing pipeline stopped paging.
HOTSET_KEY = "intraday_hotset_stale"


class _Clock:
    """A stand-in for the `time` module, so a 10-minute window costs no seconds.

    ⛔ Patched onto `chart_health_alerts` as its `time` attribute — NOT onto the
    real `time` module, which would reach every other thing running in the same
    process.
    """

    def __init__(self, t: int = 1_700_000_000):
        self.t = t

    def time(self) -> float:
        return float(self.t)

    def advance(self, seconds: int) -> None:
        self.t += seconds


@pytest.fixture
def clock(monkeypatch):
    c = _Clock()
    monkeypatch.setattr(cha, "time", c)
    return c


@pytest.fixture
def pages(monkeypatch):
    """Captured Discord pages. `_page_discord` is replaced, so no network and no
    thread — what is asserted is the DECISION to page, which is the thing the
    throttle was silencing."""
    captured: list[tuple[str, str]] = []
    monkeypatch.setattr(cha, "_page_discord",
                        lambda key, message: captured.append((key, message)))
    monkeypatch.setenv("DISCORD_WEBHOOK_URL", "https://example.invalid/hook")
    monkeypatch.setenv("CHART_HEALTH_DISCORD_ENABLED", "1")
    return captured


@pytest.fixture(autouse=True)
def reset():
    cha.clear()
    yield
    cha.clear()


# ── the defect ──────────────────────────────────────────────────────────────

def test_a_critical_pages_even_when_a_warning_fired_inside_the_throttle_window(
        clock, pages):
    """THE RAIL. Warning at 9% then critical at 21%, 100 s apart — one 5-minute
    audit cycle to the next, well inside `_THROTTLE_SEC`."""
    assert cha.emit(HOTSET_KEY, "warning", "9% of actively-viewed charts stale") is True, (
        "PRECONDITION UNMET: the warning did not emit, so the critical getting "
        "through below proves nothing about escalation"
    )
    assert pages == [], "a WARNING paged Discord — only criticals may page"

    clock.advance(100)

    assert cha.emit(HOTSET_KEY, "critical", "21% of actively-viewed charts stale") is True, (
        "THE DEFECT: a critical was throttled by the warning that preceded it, "
        "so `_should_page_discord` was never reached and nobody was paged for "
        "the escalation"
    )
    assert len(pages) == 1, f"the critical did not page Discord: {pages}"
    paged_key, paged_msg = pages[0]
    assert paged_key == HOTSET_KEY
    assert "21%" in paged_msg, (
        f"the page carried the wrong message — an operator would be told about "
        f"the warning, not the escalation: {paged_msg!r}"
    )

    # Both statements are in the feed. An operator reading the admin list sees
    # the degradation, not just its latest state.
    severities = [a["severity"] for a in cha.list_recent()]
    assert severities == ["critical", "warning"], (
        f"expected both rows newest-first, saw {severities}"
    )


def test_the_throttle_key_carries_the_severity(clock):
    """The mechanism, pinned directly. Keyed on the alert_key alone, the two
    statements above share one window and the second is unpageable."""
    cha.emit(HOTSET_KEY, "warning", "m")
    cha.emit(HOTSET_KEY, "critical", "m")
    assert set(cha._throttle) == {(HOTSET_KEY, "warning"), (HOTSET_KEY, "critical")}, (
        f"the throttle is not keyed per (key, severity): {cha._throttle!r}"
    )


# ── CONTROLS: the throttle is still a throttle ──────────────────────────────

def test_CONTROL_a_repeated_warning_is_still_throttled(clock):
    """⛔ THE CONTROL THAT MATTERS MOST. If this passes for the wrong reason —
    i.e. the throttle was removed to let the critical through — the fix traded a
    swallowed page for a flood, which is not a fix."""
    assert cha.emit(HOTSET_KEY, "warning", "first") is True
    clock.advance(100)
    assert cha.emit(HOTSET_KEY, "warning", "second") is False, (
        "THE THROTTLE IS GONE: a repeated warning re-emitted inside its window"
    )
    clock.advance(100)
    assert cha.emit(HOTSET_KEY, "warning", "third") is False
    assert len(cha.list_recent()) == 1, (
        f"a repeated warning reached the feed: {cha.list_recent()}"
    )


def test_CONTROL_a_repeated_critical_is_still_throttled(clock, pages):
    assert cha.emit(HOTSET_KEY, "critical", "first") is True
    clock.advance(100)
    assert cha.emit(HOTSET_KEY, "critical", "second") is False, (
        "THE THROTTLE IS GONE for criticals: a repeat re-emitted inside its window"
    )
    assert len(pages) == 1, f"the repeat also paged Discord: {pages}"


def test_CONTROL_the_600s_window_boundary_is_unchanged(clock):
    """The throttle was not WIDENED either — same `_THROTTLE_SEC`, read from the
    module rather than typed here."""
    window = cha._THROTTLE_SEC
    assert cha.emit(HOTSET_KEY, "warning", "first") is True
    clock.advance(window - 1)
    assert cha.emit(HOTSET_KEY, "warning", "one second early") is False
    clock.advance(1)
    assert cha.emit(HOTSET_KEY, "warning", "window expired") is True


def test_CONTROL_discord_is_still_bounded_by_its_own_cooldown(clock, pages):
    """A flapping metric crossing 0.20 repeatedly must not flood the channel.
    The deque window expires at 600 s; the Discord cooldown does not."""
    assert cha.emit(HOTSET_KEY, "critical", "21%") is True
    assert len(pages) == 1

    clock.advance(cha._THROTTLE_SEC + 1)          # deque window expired
    assert cha.emit(HOTSET_KEY, "critical", "22%") is True, (
        "precondition: the second critical should reach the page gate at all"
    )
    assert len(pages) == 1, (
        f"Discord was paged twice inside `_DISCORD_COOLDOWN_SEC` — the "
        f"anti-flood bound was widened along with the fix: {pages}"
    )

    clock.advance(cha._DISCORD_COOLDOWN_SEC)      # cooldown expired
    assert cha.emit(HOTSET_KEY, "critical", "23%") is True
    assert len(pages) == 2, (
        f"a persistent critical stopped paging entirely once its cooldown "
        f"expired: {pages}"
    )


def test_CONTROL_distinct_alert_keys_are_still_independent(clock):
    """Per-severity keying must not have collapsed two different conditions."""
    assert cha.emit("bars_daily_store_stale", "critical", "a") is True
    assert cha.emit(HOTSET_KEY, "critical", "b") is True
    assert len(cha.list_recent()) == 2


def test_CONTROL_clear_still_resets_the_per_severity_throttle(clock):
    cha.emit(HOTSET_KEY, "warning", "first")
    cha.clear()
    assert cha._throttle == {}
    assert cha.emit(HOTSET_KEY, "warning", "second") is True
