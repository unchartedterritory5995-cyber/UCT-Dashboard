"""Server-side scan: a JSON filter spec -> parametrized SQL over screener_rows.

All column names come from the registry (never from the client). Every value is
bound as a parameter, so the API surface is injection-safe.

This module also owns the READ PATH's live-tier overlay (`_Overlay.col_expr`,
the LEFT JOIN, `build_scan_sql`) and its disclosure (`live_tier_state` and the
`snapshot.live` block below). See the block comment above `_Overlay` for why
ONE expression builder serves SELECT, WHERE and ORDER BY alike, and the one
above `live_tier_state` for why the surface reads the tier's own facts rather
than recomputing any of its gates.
"""
import datetime as _dt
from zoneinfo import ZoneInfo

from . import filters, ranking, scan_store, snapshot_db

_ET = ZoneInfo("America/New_York")
_SORTABLE = set(snapshot_db.COLUMNS)
_MAX_PAGE = 500
_SCAN_KEY = "scan"
_LIST_KEY = "list"


# ═══════════════════════════════════════════════════════════════════════════
# THE OVERLAY, AND WHY ONE FUNCTION TURNS A COLUMN NAME INTO SQL
#
# The live tier recomputes a named subset of the snapshot's columns intraday
# into the side table `screener_live`. This is the half that reaches a member:
# a LEFT JOIN whose ON clause is the tier's OWN serve predicate, and ONE
# expression builder — `_Overlay.col_expr` — used by the SELECT list, the WHERE
# clause and the ORDER BY alike.
#
# ⛔⛔ THAT SINGLE BUILDER IS THE WHOLE POINT. A column that FILTERS on the
# nightly value while DISPLAYING the live one is this repo's signature defect in
# its purest form: the screen shows `chg_pct_1d = 6.4` and the member's
# `chg_pct_1d >= 3` filter drops the row, so the name never appears and the
# market looks quiet. Three code paths composing three expressions is exactly
# how that happens, and it is invisible to every test that checks one path.
# `tests/test_screener_live_read_path.py` pins all three against a marker so a
# call site that composes its own SQL goes RED BY POSITION.
#
# ⛔ AND THE OFF PATH IS THE PRE-OVERLAY STATEMENT. Rollback is
# `SCREENER_LIVE_TIER_ENABLED` unset — no deploy, no migration — so "off" must
# mean the SQL that shipped before this landed: no join, no COALESCE,
# `screener_live` never named (not even by the description), `SELECT *`
# preserved. That is mechanical — `build_scan_sql`'s output is compared to a
# FROZEN LITERAL of what `run_scan` emitted at `d3260685c`, never prose.
#
# ⚠️ ONE TEXTUAL DIFFERENCE, NAMED HERE SO NOBODY HAS TO REDISCOVER IT. One
# builder means one rendering, and the rendering that leaves the SELECT list and
# the ORDER BY byte-identical is the QUOTED identifier those two already used —
# so `build_where`'s `chg_pct_1d >= ?` became `"chg_pct_1d" >= ?`. Same
# identifier, same bound parameters, same rows, same plan. The alternative
# (bare) would have moved the bytes in two clauses instead of one and dropped
# quoting the base table has always had.
#
# ⛔ THE ROSTER IS THE WRITER'S. `live_tier.LIVE_COLUMNS` is the one declaration
# of which columns the overlay owns; retyping those 22 names here would be a
# second authority that drifts the day a 23rd lands. It is intersected with
# `snapshot_db.COLUMNS` for one reason only — a name that is not a real snapshot
# column would make EVERY scan raise, and a disclosure must never be able to
# take the screen down. (R15, the tier's own rail, is what fails BY NAME on such
# a typo; this intersection just refuses to be the thing that 500s.)
# ═══════════════════════════════════════════════════════════════════════════

#: The rows table is NOT aliased, deliberately. `scan_store.join_clause` emits
#: `h.ticker = screener_rows.ticker` — a fragment this module binds verbatim and
#: does not own — and SQLite hides the table name behind an alias, so
#: `FROM screener_rows r` would break every `{key:"scan"}` filter the moment the
#: overlay armed. The overlay gets the alias; the base table keeps its name.
_ROWS = "screener_rows"
_LIVE = "l"


class _Overlay:
    """Whether the live overlay participates in THIS statement — and the ONLY
    place a column name becomes SQL.

    An instance is built once per `run_scan` and threaded through every clause,
    so SELECT, WHERE and ORDER BY cannot disagree about which table a column's
    value comes from. `OFF` is the flag-off / tier-absent / tier-unreadable
    case and renders the pre-overlay SQL exactly.
    """
    __slots__ = ("on", "columns", "table", "predicate", "join_params", "reason")

    def __init__(self, on=False, columns=frozenset(), table=None,
                 predicate=None, join_params=(), reason=None):
        self.on = bool(on)
        self.columns = frozenset(columns)
        self.table = table
        self.predicate = predicate
        self.join_params = list(join_params)
        #: Why the overlay is not participating — reported, never silent, so an
        #: operator can tell "switched off" from "the tier could not answer".
        self.reason = reason

    # ── the one expression builder ───────────────────────────────────────────
    def col_expr(self, col: str) -> str:
        """The SQL that yields the SERVED value of `col`.

        ⛔ Every clause asks this and nothing else. `COALESCE(overlay, nightly)`
        for a column the tier owns, the nightly column for everything else, and
        the bare quoted identifier when the overlay is off (which is what the
        statement said before any of this existed).
        """
        if not self.on:
            return f'"{col}"'
        if col in self.columns:
            return f'COALESCE({_LIVE}."{col}", {_ROWS}."{col}")'
        return f'{_ROWS}."{col}"'

    def select_item(self, col: str) -> str:
        """`col_expr` in SELECT position. The alias is what keeps the response
        key the column's own name once the expression is a COALESCE; with the
        overlay off there is no expression to name, and the item is byte-for-byte
        what the pre-overlay SELECT list emitted."""
        expr = self.col_expr(col)
        return f'{expr} AS "{col}"' if self.on else expr

    def from_sql(self) -> str:
        """The FROM clause — handed to `describe_rows` too, never rebuilt there.

        The ON clause is the TIER's `serve_predicate_sql`, not a predicate
        composed here: *serve the overlay only where it describes a session
        strictly newer than the row's own anchor session*, plus the in-session
        age cutoff. Both halves are the writer's to define — a reader that
        re-derived them would disagree with the writer on precisely the days
        that matter (a dead sweeper, an overnight roll, a mixed snapshot).
        """
        if not self.on:
            return _ROWS
        return (f'{_ROWS} LEFT JOIN {self.table} {_LIVE} '
                f'ON {_LIVE}.ticker = {_ROWS}.ticker AND {self.predicate}')

    def extra_select(self) -> list:
        """The per-row provenance the disclosure reads: `live_row` (the 0/1 the
        Seal and the per-row dot key off), and the two facts that date it.

        ⭐ `live_asof` is stamped on the overlay ROW, so the newest one on a page
        is literally when the values on screen were derived — which is why
        `live_screen_state` prefers it over any cycle clock.
        """
        if not self.on:
            return []
        return [
            f'CASE WHEN {_LIVE}.ticker IS NOT NULL THEN 1 ELSE 0 END AS "live_row"',
            f'{_LIVE}.live_asof AS "live_asof"',
            f'{_LIVE}.anchor_bars_asof AS "anchor_bars_asof"',
        ]


