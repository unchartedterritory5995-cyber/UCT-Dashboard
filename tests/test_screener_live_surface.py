"""The LIVE TIER's member-facing surface: can a member tell live from nightly?

The tier itself (the sweeper, the overlay table, the derivation) is the sibling
lane's. This file covers the half a member actually touches:

  * `GET /api/screener/snapshot-status` carries the live tier's AS-OF and its
    per-cycle RECEIPT, so the surface and the controller read ONE source;
  * `run_scan`'s response says which tier THIS screen is on;
  * and — the failure mode that matters — it says *nightly* in every direction
    where it cannot prove *live*, and never the reverse.

⛔ EVERY FIXTURE HERE IS CONSTRUCTED. Nothing reads the live `screener.db`, and
the fake `live_tier` modules are built in-process so the absence, the presence
and the half-present cases are all reachable — they were written before the
sibling lane's module landed and must keep working if it is ever removed.

⚠️ TWO of them deliberately use the REAL module instead
(`test_the_probe_reads_the_REAL_live_tier_module_without_fabricating`, and the
factory rail beside it). Fakes agree with whatever the fake author imagined;
the real module is what shipped the one genuine bug this lane found — a
private `_blank_receipt()` factory the probe called and reported as a sweep.

⭐ AND EVERY GUARD CARRIES ITS OWN CONTROL. A test that only ever asserts
"nightly" would pass just as happily against a surface hard-wired to the word
— which is precisely the failure the brief names ("a surface that only ever
says 'live' is the failure mode", and its mirror). So each direction is proved
against the opposite fixture.
"""
import sys
import types
import uuid

import pytest
from fastapi.testclient import TestClient

import api.services.screener as screener_pkg
from api.main import app
from api.services.auth_db import get_connection, init_db
from api.services.auth_service import create_session, create_user
from api.services.screener import query

# A stand-in for the tier's declared set. Deliberately NOT the real 22 — the
# surface must render the list it is handed and count it with `len`, never
# carry a number of its own.
_COLS = ["price", "chg_pct_1d", "pct_vs_sma50", "dist_52w_high_pct"]

#: 🔴 THE TWO CLOCKS, DELIBERATELY FOUR HOURS APART. `as_of` is when the overlay
#: rows were DERIVED (the sweep stamps it onto every row it wrote); `swept_at`
#: is when the last CYCLE ran, and `_blank_receipt()` stamps that on every
#: cycle — including the ones that skip and write nothing. A fixture where the
#: two are equal cannot tell a correct surface from one reading the wrong field,
#: which is exactly how the first cut of this suite pinned the defect.
_AS_OF = 1755954127.4
_SWEPT_AT = _AS_OF + 4 * 3600

#: Shaped like the REAL `live_tier._blank_receipt()` — same key set, every
#: branch. A fixture missing `as_of`/`skipped_reason`/`dead_cycle` is a fixture
#: that can never see a skipped cycle, and a skipped cycle is the one this
#: surface gets wrong.
_RECEIPT = {
    "swept_at": _SWEPT_AT,
    "as_of": _AS_OF,
    "session": "regular",
    "session_ymd": 20260823,
    "enabled": True,
    "skipped_reason": None,
    "feed_symbols": 10412,
    "rows_considered": 3742,
    "rows_written": 3610,
    "rows_kept_nightly": 132,
    "cols_recomputed_total": 78122,
    "skipped": {"no_feed": 61, "not_traded": 44, "no_price": 0,
                "no_prev_close": 3, "bad_anchor": 12, "stale_anchor": 9,
                "insane_deviation": 3},
    "aborted": None,
    "dead_cycle": False,
    "lock_wait_ms": 0,
    "held_lock_ms": 118,
    "duration_ms": 402,
}

