"""A member's own lists as a SCREENING UNIVERSE — watchlists, flags, colours.

WHY THIS MODULE EXISTS
======================
The 2026-08-23 twelve-competitor benchmark's Tier-1 loss #3: *"We cannot screen
a watchlist. Everyone else can."* Seven of twelve rivals hold it — Finviz
(six colour-flag groups, combinable, plus an **Unflagged** complement),
TradingView, thinkorswim (Scan-in / Intersect-with / Exclude), Stock Rover,
Trade Ideas, ChartMill, TC2000. We had watchlists, a flagged list and colour
tags server-side, reaching every ticker cell through ``TickerActions``, and the
screener could use none of them.

⭐ IT IS SHAPED AS A FILTER, NOT AS A UNIVERSE PARAMETER, and that is the whole
design decision. Wave 4 already made scans a Scanner filter —
``{key: "scan", op: "in", value: hash}`` — with a per-user ``my_scans`` category
injected at ``meta(user_id)``. A second, parallel "universe" concept beside it
would be two mechanisms answering *"which symbols is this screen over?"*, which
is the defect this repo repeats most. So this is ``{key: "list", op: "in",
value: selector}`` and it composes with every other filter for free.

THE SELECTORS
=============
``wl:<id>``     one watchlist the CALLER OWNS
``flagged``     the caller's flagged list (``watchlists.is_flagged_list``)
``unflagged``   ⭐ the COMPLEMENT — Finviz's trick, and the reason it is worth
                copying: it is how you stop re-reviewing names you already
                triaged. Emits ``NOT IN``.
``tag:<colour>`` every symbol the caller has tagged that colour

OWNERSHIP IS A SECURITY BOUNDARY, NOT A FILTER
==============================================
⛔ Every read is scoped by ``user_id`` in the WHERE clause, never filtered after
the fact, and a selector naming a list the caller does not own REFUSES rather
than returning empty. "Empty" and "not yours" must not look the same: the first
is a screening answer, the second is an attempt to read another member's data,
and a silent empty would hide it from the logs as well as from the caller.

⛔ AN EMPTY LIST IS ZERO ROWS, NOT THE WHOLE UNIVERSE. This is K1 from the scan
branch, in a new place: the generic ``in``-branch treats an empty value list as
a no-op and drops the clause, which would silently widen a screen from "my six
names" to all 3,745. An empty list is a real, empty universe and emits ``1=0``.
An UNRESOLVABLE selector is a different fact and raises.
"""
from __future__ import annotations

import os
import sqlite3

#: Symbols one selector may resolve to before we refuse. ⚠️ MEASURED, not
#: guessed: the largest watchlist on this instance holds 1,921 symbols and the
#: mean is 10.6, while SQLite's own parameter ceiling is 32,766. 5,000 sits an
#: order of magnitude above the observed maximum and an order below the hard
#: limit, so it can only fire on something pathological — and when it does, it
#: says so instead of emitting SQL that would fail at bind time.
MAX_SYMBOLS = 5_000

FLAGGED = "flagged"
UNFLAGGED = "unflagged"
_WL_PREFIX = "wl:"
_TAG_PREFIX = "tag:"


class ListRefusal(ValueError):
    """A selector that cannot be resolved. Never an empty result."""


def _auth_db_path() -> str:
    """⛔ RESOLVED PER CALL, never captured at import. ``scan_store``'s header
    states the rule and the reason: a module-level ``os.environ.get`` is frozen
    at import, so a test that repoints the database gets the old one."""
    env = os.environ.get("AUTH_DB_PATH")
    if env:
        return env
    from api.services import auth_db
    return auth_db._DB_PATH


def _connect() -> sqlite3.Connection:
    """READ-ONLY. The screener has no business writing the auth database, and a
    URI that cannot is a stronger statement than a convention that should not."""
    uri = "file:%s?mode=ro" % os.path.abspath(_auth_db_path()).replace(os.sep, "/")
    conn = sqlite3.connect(uri, uri=True, timeout=5)
    conn.row_factory = sqlite3.Row
    return conn


