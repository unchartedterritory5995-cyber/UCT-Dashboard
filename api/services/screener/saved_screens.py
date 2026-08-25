"""Saved + shareable screener screens, stored in the auth DB (with user data).

A screen is a serialized scan spec (filters + view + sort). ``starters`` are
built-in read-only screens shipped with the app.
"""
import json
import secrets
import time

from api.services import auth_db


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
    return get(new_id, user_id)


def list_for(user_id):
    with auth_db.get_connection() as c:
        rows = c.execute("SELECT * FROM screener_saved_screens WHERE user_id=? "
                         "ORDER BY updated_at DESC", (user_id,)).fetchall()
    return [_row(r) for r in rows]


def get(screen_id, user_id):
    with auth_db.get_connection() as c:
        r = c.execute("SELECT * FROM screener_saved_screens WHERE id=? AND user_id=?",
                      (screen_id, user_id)).fetchone()
    return _row(r) if r else None


def update(screen_id, user_id, **fields):
    cur = get(screen_id, user_id)
    if not cur:
        return None
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
    return get(screen_id, user_id)


def delete(screen_id, user_id):
    with auth_db.get_connection() as c:
        cur = c.execute("DELETE FROM screener_saved_screens WHERE id=? AND user_id=?",
                        (screen_id, user_id))
        c.commit()
        return cur.rowcount > 0


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

        {"id": "starter_pocket_pivot",
         "name": "Pocket pivot off a base",
         "spec": {"filters": [
             {"key": "bar_character", "op": "eq", "value": "pocket-pivot"},
             {"key": "above_50sma", "op": "eq", "value": 1},
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


def starters():
    return candle_starters() + [
        {"id": "starter_leaders_pullback", "name": "Leaders pulling back to 20EMA",
         "spec": {"filters": [
             {"key": "rs_rank", "op": "gte", "min": 80},
             {"key": "above_50sma", "op": "eq", "value": 1},
             {"key": "pct_vs_ema20", "op": "between", "min": -2, "max": 2}],
          "view": "technical", "sort": {"key": "rs_rank", "dir": "desc"}}},
        {"id": "starter_high_rs_bases", "name": "High-RS tight bases",
         "spec": {"filters": [
             {"key": "rs_rank", "op": "gte", "min": 80},
             {"key": "tight_consolidation", "op": "eq", "value": 1}],
          "view": "overview", "sort": {"key": "uct_composite", "dir": "desc"}}},
        {"id": "starter_gappers", "name": "Gappers holding gains",
         "spec": {"filters": [
             {"key": "gap_pct", "op": "gte", "min": 3},
             {"key": "above_50sma", "op": "eq", "value": 1}],
          "view": "overview", "sort": {"key": "gap_pct", "dir": "desc"}}},
        {"id": "starter_value_quality", "name": "Cheap quality compounders",
         "spec": {"filters": [
             {"key": "pe_fwd", "op": "lte", "max": 20},
             {"key": "roe", "op": "gte", "min": 15},
             {"key": "eps_growth", "op": "gte", "min": 15}],
          "view": "valuation", "sort": {"key": "uct_composite", "dir": "desc"}}},
        # ── the six flagship presets (spec §7, owner-confirmed 2026-08-21) ──
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
        {"id": "starter_momentum_leaders", "name": "Momentum Leaders",
         "spec": {"filters": [
             {"key": "rs_rank", "op": "gte", "min": 90},
             {"key": "adr_pct", "op": "gte", "min": 4},
             {"key": "dollar_vol_30d", "op": "gte", "min": 20_000_000},
             {"key": "price", "op": "gte", "min": 5},
             {"key": "above_50sma", "op": "eq", "value": 1}],
          "view": "technical", "sort": {"key": "rs_rank", "dir": "desc"}}},
        {"id": "starter_pullback_20ema", "name": "Pullback to the 20EMA",
         "spec": {"filters": [
             {"key": "rs_rank", "op": "gte", "min": 80},
             {"key": "pct_vs_ema20", "op": "between", "min": -2, "max": 2},
             {"key": "ema_stack_intact", "op": "eq", "value": 1},
             {"key": "vol_nweek_low", "op": "gte", "min": 10}],
          "view": "technical", "sort": {"key": "rs_rank", "dir": "desc"}}},
        {"id": "starter_tight_base", "name": "Tight Base Near Highs",
         "spec": {"filters": [
             {"key": "dist_52w_high_pct", "op": "gte", "min": -8},
             {"key": "close_cv_pct", "op": "lte", "max": 2.5},
             {"key": "vol_updown_ratio", "op": "gte", "min": 1},
             {"key": "rs_rank", "op": "gte", "min": 70}],
          "view": "technical", "sort": {"key": "dist_52w_high_pct", "dir": "desc"}}},
        {"id": "starter_gap_movers", "name": "Gap Movers",
         "spec": {"filters": [
             {"key": "gap_pct", "op": "gte", "min": 8},
             {"key": "vol_ratio", "op": "gte", "min": 3},
             {"key": "market_cap", "op": "gte", "min": 300_000_000}],
          "view": "momentum", "sort": {"key": "gap_pct", "dir": "desc"}}},
        {"id": "starter_52w_breakout", "name": "52-Week Breakout on Volume",
         "spec": {"filters": [
             {"key": "new_52w_high", "op": "eq", "value": 1},
             {"key": "vol_ratio", "op": "gte", "min": 1.5},
             {"key": "dollar_vol_30d", "op": "gte", "min": 10_000_000}],
          "view": "technical", "sort": {"key": "vol_ratio", "dir": "desc"}}},
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
         "spec": {"filters": [
             {"key": "days_to_earnings", "op": "between", "min": 0, "max": 7},
             {"key": "optionable", "op": "eq", "value": 1},
             {"key": "rs_rank", "op": "gte", "min": 70}],
          "view": "events", "sort": {"key": "days_to_earnings", "dir": "asc"}}},
    ]
