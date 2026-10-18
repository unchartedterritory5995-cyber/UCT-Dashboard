"""Saved + shareable screener screens, stored in the auth DB (with user data).

A screen is a serialized scan spec (filters + view + sort). ``starters`` are
built-in read-only screens shipped with the app.
"""
import json
import secrets
import time

from api.services import artifact_versions, auth_db


def init():
    with auth_db.get_connection() as c:
        c.execute("""CREATE TABLE IF NOT EXISTS screener_saved_screens (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL,
            name TEXT NOT NULL,
            spec_json TEXT NOT NULL,
            is_public INTEGER DEFAULT 0,
            share_token TEXT,
            created_at INTEGER,
            updated_at INTEGER)""")
        c.execute("CREATE INDEX IF NOT EXISTS idx_screens_user "
                  "ON screener_saved_screens(user_id)")
        c.commit()


def _row(r):
    return {"id": r["id"], "name": r["name"], "spec": json.loads(r["spec_json"]),
            "is_public": bool(r["is_public"]), "share_token": r["share_token"],
            "created_at": r["created_at"], "updated_at": r["updated_at"]}


def create(user_id, name, spec, is_public=False):
    now = int(time.time())
    tok = secrets.token_urlsafe(8) if is_public else None
    with auth_db.get_connection() as c:
        cur = c.execute(
            "INSERT INTO screener_saved_screens "
            "(user_id,name,spec_json,is_public,share_token,created_at,updated_at) "
            "VALUES (?,?,?,?,?,?,?)",
            (user_id, name, json.dumps(spec), 1 if is_public else 0, tok, now, now))
        c.commit()
        new_id = cur.lastrowid
    rec = get(new_id, user_id)
    _version(user_id, rec, before=None)
    return rec


def list_for(user_id):
    with auth_db.get_connection() as c:
        rows = c.execute("SELECT * FROM screener_saved_screens WHERE user_id=? "
                         "ORDER BY updated_at DESC", (user_id,)).fetchall()
    return [_row(r) for r in rows]


def all_specs():
    """Every member's saved screen spec, for the nightly membership record. Specs only:
    the record is keyed by the screen's criteria, never by who saved it."""
    init()
    with auth_db.get_connection() as c:
        rows = c.execute("SELECT spec_json FROM screener_saved_screens").fetchall()
    out = []
    for r in rows:
        try:
            out.append(json.loads(r["spec_json"]))
        except (TypeError, ValueError):
            continue
    return out


def get(screen_id, user_id):
    with auth_db.get_connection() as c:
        r = c.execute("SELECT * FROM screener_saved_screens WHERE id=? AND user_id=?",
                      (screen_id, user_id)).fetchone()
    return _row(r) if r else None


def _stored(screen_id, user_id):
    """The row's stored TEXT columns, verbatim — what COV-06 versions."""
    with auth_db.get_connection() as c:
        r = c.execute("SELECT name, spec_json FROM screener_saved_screens WHERE id=? AND user_id=?",
                      (screen_id, user_id)).fetchone()
    return {"name": r["name"], "spec_json": r["spec_json"]} if r else None


def _version(user_id, rec, *, before, source="save", restored_from=None):
    """COV-06: snapshot a committed save; never raises. The ``is_enabled()`` here only skips the
    extra row read while dark — the write gate is ``artifact_versions.record_save``'s own."""
    if not rec or not artifact_versions.is_enabled():
        return None
    after = _stored(rec["id"], user_id)
    if after is None:
        return None
    return artifact_versions.record_save(
        user_id, artifact_versions.KIND_SCREEN, rec["id"], before=before, after=after,
        label=rec["name"], source=source, restored_from=restored_from)


def update(screen_id, user_id, **fields):
    cur = get(screen_id, user_id)
    if not cur:
        return None
    before = _stored(screen_id, user_id) if artifact_versions.is_enabled() else None
    name = fields.get("name", cur["name"])
    spec = fields.get("spec", cur["spec"])
    is_public = fields.get("is_public", cur["is_public"])
    tok = cur["share_token"] or (secrets.token_urlsafe(8) if is_public else None)
    with auth_db.get_connection() as c:
        c.execute("UPDATE screener_saved_screens SET name=?,spec_json=?,is_public=?,"
                  "share_token=?,updated_at=? WHERE id=? AND user_id=?",
                  (name, json.dumps(spec), 1 if is_public else 0, tok,
                   int(time.time()), screen_id, user_id))
        c.commit()
    rec = get(screen_id, user_id)
    _version(user_id, rec, before=before)
    return rec


def restore_content(screen_id, user_id, payload, *, restored_from):
    """COV-06: write a version's stored ``name`` + ``spec_json`` back, VERBATIM. Publication
    (``is_public`` / ``share_token``) is not content and is left exactly as it is. Recorded as a
    new ``restore`` version — nothing is removed, so the restore can itself be undone."""
    before = _stored(screen_id, user_id)
    if before is None:
        return None
    with auth_db.get_connection() as c:
        c.execute("UPDATE screener_saved_screens SET name=?,spec_json=?,updated_at=?"
                  " WHERE id=? AND user_id=?",
                  (payload["name"], payload["spec_json"], int(time.time()), screen_id, user_id))
        c.commit()
    rec = get(screen_id, user_id)
    res = _version(user_id, rec, before=before, source="restore", restored_from=restored_from)
    return rec, res