def _rows(conn, sql, args):
    return [r[0] for r in conn.execute(sql, args) if r[0]]


def resolve(selector, user_id):
    """``(symbols, receipt)`` for one selector, scoped to ``user_id``.

    ``symbols`` is an UPPERCASED, de-duplicated, order-stable list — uppercased
    because ``screener_rows.ticker`` is, and a case mismatch would silently
    return nothing while looking like a working filter.

    The receipt carries ``complement: True`` for ``unflagged``, which the caller
    turns into ``NOT IN``. ⛔ It is the caller's job to honour that flag — a
    complement rendered as ``IN`` is the exact inverse of the requested screen
    and would look entirely plausible on screen.
    """
    if not isinstance(selector, str) or not selector.strip():
        raise ListRefusal("a list filter needs a selector")
    sel = selector.strip()
    if user_id in (None, "", 0):
        raise ListRefusal("a list filter needs a signed-in member")

    with _connect() as conn:
        if sel == FLAGGED or sel == UNFLAGGED:
            syms = _rows(conn,
                         "SELECT i.sym FROM watchlist_items i "
                         "JOIN watchlists w ON w.id = i.watchlist_id "
                         "WHERE w.user_id = ? AND w.is_flagged_list = 1",
                         (user_id,))
            label = "Flagged" if sel == FLAGGED else "Unflagged"
            return _finish(syms, {"selector": sel, "label": label,
                                  "complement": is_complement(sel)})

        if sel.startswith(_WL_PREFIX):
            wl_id = sel[len(_WL_PREFIX):].strip()
            # 🔴 THE ID IS OPAQUE TEXT, NEVER AN INT. `watchlists.id` is
            # `TEXT PRIMARY KEY` and production ids look like `4b9b2122-ddc`.
            # The first cut of this module called `int()` here and refused every
            # real watchlist on the box — and its tests PASSED, because the
            # fixture had declared `id INTEGER PRIMARY KEY`. A fixture that does
            # not match the shipped schema cannot fail on a schema mistake.
            if not wl_id:
                raise ListRefusal("a watchlist selector needs an id")
            # ⛔ OWNERSHIP IN THE WHERE CLAUSE. Fetching by id and comparing
            # user_id afterwards would work and would be wrong: the row would
            # already be in this process's memory.
            row = conn.execute(
                "SELECT name FROM watchlists WHERE id = ? AND user_id = ?",
                (wl_id, user_id)).fetchone()
            if row is None:
                raise ListRefusal(f"no watchlist {wl_id} for this member")
            syms = _rows(conn,
                         "SELECT sym FROM watchlist_items WHERE watchlist_id = ? "
                         "ORDER BY sort_order ASC, added_at DESC", (wl_id,))
            return _finish(syms, {"selector": sel, "label": row["name"] or "Watchlist",
                                  "complement": False})

        if sel.startswith(_TAG_PREFIX):
            colour = sel[len(_TAG_PREFIX):].strip().lower()
            if not colour:
                raise ListRefusal("a tag selector needs a colour")
            syms = _rows(conn,
                         "SELECT sym FROM ticker_tags WHERE user_id = ? AND "
                         "LOWER(color) = ?", (user_id, colour))
            return _finish(syms, {"selector": sel,
                                  "label": f"{colour.title()} tag",
                                  "complement": False})

    raise ListRefusal(f"unknown list selector {sel!r}")


def _finish(syms, receipt):
    seen = set()
    out = []
    for s in syms:
        u = str(s).strip().upper()
        if u and u not in seen:
            seen.add(u)
            out.append(u)
    if len(out) > MAX_SYMBOLS:
        raise ListRefusal(
            f"{receipt['selector']} resolves to {len(out)} symbols, over the "
            f"{MAX_SYMBOLS} cap")
    receipt = dict(receipt)
    receipt["symbols"] = len(out)
    # ⛔ EMPTY IS DISCLOSED, NOT SILENT. An empty list screens to nothing, which
    # is correct and is also indistinguishable on screen from a filter that did
    # not run — so the receipt says which it was.
    receipt["empty"] = not out
    return out, receipt


