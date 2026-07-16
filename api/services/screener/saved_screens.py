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
    ]
