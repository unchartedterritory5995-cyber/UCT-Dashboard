"""Tell a member when a name enters or leaves their screen.

Benchmark Tier-1 loss #2 (metrics 462/463/465/466): six rivals can, we could
not. Every piece already existed — the 05:00 sweep stores tonight's hits, and
the watchlist pipeline already delivers on four channels. What was missing was
the set difference.

⭐ THE QUIET-NIGHT TEST IS THE ONE THAT MATTERS. Read
`test_a_quiet_night_is_not_a_flood_of_entries` first.
"""
import pytest

from api.services.screener import scan_store as ss
from api.services.screener import screen_alerts as sa
from api.services.screener import snapshot_db as db

TF = ss.SCAN_JOIN_TF
H = "def_hash_one"


@pytest.fixture
def store(tmp_path, monkeypatch):
    monkeypatch.setenv("SCREENER_DB_PATH", str(tmp_path / "s.db"))
    db.init_db()
    ss.init_db()
    sa._done.clear()
    return tmp_path


def _sweep(as_of, tickers, def_hash=H):
    """Record a swept session — coverage ALWAYS, hits only if there are any.
    That asymmetry is the real store's contract and the whole point here."""
    ss.record_coverage(def_hash, TF, as_of, evaluated=100, answered=100,
                       dropped=0, not_computable=0, dropped_symbols=[])
    if tickers:
        ss.record_hits(def_hash, TF, as_of, tickers)


class _Spy:
    def __init__(self):
        self.calls = []

    def __call__(self, **kw):
        self.calls.append(kw)
        return {"ok": True}


# ── the diff ─────────────────────────────────────────────────────────────────

def test_it_reports_what_entered_and_what_left(store):
    _sweep(20260822, ["AAA", "BBB", "CCC"])
    _sweep(20260823, ["BBB", "CCC", "DDD"])
    as_of, entered, exited = sa.diff_for(H)
    assert as_of == 20260823
    assert entered == ["DDD"]
    assert exited == ["AAA"]


def test_a_first_ever_sweep_says_nothing(store):
    """⛔ "Welcome to your new screen, here are all 87 matches" is not an
    alert."""
    _sweep(20260823, ["AAA", "BBB"])
    assert sa.diff_for(H) == (None, [], [])


def test_no_sweep_at_all_says_nothing(store):
    assert sa.diff_for(H) == (None, [], [])


def test_a_quiet_night_is_not_a_flood_of_entries(store):
    """🔴 THE TRAP THIS MODULE IS BUILT AROUND. A swept session that matched
    NOTHING writes a coverage row and zero hits rows. Diffing against "the last
    session that has hits" would skip the quiet night entirely and compare
    tonight against the busy one before it — reporting every name that has been
    in the screen the whole time as newly ENTERED, on a night when nothing
    moved."""
    _sweep(20260821, ["AAA", "BBB", "CCC"])
    _sweep(20260822, [])                      # swept, matched nothing
    _sweep(20260823, ["AAA", "BBB", "CCC"])   # the same three came back
    as_of, entered, exited = sa.diff_for(H)
    assert as_of == 20260823
    assert entered == ["AAA", "BBB", "CCC"], (
        "against the QUIET night these three genuinely did re-enter")
    assert exited == []
    # …and the quiet night itself reported the three leaving, which is true.
    assert ss.recent_covered_as_ofs(H, TF, 2) == [20260823, 20260822], (
        "the previous session is the quiet one, not the last one with hits")


def test_an_unchanged_screen_produces_no_diff(store):
    _sweep(20260822, ["AAA", "BBB"])
    _sweep(20260823, ["AAA", "BBB"])
    _as_of, entered, exited = sa.diff_for(H)
    assert entered == [] and exited == []


# ── subscriptions ────────────────────────────────────────────────────────────

def test_subscribe_list_unsubscribe(store):
    sa.subscribe("u1", H, "d1", "Momentum", "both")
    subs = sa.list_subs("u1")
    assert [s["def_hash"] for s in subs] == [H]
    assert subs[0]["name"] == "Momentum" and subs[0]["mode"] == "both"
    assert sa.list_subs("u2") == [], "one member's subs are not another's"
    assert sa.unsubscribe("u1", H) is True
    assert sa.list_subs("u1") == []
    assert sa.unsubscribe("u1", H) is False


def test_a_bad_mode_or_missing_owner_refuses(store):
    with pytest.raises(ValueError):
        sa.subscribe("u1", H, "d1", "X", "sometimes")
    with pytest.raises(ValueError):
        sa.subscribe("", H, "d1", "X")
    with pytest.raises(ValueError):
        sa.subscribe("u1", "", "d1", "X")


# ── the run ──────────────────────────────────────────────────────────────────

def test_it_delivers_entries_and_exits(store):
    _sweep(20260822, ["AAA", "BBB"])
    _sweep(20260823, ["BBB", "DDD"])
    sa.subscribe("u1", H, "d1", "Momentum", "both")
    spy = _Spy()
    r = sa.run_nightly(deliver=spy)
    assert r["sent"] == 1 and r["compared"] == 1
    kw = spy.calls[0]
    assert kw["extra_data"]["entered"] == ["DDD"]
    assert kw["extra_data"]["exited"] == ["AAA"]
    assert "entered Momentum" in kw["message"]
    assert "left Momentum" in kw["message"]