#: The flag-off statement, and the fallback for every way the tier can fail to
#: answer. ⛔ Shared and never mutated (`_Overlay` has no setters).
OFF = _Overlay(reason="the live overlay is not participating in this statement")


def _table_exists(conn, name: str) -> bool:
    """Derived from `sqlite_master`, never assumed.

    A pod that arms `SCREENER_LIVE_TIER_ENABLED` against a `screener.db` built
    before the overlay table existed would otherwise raise `no such table` on
    EVERY member scan — a flag flip taking the whole screener down. One cheap
    read, and only when the flag is on.
    """
    try:
        row = conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name=? LIMIT 1",
            (name,)).fetchone()
    except Exception:  # noqa: BLE001 — an unreadable catalog reads as "no overlay"
        return False
    return row is not None


def _overlay(conn) -> _Overlay:
    """Decide ONCE, for this statement, whether the overlay is served.

    ⛔ EVERY GATE IS THE TIER'S OWN, READ OFF THE TIER: `enabled()` (per call,
    so a rollback lands on the next request with no deploy), `LIVE_COLUMNS`,
    `LIVE_TABLE`, `serve_predicate_sql()` and `min_serve_asof()`. Nothing here
    recomputes a session, a cutoff or a date comparison — the writer owns those
    and a second copy would disagree with it exactly when it mattered.

    ⛔ AND IT NEVER GUESSES TOWARD "LIVE". Anything unanswerable — the module
    absent, half-written, raising, naming no overlayable column, producing no
    predicate, or a database with no overlay table — returns `OFF`, which is
    the honest direction: nightly values, served correctly, and the disclosure
    beside them says so.
    """
    mod = _live_tier_module()
    if mod is None:
        return _Overlay(reason="the live tier is not installed on this pod")
    try:
        if not mod.enabled():
            return _Overlay(reason="the live overlay is switched off")
        table = str(mod.LIVE_TABLE)
        known = set(snapshot_db.COLUMNS)
        columns = frozenset(
            str(c) for c in (mod.LIVE_COLUMNS or ()) if str(c) in known)
        if not columns:
            return _Overlay(reason="the live tier declares no overlayable column")
        if not _table_exists(conn, table):
            return _Overlay(reason=f"{table} does not exist in this database")
        min_asof = mod.min_serve_asof()
        if min_asof is None:
            predicate = mod.serve_predicate_sql(live_alias=_LIVE, rows_alias=_ROWS)
            join_params = []
        else:
            predicate = mod.serve_predicate_sql(
                live_alias=_LIVE, rows_alias=_ROWS, min_asof_param="?")
            join_params = [float(min_asof)]
        if not isinstance(predicate, str) or not predicate.strip():
            return _Overlay(reason="the live tier produced no serve predicate")
    except Exception as e:  # noqa: BLE001 — an overlay must not take the screen down
        return _Overlay(reason=f"the live tier could not be read: {type(e).__name__}: {e}")
    return _Overlay(on=True, columns=columns, table=table,
                    predicate=predicate, join_params=join_params)


def _scan_clauses(f, clauses, params, scan_joins):
    """The my_scans join: the nightly hits-store intersected with screener_rows,
    disclosed per hash.

    Supersedes E4-A5 (see scan_results.py's header): the freshness objection
    is answered by DISCLOSURE — every joined hash reports its own as_of in
    scan_joins, and a hash with no receipt joins NOTHING and says so
    (applied: False == "first sweep tonight"). ⛔ K1: an unresolvable scan
    filter REFUSES — the generic in-branch's silent empty-values no-op would
    return the whole universe here.
    """
    if f.get("op") != "in":
        raise ValueError(f"bad op {f.get('op')} for scan")
    raw = f.get("value")
    hashes = raw if isinstance(raw, list) else [raw]
    hashes = [h for h in hashes if isinstance(h, str) and h.strip()]
    if not hashes or (isinstance(raw, list) and len(hashes) != len(raw)):
        raise ValueError("scan filter requires def_hash value(s)")
    # Dedupe AFTER validation: the len-mismatch guard above compares against
    # the RAW list, so a malformed mixed list (e.g. containing "") still
    # refuses; only a clean, hand-crafted repeat like ["H1","H1"] collapses
    # to one clause. First-seen order preserved.
    seen = set()
    hashes = [h for h in hashes if not (h in seen or seen.add(h))]
    # ONE batched read for every hash (the primitive's own contract: meta()
    # and this request path both run on the one shared loop — no N+1).
    covered = scan_store.latest_coverage_for(hashes, scan_store.SCAN_JOIN_TF)
    for h in hashes:
        latest = (covered.get(h) or {}).get("as_of")
        if latest is None:
            # Never swept (withheld is indistinguishable at the store, by
            # design): INERT and disclosed, per spec §4(c).
            if scan_joins is not None:
                scan_joins.append({"def_hash": h, "as_of": None, "applied": False})
            continue
        frag, frag_params = scan_store.join_clause(
            h, scan_store.SCAN_JOIN_TF, latest)
        clauses.append(frag)
        params.extend(frag_params)
        if scan_joins is not None:
            scan_joins.append({"def_hash": h, "as_of": latest, "applied": True})