def delete(screen_id, user_id):
    before = _stored(screen_id, user_id) if artifact_versions.is_enabled() else None
    with auth_db.get_connection() as c:
        cur = c.execute("DELETE FROM screener_saved_screens WHERE id=? AND user_id=?",
                        (screen_id, user_id))
        c.commit()
        gone = cur.rowcount > 0
    if gone and before is not None:
        # COV-06: the history outlives the screen (a tombstone), so a delete can be undone.
        artifact_versions.record_delete(user_id, artifact_versions.KIND_SCREEN, screen_id,
                                        before=before, label=before["name"])
    return gone


def undelete_content(screen_id, user_id, payload, *, restored_from):
    """COV-06: bring a DELETED screen back from one of its kept versions, under its OLD id (so its
    history continues). It comes back UNPUBLISHED: publication is not content, and a link the
    owner's delete killed must not come back to life. ``None`` if the id is taken (it exists)."""
    if _stored(screen_id, user_id) is not None:
        return None
    now = int(time.time())
    with auth_db.get_connection() as c:
        taken = c.execute("SELECT 1 FROM screener_saved_screens WHERE id=?", (screen_id,)).fetchone()
        if taken:
            return None
        c.execute(
            "INSERT INTO screener_saved_screens "
            "(id,user_id,name,spec_json,is_public,share_token,created_at,updated_at) "
            "VALUES (?,?,?,?,0,NULL,?,?)",
            (screen_id, user_id, payload["name"], payload["spec_json"], now, now))
        c.commit()
    rec = get(screen_id, user_id)
    res = _version(user_id, rec, before=None, source="restore", restored_from=restored_from)
    return rec, res


def get_public(share_token):
    with auth_db.get_connection() as c:
        r = c.execute("SELECT * FROM screener_saved_screens WHERE share_token=? "
                      "AND is_public=1", (share_token,)).fetchone()
    return _row(r) if r else None




# ── CONJUNCTION STARTERS — where the bar-naming columns become a setup ──────
# 🔴 THE GAP THESE CLOSE. The 2026-08-24 wave shipped four columns that each
# answer ONE question about a bar: what SHAPE it is, what it DID, what it did
# RECENTLY, and what the higher timeframes say. Nothing joined them, and a
# trader does not act on any one of them alone.
#
# ⭐ A HAMMER IS NOISE. A hammer AT a 50-day reclaim, ON heavy volume, WITH a
# bullish weekly bar behind it is a setup. The columns were the hard part; the
# conjunction is a filter list, and it is what makes them usable.
#
# ⛔ EVERY SCREEN BELOW WAS RUN AGAINST A FULL REAL SNAPSHOT BEFORE SHIPPING and
# its hit count recorded in the comment beside it. A valid screen that returns
# nothing forever is indistinguishable from a quiet market
# (`lesson_a_valid_screen_can_return_nothing_forever`), and a starter that has
# never matched a row is a broken promise a member finds before we do.
#
# ⚠️ THE COUNTS ARE A SNAPSHOT, NOT A GUARANTEE. They say the screen is
# REACHABLE on a real tape, not that it fires every day — several of these
# describe genuinely uncommon events and SHOULD be empty on a quiet session.
#
# Measured 2026-08-24 against a full 3,707-row build (every hit count non-zero):
#   NR7 squeeze near the highs        144      Undercut & reclaim            38
#   Recent reversal, next open agreed 237      Weekly reversal candle        25
#   Pocket pivot off a base            56      Trapped sellers (hikkake)     22
#   Gap up and never looked back       21      Coiled near the highs         18
#   Failed breakout at the highs       16      Reversal candle at the 50-day  5
#   Monthly reversal candle             5      Heavy volume, no result        4
#
# ⛔ NONE OF THESE FILTER ON A COLUMN THAT CAN BE UNFILLED. `rs_rank`,
# `market_cap`, `pe_fwd`, `roe` and `eps_growth` are all NULL in the snapshot
# these were validated against, and eight of the PRE-EXISTING starters return
# zero rows because they gate on them. Sorting by such a column is safe-ish
# (arbitrary order); FILTERING on one returns nothing forever.

def _candle(key):
    """Candle Type filters query the delimiter-wrapped match set, never the
    rendered head — see `candle_catalog.encode_matches`."""
    from . import candle_catalog
    return {"key": "candle_type", "op": "contains",
            "value": candle_catalog.match_value(key)}