#: What `sweep_job()` leaves in `_LAST_RECEIPT` after 16:00 — and all weekend.
#: `swept_at` is NOW; `as_of` is None because this cycle wrote nothing.
_SKIP_RECEIPT = {**_RECEIPT, "as_of": None, "session": "closed",
                 "skipped_reason": "not_regular_session", "rows_written": 0,
                 "rows_kept_nightly": 0, "cols_recomputed_total": 0,
                 "skipped": {k: 0 for k in _RECEIPT["skipped"]}}


# ─── fixtures: the tier, in every state it can actually be in ────────────────

def _fake_tier(*, enabled=True, receipt=None, receipt_attr="last_receipt",
               columns=None, **consts):
    mod = types.ModuleType("api.services.screener.live_tier")
    mod.enabled = lambda: enabled
    mod.LIVE_COLUMNS = list(_COLS if columns is None else columns)
    mod.LIVE_TABLE = "screener_live"
    mod.MAX_AGE_S = 180
    if receipt is not None:
        setattr(mod, receipt_attr, (lambda: receipt))
    for name, value in consts.items():
        setattr(mod, name, value)
    return mod


def _install(monkeypatch, mod):
    """Make `from api.services.screener import live_tier` resolve to `mod`.

    BOTH the package attribute and `sys.modules` are set: `from pkg import name`
    reads the attribute first and only falls back to the module table, so
    setting one alone leaves whichever the interpreter happens to check.
    """
    monkeypatch.setitem(sys.modules, "api.services.screener.live_tier", mod)
    monkeypatch.setattr(screener_pkg, "live_tier", mod, raising=False)


def _uninstall(monkeypatch):
    """Force the import to fail even after the sibling lane ships the module."""
    monkeypatch.delattr(screener_pkg, "live_tier", raising=False)
    monkeypatch.setitem(sys.modules, "api.services.screener.live_tier", None)


def _make_paid(user_id):
    conn = get_connection()
    try:
        conn.execute(
            "INSERT INTO subscriptions (id, user_id, plan, status) "
            "VALUES (?, ?, 'pro', 'active')", (f"sub_{uuid.uuid4()}", user_id))
        conn.commit()
    finally:
        conn.close()


def _login(client):
    user = create_user(f"live_{uuid.uuid4()}@example.com", "password123")
    client.cookies.set("uct_session", create_session(user["id"]))
    _make_paid(user["id"])
    return user["id"]


def _seed(tmp_path, monkeypatch, rows=None):
    monkeypatch.setenv("SCREENER_DB_PATH", str(tmp_path / "live_surface.db"))
    import api.services.screener.snapshot_db as db
    db.init_db()
    db.upsert_rows(rows or [
        {"ticker": "AAA", "price": 10.0, "uct_composite": 80, "sector": "Tech",
         "snapshot_date": "2026-08-22", "built_at": 1},
        {"ticker": "BBB", "price": 20.0, "uct_composite": 60, "sector": "Tech",
         "snapshot_date": "2026-08-22", "built_at": 1},
    ])
    return db


# ═══ 1. the status endpoint carries the as-of AND the receipt ════════════════

def test_status_carries_the_live_as_of_and_the_whole_sweep_receipt(tmp_path, monkeypatch):
    """ONE source for the surface and the controller: the tier's as-of plus the
    per-cycle receipt VERBATIM — including the per-reason `skipped` map, which
    is the half that makes a silent failure visible (`rows_written` alone is
    not a receipt).

    ⛔ AND THE AS-OF IS THE OVERLAY'S, NOT THE CYCLE'S. Spec §13 receipt 2 has
    the controller read exactly this field before arming, so the two clocks are
    four hours apart in the fixture and BOTH are asserted by name.
    """
    _seed(tmp_path, monkeypatch)
    _install(monkeypatch, _fake_tier(receipt=_RECEIPT))
    client = TestClient(app)
    init_db()
    _login(client)

    body = client.get("/api/screener/snapshot-status").json()
    live = body["live"]

    assert live["state"] == "on"
    assert live["available"] is True and live["enabled"] is True
    assert live["as_of"] == _RECEIPT["as_of"]
    assert live["as_of_key"] == "as_of"
    assert live["as_of_et"].endswith(" ET")
    # the cycle clock is a real operator fact — reported, under its own name,
    # and never mistaken for the one above
    assert live["swept_at"] == _RECEIPT["swept_at"]
    assert live["swept_at_key"] == "swept_at"
    assert live["as_of"] != live["swept_at"]
    # verbatim, not a re-shaped summary
    assert live["receipt"] == _RECEIPT
    assert live["receipt"]["skipped"]["insane_deviation"] == 3
    assert live["receipt_source"] == "last_receipt"
    assert live["columns"] == _COLS and live["column_count"] == len(_COLS)
    # config is DERIVED from the module's own scalar constants, so a knob the
    # sibling lane adds tomorrow surfaces with no edit here.
    assert live["config"]["MAX_AGE_S"] == 180
    assert live["config"]["LIVE_TABLE"] == "screener_live"

    # and the snapshot half of the endpoint is untouched — this block is additive
    assert "snapshot_date" in body and "latest_built_at" in body