def is_complement(selector) -> bool:
    """⛔ THE ONE PLACE THAT DECIDES WHETHER A SELECTOR IS A COMPLEMENT.

    X15: `available()` offers `unflagged` and `scan_run.submit_run` ALWAYS
    refuses it — *"a complement (everything NOT on a list), not a list — a run
    needs a bounded set of names"*. A member picking "Unflagged (everything
    else)" from the run-now selector could therefore only ever be refused.

    ⭐ The option is not broken; its validity is CONTEXT-DEPENDENT. A complement
    is a perfectly good screen (it is a `NOT IN` in a WHERE clause) and a
    perfectly bad run universe (a run needs a bounded set). So the fix is not
    "stop offering it" and it is certainly not "filter it out in the client" —
    that would put a second authority on the selector grammar. It is: **the
    side that knows stamps its answer**, and each door decides for itself.

    `resolve()` already stamped `complement` on its receipt; `available()` did
    not, so a consumer holding only the option list had no way to tell. Both
    now ask this function, so the two doors cannot drift apart.
    """
    return selector == UNFLAGGED


def available(user_id):
    """Every selector this member can screen by, for ``meta(user_id)``.

    Returns ``[]`` for a signed-out caller and for any error — ⛔ an unreadable
    auth database costs one CATEGORY, never a 500 on the whole screener meta.
    That is the same guard ``_my_scans_entry`` states.
    """
    if user_id in (None, "", 0):
        return []
    try:
        with _connect() as conn:
            out = []
            flagged_n = conn.execute(
                "SELECT COUNT(*) FROM watchlist_items i JOIN watchlists w "
                "ON w.id = i.watchlist_id WHERE w.user_id = ? AND "
                "w.is_flagged_list = 1", (user_id,)).fetchone()[0]
            if flagged_n:
                out.append({"value": FLAGGED, "label": f"Flagged ({flagged_n})"})
                out.append({"value": UNFLAGGED, "label": "Unflagged (everything else)"})
            for r in conn.execute(
                    "SELECT w.id, w.name, COUNT(i.id) n FROM watchlists w "
                    "LEFT JOIN watchlist_items i ON i.watchlist_id = w.id "
                    "WHERE w.user_id = ? AND COALESCE(w.is_flagged_list, 0) = 0 "
                    "GROUP BY w.id ORDER BY w.name", (user_id,)):
                # A list with no symbols is still OFFERED — it is a real, empty
                # universe, and hiding it would make an empty screen look like a
                # missing feature.
                out.append({"value": f"{_WL_PREFIX}{r['id']}",
                            "label": f"{r['name'] or 'Untitled'} ({r['n']})"})
            for r in conn.execute(
                    "SELECT LOWER(color) c, COUNT(*) n FROM ticker_tags "
                    "WHERE user_id = ? GROUP BY LOWER(color) ORDER BY c",
                    (user_id,)):
                out.append({"value": f"{_TAG_PREFIX}{r['c']}",
                            "label": f"{str(r['c']).title()} tag ({r['n']})"})
            # ⭐ STAMPED ONCE, AT THE ONE EXIT (X15). Four option kinds are
            # built above; writing `is_complement(...)` into each of them
            # would be four hand-written copies of one rule, which is the
            # defect this fix exists to remove. Stamping here also means an
            # option kind added tomorrow is covered with no edit — and the
            # rail compares this flag against `resolve()`'s receipt, so the
            # two doors cannot drift.
            for o in out:
                o["complement"] = is_complement(o["value"])
            return out
    except Exception:  # noqa: BLE001 — see the docstring
        return []