def candle_starters():
    return [
        {"id": "starter_reversal_at_the_50day",
         "name": "Reversal candle at the 50-day",
         "spec": {"filters": [
             {"key": "bar_character", "op": "eq", "value": "reclaimed-50-day"},
             {"key": "candle_trend", "op": "eq", "value": "down"},
             {"key": "vol_ratio", "op": "gte", "min": 1.2},
             {"key": "price", "op": "gte", "min": 5}],
          "view": "candles", "sort": {"key": "vol_ratio", "dir": "desc"}}},

        {"id": "starter_trapped_sellers",
         "name": "Trapped sellers (hikkake confirmed)",
         "spec": {"filters": [
             _candle("hikkake-bull-confirmed"),
             {"key": "above_50sma", "op": "eq", "value": 1},
             {"key": "dollar_vol_30d", "op": "gte", "min": 5_000_000}],
          "view": "candles", "sort": {"key": "rs_rank", "dir": "desc"}}},

        {"id": "starter_failed_breakout_short",
         "name": "Failed breakout at the highs",
         "spec": {"filters": [
             {"key": "bar_character", "op": "eq", "value": "failed-breakout"},
             {"key": "vol_ratio", "op": "gte", "min": 1.2},
             {"key": "price", "op": "gte", "min": 5}],
          "view": "candles", "sort": {"key": "vol_ratio", "dir": "desc"}}},

        {"id": "starter_coiled_and_ready",
         "name": "Coiled near the highs",
         "spec": {"filters": [
             {"key": "inside_bar_run", "op": "gte", "min": 2},
             {"key": "dist_52w_high_pct", "op": "gte", "min": -15},
             {"key": "dollar_vol_30d", "op": "gte", "min": 5_000_000}],
          "view": "candles", "sort": {"key": "rs_rank", "dir": "desc"}}},

        {"id": "starter_nr7_at_highs",
         "name": "NR7 squeeze near the highs",
         "spec": {"filters": [
             {"key": "nr7", "op": "eq", "value": 1},
             {"key": "dist_52w_high_pct", "op": "gte", "min": -10},
             {"key": "above_50sma", "op": "eq", "value": 1},
             {"key": "dollar_vol_30d", "op": "gte", "min": 5_000_000}],
          "view": "candles", "sort": {"key": "rs_rank", "dir": "desc"}}},

        {"id": "starter_undercut_reclaim",
         "name": "Undercut & reclaim",
         "spec": {"filters": [
             {"key": "bar_character", "op": "eq", "value": "undercut-and-reclaim"},
             {"key": "price", "op": "gte", "min": 5},
             {"key": "dollar_vol_30d", "op": "gte", "min": 5_000_000}],
          "view": "candles", "sort": {"key": "vol_ratio", "dir": "desc"}}},

        {"id": "starter_gap_and_go",
         "name": "Gap up and never looked back",
         "spec": {"filters": [
             {"key": "bar_character", "op": "eq", "value": "gap-up-and-go"},
             {"key": "vol_ratio", "op": "gte", "min": 1.5},
             {"key": "dollar_vol_30d", "op": "gte", "min": 5_000_000}],
          "view": "candles", "sort": {"key": "vol_ratio", "dir": "desc"}}},

        # ⚠️ NAMED FOR WHAT IT SELECTS. This was "Weekly reversal, daily
        # follow-through" while filtering for a DOWN daily trend — the opposite
        # of follow-through. A screen whose name disagrees with its filters
        # teaches the member the wrong thing about their own results.
        {"id": "starter_weekly_reversal",
         "name": "Weekly reversal candle",
         "spec": {"filters": [
             {"key": "candle_weekly", "op": "eq", "value": "bullish-engulfing"},
             {"key": "dollar_vol_30d", "op": "gte", "min": 5_000_000}],
          "view": "candles", "sort": {"key": "rs_rank", "dir": "desc"}}},

        # ⛔ THIS SCREEN NOW USES THE STRUCTURE, NOT THE BAR CHARACTER.
        # It read `bar_character == "pocket-pivot"`, which is the volume
        # signature alone, and compensated with `above_50sma` -- a reasonable
        # approximation while `base_catalog.POCKET_PIVOT` was crashing on every
        # symbol and therefore matching nothing. That is fixed, so the screen
        # can filter on the full published Morales/Kacher rule and its NAME is
        # true. `above_50sma` is dropped as REDUNDANT, not as a loosening: the
        # structure already requires price above both the 50- and 200-day, and
        # leaving it would put a second authority on the same condition.
        {"id": "starter_pocket_pivot",
         "name": "Pocket pivot off a base",
         "spec": {"filters": [
             {"key": "base_structure", "op": "contains", "value": ",pocket-pivot,"},
             {"key": "dist_52w_high_pct", "op": "gte", "min": -20},
             {"key": "dollar_vol_30d", "op": "gte", "min": 5_000_000}],
          "view": "candles", "sort": {"key": "rs_rank", "dir": "desc"}}},

        {"id": "starter_effort_no_result",
         "name": "Heavy volume, nothing to show for it",
         "spec": {"filters": [
             {"key": "bar_character", "op": "eq", "value": "churn"},
             {"key": "dollar_vol_30d", "op": "gte", "min": 10_000_000}],
          "view": "candles", "sort": {"key": "vol_ratio", "dir": "desc"}}},

        {"id": "starter_fresh_reversal_confirmed",
         "name": "Recent reversal, next open agreed",
         "spec": {"filters": [
             {"key": "candle_recent_bars_ago", "op": "lte", "max": 2},
             {"key": "candle_recent_status", "op": "eq", "value": "opened-with"},
             {"key": "dollar_vol_30d", "op": "gte", "min": 10_000_000}],
          "view": "candles", "sort": {"key": "rs_rank", "dir": "desc"}}},

        {"id": "starter_monthly_structure",
         "name": "Monthly reversal candle",
         "spec": {"filters": [
             {"key": "candle_monthly", "op": "eq", "value": "hammer"},
             {"key": "dollar_vol_30d", "op": "gte", "min": 5_000_000}],
          # ⚠️ sorts by dollar volume, not market cap: `market_cap` is unfilled
          # in the snapshot this was validated against, and an all-NULL sort key
          # silently returns the rows in arbitrary order.
          "view": "candles", "sort": {"key": "dollar_vol_30d", "dir": "desc"}}},
    ]