def test_status_says_unavailable_when_the_tier_is_not_installed(tmp_path, monkeypatch):
    """The control for the test above: same endpoint, no tier, and it says so
    in words a member could read rather than going quiet.

    ⭐ NON-VACUITY FIRST. An "it says unavailable" assertion passes just as
    happily against a probe that has been deleted — and it passed vacuously on
    the morning this was written, before `live_tier.py` existed at all. The
    tier is installed and SEEN first, then removed, so this proves the removal
    rather than the emptiness of the room.
    """
    _seed(tmp_path, monkeypatch)
    client = TestClient(app)
    init_db()
    _login(client)

    _install(monkeypatch, _fake_tier(receipt=_RECEIPT))
    assert client.get("/api/screener/snapshot-status").json()["live"]["state"] == "on"

    _uninstall(monkeypatch)
    live = client.get("/api/screener/snapshot-status").json()["live"]
    assert live["state"] == "unavailable"
    assert live["available"] is False
    assert live["receipt"] is None and live["as_of"] is None
    assert "03:00 build" in live["note"]


def test_status_still_answers_when_the_tiers_flag_raises(tmp_path, monkeypatch):
    """A tier whose `enabled()` blows up must read as OFF and name the error —
    never 502 the provenance endpoint the whole surface depends on."""
    _seed(tmp_path, monkeypatch)

    def _boom():
        raise RuntimeError("flag store unreachable")

    mod = _fake_tier(receipt=_RECEIPT)
    mod.enabled = _boom
    _install(monkeypatch, mod)
    client = TestClient(app)
    init_db()
    _login(client)

    live = client.get("/api/screener/snapshot-status").json()["live"]
    assert live["state"] == "off"
    assert "RuntimeError" in live["enabled_error"]


# ═══ 1b. THE TWO CLOCKS — a skipped cycle must not date the overlay ══════════

def test_a_skipped_cycle_dates_nothing_even_though_it_stamped_a_clock(monkeypatch):
    """🔴 THE FABRICATED FRESHNESS CLAIM THIS EXISTS TO STOP.

    From 16:00 every 60 s cycle returns `skipped_reason="not_regular_session"`
    with `as_of=None` and `swept_at=now`, and `sweep_job()` overwrites
    `_LAST_RECEIPT` with it. A surface reading `swept_at` as the served as-of
    would print `⚡ LIVE 19:24:48 ET` over 15:59 prices — and a weekend would
    date Friday's overlay with Saturday's clock. So: the cycle clock is
    reported, the overlay as-of is honestly absent, and NO time reaches the
    chip.
    """
    _install(monkeypatch, _fake_tier(receipt=_SKIP_RECEIPT))
    state = query.live_tier_state()

    assert state["state"] == "on"                    # the tier is running
    assert state["as_of"] is None and state["as_of_et"] is None
    assert state["as_of_key"] is None
    assert state["swept_at"] == _SKIP_RECEIPT["swept_at"]
    assert state["swept_at_et"].endswith(" ET")
    assert state["receipt"]["skipped_reason"] == "not_regular_session"

    # CONTROL — the SAME module with a receipt from a cycle that actually
    # wrote rows does date the overlay, so the silence above is about the skip,
    # not about the probe being broken.
    _install(monkeypatch, _fake_tier(receipt=_RECEIPT))
    wrote = query.live_tier_state()
    assert wrote["as_of"] == _AS_OF and wrote["as_of_key"] == "as_of"


