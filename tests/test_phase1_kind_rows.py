"""Task 10.14 (spec §16.6, ruling W10-R1): phase 1 is unchanged.

Wave 10 adds the seven ready-made dedicated kinds as ROWS in tables phase 1 shares (`KIND_WAVE`, `KIND_TITLE`,
`ACCOUNT_KINDS`, `_BUILDERS`, the client's `WIDGET_KINDS`, the public `MARKET_DATA_VENDORS`). This rail holds the
15 phase 1 kinds' rows in each of them to a snapshot frozen before the seven landed, and the phase 1 request
keys to their exact tuple. A phase 1 row that moves -- a title, a wave, a builder swapped, a vendor verdict, a
client row's copy -- reds here, whatever else is added beside it.

The snapshot is literal on purpose: it is the record of what phase 1 WAS, never derived from the code it checks.
"""
from __future__ import annotations

import re
from pathlib import Path

from api.services.journal_two import notebook_widgets as nw
from api.services.journal_two import public_note_payload as pnp

ROOT = Path(__file__).resolve().parents[1]
CLIENT = ROOT / "app" / "src" / "pages" / "journal-2-0" / "lib" / "notebookWidgets.js"
CLIENT_SETS = ROOT / "app" / "src" / "pages" / "journal-2-0" / "lib" / "notebookSets.js"
CLIENT_FETCH = ROOT / "app" / "src" / "pages" / "journal-2-0" / "lib" / "notebookWidgetsFetch.js"
PHASE1_KEYS = ("symbol", "list", "from", "to", "month", "definitionId", "tradeId")

#: The 15 phase 1 kinds, in the client's menu order. (`builtWidget` is wave 8 and not a phase 1 kind.)
PHASE1 = ("myWatchlistToday", "myNamesReporting", "marketOnMyNames", "myScreenToday", "roomBuzzOnMyNames",
          "myEarningsReactions", "tickerCard", "tickerFlow", "myPnlStats", "myPositionsRisk", "myRulesCheck",
          "myMistakes", "tradeRecap", "myPnlCalendar", "mySetupEdge")

FROZEN_WAVE = {
    "myWatchlistToday": 1, "myNamesReporting": 1, "tickerCard": 1, "myPnlStats": 1, "myPositionsRisk": 1,
    "myRulesCheck": 2, "myMistakes": 2, "marketOnMyNames": 3, "tickerFlow": 3, "tradeRecap": 6,
    "myPnlCalendar": 6, "mySetupEdge": 6, "myScreenToday": 6, "roomBuzzOnMyNames": 6, "myEarningsReactions": 6,
}
FROZEN_TITLE = {
    "myWatchlistToday": "My watchlist today", "myNamesReporting": "My names reporting",
    "marketOnMyNames": "Market on my names", "tickerCard": "Ticker card", "tickerFlow": "Options flow on a ticker",
    "myPnlStats": "My P&L and stats", "myPositionsRisk": "My open positions and risk",
    "myRulesCheck": "My rules check", "myMistakes": "My recurring mistakes", "tradeRecap": "Trade recap",
    "myPnlCalendar": "My P&L calendar", "mySetupEdge": "My setup edge", "myScreenToday": "My screen today",
    "roomBuzzOnMyNames": "Room buzz on my names", "myEarningsReactions": "My earnings reactions",
}
FROZEN_ACCOUNT = frozenset({"myPnlStats", "myPositionsRisk", "myRulesCheck", "myMistakes", "tradeRecap",
                            "myPnlCalendar", "mySetupEdge"})
