"""The Notebook telemetry events' prop schemas, applied on arrival by POST /api/j2/telemetry
(api/routers/journal_two.py `_sanitize_notebook_props`, which re-exports both names below).

Follow-up A fix round 1 (M4): moved here from the router, unchanged, so a reader (tools/notebook_usage_report.py,
the soak) can have the schema without importing the whole router module. ONE copy: the router imports it.
"""
from __future__ import annotations

from typing import Any

# Wave 6 (D14, S-3) — the seven Notebook events' prop schemas, applied on
# ARRIVAL. The client helper is a convention, not a wall: any lane can post to
# /telemetry with a raw fetch, and a free-text prop would land in activity_log
# verbatim. Same rules as the client's `sanitizeProps`: a key not listed is
# dropped; "num" must be a JSON number a double can hold and finite (rounded
# as JS Math.round does — a numeric STRING is not a number, and is dropped);
# "bool" must be a bool; an enum (a tuple) keeps a string only if it is one of
# its values, else 'other'. ⛔ ONE FACT IN TWO FILES: this dict and the client's
# EVENT_SCHEMAS are pinned by tests/test_notebook_telemetry_events.py, which
# PARSES the client source — change both or neither.
#
# The `save_failed` reason the client sends when the BROWSER itself reports no
# connection (`NoteEditorPage.jsx` `reportSaveFailed`: no status and
# `navigator.onLine === false`). Named once, here, because the Notebook SLO's
# stall count reads it too (`notebook_slo._offline_reason`): an offline retry
# streak is the member's network, not our outage. tests/test_notebook_slo.py pins
# it to the word the client source sends.
SAVE_FAILED_OFFLINE_REASON = "offline"
from api.services.journal_two.template_gallery import LISTED_ITEM_TYPES as _LISTED_LIBRARY_TYPES  # noqa: E402