#: FT-022: the chart-pattern presets. Each is ONE engine detection, matched as
#: an exact token (the column is delimiter-wrapped, so ",head_shoulders," can
#: never match ",inverse_head_shoulders,"), on the Patterns view, strongest
#: detection first. The ids are the detectors' own `_PATTERN_ID`s -- the
#: preset rail checks every one against the registry, so a renamed detector
#: fails by name instead of shipping a preset that matches nothing.
PATTERN_PRESETS = (
    ("cup_handle", "Cup & Handle"),
    ("ascending_triangle", "Ascending Triangle"),
    ("symmetrical_triangle", "Symmetrical Triangle"),
    ("descending_triangle", "Descending Triangle"),
    ("bull_flag", "Bull Flag"),
    ("bear_flag", "Bear Flag"),
    ("pennant", "Pennant"),
    ("falling_wedge", "Falling Wedge"),
    ("rising_wedge", "Rising Wedge"),
    ("double_bottom", "Double Bottom"),
    ("double_top", "Double Top"),
    ("triple_bottom", "Triple Bottom"),
    ("triple_top", "Triple Top"),
    ("inverse_head_shoulders", "Inverse Head & Shoulders"),
    ("head_shoulders", "Head & Shoulders"),
    ("rounded_base", "Rounded Base"),
    ("rectangle", "Rectangle"),
    ("channel", "Channel"),
)

PATTERN_PRESETS_FLAG = "SCREENER_PATTERN_PRESETS_ENABLED"


def pattern_presets_enabled() -> bool:
    import os
    return os.environ.get(PATTERN_PRESETS_FLAG, "0").strip() == "1"

#: Member-facing one-liners for the pattern presets, keyed by detector id. Each says only what
#: the preset filters for: the pattern ENGINE detected that pattern on the stock. It names the
#: engine because the base read on each row's setup line is a different detector that shares
#: some of these names ("scanner" said neither).
PATTERN_DESCRIPTIONS = {
    "cup_handle": "Stocks with a cup and handle the pattern engine detected",
    "ascending_triangle": "Stocks with an ascending triangle the pattern engine detected",
    "symmetrical_triangle": "Stocks with a symmetrical triangle the pattern engine detected",
    "descending_triangle": "Stocks with a descending triangle the pattern engine detected",
    "bull_flag": "Stocks with a bull flag the pattern engine detected",
    "bear_flag": "Stocks with a bear flag the pattern engine detected",
    "pennant": "Stocks with a pennant the pattern engine detected",
    "falling_wedge": "Stocks with a falling wedge the pattern engine detected",
    "rising_wedge": "Stocks with a rising wedge the pattern engine detected",
    "double_bottom": "Stocks with a double bottom the pattern engine detected",
    "double_top": "Stocks with a double top the pattern engine detected",
    "triple_bottom": "Stocks with a triple bottom the pattern engine detected",
    "triple_top": "Stocks with a triple top the pattern engine detected",
    "inverse_head_shoulders": "Stocks with an inverse head and shoulders the pattern engine detected",
    "head_shoulders": "Stocks with a head and shoulders the pattern engine detected",
    "rounded_base": "Stocks with a rounded base the pattern engine detected",
    "rectangle": "Stocks trading in a rectangle the pattern engine detected",
    "channel": "Stocks trading in a channel the pattern engine detected",
}


def pattern_starters():
    return [
        {"id": f"starter_pattern_{pid}", "name": label, "group": "Chart Patterns",
         "description": PATTERN_DESCRIPTIONS[pid],
         "spec": {"filters": [{"key": "pattern_engine_id", "op": "contains",
                               "value": f",{pid},"}],
                  "view": "patterns",
                  "sort": {"key": "pattern_engine_conf", "dir": "desc"}}}
        for pid, label in PATTERN_PRESETS
    ]


def archive_starters():
    """"Names the team has called" (2026-10-16). Shown only while the trader
    archive is on: with it off `archive_calls_n` is blank on every row, so the
    screen would return nothing and read as "the team never called anything".
    Display-only context; it changes nothing about what any detector fires."""
    try:
        from api.services.wisdom.core import flags
        if not flags.archive_enabled():
            return []
    except Exception:  # noqa: BLE001 -- an unreadable gate shows nothing
        return []
    return [{
        "id": "starter_team_called", "name": "Names the team has called",
        "group": "Team archive",
        "description": "Stocks the trading team has called in the trader archive, most-called first",
        "spec": {"filters": [{"key": "archive_calls_n", "op": "gte", "min": 1}],
                 "view": "team",
                 "sort": {"key": "archive_calls_n", "dir": "desc"}}}]