def _list_clauses(f, clauses, params, list_joins, user_id):
    """The my_lists universe: a member's own watchlist / flag / colour as a
    `ticker IN (…)` pre-filter.

    ⛔ SEVERAL SELECTORS IN ONE FILTER **UNION**, and that is the opposite of
    the `scan` branch one screen up, so it is written down rather than left to
    be discovered. A scan is a CRITERION — two of them mean "both must hold",
    and each adds its own clause. A list is a UNIVERSE — picking "gold tag" and
    "blue tag" means "either", the way Finviz's six colour groups are
    "combinable as one universe". Intersecting two universes is still
    available: use two `list` filters, which AND like everything else here.

    ⛔ A COMPLEMENT CANNOT BE UNIONED. `unflagged` emits `NOT IN`, and mixing
    that into an OR with an `IN` produces a set almost nobody means and that
    reads as plausible on screen. It refuses instead.
    """
    from . import list_universe
    if f.get("op") != "in":
        raise ValueError(f"bad op {f.get('op')} for list")
    raw = f.get("value")
    sels = raw if isinstance(raw, list) else [raw]
    sels = [x for x in sels if isinstance(x, str) and x.strip()]
    if not sels or (isinstance(raw, list) and len(sels) != len(raw)):
        raise ValueError("list filter requires selector value(s)")
    seen = set()
    sels = [x for x in sels if not (x in seen or seen.add(x))]

    union, receipts, complement = [], [], None
    for sel in sels:
        try:
            syms, rc = list_universe.resolve(sel, user_id)
        except list_universe.ListRefusal as e:
            # ⛔ REFUSES, never returns everything. K1 from the scan branch: the
            # generic in-branch's empty-values no-op would widen the screen from
            # "my six names" to the whole universe, silently.
            raise ValueError(str(e)) from None
        if rc["complement"]:
            if len(sels) > 1:
                raise ValueError(
                    "the unflagged complement cannot be combined with another "
                    "list in one filter — use a second list filter")
            complement = rc
        union.extend(syms)
        receipts.append(rc)

    seen = set()
    union = [s for s in union if not (s in seen or seen.add(s))]
    if list_joins is not None:
        list_joins.extend(receipts)

    if complement is not None:
        if not union:
            # Nothing is flagged, so "everything else" is everything. A no-op
            # here is CORRECT, and it is disclosed in the receipt.
            return
        placeholders = ",".join("?" for _ in union)
        clauses.append(f"UPPER(ticker) NOT IN ({placeholders})")
        params.extend(union)
        return
    if not union:
        # An empty list is a real, empty universe — NOT an absent filter.
        clauses.append("1=0")
        return
    placeholders = ",".join("?" for _ in union)
    clauses.append(f"UPPER(ticker) IN ({placeholders})")
    params.extend(union)


def build_where(filter_specs, scan_joins=None, overlay=None, *,
                list_joins=None, user_id=None):
    """The WHERE clause — over the SERVED value of every column.

    ⛔ `overlay.col_expr(col)` IS THE ONLY WAY A COLUMN NAME BECOMES SQL HERE,
    and it is the same call the SELECT list and the ORDER BY make. A filter
    reading `screener_rows.chg_pct_1d` while the screen displays
    `COALESCE(l.chg_pct_1d, …)` is the second-authority defect this whole
    design exists to prevent: the member sees a number their own filter is
    silently disagreeing with, and the row they were looking for never arrives.

    ⚠️ THE `{key:"scan"}` BRANCH IS DELIBERATELY NOT OVERLAID, and it is not an
    oversight. It binds a whole `EXISTS (…)` fragment from `scan_store` rather
    than naming a column, and what that fragment reads is the NIGHTLY 05:00
    sweep's own receipt — overlaying it would turn a nightly answer into an
    intraday one, the same refusal `scan_evaluator` itself carries (spec §10).
    (⛔ And the fragment stays the store's: this module restates none of its
    SQL — `test_the_fragment_is_the_stores_never_restated` scans this file's
    SOURCE, so even naming that table in a comment goes red.)

    `overlay` defaults to `OFF`, which renders the quoted identifier alone — so
    every caller that predates the overlay (and every test of the clause in
    isolation) gets the pre-overlay statement.
    """
    overlay = overlay or OFF
    clauses, params = [], []
    for f in filter_specs or []:
        key, op = f.get("key"), f.get("op")
        if key == _SCAN_KEY:
            _scan_clauses(f, clauses, params, scan_joins)
            continue
        if key == _LIST_KEY:
            # ⛔ `user_id` is the CALLER'S, threaded from the authenticated
            # session — never read off the client-supplied spec. A spec that
            # could name its own user_id would let any member screen any other
            # member's watchlist.
            _list_clauses(f, clauses, params, list_joins, user_id)
            continue
        name = filters.column_for(key)
        if not name:
            raise ValueError(f"unknown filter key: {key}")
        if not filters.is_valid_op(key, op):
            raise ValueError(f"bad op {op} for {key}")
        col = overlay.col_expr(name)
        if op in filters.COL_OPS:
            # 🔴 FIELD-TO-FIELD (benchmark metric 423). The right-hand side is a
            # FILTER KEY, resolved through the registry exactly like the left —
            # never a column name off the request. `_distinct_options` states the
            # rule: the registry is the only thing that may name a column.
            other_key = f.get("other")
            other_name = filters.column_for(other_key)
            if not other_name or other_key not in filters.comparable_keys():
                raise ValueError(
                    f"bad comparison field {other_key!r} for {key}")
            # ⛔ BOTH SIDES THROUGH `col_expr`. A comparison that read the raw
            # column on one side and the overlaid value on the other would be the
            # second-authority defect this whole module exists to prevent — the
            # member would see two numbers and a filter silently disagreeing with
            # both.
            clauses.append(
                f"{col} {filters.COL_OPS[op]} {overlay.col_expr(other_name)}")
            # ⚠️ NO PARAMS, and no NULL guard: SQL comparison against NULL is
            # NULL, so a row missing either side simply does not match. That is
            # the honest answer — "we cannot compare what we do not hold" — and
            # it is the same contract every other operator here already has.
            continue
        if op == "gte":
            clauses.append(f"{col} >= ?"); params.append(f["min"])
        elif op == "lte":
            clauses.append(f"{col} <= ?"); params.append(f["max"])
        elif op == "gt":
            clauses.append(f"{col} > ?"); params.append(f["min"])
        elif op == "lt":
            clauses.append(f"{col} < ?"); params.append(f["max"])
        elif op == "between":
            clauses.append(f"{col} >= ?"); params.append(f["min"])
            clauses.append(f"{col} <= ?"); params.append(f["max"])
        elif op == "eq":
            clauses.append(f"{col} = ?"); params.append(f["value"])
        elif op == "in":
            vals = f.get("values") or []
            if vals:
                clauses.append(f"{col} IN ({','.join('?' for _ in vals)})")
                params.extend(vals)
        elif op == "contains":
            clauses.append(f"{col} LIKE ?"); params.append(f"%{f['value']}%")
        else:
            raise ValueError(f"unhandled op {op}")
    where = (" WHERE " + " AND ".join(clauses)) if clauses else ""
    return where, params


