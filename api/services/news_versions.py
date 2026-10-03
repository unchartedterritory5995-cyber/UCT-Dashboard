"""D-6 -- story versioning on the company-news store (Lane R, TERMINAL-NEXT).

What this records, and ONLY this: the company-news store upserts on
(provider, provider_id). When a re-ingest of the SAME provider id arrives with a
different headline, description or published time, the row is updated in place
-- and, while this surface is on, the PRIOR text is kept here first, with the
time we observed the change and which fields changed. That is a version we saw,
not one we guessed.

What this does NOT claim:
  * Retraction. None of the providers the store ingests (FMP news, SEC EDGAR
    originals, curated X) sends a retraction, correction or deletion field. A
    story we stop seeing is not a retracted story; the payload says
    `retraction.state = "not_tracked"` with that reason, every time, and never
    infers a retraction from absence. A removal channel (e.g. Benzinga's
    /removed-news) would be a NEW vendor and is owner-blocked.
  * "No longer returned by <provider>". The ingest is append/upsert only; it
    does not re-read a window to diff what disappeared, so we do not know that
    either, and we do not say it.

DARK behind NEWS_STORY_VERSIONS_ENABLED (read per call). Unset: nothing is
recorded, the route 404s, the panel shows no version column. Rollback = unset;
the table stays and is not read.
"""
from __future__ import annotations

import contextlib
import json
import os
import sqlite3
from datetime import datetime, timezone
from typing import Any

ENABLED_ENV = "NEWS_STORY_VERSIONS_ENABLED"

# The fields whose change makes a new version. Anything else (category,
# sentiment, event clustering) is OUR derivation and changes on our side.
VERSIONED_FIELDS = ("headline", "description", "published_at")

RETRACTION_STATEMENT = {
    "state": "not_tracked",
    "reason": ("None of the sources this feed reads (FMP news, SEC EDGAR, curated X) "
               "sends a retraction or correction flag, so a retraction cannot be "
               "shown. A story that stops appearing upstream is not marked: absence "
               "is not a retraction."),
}

_SCHEMA = """
CREATE TABLE IF NOT EXISTS news_item_versions (
  news_id      INTEGER NOT NULL,
  version_no   INTEGER NOT NULL,
  observed_at  TEXT NOT NULL,
  headline     TEXT NOT NULL DEFAULT '',
  description  TEXT NOT NULL DEFAULT '',
  published_at TEXT NOT NULL DEFAULT '',
  changed      TEXT NOT NULL DEFAULT '[]',
  PRIMARY KEY (news_id, version_no)
);
"""


def is_enabled() -> bool:
    """Read PER CALL. Unset means OFF."""
    return os.environ.get(ENABLED_ENV, "").strip() == "1"


def ensure_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(_SCHEMA)


def record_if_changed(conn: sqlite3.Connection, incoming: dict[str, Any]) -> list[str]:
    """Called by `store.upsert` INSIDE its write lock, on its connection, BEFORE
    the row is overwritten. Keeps the prior text when a versioned field differs.
    Returns the changed field names ([] = no new version). Never raises."""
    try:
        if not is_enabled():
            return []
        prov, pid = incoming.get("provider"), incoming.get("provider_id")
        if not prov or not pid:
            return []
        ensure_schema(conn)
        prior = conn.execute(
            "SELECT id, headline, description, published_at FROM news_items "
            "WHERE provider=? AND provider_id=?", (prov, pid)).fetchone()
        if prior is None:
            return []
        prior = dict(prior)
        changed = [f for f in VERSIONED_FIELDS
                   if (incoming.get(f) or "") != (prior.get(f) or "")
                   # an empty re-ingest is a provider omission, not an edit
                   and (incoming.get(f) or "") != ""]
        if not changed:
            return []
        nxt = conn.execute(
            "SELECT COALESCE(MAX(version_no), 0) + 1 FROM news_item_versions WHERE news_id=?",
            (prior["id"],)).fetchone()[0]
        conn.execute(
            "INSERT INTO news_item_versions (news_id, version_no, observed_at, headline, "
            "description, published_at, changed) VALUES (?,?,?,?,?,?,?)",
            (prior["id"], int(nxt), datetime.now(timezone.utc).isoformat(),
             prior.get("headline") or "", prior.get("description") or "",
             prior.get("published_at") or "", json.dumps(changed)))
        return changed
    except Exception:  # noqa: BLE001 -- versioning must never break ingest
        return []


def version_counts(conn: sqlite3.Connection, news_ids: list[int]) -> dict[int, int]:
    """Prior versions held per story (0 = only the current text was ever seen)."""
    if not news_ids:
        return {}
    ensure_schema(conn)
    marks = ",".join("?" for _ in news_ids)
    rows = conn.execute(
        f"SELECT news_id, COUNT(*) FROM news_item_versions WHERE news_id IN ({marks}) "
        f"GROUP BY news_id", list(news_ids)).fetchall()
    return {int(r[0]): int(r[1]) for r in rows}


def history(news_id: int) -> dict[str, Any] | None:
    """The story's current text plus every prior version we observed, newest
    first. None = no such story."""
    from api.services.news import store
    store._ensure_init()  # noqa: SLF001
    with contextlib.closing(store._connect()) as c:  # noqa: SLF001
        ensure_schema(c)
        cur = c.execute(
            "SELECT id, provider, headline, description, published_at, ingested_at, "
            "source_display FROM news_items WHERE id=?", (int(news_id),)).fetchone()
        if cur is None:
            return None
        rows = c.execute(
            "SELECT version_no, observed_at, headline, description, published_at, changed "
            "FROM news_item_versions WHERE news_id=? ORDER BY version_no DESC",
            (int(news_id),)).fetchall()
    cur = dict(cur)
    prior = []
    for r in rows:
        d = dict(r)
        try:
            d["changed"] = json.loads(d.get("changed") or "[]")
        except ValueError:
            d["changed"] = []
        # The time this text STOPPED being current is when we observed its
        # replacement; when it started is not known beyond first ingest.
        d["replaced_at"] = d.pop("observed_at")
        prior.append(d)
    return {
        "id": cur["id"],
        "source": cur.get("source_display") or "",
        "current": {"headline": cur["headline"], "description": cur["description"],
                    "published_at": cur["published_at"]},
        "first_ingested_at": cur.get("ingested_at") or "",
        "prior_versions": prior,
        "versioned_fields": list(VERSIONED_FIELDS),
        "retraction": dict(RETRACTION_STATEMENT),
    }