def test_the_served_as_of_comes_off_the_rows_served(monkeypatch):
    """⭐ ROWS ARE THE EVIDENCE — for the timestamp as well as the verdict.

    `live_asof` is the stamp the sweep wrote ONTO each overlay row, so the
    newest one on the page is literally when these values were derived. The
    worst day, end to end: the last real sweep was 15:59, every cycle since has
    skipped, and the rows on screen are still the 15:59 ones. The screen must
    say 15:59.
    """
    _install(monkeypatch, _fake_tier(receipt=_SKIP_RECEIPT))
    out = query.live_screen_state([
        {"ticker": "AAA", "live_row": 1, "live_asof": _AS_OF},
        {"ticker": "BBB", "live_row": 1, "live_asof": _AS_OF - 60},
        {"ticker": "CCC", "live_row": 0, "live_asof": _SWEPT_AT},   # not overlaid
    ])
    assert out["state"] == "live"
    assert out["as_of"] == _AS_OF          # the newest OVERLAID row, not the skip
    assert out["as_of_source"] == "rows"
    assert out["as_of_note"] is None
    # and never the cycle clock, which is four hours newer and on the page
    assert out["as_of"] != _SWEPT_AT

    # the receipt is the FALLBACK, named as such, when the join has not landed
    _install(monkeypatch, _fake_tier(receipt=_RECEIPT))
    fallback = query.live_screen_state([{"ticker": "AAA", "live_row": 1}])
    assert fallback["as_of"] == _AS_OF and fallback["as_of_source"] == "receipt"

    # CONTROL — neither source has a time: no time is shown, and it SAYS so
    # rather than borrowing the cycle clock that is sitting right there.
    _install(monkeypatch, _fake_tier(receipt=_SKIP_RECEIPT))
    silent = query.live_screen_state([{"ticker": "AAA", "live_row": 1}])
    assert silent["state"] == "live"
    assert silent["as_of"] is None and silent["as_of_et"] is None
    assert silent["as_of_source"] is None
    assert "did not report when" in silent["as_of_note"]


# ═══ 2. enabled-but-unreadable is NOT "off" ══════════════════════════════════

def test_enabled_but_unreadable_is_never_reported_as_off(monkeypatch):
    """⛔ THE LIE THIS GUARDS. "The overlay is off" and "I cannot tell what the
    overlay is doing" are different facts. Collapsing the second into the first
    would let a broken receipt accessor read as a healthy nightly screen while
    the tier was writing — the surface would be confidently wrong in the one
    direction the constraints forbid."""
    _install(monkeypatch, _fake_tier(enabled=True, receipt=None))
    state = query.live_tier_state()
    assert state["state"] == "unreadable"
    assert state["enabled"] is True
    assert state["receipt"] is None

    # CONTROL — genuinely off is a different word.
    _install(monkeypatch, _fake_tier(enabled=False, receipt=_RECEIPT))
    assert query.live_tier_state()["state"] == "off"


# ═══ 3. the receipt accessor's NAME is derived, not typed ════════════════════