def test_the_copy_says_OVERNIGHT_and_never_implies_live(store):
    """⚠️ The sweep is nightly by construction. thinkorswim's every-change
    alert is a better product on this axis, and the wording must not borrow
    credit for it."""
    _sweep(20260822, ["AAA"])
    _sweep(20260823, ["AAA", "BBB"])
    sa.subscribe("u1", H, "d1", "Momentum")
    spy = _Spy()
    sa.run_nightly(deliver=spy)
    msg = spy.calls[0]["message"].lower()
    assert "overnight" in msg
    for banned in ("just now", "live", "real-time", "right now"):
        assert banned not in msg


def test_entry_only_and_exit_only_modes(store):
    _sweep(20260822, ["AAA", "BBB"])
    _sweep(20260823, ["BBB", "DDD"])
    sa.subscribe("uin", H, "d1", "S", "entry")
    sa.subscribe("uout", H, "d1", "S", "exit")
    spy = _Spy()
    sa.run_nightly(deliver=spy)
    by_user = {c["user_id"]: c["extra_data"] for c in spy.calls}
    assert by_user["uin"]["entered"] == ["DDD"] and by_user["uin"]["exited"] == []
    assert by_user["uout"]["exited"] == ["AAA"] and by_user["uout"]["entered"] == []


def test_a_quiet_screen_sends_nothing(store):
    """⛔ A nightly "nothing changed" trains the member to ignore the channel,
    which costs them the night something does."""
    _sweep(20260822, ["AAA"])
    _sweep(20260823, ["AAA"])
    sa.subscribe("u1", H, "d1", "S")
    spy = _Spy()
    r = sa.run_nightly(deliver=spy)
    assert spy.calls == [] and r["skipped_quiet"] == 1


def test_a_rerun_does_not_send_twice(store):
    _sweep(20260822, ["AAA"])
    _sweep(20260823, ["AAA", "BBB"])
    sa.subscribe("u1", H, "d1", "S")
    spy = _Spy()
    assert sa.run_nightly(deliver=spy)["sent"] == 1
    again = sa.run_nightly(deliver=spy)
    assert again["sent"] == 0 and again["skipped_dedup"] == 1
    assert len(spy.calls) == 1


def test_a_new_session_alerts_again(store):
    """Dedup is per SESSION — without `as_of` a re-run after a failed night
    would silence the definition forever."""
    _sweep(20260822, ["AAA"])
    _sweep(20260823, ["AAA", "BBB"])
    sa.subscribe("u1", H, "d1", "S")
    spy = _Spy()
    sa.run_nightly(deliver=spy)
    _sweep(20260824, ["AAA", "BBB", "CCC"])
    assert sa.run_nightly(deliver=spy)["sent"] == 1
    assert len(spy.calls) == 2


def test_the_per_member_quota_holds(store):
    for i in range(sa.MAX_PER_USER + 3):
        h = f"h{i}"
        _sweep(20260822, ["AAA"], def_hash=h)
        _sweep(20260823, ["AAA", "BBB"], def_hash=h)
        sa.subscribe("u1", h, f"d{i}", f"S{i}")
    spy = _Spy()
    r = sa.run_nightly(deliver=spy)
    assert r["sent"] == sa.MAX_PER_USER
    assert r["skipped_quota"] == 3
    assert len(spy.calls) == sa.MAX_PER_USER


def test_a_long_list_is_truncated_with_a_count(store):
    many = [f"T{i:03d}" for i in range(sa.MAX_NAMED + 5)]
    _sweep(20260822, [])
    _sweep(20260823, many)
    sa.subscribe("u1", H, "d1", "S")
    spy = _Spy()
    sa.run_nightly(deliver=spy)
    msg = spy.calls[0]["message"]
    assert "+5 more" in msg
    assert msg.count("T0") == sa.MAX_NAMED
    assert spy.calls[0]["extra_data"]["entered"] == many, (
        "the payload keeps every name; only the prose is truncated")


def test_one_members_failure_never_costs_another(store):
    """⛔ Per-user isolation — the rule every fan-out in this codebase follows."""
    _sweep(20260822, ["AAA"])
    _sweep(20260823, ["AAA", "BBB"])
    sa.subscribe("bad", H, "d1", "S")
    sa.subscribe("good", H, "d1", "S")
    seen = []

    def deliver(**kw):
        if kw["user_id"] == "bad":
            raise RuntimeError("mailbox is on fire")
        seen.append(kw["user_id"])
    r = sa.run_nightly(deliver=deliver)
    assert seen == ["good"]
    assert r["sent"] == 1 and r["errors"] == 1


def test_a_definition_that_was_never_swept_twice_is_counted_not_sent(store):
    _sweep(20260823, ["AAA"])
    sa.subscribe("u1", H, "d1", "S")
    spy = _Spy()
    r = sa.run_nightly(deliver=spy)
    assert spy.calls == [] and r["no_previous"] == 1 and r["sent"] == 0


def test_no_subscriptions_is_a_clean_no_op(store):
    r = sa.run_nightly(deliver=_Spy())
    assert r["definitions"] == 0 and r["sent"] == 0