_NW = "api.services.journal_two.notebook_widgets"
FROZEN_BUILDERS = {
    "myWatchlistToday": (_NW, "_my_watchlist_today"), "myNamesReporting": (_NW, "_my_names_reporting"),
    "myPnlStats": (_NW, "_my_pnl_stats"), "myPositionsRisk": (_NW, "_my_positions_risk"),
    "myRulesCheck": (_NW, "_my_rules_check"), "myMistakes": (_NW, "_my_mistakes"),
    "tickerCard": (_NW, "_ticker_card"), "marketOnMyNames": (_NW, "_market_on_my_names"),
    "tickerFlow": (_NW, "_ticker_flow"), "tradeRecap": (_NW, "_trade_recap"),
    "myPnlCalendar": (_NW, "_my_pnl_calendar"), "mySetupEdge": (_NW, "_my_setup_edge"),
    "myScreenToday": (_NW, "_my_screen_today"), "roomBuzzOnMyNames": (_NW, "_room_buzz_on_my_names"),
    "myEarningsReactions": (_NW, "_my_earnings_reactions"),
}
#: Each client row's text after its id, whitespace collapsed (the row's wave, group, title, flags and copy).
FROZEN_CLIENT_ROWS = {
    "myWatchlistToday": ", wave: 1, group: 'open', title: 'My watchlist today', description: 'Your names: price, "
                        "move, earnings; refreshes', keywords: ['watchlist', 'names', 'today', 'premarket', 'prep']",
    "myNamesReporting": ", wave: 1, group: 'open', title: 'My names reporting', description: 'Earnings this week "
                        "with expected move', keywords: ['earnings', 'reporting', 'expected move', 'implied move']",
    "marketOnMyNames": ", wave: 3, group: 'open', title: 'Market on my names', description: 'Your names vs their "
                       "sector; refreshes', keywords: ['sector', 'leading', 'lagging', 'relative strength']",
    "myScreenToday": ", wave: 6, group: 'open', title: 'My screen today', pick: 1, description: \"Today's hits "
                     "from a screen you pick\"",
    "roomBuzzOnMyNames": ", wave: 6, group: 'open', title: 'Room buzz on my names', description: 'Your names in "
                         "the room'",
    "myEarningsReactions": ", wave: 6, group: 'open', title: 'My earnings reactions', description: 'Results and "
                           "the move after'",
    "tickerCard": ", wave: 1, group: 'plan', title: 'Ticker card', description: 'Price, levels, earnings date, your "
                  "history', keywords: ['ticker', 'card', 'symbol', 'levels', 'history']",
    "tickerFlow": ", wave: 3, group: 'plan', title: 'Options flow on a ticker', description: \"Today's biggest "
                  "options trades and bullish vs bearish premium\", keywords: ['flow', 'options', 'calls', 'puts']",
    "myPnlStats": ", wave: 1, group: 'review', title: 'My P&L and stats', description: 'Net P&L, win rate and "
                  "average R for a range', keywords: ['pnl', 'p&l', 'stats', 'win rate', 'review'], account: true",
    "myPositionsRisk": ", wave: 1, group: 'review', title: 'My open positions and risk', description: 'Size, open "
                       "P&L, distance to stop', keywords: ['positions', 'risk', 'stops', 'open'], account: true",
    "myRulesCheck": ", wave: 2, group: 'review', title: 'My rules check', description: 'Which rules you kept this "
                    "week', keywords: ['rules', 'discipline', 'checklist'], account: true",
    "myMistakes": ", wave: 2, group: 'review', title: 'My recurring mistakes', description: 'What your mistakes "
                  "cost, and the trend', keywords: ['mistakes', 'errors', 'cost', 'review'], account: true",
    "tradeRecap": ", wave: 6, group: 'review', title: 'Trade recap', pick: 1, account: true, description: 'Entry, "
                  "exit, R and a chart'",
    "myPnlCalendar": ", wave: 6, group: 'review', title: 'My P&L calendar', account: true, description: 'Your P&L "
                     "by day'",
    "mySetupEdge": ", wave: 6, group: 'review', title: 'My setup edge', account: true, description: 'Expectancy by "
                   "setup'",
}
FROZEN_VENDORS = {
    "myWatchlistToday": "mixed", "myNamesReporting": "mixed", "tickerCard": "mixed", "myPnlStats": "member-optin",
    "myPositionsRisk": "member-optin", "myRulesCheck": "member-optin", "myMistakes": "member-optin",
    "tradeRecap": "member-optin", "myPnlCalendar": "member-optin", "mySetupEdge": "member-optin",
    "marketOnMyNames": "mixed", "tickerFlow": "mixed", "myScreenToday": "mixed", "roomBuzzOnMyNames": "mixed",
    "myEarningsReactions": "mixed",
}


def _client_rows() -> list[tuple[str, str]]:
    """[(id, row text)] for each WIDGET_KINDS row, in file order, read from the client file."""
    src = CLIENT.read_text(encoding="utf-8")
    start = src.index("export const WIDGET_KINDS")
    block = src[start:src.index("])", start)]
    return [(k, " ".join(body.split())) for k, body in re.findall(r"\{ id: '(\w+)'(.*?)\}", block, flags=re.S)]


def test_phase1_kind_rows_unchanged():
    assert len(PHASE1) == 15 and set(PHASE1) == set(FROZEN_WAVE)                    # non-vacuity
    assert {k: nw.KIND_WAVE[k] for k in PHASE1} == FROZEN_WAVE
    assert {k: nw.KIND_TITLE[k] for k in PHASE1} == FROZEN_TITLE
    assert {k for k in PHASE1 if k in nw.ACCOUNT_KINDS} == FROZEN_ACCOUNT
    builders = nw._BUILDERS
    assert {k: (builders[k].__module__, builders[k].__qualname__) for k in PHASE1} == FROZEN_BUILDERS
    rows = _client_rows()
    client = dict(rows)
    assert {k: client[k] for k in PHASE1} == FROZEN_CLIENT_ROWS
    assert [k for k, _ in rows if k in FROZEN_CLIENT_ROWS] == list(PHASE1)          # the menu order holds too
    assert {k: pnp.MARKET_DATA_VENDORS[("widgetEmbed", k)] for k in PHASE1} == FROZEN_VENDORS
    assert nw.SETTING_KEYS == PHASE1_KEYS


def test_phase1_request_key_lists_unchanged():
    """Fix round 1 (review m-4): the other three phase 1 key lists the global constraint freezes. The router's
    PASS_PARAMS (what the phase 1 GET passes on) and the client's SETTINGS_KEYS (what a preset keeps) and REQUEST_KEYS
    (what See it now re-asks with), read from the client source, each equal to the frozen tuple."""
    import json
    from api.routers import notebook_widgets as router
    assert tuple(router.PASS_PARAMS) == PHASE1_KEYS
    sets_src = CLIENT_SETS.read_text(encoding="utf-8")
    m = re.search(r"export const SETTINGS_KEYS = Object\.freeze\((\[[^\]]*\])\)", sets_src)
    assert m, "SETTINGS_KEYS is no longer a frozen literal in notebookSets.js"
    assert tuple(json.loads(m.group(1).replace("'", '"'))) == PHASE1_KEYS
    fetch_src = CLIENT_FETCH.read_text(encoding="utf-8")
    # REQUEST_KEYS is SETTINGS_KEYS itself (one list), never a second literal
    assert re.search(r"^export const REQUEST_KEYS = SETTINGS_KEYS$", fetch_src, flags=re.M), "REQUEST_KEYS moved"
    assert len(re.findall(r"export const REQUEST_KEYS\b", fetch_src)) == 1