def test_the_receipt_accessor_name_is_derived_from_the_module(monkeypatch):
    """The sibling lane names its own accessor. Hard-coding one guess here and
    reading that guess's absence as "off" is the same lie as above, one layer
    down — so the candidates come out of `dir()` and the name that answered is
    reported."""
    _install(monkeypatch, _fake_tier(receipt=_RECEIPT, receipt_attr="sweep_receipt"))
    state = query.live_tier_state()
    assert state["state"] == "on"
    assert state["receipt_source"] == "sweep_receipt"
    assert "sweep_receipt" in state["receipt_candidates"]

    # a plain dict attribute (not a callable) answers too
    _install(monkeypatch, _fake_tier(receipt=None, last_sweep_receipt=_RECEIPT))
    assert query.live_tier_state()["receipt"] == _RECEIPT

    # CONTROL — a module whose summary is named nothing-like-a-receipt is
    # honestly unreadable, and the empty candidate list SAYS the probe found
    # nothing to try rather than implying it tried and got a "no".
    _install(monkeypatch, _fake_tier(receipt=None, last_sweep=_RECEIPT))
    control = query.live_tier_state()
    assert control["state"] == "unreadable"
    assert control["receipt_candidates"] == []


def test_the_probe_refuses_a_receipt_FACTORY_and_reads_only_public_names(monkeypatch):
    """🔴 THE FABRICATION THIS CAUGHT — kept as a rail.

    `live_tier` carries `_blank_receipt(**over)`: a private factory returning a
    fresh, all-zero receipt stamped `swept_at = time.time()`. Zero required
    args, "receipt" in the name, and it sorts BEFORE the real `last_receipt` —
    so the first version of this probe MANUFACTURED a sweep that had never
    happened, timestamped NOW, and handed it to the surface as the tier's
    as-of. Measured against the real module on 2026-08-23. Constraint 1 in one
    line: a factory is not a fact.
    """
    mod = _fake_tier(receipt=None)
    mod._blank_receipt = lambda **over: {"swept_at": 1.0, "rows_written": 0}
    mod._LAST_RECEIPT = None
    _install(monkeypatch, mod)

    state = query.live_tier_state()
    assert state["state"] == "unreadable"
    assert state["receipt"] is None and state["as_of"] is None
    assert state["receipt_candidates"] == []   # the private factory is not a candidate

    # CONTROL — the identical module plus a PUBLIC accessor IS read, so the
    # refusal above is about privacy, not about the probe being broken.
    mod.last_receipt = lambda: {"swept_at": 2.0}
    _install(monkeypatch, mod)
    read = query.live_tier_state()
    assert read["receipt"] == {"swept_at": 2.0}
    assert read["receipt_source"] == "last_receipt"


def test_the_probe_reads_the_REAL_live_tier_module_without_fabricating(monkeypatch):
    """Against the sibling lane's actual module, not a fake.

    Two invariants, both order-independent:
      * the probe SEES the real public accessor (so the surface is not blind);
      * it reports a receipt if and only if the tier itself has one — no
        factory, no synthesised as-of, on either side of the flag.
    """
    live_tier = pytest.importorskip("api.services.screener.live_tier")
    for flag in ("0", "1"):
        monkeypatch.setenv("SCREENER_LIVE_TIER_ENABLED", flag)
        state = query.live_tier_state()
        assert "last_receipt" in state["receipt_candidates"]
        assert all(not n.startswith("_") for n in state["receipt_candidates"])
        assert (state["receipt"] is None) == (live_tier.last_receipt() is None)
        if state["receipt"] is None:
            assert state["as_of"] is None and state["as_of_et"] is None
    # ⛔ EXACTLY ONE, AND IT FAILS BY NAME. The fallback CALLS what it finds and
    # this runs on the member request path, so the day the engine lane adds a
    # public `reset_receipt()` / `refresh_receipt()` this must go RED here
    # rather than go green while a member's scan invokes it. (The direct-read
    # ordering below means it would not actually be called today — this is the
    # second lock on the same door, because the fallback is still reachable for
    # a tier that renames its accessor.)
    assert set(query.live_tier_state()["receipt_candidates"]) == {"last_receipt"}


