"""Append-only decision ledger keyed (theme_id, sym, action). Survives across
runs so prior rejections suppress re-proposals and the CLI is resumable."""
import json
import sqlite3
import time


class Ledger:
    def __init__(self, path: str):
        self.path = path
        with self._conn() as c:
            c.execute(
                "CREATE TABLE IF NOT EXISTS decisions ("
                "theme_id TEXT, sym TEXT, action TEXT, decision TEXT, "
                "fields TEXT, at REAL, PRIMARY KEY (theme_id, sym, action))")

    def _conn(self) -> sqlite3.Connection:
        c = sqlite3.connect(self.path)
        c.row_factory = sqlite3.Row
        return c

    def record(self, theme_id, sym, action, decision, fields=None):
        with self._conn() as c:
            c.execute(
                "INSERT OR REPLACE INTO decisions "
                "(theme_id, sym, action, decision, fields, at) VALUES (?,?,?,?,?,?)",
                (theme_id, sym, action, decision, json.dumps(fields or {}), time.time()))

    def get(self, theme_id, sym, action):
        with self._conn() as c:
            r = c.execute(
                "SELECT * FROM decisions WHERE theme_id=? AND sym=? AND action=?",
                (theme_id, sym, action)).fetchone()
            if not r:
                return None
            d = dict(r)
            d["fields"] = json.loads(d["fields"] or "{}")
            return d

    def is_decided(self, theme_id, sym, action) -> bool:
        return self.get(theme_id, sym, action) is not None

    def rejected_keys(self) -> set:
        with self._conn() as c:
            return {(r["theme_id"], r["sym"], r["action"])
                    for r in c.execute(
                        "SELECT theme_id, sym, action FROM decisions WHERE decision='reject'")}
