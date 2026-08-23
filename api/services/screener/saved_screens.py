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


def starters():
    return [
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