def test_the_named_accessor_is_read_directly_and_nothing_else_is_invoked(monkeypatch):
    """⛔ THE MEMBER REQUEST PATH INVOKES `last_receipt` AND NOTHING ELSE.

    Every `run_scan` and every `snapshot-status` runs this. The derivation is a
    fallback for a tier that names its accessor differently — it must not be
    the first move, because it CALLS what it finds and the only thing standing
    between it and a side-effecting sibling is a substring.
    """
    called = []
    mod = _fake_tier(receipt=_RECEIPT)
    mod.refresh_receipt = lambda: called.append("refresh_receipt") or {"swept_at": 1.0}
    _install(monkeypatch, mod)

    state = query.live_tier_state()
    assert state["receipt_source"] == "last_receipt"
    assert state["receipt"] == _RECEIPT
    assert called == []                       # the sibling was never invoked
    # it is still REPORTED, so an operator can see the name that would have
    # been tried had the contract been missing
    assert "refresh_receipt" in state["receipt_candidates"]

    # …and "no sweep yet" from the named accessor is an ANSWER, not a cue to
    # start groping at the siblings.
    mod.last_receipt = lambda: None
    _install(monkeypatch, mod)
    quiet = query.live_tier_state()
    assert quiet["state"] == "unreadable" and quiet["receipt"] is None
    assert called == []

    # CONTROL — remove the contract entirely and the fallback DOES run, so the
    # restraint above is about ordering, not about the fallback being dead.
    del mod.last_receipt
    _install(monkeypatch, mod)
    derived = query.live_tier_state()
    assert derived["receipt_source"] == "refresh_receipt"
    assert called == ["refresh_receipt"]


def test_a_receipt_timestamp_that_is_already_a_string_is_passed_through(monkeypatch):
    """Reformatting a timestamp we did not parse would be inventing precision."""
    _install(monkeypatch, _fake_tier(
        receipt={"as_of": "10:42:07 ET", "rows_written": 5}))
    state = query.live_tier_state()
    assert state["as_of"] == "10:42:07 ET"
    assert state["as_of_et"] == "10:42:07 ET"

    # CONTROL — the same string under the CYCLE's key is a cycle clock, and it
    # never becomes the overlay's as-of no matter how well-formed it looks.
    _install(monkeypatch, _fake_tier(
        receipt={"swept_at": "19:24:48 ET", "rows_written": 0}))
    cycle = query.live_tier_state()
    assert cycle["swept_at"] == "19:24:48 ET"
    assert cycle["as_of"] is None and cycle["as_of_et"] is None


# ═══ 4. the SCREEN's verdict is evidence-based, both directions ══════════════

def test_the_screen_says_live_only_when_a_served_row_carries_a_live_value(monkeypatch):
    """⭐ THE VERDICT IS DERIVED FROM THE ROWS, NOT THE FLAG — and the pair of
    assertions below is the whole point: one tier state, two row sets, two
    different answers. A surface hard-wired to either word fails one of them."""
    _install(monkeypatch, _fake_tier(receipt=_RECEIPT))

    live = query.live_screen_state([{"ticker": "AAA", "live_row": 1},
                                    {"ticker": "BBB", "live_row": 0}])
    assert live["state"] == "live"
    assert live["live_rows_on_page"] == 1 and live["rows_on_page"] == 2
    assert live["as_of"] == _RECEIPT["as_of"]
    assert live["as_of_et"].endswith(" ET")
    assert live["columns"] == _COLS and live["column_count"] == len(_COLS)
    assert live["off_reason"] is None
    # the wording contract is the SERVER's, so the toolbar cannot phrase the
    # anchor differently from the API
    assert live["anchor_note"] == query.LIVE_ANCHOR_NOTE
    assert "do not move during the day" in live["anchor_note"]
    assert "page" in live["scope_note"]

    # CONTROL — the identical tier, rows with no live marker.
    nightly = query.live_screen_state([{"ticker": "AAA"}, {"ticker": "BBB"}])
    assert nightly["state"] == "nightly"
    assert nightly["as_of"] is None and nightly["as_of_et"] is None
    assert nightly["columns"] == []
    assert "No row in this result carries a live value" in nightly["off_reason"]
    # the disagreement stays VISIBLE to an operator instead of being inherited
    # by the member: the screen says nightly, the tier still says it is on.
    assert nightly["tier"]["state"] == "on"