#: Every starter screen is STOCKS ONLY (owner decision 3, 2026-10-14): the
#: momentum starters were topped by QQQ, SPY and closed-end funds. Expressed
#: exactly as the Type filter's own EXCLUDE control emits it
#: (`TypeFilterControl.jsx`: `{op: 'not_in', values: [...]}` over the buckets
#: `filters.FILTERS["security_type"]["options"]` declares). Closed-end funds and
#: ETNs fold into the "ETF" bucket (`screener_universe._coarse_type`), so
#: excluding ETF is what leaves both out. An ADR is a listed company's shares,
#: so it stays.
#: ⭐ EXCLUDE, NOT INCLUDE (2026-10-15): `in [Stock, ADR]` also dropped every row
#: whose type we simply do not hold (SQL `NULL IN (...)` is not true), so a stock
#: with an unknown type vanished from every starter. `not_in` keeps the NULL
#: explicitly (`query.build_where`), which is the "exclude funds" the owner asked
#: for. Measured on production 2026-10-15: 0 rows carry a NULL type today, so the
#: two forms return the same 5,787; the change is about the day one arrives.
STOCKS_ONLY = {"key": "security_type", "op": "not_in", "values": ["ETF"]}


def _stocks_only(starter):
    spec = dict(starter["spec"])
    spec["filters"] = [*spec.get("filters", []), dict(STOCKS_ONLY,
                                                      values=list(STOCKS_ONLY["values"]))]
    return {**starter, "spec": spec}


def premarket_starters():
    """The two Extended hours starters (spec 2026-10-16 §2, widened 2026-10-17). They
    screen on the extended-hours columns: pre-market before the open, after hours after the
    close, the last after-hours print overnight and on weekends; in the session both answer
    empty (the Focus empty state says why). The ids keep `premarket` so pinned screens
    survive. Shown only to users the flag reaches -- see `starters(user)`."""
    sort = {"key": "premarket_chg_pct", "dir": "desc"}
    return [
        {"id": "starter_premarket_gappers", "name": "Up in extended hours",
         "group": "Extended hours",
         "description": "Stocks up 3%+ before the open or after the close, $10M+ traded daily, price $5+. Before the open the move is against the prior close, after the close against today's close. No extended-hours volume is available.",
         "spec": {"filters": [
             {"key": "premarket_chg_pct", "op": "gte", "min": 3},
             {"key": "dollar_vol_30d", "op": "gte", "min": 10_000_000},
             {"key": "price", "op": "gte", "min": 5}],
          "view": "technical", "sort": dict(sort)}},
        {"id": "starter_premarket_setups", "name": "Setups moving in extended hours",
         "group": "Extended hours",
         # `base_pivot_px >= 0` is the PRESENCE test: SQL answers it only for a row
         # that holds a pivot, i.e. a stock with a base.
         "description": "Stocks with a base pivot, up 2%+ before the open or after the close, $10M+ traded daily. No extended-hours volume is available.",
         "spec": {"filters": [
             {"key": "base_pivot_px", "op": "gte", "min": 0},
             {"key": "premarket_chg_pct", "op": "gte", "min": 2},
             {"key": "dollar_vol_30d", "op": "gte", "min": 10_000_000}],
          "view": "technical", "sort": dict(sort)}},
    ]


def starters(user=None):
    """Every starter this user may see. The Extended hours pair joins only when
    `premarket.served_to(user)`; with no user that is a member's answer, so a caller
    that does not pass one fails closed at `admin`."""
    from api.services.screener import premarket  # noqa: PLC0415
    extra = premarket_starters() if premarket.served_to(user) else []
    return [_stocks_only(s) for s in [*_starter_defs(), *extra]]


def _live_volume_or_nightly(min_x):
    """Heavy volume TODAY in the session, LAST SESSION'S otherwise, as one group.

    🔴 THE DEFECT THIS REPLACES. Gap Movers and the 52-week breakout paired a LIVE
    gap / new high with `vol_ratio`, which is last night's completed session, so
    at 10:30 a stock gapping on light volume passed because yesterday was heavy,
    and today's real volume surge never counted.

    ⭐ The group reads `rvol_live` (volume vs usual BY NOW, live_tier) whenever it
    holds a value, and falls back to `vol_ratio` only when it does not (before
    09:45 ET, after the overlay stops serving, or for a symbol the sweep missed).
    `{"none": [rvol_live >= 0]}` is "rvol_live is blank": `logic.to_sql` is
    two-valued, so a row with no value fails `>= 0` and therefore passes none-of.
    A plain `any(rvol_live, vol_ratio)` would let yesterday's volume vouch for
    today in the session, which is the defect again.

    ⚠️ Needs `SCREENER_LOGIC_ENABLED` (armed on production; checked 2026-10-15 via
    `/api/screener/grammar` = 200). With it off the screen is REFUSED with a
    sentence, never run without its volume clause.
    """
    return {"any": [
        {"key": "rvol_live", "op": "gte", "min": min_x},
        {"all": [{"none": [{"key": "rvol_live", "op": "gte", "min": 0}]},
                 {"key": "vol_ratio", "op": "gte", "min": min_x}]},
    ]}