# ═══════════════════════════════════════════════════════════════════════════
# THE LIVE TIER, AS THE MEMBER'S SURFACE SEES IT
#
# The live tier re-derives a NAMED SUBSET of the snapshot's columns from the
# live price during the regular session and serves them as an overlay. Two
# facts about that are the member's business, and a screen that states neither
# is a lie of omission:
#
#   1. WHICH COLUMNS on screen are live, and AS OF WHEN.
#   2. That everything else -- and, when the overlay is not running, EVERY
#      column -- is last night's 03:00 build.
#
# ⛔ NOTHING HERE RECOMPUTES A GATE THE TIER ALREADY OWNS. Not the flag, not
# the serve predicate, not the freshness cutoff. `live_tier.enabled()` answers
# "is it on"; the sweeper's own receipt answers "when did it last run"; the
# SERVED ROWS answer "did any of it reach this screen". A surface that
# re-derived "is it serving?" from an env var and a clock would be a second
# authority over the writer's own decision -- this repo's most repeated defect
# -- and it would disagree with the writer on precisely the days that matter
# (a holiday abort, a dead sweeper, a mid-session flag flip).
#
# ⛔ AND IT NEVER GUESSES IN THE DIRECTION OF "LIVE". Three refusals:
#   * the tier module is absent            -> the screen says NIGHTLY (true)
#   * the tier is on, receipt unreadable   -> the STATUS says `unreadable`,
#     never `off`. "I cannot tell" and "it is off" are different facts, and
#     collapsing them is how a broken accessor would read as a healthy screen.
#   * the tier is on but no served row carries a live value -> the SCREEN says
#     NIGHTLY, because what is on screen is what the member acts on. The tier's
#     own state ships beside it (`live.tier`) so an operator can see the
#     disagreement instead of the member inheriting it.
# ═══════════════════════════════════════════════════════════════════════════

#: The one sentence that says what a live column is measured AGAINST, from ONE
#: template so the general form and the dated form cannot drift apart. Owned
#: server-side so the API and the toolbar cannot phrase the anchor contract
#: differently -- the surface renders this string, it does not compose its own.
#: (Spec §1.5: every live column is f(live tick, a level from sessions COMPLETED
#: through the row's `bars_asof`); today's developing session is never folded in.)
_ANCHOR_NOTE_TMPL = (
    "Levels — moving averages, 52-week and 20-day extremes, pattern entry and "
    "stop — are from {basis} and do not move during the day. Only the "
    "price-derived columns below are live."
)
#: The general form: correct on ANY page, including a mixed one.
LIVE_ANCHOR_NOTE = _ANCHOR_NOTE_TMPL.format(basis="each row's last completed session")


def anchor_note(anchor_date=None) -> str:
    """The anchor sentence, naming the DATE when one date is true of the whole
    page (spec §8.1 / §13 receipt 4) and generalising when it is not.

    ⛔ A representative date is not an option here. `bars_asof` is per row and
    `describe_rows.mixed` exists precisely because a page can hold three of
    them; picking one would print *"levels from the 2026-08-22 close"* over
    rows anchored to 2026-08-19. One date, or none.
    """
    if not anchor_date:
        return LIVE_ANCHOR_NOTE
    return _ANCHOR_NOTE_TMPL.format(basis=f"the {anchor_date} close")


# ⛔ TWO TIMESTAMPS, AND CONFLATING THEM DATES THE OVERLAY WITH THE WRONG CLOCK.
#
# A sweep receipt carries BOTH "when did the last cycle run" and "when were the
# values now on screen derived", and in the real `live_tier` they are routinely
# HOURS apart:
#
#   * `swept_at` is stamped by `_blank_receipt()` on EVERY cycle, including the
#     ones that write nothing (`skipped_reason="disabled" / "not_regular_session"
#     / "build_in_flight"`, and the holiday abort). `sweep_job()` overwrites
#     `_LAST_RECEIPT` with those skip receipts.
#   * `as_of` is set ONLY on a cycle that actually wrote rows, and it is
#     literally the `live_asof` stamped onto each overlay row.
#
# So at 19:24 on a day whose last real sweep was 15:59, the newest receipt is a
# `not_regular_session` skip with `swept_at = now` and `as_of = None`, while the
# rows still being served are four hours old. Reading `swept_at` as the served
# as-of would print *"⚡ LIVE 19:24:48 ET"* over 15:59 prices — a fabricated
# freshness claim, which is constraint 1 broken in the one direction that
# matters. A weekend is worse: Friday's overlay dated with Saturday's clock.
#
# Hence: `as_of` NEVER comes from a cycle clock. `swept_at` is still reported —
# it is a real operator fact and the controller reads it — under its own name.
#: Where the OVERLAY's own timestamp may live, most-specific first.
_AS_OF_KEYS = ("as_of", "live_asof", "overlay_asof", "generated_at")
#: Where the LAST CYCLE's clock may live. ⛔ Never a fallback for the above.
_SWEPT_AT_KEYS = ("swept_at", "cycle_at", "ran_at")


def _live_tier_module():
    """Import the sibling lane's `live_tier`, or None.

    Catches Exception, not just ImportError: a module that is present but
    raises at import time must read as "not available", never crash a scan.
    """
    try:
        from api.services.screener import live_tier  # noqa: PLC0415
        return live_tier
    except Exception:  # noqa: BLE001 — a disclosure must not break the screen
        return None


#: The accessor the shipped `live_tier` exposes today. Tried BY NAME first so
#: the member request path calls exactly this and nothing else; the derivation
#: below is the fallback for a tier that names it differently.
_RECEIPT_ACCESSOR = "last_receipt"