def test_the_anchor_note_names_the_date_only_when_one_date_is_true(monkeypatch):
    """Spec §8.1 / §13 receipt 4 — 'the popover names the anchor date'.

    ⛔ And it names it ONLY when one date is true of the whole page. `bars_asof`
    is per row and `describe_rows.mixed` exists because a page can hold three
    of them; a representative pick would print 'levels from the 2026-08-22
    close' over rows anchored to 2026-08-19.
    """
    _install(monkeypatch, _fake_tier(receipt=_RECEIPT))

    one = query.live_screen_state([
        {"ticker": "AAA", "live_row": 1, "anchor_bars_asof": "20260822"},
        {"ticker": "BBB", "live_row": 1, "bars_asof": "20260822"},
        {"ticker": "CCC", "live_row": 0, "bars_asof": "20260819"},  # not overlaid
    ])
    assert one["anchor_date"] == "2026-08-22"
    assert "from the 2026-08-22 close" in one["anchor_note"]
    assert "do not move during the day" in one["anchor_note"]

    # CONTROL — two anchors among the LIVE rows: no date, the general sentence.
    mixed = query.live_screen_state([
        {"ticker": "AAA", "live_row": 1, "bars_asof": "20260822"},
        {"ticker": "BBB", "live_row": 1, "bars_asof": "20260819"},
    ])
    assert mixed["anchor_date"] is None
    assert mixed["anchor_note"] == query.LIVE_ANCHOR_NOTE
    assert "each row's last completed session" in mixed["anchor_note"]

    # CONTROL — the column was not selected, or is unreadable: no date either.
    for row in ({"ticker": "AAA", "live_row": 1},
                {"ticker": "AAA", "live_row": 1, "bars_asof": "not-a-date"}):
        out = query.live_screen_state([row])
        assert out["anchor_date"] is None
        assert out["anchor_note"] == query.LIVE_ANCHOR_NOTE

    # ONE TEMPLATE, so the dated and the general form cannot drift apart.
    assert query.anchor_note() == query.LIVE_ANCHOR_NOTE
    assert query.anchor_note("2026-08-22") != query.LIVE_ANCHOR_NOTE


def test_overlaid_rows_with_no_named_columns_refuse_BOTH_words(monkeypatch):
    """The roster IS the disclosure, so a roster of none cannot be `live`.

    ⛔ And it cannot be `nightly` either — that would be false about values
    that were recomputed. Unreachable while the tier ships `LIVE_COLUMNS`; if
    it is ever reached, an unclaimed screen is the safe direction.
    """
    _install(monkeypatch, _fake_tier(receipt=_RECEIPT, columns=[]))
    out = query.live_screen_state([{"ticker": "AAA", "live_row": 1}])
    assert out["state"] == "live_unnamed"
    assert out["columns"] == [] and out["column_count"] == 0
    assert "did not say which columns" in out["off_reason"]
    assert out["live_rows_on_page"] == 1

    # CONTROL 1 — the same rows with a named roster ARE live.
    _install(monkeypatch, _fake_tier(receipt=_RECEIPT))
    assert query.live_screen_state([{"ticker": "AAA", "live_row": 1}])["state"] == "live"

    # CONTROL 2 — an empty roster with NO overlaid rows is plain nightly, so
    # the third word is about the roster, not about the empty list.
    _install(monkeypatch, _fake_tier(receipt=_RECEIPT, columns=[]))
    assert query.live_screen_state([{"ticker": "AAA"}])["state"] == "nightly"


def test_an_aborted_sweep_is_named_in_the_reason(monkeypatch):
    _install(monkeypatch, _fake_tier(
        receipt={**_RECEIPT, "aborted": "not_a_trading_session"}))
    out = query.live_screen_state([{"ticker": "AAA"}])
    assert out["state"] == "nightly"
    assert "not_a_trading_session" in out["off_reason"]