def _starter_defs():
    # ── UCT Preset Scans — the firm's curated setups ──────────────────────────
    # ⛔ candle_starters() is NO LONGER surfaced here (owner call, 2026-09-20):
    # the candle-shape wall was noise as a "preset scan" list. The function is
    # kept (tests/test_screener_builder.py exercises it directly, and it may be
    # re-surfaced), just not included below.
    # ⭐ THE SIX FLAGSHIP IDs + THEIR SPECS ARE PINNED by test_screener_saved.py
    # (`test_the_six_flagship_presets_ship_as_starters` + the unit-ruling test) —
    # keep the ids and the vol_nweek_low / dollar_vol literals exactly.
    # More can be added later; every entry must be a runnable spec (that rail
    # derives its check from THIS list).
    return [
        # UCT 50 — top 50 by composite rating (rank owns ordering; top_n caps).
        {"id": "starter_uct_50", "name": "UCT 50",
         "group": "Momentum leaders",
         "description": "The 50 stocks with the highest UCT composite rating",
         "spec": {"filters": [], "view": "uct_ratings",
                  "rank": {"criteria": [{"key": "uct_composite"}], "top_n": 50}}},
        # ── momentum / trend setups ──
        # Measured on production 2026-10-15 (stocks only): 103 before, 42 with the
        # full-bull stack + within 15% of the high. A full-bull stack is price >
        # SMA20 > SMA50 > SMA200 (identities.py), so "above the 50 day" is implied
        # and is no longer a separate clause.
        {"id": "starter_momentum_leaders", "name": "Leaders (RS ≥ 90)",
         "group": "Momentum leaders",
         "description": "RS 90+ stocks, MAs stacked, within 15% of the 52 week high, 4%+ daily range, $20M+ traded, price $5+",
         "spec": {"filters": [
             {"key": "rs_rank", "op": "gte", "min": 90},
             {"key": "ma_stack", "op": "eq", "value": "full-bull"},
             {"key": "dist_52w_high_pct", "op": "gte", "min": -15},
             {"key": "adr_pct", "op": "gte", "min": 4},
             {"key": "dollar_vol_30d", "op": "gte", "min": 20_000_000},
             {"key": "price", "op": "gte", "min": 5}],
          "view": "technical", "sort": {"key": "rs_rank", "dir": "desc"}}},
        # Measured on production 2026-10-15: the old +-2% + EMA stack + 2-week volume
        # low returned 7 (the volume low alone cut 42 to 5). A pullback INTO the
        # rising 20 EMA is a 3% dip to a 1% hold above it: 42 names.
        {"id": "starter_pullback_20ema", "name": "Momentum pullbacks (20EMA)",
         "group": "Momentum leaders",
         "description": "RS 80+ stocks 3% below to 1% above a rising 20 day EMA, above 50 day, $20M+ traded",
         "spec": {"filters": [
             {"key": "rs_rank", "op": "gte", "min": 80},
             {"key": "pct_vs_ema20", "op": "between", "min": -3, "max": 1},
             {"key": "ema20_rising", "op": "eq", "value": 1},
             {"key": "above_50sma", "op": "eq", "value": 1},
             {"key": "dollar_vol_30d", "op": "gte", "min": 20_000_000}],
          "view": "technical", "sort": {"key": "rs_rank", "dir": "desc"}}},
        # Measured on production 2026-10-15: close CV <= 2.5 passed 61% of liquid
        # stocks, so the old screen was not tight (126 names). CV <= 1.5 plus this
        # week's daily range below the 30-day one (field-to-field, `lt_col`) is a base
        # that is actually contracting: 48 names.
        {"id": "starter_tight_base", "name": "Tight bases near highs",
         "group": "Bases & chart patterns",
         "description": "RS 70+ stocks within 10% of the 52 week high, tight closes, range contracting, above 50 day, $20M+ traded",
         "spec": {"filters": [
             {"key": "dist_52w_high_pct", "op": "gte", "min": -10},
             {"key": "close_cv_pct", "op": "lte", "max": 1.5},
             {"key": "adr_pct_1w", "op": "lt_col", "other": "adr_pct"},
             {"key": "above_50sma", "op": "eq", "value": 1},
             {"key": "dollar_vol_30d", "op": "gte", "min": 20_000_000},
             {"key": "rs_rank", "op": "gte", "min": 70}],
          "view": "technical", "sort": {"key": "dist_52w_high_pct", "dir": "desc"}}},
        # ── named base structures (query the delimiter-wrapped match set) ──
        # The structure itself already holds above the 50 and 200 day (base_catalog's
        # definition), so the guards added here are liquidity and price. Production
        # 2026-10-15: 27 -> 12.
        {"id": "starter_base_pocket_pivot", "name": "Pocket pivots",
         "group": "Breakouts & entries",
         "description": "Stocks with an up day on more volume than any down day in 10 sessions, $10M+ traded, price $5+",
         "spec": {"filters": [{"key": "base_structure", "op": "contains", "value": ",pocket-pivot,"},
                              {"key": "dollar_vol_30d", "op": "gte", "min": 10_000_000},
                              {"key": "price", "op": "gte", "min": 5}],
                  "view": "bases", "sort": {"key": "rs_rank", "dir": "desc"}}},
        {"id": "starter_power_play", "name": "Power Plays",
         "group": "Momentum leaders",
         "description": "Stocks that doubled in eight weeks, then held within 20% of the high",
         "spec": {"filters": [{"key": "base_structure", "op": "contains", "value": ",power-play,"}],
                  "view": "bases", "sort": {"key": "rs_rank", "dir": "desc"}}},
        {"id": "starter_stage2_breakout", "name": "Stage-2 breakouts",
         "group": "Breakouts & entries",
         "description": "Stocks that broke the last swing high above a flat or rising 30 week average",
         "spec": {"filters": [{"key": "base_structure", "op": "contains", "value": ",stage-2-breakout,"}],
                  "view": "bases", "sort": {"key": "rs_rank", "dir": "desc"}}},
        # Production 2026-10-15: the bare structure matched 904 names, most of them
        # illiquid or falling; with RS 70+, above the 50 day and $10M+ it is 59.
        {"id": "starter_three_weeks_tight", "name": "Three weeks tight",
         "group": "Bases & chart patterns",
         "description": "Stocks with three weekly closes within 1.5% of each other, RS 70+, above 50 day, $10M+ traded",
         "spec": {"filters": [{"key": "base_structure", "op": "contains", "value": ",three-weeks-tight,"},
                              {"key": "rs_rank", "op": "gte", "min": 70},
                              {"key": "above_50sma", "op": "eq", "value": 1},
                              {"key": "dollar_vol_30d", "op": "gte", "min": 10_000_000}],
                  "view": "bases", "sort": {"key": "rs_rank", "dir": "desc"}}},
        # ── gaps / breakouts / events / value ──
        # Was P/E <= 20, ROE 15%+, EPS growth 15%+: 386 names on production
        # (2026-10-15 snapshot), so it filtered almost nothing, and `lte 20` also
        # let a NEGATIVE forward P/E (expected losses) through as "cheap". Every
        # threshold below is one this registry already publishes as a preset
        # (Forward P/E "Under 20", ROE "Over 25%", EPS Growth "Over 25%",
        # Operating Margin "Over 20%", Market Cap "Large (>$10B)"), so no new
        # number ships. Calibrated read-only on production 2026-10-16 against the
        # 2026-10-15 snapshot, stocks only: 386 before, 48 after (ROE 25 + EPS 25
        # + cap $10B without the margin: 75).
        {"id": "starter_value_quality", "name": "Cheap quality compounders",
         "group": "Quality & value",
         "description": ("Stocks with forward P/E under 20, ROE 25%+, EPS growth 25%+, "
                         "operating margin 20%+ and market cap $10B+"),
         "spec": {"filters": [
             {"key": "pe_fwd", "op": "between", "min": 0, "max": 20},
             {"key": "roe", "op": "gte", "min": 25},
             {"key": "eps_growth", "op": "gte", "min": 25},
             {"key": "op_margin", "op": "gte", "min": 20},
             {"key": "market_cap", "op": "gte", "min": 1e10}],
          "view": "valuation", "sort": {"key": "uct_composite", "dir": "desc"}}},
        # ── flagship presets (spec §7, owner-confirmed 2026-08-21) ──
        # Registry starters are the publication surface for these numbers —
        # FILTERS[…]["presets"] deliberately gains nothing (preset-free rails
        # stay binding). Two §7 literals were unit-corrected on the way in:
        #   * vol_nweek_low stores BAR COUNTS (20/15/10 = 4w/3w/2w low), so
        #     §7's "≥ 2" becomes `gte 10` ("2-week volume low or drier") —
        #     the literal 2 would pass the whole universe.
        #   * dollar_vol_30d holds RAW DOLLARS (measured 2026-08-22: MU row =
        #     price × avg_volume_30d = 3.909e10), so $20M/$10M pin as 2e7/1e7.
        # "Implied move present" = `gte 0`: SQL `>= 0` excludes NULL, which IS
        # presence — no new operator this wave (controller ruling, recorded).
        # (momentum_leaders / pullback_20ema / tight_base moved to the top of
        #  this list, renamed; their specs are unchanged.)
        # Both pair a LIVE gap / new high with volume; the volume is now live in the
        # session and last session's otherwise (`_live_volume_or_nightly`). Production
        # 2026-10-15 after the close (nightly branch): Gap Movers 1, 52-week breakout
        # 18, the same as the old specs, as they must be when no live value exists.
        {"id": "starter_gap_movers", "name": "Gap Movers",
         "group": "Momentum leaders",
         "description": "Stocks that gapped up 8%+ on 3x volume, live during the session, $300M+ market cap",
         "spec": {"filters": [
             {"key": "gap_pct", "op": "gte", "min": 8},
             {"key": "market_cap", "op": "gte", "min": 300_000_000}],
          "logic": _live_volume_or_nightly(3),
          "view": "momentum", "sort": {"key": "gap_pct", "dir": "desc"}}},
        {"id": "starter_52w_breakout", "name": "52-Week Breakout on Volume",
         "group": "Breakouts & entries",
         "description": "Stocks at a new 52 week high on 1.5x volume, live during the session, $10M+ traded daily",
         "spec": {"filters": [
             {"key": "new_52w_high", "op": "eq", "value": 1},
             {"key": "dollar_vol_30d", "op": "gte", "min": 10_000_000}],
          "logic": _live_volume_or_nightly(1.5),
          "view": "technical", "sort": {"key": "vol_ratio", "dir": "desc"}}},
        # ── live-volume starters (rvol_live: volume vs usual BY NOW) ──
        # ⭐ 2026-10-17: they use `_live_volume_or_nightly`, like Gap Movers: volume
        # vs usual BY NOW in the session, the LAST SESSION'S full-day ratio otherwise.
        # Members scan mostly after hours and on weekends, when rvol_live is blank and
        # these screens used to return nothing. The non-live clauses were measured on
        # production 2026-10-15 with last session's vol_ratio standing in for
        # rvol_live (a full-day ratio, the closest thing to "by now" at the close):
        #   Volume surge right now        529 without volume, 13 at vol_ratio >= 2
        #   Gapping up on volume           42 without volume,  5 at vol_ratio >= 1.5
        #   Near the 20-day high on vol   537 without volume, 41 at vol_ratio >= 1.5
        {"id": "starter_volume_surge_now", "name": "Volume surge right now",
         "group": "Momentum leaders",
         "description": "Stocks on 2x volume (live during the session, else prior day) up from the open, above 50 day, $20M+ traded, price $5+",
         "spec": {"filters": [
             {"key": "chg_from_open_pct", "op": "gt", "min": 0},
             {"key": "above_50sma", "op": "eq", "value": 1},
             {"key": "dollar_vol_30d", "op": "gte", "min": 20_000_000},
             {"key": "price", "op": "gte", "min": 5}],
          "logic": _live_volume_or_nightly(2),
          "view": "technical", "sort": {"key": "rvol_live", "dir": "desc"}}},
        {"id": "starter_gap_up_volume", "name": "Gapping up on volume",
         "group": "Momentum leaders",
         # Recalibrated 2026-10-16 from 3% after two in-session readings on production:
         # 6 at 09:52 and 6 at 10:09 ET (target 10-60); at 2% it was 14 at 09:52.
         "description": "Stocks gapped up 2%+ on 1.5x volume (live during the session, else prior day), $10M+ traded, price $5+",
         "spec": {"filters": [
             {"key": "gap_pct", "op": "gte", "min": 2},
             {"key": "dollar_vol_30d", "op": "gte", "min": 10_000_000},
             {"key": "price", "op": "gte", "min": 5}],
          "logic": _live_volume_or_nightly(1.5),
          "view": "technical", "sort": {"key": "gap_pct", "dir": "desc"}}},
        {"id": "starter_near_20d_high_volume", "name": "Near the 20-day high on volume",
         "group": "Breakouts & entries",
         "description": "Stocks within 3% of the 20 day high on 1.5x volume (live during the session, else prior day), above 50 day, $20M+ traded",
         "spec": {"filters": [
             {"key": "dist_20d_high_pct", "op": "gte", "min": -3},
             {"key": "above_50sma", "op": "eq", "value": 1},
             {"key": "dollar_vol_30d", "op": "gte", "min": 20_000_000}],
          "logic": _live_volume_or_nightly(1.5),
          "view": "technical", "sort": {"key": "rvol_live", "dir": "desc"}}},
        # Minervini's trend template, tightened to fit a working list: the textbook
        # cut (RS 70+, within 25% of the high, $20M+) returned 113 on production
        # 2026-10-15; RS 90+, within 15% and $50M+ returns 52.
        {"id": "starter_trend_template", "name": "Trend template",
         "group": "Momentum leaders",
         "description": "Stocks: MAs stacked, 30%+ above the 52 week low, within 15% of the 52 week high, RS 90+, 3%+ daily range, $50M+ traded",
         "spec": {"filters": [
             {"key": "ma_stack", "op": "eq", "value": "full-bull"},
             {"key": "dist_52w_low_pct", "op": "gte", "min": 30},
             {"key": "dist_52w_high_pct", "op": "gte", "min": -15},
             {"key": "rs_rank", "op": "gte", "min": 90},
             {"key": "adr_pct", "op": "gte", "min": 3},
             {"key": "dollar_vol_30d", "op": "gte", "min": 50_000_000}],
          "view": "technical", "sort": {"key": "rs_rank", "dir": "desc"}}},
        # ⛔ 2026-08-23: THIS PRESET RETURNED ZERO ROWS, ALWAYS — caught by
        # running all ten starters against prod rather than by any test.
        # Spec §7 asked for "implied move present", which shipped as
        # `implied_move_pct >= 0` (the presence ruling: `col >= 0` excludes
        # NULL). MEASURED on prod the same morning: `implied_move_pct` is
        # non-null on **0 of 3,745 rows**, so that clause is an unsatisfiable
        # AND — the other two criteria alone yield 38 names.
        # WHY the column is empty (stated to the limit of what was measured,
        # not further): `earnings_context` reads `implied_store`, which
        # captures the pre-report straddle *the night before* a report —
        # first-write-wins per (sym, report_date) — so coverage is inherently
        # sparse, and it was zero on this Sunday build. `IMPLIED_STORE_ENABLED`
        # IS set in prod. Whether a weekday build carries a handful of rows is
        # UNMEASURED; re-measure before treating the column as dead.
        # THE SUBSTITUTE: `optionable` carries the surviving intent — "this
        # name has a real options market for the event to be priced in" — and
        # it is REAL DATA (3,117 of 3,745, so it genuinely discriminates; the
        # preset yields 37 vs 38 unfiltered). It shipped in the Wave-6 finviz
        # parity pull and populated on its first night.
        {"id": "starter_earnings_momentum", "name": "Earnings Momentum",
         "group": "Earnings",
         "description": "Stocks that report within 7 days, have options, RS 70 or higher",
         "spec": {"filters": [
             {"key": "days_to_earnings", "op": "between", "min": 0, "max": 7},
             {"key": "optionable", "op": "eq", "value": 1},
             {"key": "rs_rank", "op": "gte", "min": 70}],
          "view": "events", "sort": {"key": "days_to_earnings", "dir": "asc"}}},
    ] + (pattern_starters() if pattern_presets_enabled() else []) + archive_starters()