def _live_receipt(mod):
    """The sweeper's last receipt: the known accessor first, derivation second.

    ⛔ THE DERIVATION IS A FALLBACK, NOT THE FIRST MOVE, AND THAT ORDER IS THE
    GUARD. This runs on the MEMBER REQUEST PATH -- every `run_scan`, every
    `snapshot-status` -- and the fallback CALLS what it finds. The substring
    match is all that stands between it and `run_sweep()`, which is public and
    zero-arg; the day the engine lane adds `reset_receipt()` or
    `refresh_receipt()`, a member's scan would invoke it. Reading
    `last_receipt` directly means that on the shipped module nothing else is
    ever touched, and `tests/test_screener_live_surface.py` pins the REAL
    module's candidate set to exactly `{"last_receipt"}` so a new public name
    fails BY NAME instead of being called.

    ⛔ The accessor is still the sibling lane's to name. Hard-coding one guess
    and then reading that guess's absence as "the tier is off" is exactly the
    lie this surface exists to prevent, so when `last_receipt` is missing the
    candidates are DERIVED from the module (`dir()`), every name carrying
    "receipt" is tried in a stable order, and the name that answered is
    REPORTED (`receipt_source`) alongside the ones that were tried
    (`receipt_candidates`). If the tier is on and nothing answers, the state is
    `unreadable` -- named, not silently off.

    ⛔ PUBLIC NAMES ONLY, AND THAT RESTRICTION IS LOAD-BEARING -- IT CAUGHT A
    REAL FABRICATION. `live_tier` carries `_blank_receipt(**over)`: a private
    FACTORY that returns a fresh, all-zero receipt stamped `swept_at =
    time.time()`. It takes no required argument, its name contains "receipt",
    and it sorts BEFORE the real `last_receipt` -- so a probe that walked
    private names manufactured a sweep that never happened, timestamped NOW,
    and the surface reported it as the live tier's as-of (measured 2026-08-23,
    against the real module). A private helper is not a contract; a factory is
    not a fact. Only public names are considered, and a tier that exposes its
    receipt privately reads as `unreadable` -- the honest direction.

    ⚠️ The fallback still CALLS what it finds, so the substring stays the
    guard there. Widen the match at your peril.

    Returns ``(receipt|None, source_name|None, candidates)``.
    """
    try:
        names = sorted(n for n in dir(mod)
                       if "receipt" in n.lower() and not n.startswith("_"))
    except Exception:  # noqa: BLE001
        return None, None, []
    ordered = ([_RECEIPT_ACCESSOR] if _RECEIPT_ACCESSOR in names else []) + \
              [n for n in names if n != _RECEIPT_ACCESSOR]
    for name in ordered:
        try:
            attr = getattr(mod, name)
            value = attr() if callable(attr) else attr
        except Exception:  # noqa: BLE001 — wrong arity / not ready yet
            continue
        if isinstance(value, dict) and value:
            return value, name, names
        if name == _RECEIPT_ACCESSOR:
            # The contract answered "no sweep yet". That is an ANSWER, and
            # groping at the other public names after it would be the very
            # invocation this ordering exists to avoid. (A RAISING accessor is
            # different — it answered nothing, so the fallback still runs.)
            return None, None, names
    return None, None, names


def _receipt_stamp(receipt, keys):
    """``(value, key)`` for the first of `keys` a receipt carries — a unix float
    or an already-formatted string, whichever the writer used. Honest-None when
    none is present.

    ⛔ `keys` is passed in, never defaulted: the caller must say WHICH clock it
    is asking for. See the `_AS_OF_KEYS` comment — the overlay's timestamp and
    the cycle's timestamp are different facts and one silently standing in for
    the other is a fabricated freshness claim.
    """
    if not isinstance(receipt, dict):
        return None, None
    for key in keys:
        value = receipt.get(key)
        if isinstance(value, bool):
            continue
        if isinstance(value, (int, float)) and value > 0:
            return float(value), key
        if isinstance(value, str) and value.strip():
            return value.strip(), key
    return None, None


def _et_clock(as_of):
    """A member-readable ET wall clock for `as_of`, or None. A string as_of is
    passed through untouched — reformatting a timestamp we did not parse would
    be inventing precision."""
    if isinstance(as_of, str):
        return as_of
    if isinstance(as_of, (int, float)) and not isinstance(as_of, bool):
        try:
            return _dt.datetime.fromtimestamp(as_of, _ET).strftime("%H:%M:%S ET")
        except (OverflowError, OSError, ValueError):
            return None
    return None