def test_a_page_with_no_rows_says_so_instead_of_claiming_a_tier(monkeypatch):
    _install(monkeypatch, _fake_tier(receipt=_RECEIPT))
    out = query.live_screen_state([])
    assert out["state"] == "nightly"
    assert "no rows" in out["off_reason"]


def test_the_off_reason_names_the_tier_when_the_tier_is_the_reason(monkeypatch):
    _uninstall(monkeypatch)
    out = query.live_screen_state([{"ticker": "AAA"}])
    assert out["state"] == "nightly"
    assert out["tier"]["state"] == "unavailable"
    assert out["off_reason"] == "The live overlay is not running on this pod."

    _install(monkeypatch, _fake_tier(enabled=False))
    out = query.live_screen_state([{"ticker": "AAA"}])
    assert out["off_reason"] == "The live overlay is switched off."
    # ⛔ THE REASON IS A CAUSE CLAUSE, NOT A SECOND COPY OF THE LEAD. The
    # toolbar prints "…every column on this screen is from the 03:00 build."
    # and then appends this; a reason that repeated the lead produced the
    # sentence twice on screen. Green tests never saw it — reading the
    # rendered text did.
    assert "03:00 build" not in out["off_reason"]


# ═══ 5. the wire: run_scan actually attaches it, to the served rows ══════════

def test_run_scan_attaches_the_live_block_to_the_provenance_object(tmp_path, monkeypatch):
    """The block rides `snapshot`, which is already the object the toolbar's
    Seal receives — so the disclosure is reachable, not merely built."""
    _seed(tmp_path, monkeypatch)
    _install(monkeypatch, _fake_tier(receipt=_RECEIPT))
    res = query.run_scan({"filters": [], "page": 1, "page_size": 50})

    live = res["snapshot"]["live"]
    assert live["state"] == "nightly"          # no join yet — honest
    assert live["rows_on_page"] == len(res["rows"]) == 2
    assert live["tier"]["state"] == "on"
    assert live["tier"]["receipt"] == _RECEIPT


def test_run_scan_hands_the_verdict_the_rows_it_actually_served(tmp_path, monkeypatch):
    """⛔ THE SEVERED-WIRE RAIL. Every assertion above would still pass if
    `run_scan` computed the block from an empty list, or from the whole table,
    or from a stale copy. This one pins that the rows judged ARE the rows
    returned — which is the only reason the verdict can be trusted."""
    _seed(tmp_path, monkeypatch)
    _install(monkeypatch, _fake_tier(receipt=_RECEIPT))
    seen = {}

    def _spy(rows, tier=None):
        seen["rows"] = rows
        return {"state": "spied"}

    monkeypatch.setattr(query, "live_screen_state", _spy)
    # page_size 1 makes the served set a STRICT subset of the table, so a block
    # computed off the whole table (or off nothing) cannot pass this.
    res = query.run_scan({"filters": [], "page": 1, "page_size": 1})
    assert res["snapshot"]["live"] == {"state": "spied"}
    assert [r["ticker"] for r in seen["rows"]] == ["AAA"]
    assert seen["rows"] == res["rows"]


def test_the_live_block_never_breaks_a_scan_when_the_tier_is_half_written(tmp_path, monkeypatch):
    """A disclosure that can take the screen down is worse than the silence it
    replaces. Every attribute of this module raises; the scan still answers,
    and the verdict falls to nightly rather than to a 500."""
    _seed(tmp_path, monkeypatch)

    class _Exploding(types.ModuleType):
        def __getattr__(self, name):
            raise RuntimeError("half-written module")

    _install(monkeypatch, _Exploding("api.services.screener.live_tier"))
    res = query.run_scan({"filters": [], "page": 1, "page_size": 50})
    assert res["snapshot"]["live"]["state"] == "nightly"
    assert res["snapshot"]["live"]["tier"]["state"] in ("off", "unavailable", "unreadable")
    assert res["total"] == 2
