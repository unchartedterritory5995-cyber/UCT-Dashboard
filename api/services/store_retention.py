"""Arch 5-B.8 / TD-33: the store retention registry, visible to `disk_watchdog`.

`product-architecture.md` §5-B.8 sets two rules for every store; this module is the
first one: *"every store ships with a retention rule and is visible to
`disk_watchdog`"*. Before it, a retention rule lived only inside the module that
swept, so the volume watchdog could name the biggest directory on the disk but not
say whether anything was ever supposed to shrink it, and a sweep that deleted
MEMBER rows (an AI Search thread past the per-user cap, say) was declared nowhere.

What the registry is:

  * ONE row per store, keyed by the file's basename under the volume (the exact name
    `disk_watchdog.top_consumers` ranks), saying whether it holds MEMBER data, its
    retention rule in words, which TABLES an automatic sweep may delete rows from, and
    which function does the deleting.
  * `may_prune(store, table)`: the guard a sweep asks before it deletes. ⛔ FAILS
    CLOSED: an undeclared store or table answers False and the sweep deletes nothing.
    Retention never removes member data without a declared entry here.
  * `annotate(name)`: what `disk_watchdog` prints beside a top consumer, so a growing
    store with no retention rule reads "UNDECLARED" in the alert instead of nothing.

What it is NOT: a scheduler, or a deleter. It never deletes anything itself; deciding
what is expendable stays with the subsystem that wrote it (disk_watchdog's own rule).
A member's own delete (removing their post) is not retention and needs no entry.

Rails: tests/test_store_retention.py (every backed-up store is registered, every
declared sweep exists, the guard fails closed, the watchdog shows the annotation).
"""
from __future__ import annotations

import importlib
from dataclasses import dataclass

MEMBER = True
NOT_MEMBER = False


@dataclass(frozen=True)
class Retention:
    #: Registry key. For a store also in `store_backup.STORES`, the same name.
    name: str
    #: Basename under the volume, as `disk_watchdog.top_consumers` sees it.
    file: str
    member_data: bool
    #: The rule, in words a reader of a disk alert can act on.
    rule: str
    #: Tables an AUTOMATIC sweep may delete rows from. () = nothing is ever swept.
    prunes: tuple[str, ...] = ()
    #: "module:function" for each function that performs those deletions.
    sweeps: tuple[str, ...] = ()
    #: Where the path authority lives ("module:attr"), for the rail that pins `file`.
    path: str | None = None