def live_tier_state() -> dict:
    """What the LIVE TIER itself is doing — facts, read off the tier.

    `state` is one of:
      * ``unavailable`` — the module is not installed on this pod
      * ``off``         — installed, `enabled()` is false (the shipped default)
      * ``on``          — installed, enabled, and its last receipt was read
      * ``unreadable``  — installed and enabled, but NO receipt could be read.
                          ⛔ This is deliberately not `off`: the overlay may be
                          writing while this surface is blind to it, and the
                          honest answer to "is the screen live?" is then
                          "I cannot tell", which the toolbar renders as nightly
                          WITH the reason, never as silence.

    `as_of` is the OVERLAY's timestamp — when the values a member could be
    looking at were derived. `swept_at` is when the last CYCLE ran, which on a
    skipped cycle is now and says nothing about the data. They are reported
    separately and neither ever substitutes for the other; see `_AS_OF_KEYS`.

    `config` is derived from the module's own scalar UPPERCASE constants rather
    than a list typed here, so a constant the sibling lane adds tomorrow shows
    up without an edit on this side.
    """
    mod = _live_tier_module()
    if mod is None:
        return {
            "state": "unavailable", "available": False, "enabled": None,
            "enabled_error": None, "columns": [], "column_count": 0,
            "receipt": None, "receipt_source": None, "receipt_candidates": [],
            "as_of": None, "as_of_et": None, "as_of_key": None,
            "swept_at": None, "swept_at_et": None, "swept_at_key": None,
            "config": {},
            "reason": "The live overlay is not running on this pod.",
            "note": ("the live tier is not installed on this pod — every "
                     "column is from the 03:00 build"),
        }
    try:
        enabled = bool(mod.enabled())
        enabled_error = None
    except Exception as e:  # noqa: BLE001 — missing/raising flag reads as OFF
        enabled, enabled_error = False, f"{type(e).__name__}: {e}"
    # ⛔⛔ THE CLAIM IS WHAT THE SWEEP MEASURED, NOT WHAT THE TIER ASPIRES TO.
    #
    # `LIVE_COLUMNS` is the set the tier intends to recompute;
    # `live_columns_effective()` is the set it MEASURED ITSELF RECOMPUTING on the
    # last cycle that wrote rows. They differ today: four of the twenty-two
    # (`chg_from_open_pct`, `gap_pct`, `new_52w_high`, `new_ath`) need feed
    # fields `massive.get_full_market_snapshot` does not yet emit (spec §3.2
    # unlanded), so those columns carry their NIGHTLY value forward — and
    # naming one "live as of 10:42" while it holds the prior session's number is
    # an honest value under a dishonest label. A member filtering `gap_pct > 3`
    # during RTH would read yesterday's gappers as today's.
    #
    # ⚠️ THIS ONLY STARTED MATTERING WHEN THE OVERLAY BECAME REACHABLE. Until
    # the join below landed no row ever carried `live_row`, so this list was
    # never rendered as a live claim; the moment values reach the screen the
    # roster IS the disclosure. `live_tier`'s own module docstring states the
    # contract ("the provenance surface must read the second one") and nothing
    # was reading it — the same built-tested-green-and-unreachable shape, one
    # level up.
    #
    # ⛔ The SQL still overlays ALL of `LIVE_COLUMNS` (see `_overlay`), and that
    # is correct, not a contradiction: an overlay row carries the nightly value
    # verbatim for a column it could not recompute, so COALESCE returns the same
    # number either way. What changes is only what the screen CLAIMS is live.
    # A tier without the accessor falls back to the declared list.
    try:
        effective = getattr(mod, "live_columns_effective", None)
        declared = getattr(mod, "LIVE_COLUMNS", None) or []
        columns = [str(c) for c in (effective() if callable(effective) else declared)]
    except Exception:  # noqa: BLE001
        columns = []
    receipt, source, candidates = _live_receipt(mod)
    as_of, as_of_key = _receipt_stamp(receipt, _AS_OF_KEYS)
    swept_at, swept_at_key = _receipt_stamp(receipt, _SWEPT_AT_KEYS)
    config = {}
    try:
        for name in sorted(n for n in dir(mod) if n.isupper()):
            value = getattr(mod, name, None)
            if isinstance(value, (int, float, str, bool)):
                config[name] = value
    except Exception:  # noqa: BLE001
        config = {}
    # TWO SENTENCES PER CONDITION, ONE BRANCH — different audiences, never a
    # second decision. `note` is the operator's line on the status endpoint,
    # where it stands alone; `reason` is the CAUSE CLAUSE the toolbar appends
    # after its own "every column is from the 03:00 build" lead. Folding the
    # lead into `reason` is what made the popover read *"…is from the 03:00
    # build. …is from the 03:00 build."* — the defect was invisible in every
    # green test and obvious the moment the rendered text was read.
    if not enabled:
        state = "off"
        reason = "The live overlay is switched off."
        note = "the live overlay is switched off — every column is from the 03:00 build"
    elif receipt is None:
        state = "unreadable"
        reason = ("The live overlay is switched on, but no sweep receipt could "
                  "be read — it may not have run yet.")
        note = ("the live overlay is switched on, but no sweep receipt could be "
                "read — it may not have run yet, or this surface cannot see it; "
                "treat every column as the 03:00 build until one appears")
    else:
        state = "on"
        reason = None
        note = "the live overlay is switched on"
    return {
        "state": state, "available": True, "enabled": enabled,
        "enabled_error": enabled_error,
        "columns": columns, "column_count": len(columns),
        "receipt": receipt, "receipt_source": source,
        "receipt_candidates": candidates,
        "as_of": as_of, "as_of_et": _et_clock(as_of), "as_of_key": as_of_key,
        "swept_at": swept_at, "swept_at_et": _et_clock(swept_at),
        "swept_at_key": swept_at_key,
        "config": config, "reason": reason, "note": note,
    }


def _served_as_of(rows):
    """⭐ THE SERVED AS-OF COMES OFF THE ROWS SERVED, exactly like the verdict.

    `live_asof` is the stamp the sweep wrote ONTO each overlay row, so the
    newest one on this page is literally when the values on screen were
    derived — not when some later cycle happened to tick. Honest-None when the
    join has not landed or the column was not selected; the caller then falls
    back to the receipt's own `as_of` (never to a cycle clock).
    """
    best = None
    for r in rows:
        if not r.get("live_row"):
            continue
        v = r.get("live_asof")
        if isinstance(v, bool) or not isinstance(v, (int, float)) or v <= 0:
            continue
        if best is None or v > best:
            best = float(v)
    return best


def _served_anchor_date(rows):
    """The ONE anchor session every live row on this page was measured against,
    as `YYYY-MM-DD`, or None when the page is mixed / the column is absent.

    `bars_asof` is an 8-char `YYYYMMDD` string (`snapshot_builder.build_row`
    stamps `str(bars[-1]["t"])`, and daily `ts` is a `YYYYMMDD` int). The
    overlay copies the one it derived against into `anchor_bars_asof`, which is
    preferred because it is the anchor the live numbers actually used.
    """
    seen = set()
    for r in rows:
        if not r.get("live_row"):
            continue
        raw = r.get("anchor_bars_asof") or r.get("bars_asof")
        text = str(raw).strip() if raw is not None else ""
        if len(text) != 8 or not text.isdigit():
            return None
        seen.add(text)
        if len(seen) > 1:
            return None
    if len(seen) != 1:
        return None
    d = seen.pop()
    return f"{d[:4]}-{d[4:6]}-{d[6:]}"