NOTEBOOK_PROP_SCHEMAS: dict[str, dict[str, Any]] = {
    "note_open_ms": {
        "ms": "num",
        "source": ("list", "switcher", "link", "search", "deeplink", "new", "tasks", "mention"),
        "cached": "bool",
    },
    "save_failed": {
        "status": "num",
        "reason": ("network", "http", "conflict", "quota", SAVE_FAILED_OFFLINE_REASON, "too-large",
                   "unknown"),
        "offline": "bool",
        "retrying": "bool",
    },
    "conflict_forked": {
        "door": ("editor", "outbox", "restore", "board", "capture", "import", "unknown"),
        "queued": "bool",
    },
    "ask_used": {
        "scope": ("note", "notebook", "selection"),
        "inserted": "bool",
        "ms": "num",
    },
    "capture_used": {
        "target": ("current", "new", "inbox"),
        "widget": ("chart", "widget", "fact", "excerpt", "web", "quote", "unknown"),
    },
    "search_used": {
        "results": "num",
        "filters": "num",
        "mode": ("text", "tag", "ticker", "filter"),
        "ms": "num",
    },
    "switcher_used": {
        "results": "num",
        "rank": "num",
        "picked": "bool",
        "mode": ("title", "recent", "favorite", "create"),
    },
    # Wave 10 (10D, R-16). ⛔ `bulk_used.op` must stay NOTE_BATCH_OPS (railed:
    # tests/test_notebook_telemetry_events.py), `import_used.source` the importer
    # registry's adapter ids and `export_used.format` EXPORT_FORMATS + png/print
    # (railed client-side: app/src/pages/journal-2-0/lib/notebookTelemetry.test.js,
    # the "R-16 — every core action has an event that fires on its success" block).
    "save_success": {
        "door": ("editor", "outbox"),
        "queued": "bool",
    },
    "export_used": {
        "format": ("md", "html", "json", "docx", "png", "print"),
        "scope": ("note", "selection", "notebook"),
        "count": "num",
    },
    "import_used": {
        "source": ("uct-export", "evernote", "notion", "obsidian", "logseq", "keep", "file"),
        "created": "num",
        "updated": "num",
        "failed": "num",
    },
    "share_used": {
        "action": ("create", "copy", "revoke"),
    },
    "publish_used": {
        "action": ("publish", "unpublish", "copy"),
        "kind": ("note", "folder"),
        "door": ("editor", "sidebar"),
    },
    "writing_help_used": {
        "action": ("summarize", "rewrite", "continue", "translate", "autofill"),
        "scope": ("selection", "whole", "property"),
        "replaced": "bool",
    },
    "dictation_used": {
        "words": "num",
    },
    "bulk_used": {
        "op": ("move", "addTag", "removeTag", "favorite", "unfavorite", "trash", "restore",
               "archive", "unarchive", "renameTag"),
        "changed": "num",
        "failed": "num",
    },
    # P3a Task 11 — the community style library. `type` is "all" plus every type a member can list or filter by,
    # DERIVED from the gallery's own LISTED_ITEM_TYPES (wave 11, ruling W11-R17 c2), so a type the library gains is
    # counted the day it lands instead of reading as "other"; the client's one-line oneOf is held equal to it.
    "library_viewed": {
        "type": ("all", *_LISTED_LIBRARY_TYPES),
        "view": ("browse", "following", "author"),
    },
    "style_adopted": {
        "notify": "bool",
    },
    # P5 Task 6. ⛔ `block_used.kind` is journal_styles.BLOCK_KINDS' ids in that order (railed both ways by
    # tests/test_notebook_telemetry_events.py, with the client's one-line oneOf).
    "style_applied": {
        "via": ("new_note", "switch", "update"),
    },
    "style_created": {
        "via": ("editor", "duplicate", "from_note"),
    },
    "block_used": {
        "kind": ("chart", "preEntryChecklist", "priceStamps", "positionSizing", "myRules", "prepWire",
                 "prepEarnings", "prepMovers", "prepLevels", "tradeReview", "moodCheckIn", "marketcontext",
                 "reminder"),
    },
    # S16 / S20 (audit 2026-11-05). `names` is a COUNT of tickers, never the tickers.
    "first_run_completed": {
        "names": "num",
        "pack": ("swing", "day", "prop", "options", "earnings", "none"),
        "plan": "bool",
        "ms": "num",
    },
    "first_run_skipped": {
        "step": "num",
    },
    "first_live_widget": {
        "source": ("watchlist", "reporting", "first_run"),
        "names": "num",
    },
    "recap_written": {
        "created": "bool",
    },
    "trust_incident": {
        "kind": ("publish_undone", "widget_restored"),
        "ms": "num",
    },
    "today_opened": {
        "session": ("premarket", "open", "after_close", "closed"),
        "created": "bool",
    },
    # Follow-up A. Each enum equals the client's (tests/test_notebook_telemetry_events.py parses it); the client
    # rails each one against the place its ids are defined (app/.../lib/notebookUsage.test.js).
    "view_used": {
        "mode": ("list", "table", "board", "calendar", "tasks", "graph", "timeline"),
        "via": ("menu", "saved_view", "link"),
    },
    "list_layout_used": {
        "layout": ("rows", "cards"),
    },
    "menu_row_used": {
        "menu": ("new", "list_more", "view", "note_more", "note_ai", "format", "plus_sheet"),
        "row": ("blank", "template", "voice", "import", "reviews", "review_daily", "review_weekly", "review_monthly",
                "today_note", "ask_notebook", "journal_tools", "export", "remove_sample", "my_tools",
                "manage_templates", "list", "table", "board", "calendar", "tasks", "graph", "timeline", "rows",
                "cards", "more_views", "save_view", "saved_view", "starter_views", "rename_view", "delete_view",
                "ask_note", "writing_help", "font", "font_pick", "size", "size_pick", "color", "quote", "code",
                "attach", "divider", "find", "outline", "history", "duplicate", "make_thesis", "lock", "archive",
                "save_template", "open_beside", "trash", "export_png", "export_print", "export_md", "export_html",
                "export_json", "export_docx", "quick_note", "photo", "help"),
    },
    "today_door_used": {
        "door": ("list_button", "shortcut", "phone_row", "brief_start", "brief_open", "recap", "journal_panel"),
        "created": "bool",
    },
    "template_started": {
        "source": ("catalogue", "note_type", "own", "library"),
        "family": ("rituals", "research", "trades", "mind", "trade_plan", "daily_prep", "weekend_prep", "earnings",
                   "earnings_followup", "post_trade_review", "weekly_review", "thesis", "watchlist_note", "custom"),
    },
    "block_inserted": {
        "kind": ("chart", "watchlist", "themes", "scanner", "fundamentals", "breadth", "indexes", "marketcontext",
                 "aisearch", "news", "notebook", "profile", "alerts", "calendar", "optionsflow", "periodsort", "nhnl",
                 "nhnlPulse", "volumescan", "scatter", "tradeExchangeNews", "researchLibrary", "screener", "cot",
                 "modelbook", "tradeExchangeHeadline", "myWatchlistToday", "myNamesReporting", "tickerCard",
                 "myPnlStats", "myPositionsRisk", "myRulesCheck", "myMistakes", "marketOnMyNames", "tickerFlow",
                 "tradeRecap", "myPnlCalendar", "mySetupEdge", "myScreenToday", "roomBuzzOnMyNames",
                 "myEarningsReactions", "myTiltCheck", "myRevengeClean", "myPlanVsActual", "myRiskLeftToday",
                 "myPropFirm", "myGamePlan", "myAlertsFired", "preEntryChecklist", "priceStamps", "positionSizing",
                 "sizeCalc", "myRules", "prepWire", "prepEarnings", "prepMovers", "prepLevels", "tradeReview",
                 "moodCheckIn", "routine", "tracker", "custom"),
        "via": ("slash", "palette", "phone_plus"),
    },
    "panel_row_used": {
        "row": ("all_notes", "daily_brief", "favorites", "recents", "folder", "tag", "unfiled", "archived", "trash",
                "playbook", "search_tab"),
    },
    "notebook_route_opened": {
        "route": ("setups_board", "playbook", "research_page"),
    },
}