REGISTRY: tuple[Retention, ...] = (
    # ── member-authored (store_backup CLASS_MEMBER) ──────────────────────────────
    Retention("community", "community.db", MEMBER,
              "kept indefinitely; rows leave only by the member's own action (unreact, unmute, unvote)",
              path="api.services.community_store:_db_path"),
    Retention("charts_layouts", "charts_layouts.db", MEMBER,
              "kept indefinitely; a layout leaves only when its owner deletes it",
              path="api.services.charts_layout_service:_DB_PATH"),
    Retention("user_definitions", "user_definitions.db", MEMBER,
              "kept indefinitely; no delete statement in the module",
              path="api.services.user_definitions:_DB_PATH"),
    Retention("theme_sets", "theme_sets.db", MEMBER,
              "kept indefinitely; a set leaves only when its owner deletes it",
              path="api.services.theme_sets:_db_path"),
    Retention("ai_search_member", "ai_search_member.db", MEMBER,
              "per-user caps: newest 100 threads (their turns go with them) and newest 200 saved "
              "answers; older rows are deleted on the next write by that member",
              prunes=("ais_threads", "ais_turns", "ais_saved"),
              sweeps=("api.services.ai_search_member:save_thread",
                      "api.services.ai_search_member:save_answer"),
              path="api.services.ai_search_member:_db_path"),
    Retention("discord_chart_prefs", "discord_chart_prefs.db", MEMBER,
              "kept indefinitely; a member's row leaves only on their own reset",
              path="api.services.discord_chart_prefs:_db_path"),
    Retention("wire_feedback", "wire_feedback.db", MEMBER,
              "kept indefinitely; no delete statement in the module",
              path="api.services.wire_feedback_store:_DB_PATH"),
    Retention("workspace_docs", "workspace_docs.db", MEMBER,
              "workspace documents kept; their VERSIONS are pruned by the owner's policy "
              "(window OR newest-N, protected versions never) and artefact versions keep the "
              "newest 10 after 60 s coalescing; every removal is logged in a prune_log table, "
              "and both sweeps run only while their flags are armed",
              prunes=("workspace_doc_versions", "artifact_versions"),
              sweeps=("api.services.workspace_doc_store:prune_versions",
                      "api.services.artifact_versions:_prune"),
              path="api.services.workspace_doc_store:_DB_PATH"),
    Retention("auth", "auth.db", MEMBER,
              "kept indefinitely; sessions leave on logout/expiry by token, accounts only by admin "
              "action. Backed up every 6 h (authdb_backup.py)"),
    # ── firm-curated / retained series ───────────────────────────────────────────
    Retention("modelbook", "modelbook.db", NOT_MEMBER,
              "curated; rows leave only by admin edit or an AI-catalyst regeneration",
              path="api.services.modelbook_service:_DB_PATH"),
    Retention("education", "education.db", NOT_MEMBER,
              "curated; rows leave only by admin edit (a member's own video note by that member)",
              path="api.services.education_service:_DB_PATH"),
    Retention("desk", "desk.db", NOT_MEMBER,
              "curated; duplicate Substack posts by URL are collapsed to the newest",
              prunes=("substack_posts",),
              sweeps=("api.services.desk_store:dedupe_posts",),
              path="api.services.desk_store:_DB_PATH"),
    Retention("screener_analyst", "screener_analyst.db", NOT_MEMBER,
              "retained series (TERM-073): the analyst timeline is kept because the vendor cannot "
              "re-serve it",
              path="api.services.screener.analyst_pass:get_db_path"),
    # ── operational series ──────────────────────────────────────────────────────
    Retention("tweets", "tweets.db", NOT_MEMBER,
              "rolling TWEET_RETENTION_DAYS (default 7) by created_at",
              prunes=("tweets",),
              sweeps=("api.services.tweet_cleanup:run_cleanup",),
              path="api.services.tweet_store:_DB_PATH"),
    Retention("rss_series", "rss_series.db", NOT_MEMBER,
              "TERM-014 RSS samples: newest 400 rows and nothing older than 90 days (OBS-5)",
              prunes=("rss_samples",),
              sweeps=("api.services.rss_series:prune",),
              path="api.services.rss_series:db_path"),
)

_BY_NAME = {r.name: r for r in REGISTRY}
_BY_FILE = {r.file: r for r in REGISTRY}


def get(name: str) -> Retention | None:
    return _BY_NAME.get(name)


def by_file(basename: str) -> Retention | None:
    return _BY_FILE.get(basename)


def may_prune(store: str, table: str) -> bool:
    """May an automatic sweep delete rows of `table` in `store`? ⛔ False for anything
    undeclared: the sweep then deletes nothing. Never raises."""
    try:
        entry = _BY_NAME.get(store)
        return bool(entry and table in entry.prunes)
    except Exception:
        return False


def annotate(basename: str) -> str:
    """The text `disk_watchdog` prints beside a top consumer."""
    entry = _BY_FILE.get(basename)
    if entry is None:
        return "retention: UNDECLARED"
    tag = "member" if entry.member_data else "non-member"
    swept = "swept" if entry.prunes else "never swept"
    return f"retention: {tag}, {swept}"


def resolve_sweep(spec: str):
    """Import a "module:function" sweep reference (the rail checks every one)."""
    mod, _, fn = spec.partition(":")
    return getattr(importlib.import_module(mod), fn)