def live_screen_state(rows, tier=None) -> dict:
    """What THIS RESULT SET is: live, or last night's snapshot.

    ⭐ THE VERDICT IS DERIVED FROM THE ROWS BEING SERVED, never from the flag.
    `live_row` is the 0/1 marker the overlay join stamps on a row it overlaid;
    a page where no row carries it is a page of nightly values, whatever the
    tier believes about itself. That is what makes this honest in the one
    direction that matters — and it means the disclosure lights up the day the
    join lands, with no edit here, because the evidence is the artifact.

    ⭐ SO DOES THE AS-OF, AND THAT IS THE SAME PRINCIPLE. `_served_as_of` reads
    the `live_asof` the sweep stamped on these very rows; the receipt's own
    `as_of` is the fallback. ⛔ A CYCLE CLOCK IS NEVER THE FALLBACK — see the
    `_AS_OF_KEYS` comment for the 19:24-over-15:59-prices case that made this
    the blocking defect of the first cut.

    `state` is one of:
      * ``live``          — rows carry overlay values AND the tier names which
                            columns those are;
      * ``live_unnamed``  — rows carry overlay values but the tier named NO
                            columns. The roster is the whole disclosure, so
                            this refuses to claim `live`; it equally refuses to
                            say `nightly`, which would be false about values
                            that were recomputed. Unreachable while the tier
                            ships `LIVE_COLUMNS` — and if it ever is reached,
                            an unclaimed screen is the safe direction.
      * ``nightly``       — no row on this page carries a live value.

    ⚠️ The counts are PAGE-scoped and say so (`scope_note`, which the surface
    renders — a page-scoped number printed beside the seal's result-set-scoped
    "Rows served" reads as a contradiction without it). A whole-result-set
    `rows_live` has to come from the same statement that returned the rows
    (spec §8.4/R13); counting it a second way here would be exactly the drift
    `run_scan`'s `total` comment already refuses.
    """
    tier = tier if tier is not None else live_tier_state()
    rows = rows or []
    live_n = sum(1 for r in rows if r.get("live_row"))
    columns = tier.get("columns") or []
    if live_n and columns:
        state = "live"
    elif live_n:
        state = "live_unnamed"
    else:
        state = "nightly"

    if state == "live":
        off_reason = None
    elif state == "live_unnamed":
        off_reason = ("Some values on this screen were recomputed from the "
                      "live price, but the overlay did not say which columns — "
                      "so nothing here can be named live.")
    elif not rows:
        off_reason = "This screen returned no rows, so there is nothing to describe."
    elif tier.get("reason"):
        off_reason = tier["reason"]
    else:
        aborted = (tier.get("receipt") or {}).get("aborted")
        off_reason = ("No row in this result carries a live value"
                      + (f" — the last sweep reported {aborted}." if aborted
                         else " — the overlay has not reached these symbols."))

    row_as_of = _served_as_of(rows) if live_n else None
    if row_as_of is not None:
        as_of, as_of_source = row_as_of, "rows"
    elif live_n and tier.get("as_of") is not None:
        as_of, as_of_source = tier["as_of"], "receipt"
    else:
        as_of, as_of_source = None, None
    # ⛔ NO TIME AT ALL rather than a borrowed one. A live screen whose overlay
    # never reported when it derived these values says so in words; the chip
    # simply reads `⚡ LIVE` with no clock beside it.
    as_of_note = None
    if live_n and as_of is None:
        as_of_note = ("The overlay did not report when these values were "
                      "derived, so no time is shown.")
    anchor_date = _served_anchor_date(rows) if live_n else None

    return {
        "state": state,
        "as_of": as_of,
        "as_of_et": _et_clock(as_of),
        "as_of_source": as_of_source,
        "as_of_note": as_of_note,
        "columns": columns if state == "live" else [],
        "column_count": len(columns) if state == "live" else 0,
        "rows_on_page": len(rows),
        "live_rows_on_page": live_n,
        "scope_note": ("counted on the rows this page returned, not on the "
                       "whole result set"),
        "anchor_date": anchor_date,
        "anchor_note": anchor_note(anchor_date),
        "off_reason": off_reason,
        "tier": tier,
    }


def build_scan_sql(spec, overlay=None, *, user_id=None) -> dict:
    """The EXACT statement `run_scan` executes, plus what describes its rows.

    Split out of `run_scan` for ONE reason: the rollback guarantee has to be
    mechanical. `tests/test_screener_live_read_path.py` reads the string this
    returns with the flag off and compares it to a frozen literal of the
    pre-overlay statement — a claim in prose that "nothing changes when the
    flag is off" is exactly the kind nobody can falsify.

    ⛔ `run_scan` CALLS THIS. If it composed its own SQL beside it, the rail
    would be pinning a string the member never runs; the connection spy in that
    same file is what pins the wire.

    Returns the sql/params, the WHERE and FROM/date expressions
    `snapshot_db.describe_rows` must reuse (never rebuild — see its docstring),
    and the response scaffolding.
    """
    overlay = overlay or OFF
    spec = spec or {}
    scan_joins = []
    list_joins = []
    # ⛔ `user_id` IS A PARAMETER, NOT A SPEC FIELD. The spec is client-supplied
    # JSON; a `list` filter resolved against a user_id read out of it would let
    # any member screen any other member's watchlist. It arrives from the route's
    # authenticated dependency and nowhere else.
    where, where_params = build_where(spec.get("filters"), scan_joins, overlay,
                                      list_joins=list_joins, user_id=user_id)
    # 🔴 THE MEMBER'S OWN WEIGHTED COMPOSITE (benchmark 432-435). Parsed before
    # anything else uses it so a malformed rank REFUSES rather than degrading to
    # an unranked list the member did not ask for.
    rank = ranking.parse(spec.get("rank"))
    base_where, base_params = where, list(where_params)
    if rank:
        # A row missing a weighted criterion cannot be ranked against rows that
        # have it — see `ranking`'s docstring for why neither a fabricated zero
        # nor a renormalised score is acceptable. It is excluded HERE and
        # counted in the receipt.
        extra = ranking.completeness_clauses(rank, overlay.col_expr)
        joiner = " AND " if where.strip() else " WHERE "
        where = f"{where}{joiner}{' AND '.join(extra)}"
    view_key = spec.get("view") or "overview"
    view = filters.VIEWS.get(view_key, filters.VIEWS["overview"])
    sort = spec.get("sort") or {}
    sort_key = sort.get("key") or "uct_composite"
    if sort_key not in _SORTABLE:
        # ⛔ No silent substitution: a member sorting a column that does not
        # exist deserves a 400 naming it, not a quiet uct_composite reorder.
        raise ValueError(f"unknown sort key: {sort_key}")
    sort_dir = "ASC" if (sort.get("dir") == "asc") else "DESC"
    page = max(int(spec.get("page", 1)), 1)
    page_size = min(max(int(spec.get("page_size", 50)), 1), _MAX_PAGE)
    offset = (page - 1) * page_size

    cols_req = spec.get("columns")
    if cols_req:
        bad = [c for c in cols_req if c not in set(snapshot_db.COLUMNS)]
        if bad:
            raise ValueError(f"unknown columns: {', '.join(sorted(bad))}")
        # ticker first, then the request's own order, then the sort column so
        # the client can always show why the rows are in this order. Dedupe
        # preserves first position.
        seen, select_cols = set(), []
        for c in ["ticker", *cols_req, sort_key]:
            if c not in seen:
                seen.add(c)
                select_cols.append(c)
        out_columns = select_cols
    elif overlay.on:
        # ⚠️ `SELECT *` CANNOT SURVIVE THE JOIN. With a second table in the FROM
        # it returns BOTH tables' columns, and `sqlite3.Row` keeps only the last
        # of two same-named ones — so `price` would silently become the overlay's
        # copy for every row INCLUDING the ones the serve predicate refused. The
        # list becomes explicit and every item goes through `col_expr`, which is
        # the only expression that respects the predicate.
        select_cols = list(snapshot_db.COLUMNS)
        out_columns = view["columns"]
    else:
        select_cols = None          # `SELECT *`, exactly as before the overlay
        out_columns = view["columns"]

    if select_cols is None:
        select_sql = "*"
    else:
        select_sql = ", ".join(
            [overlay.select_item(c) for c in select_cols] + overlay.extra_select())

    if rank:
        # ⛔ A CTE, because a window function cannot be used in the ORDER BY of
        # the same SELECT that defines it. The scoring pass runs over the
        # screened set once, then the outer statement pages the scored rows.
        score = ranking.score_expr(rank, overlay.col_expr)
        sql = (f"SELECT * FROM (SELECT {select_sql}, {score} AS rank_score "
               f"FROM {overlay.from_sql()}{where}) "
               f"ORDER BY rank_score DESC NULLS LAST, ticker ASC "
               f"LIMIT ? OFFSET ?")
        # `top_n` caps the WHOLE ranked list, so it bounds this page rather than
        # being a second LIMIT the pager would fight with.
        if rank["top_n"] is not None:
            page_size = max(min(page_size, rank["top_n"] - offset), 0)
        if "rank_score" not in out_columns:
            out_columns = [*out_columns, "rank_score"]
    else:
        sql = (f"SELECT {select_sql} FROM {overlay.from_sql()}{where} "
               f"ORDER BY {overlay.col_expr(sort_key)} {sort_dir} NULLS LAST "
               f"LIMIT ? OFFSET ?")
    # The join's own parameter (the in-session freshness cutoff) binds BEFORE
    # the where clause's, because the ON clause is earlier in the statement.
    describe_params = [*overlay.join_params, *where_params]
    return {
        "sql": sql,
        "params": [*describe_params, page_size, offset],
        "where": where,
        "describe_params": describe_params,
        "from_sql": overlay.from_sql(),
        # ⭐ THE SAME HELPER dates the description. `snapshot_date` is not a live
        # column today, so this renders the nightly one — but if it ever became
        # one, the label would follow the value it labels with no edit here.
        "date_expr": overlay.col_expr("snapshot_date"),
        "scan_joins": scan_joins,
        "list_joins": list_joins,
        "rank": rank,
        # The WHERE before the rank's completeness clauses — what "matched your
        # filters" means, so the receipt can say how many the rank had to drop.
        "base_where": base_where,
        "base_params": base_params,
        "view": view_key,
        "view_columns": out_columns,
        "page": page,
        "page_size": page_size,
        "overlay": overlay,
    }


def run_scan(spec, user_id=None):
    spec = spec or {}
    with snapshot_db.connect() as conn:
        # ⛔ ONE DECISION PER STATEMENT. The overlay is resolved once and threaded
        # through the SELECT, the WHERE, the ORDER BY and the description, so
        # they cannot disagree about which values are being served.
        plan = build_scan_sql(spec, _overlay(conn), user_id=user_id)
        rows = conn.execute(plan["sql"], plan["params"]).fetchall()
        # 🔴 THE DATE MUST DESCRIBE THE ROWS BEING SERVED, so the SAME `where`,
        # the SAME params AND THE SAME `FROM` that selected them select the
        # description.
        #
        # This used to be `SELECT MAX(snapshot_date) FROM screener_rows` --
        # unfiltered, and the MAX. On the live snapshot that printed
        # *"snapshot 2026-08-08"* over 3,583 rows built 2026-07-11, because ONE
        # row had been rebuilt. The member screened on month-old fundamentals
        # under today's date. See `snapshot_db.describe_rows` for the argument;
        # the short version is that a rank statistic has no threshold to get
        # wrong, and one number cannot honestly describe three dates.
        #
        # ⛔ THE FROM CLAUSE IS HANDED OVER, NEVER REBUILT. Once the overlay is
        # serving, the where clause can name `l.` — described against
        # `screener_rows` alone this statement would not disagree, it would
        # RAISE, and a second join composed there would be a second authority
        # over which rows `total` counts.
        #
        # ⛔ THE RESULT SET IS NOT TOUCHED. Filtering the rows down to the
        # representative date would silently drop symbols -- a fixed label at
        # the price of a missing-data bug -- and a screen that quietly returns
        # fewer names looks like a quiet market.
        snap = snapshot_db.describe_rows(
            conn, plan["where"], plan["describe_params"],
            from_sql=plan["from_sql"], date_expr=plan["date_expr"])
        rank_receipt = None
        if plan["rank"]:
            # ⭐ TWO COUNTS, because a ranked screen returns FEWER rows than the
            # same filters unranked and the difference is missing data, not a
            # quiet market. `matched` is the filters alone; `ranked` is what
            # survived the completeness requirement.
            def _count(where, params):
                return conn.execute(
                    f"SELECT COUNT(*) FROM {plan['from_sql']}{where}",
                    [*plan["overlay"].join_params, *params]).fetchone()[0]
            rank_receipt = ranking.receipt(
                plan["rank"],
                matched=_count(plan["base_where"], plan["base_params"]),
                ranked=_count(plan["where"], plan["describe_params"][
                    len(plan["overlay"].join_params):]))
    out_rows = [dict(r) for r in rows]
    # 🔑 THE LIVE DISCLOSURE RIDES THE PROVENANCE BLOCK, AT ONE ADDRESS.
    #
    # `snapshot` is already this response's provenance object and is already
    # threaded to the toolbar's Seal (`ScannerShell.jsx` passes
    # `snapshot={result?.snapshot}`), which is the surface that owns "how old
    # is what I am looking at". Putting the live block anywhere else would mean
    # either a second copy in the payload -- two addresses one consumer can read
    # and a later edit can drift -- or a disclosure wired to a prop nobody
    # passes, which is the built-tested-green-and-unreachable failure this repo
    # has already paid for twice. One block, one address, reachable today.
    snap["live"] = live_screen_state(out_rows)
    # `total` IS the described row count. One `GROUP BY` already counted every
    # matching row, so re-running `COUNT(*)` would be a second authority over
    # one value -- exactly the drift that lets a label and a total disagree.
    return {"total": snap["rows"], "rows": out_rows,
            "view": plan["view"], "view_columns": plan["view_columns"],
            "snapshot_date": snap["snapshot_date"], "snapshot": snap,
            "page": plan["page"], "page_size": plan["page_size"],
            "scan_joins": plan["scan_joins"],
            "list_joins": plan["list_joins"],
            "rank": rank_receipt}
