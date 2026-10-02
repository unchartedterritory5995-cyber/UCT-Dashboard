"""Wave 11 (lane 11B): computed note properties -- `formula` and `rollup`.

A FORMULA is computed from the SAME note's number properties through the
expression language in `formula_engine.py` (never `eval`). A ROLLUP summarises
one property across a SET of rows: the notes that link to this note, the notes
this note links to, the notes a saved view matches, or the member's trades
linked to this note -- with count, sum, average, min, max or win rate.

Both are DARK behind `NOTEBOOK_FORMULAS_ENABLED` (enablement gate, unset = OFF,
read per request through `notebook_flags.flag_on`, riding the auth payload as
`notebook_formulas_enabled`). With the flag off a formula/rollup definition is
invisible everywhere -- `note_properties` filters both types out of every read
-- so existing notes and property types behave exactly as before.

A READ NEVER WRITES (controller ruling, 2026-10-01)
--------------------------------------------------
Every value is computed IN MEMORY at read time from its current inputs: one
bounded query for the inputs, the evaluation in process, and -- for a sort or
a filter over the whole library -- the ordering in process, after which only
the page's rows are read. Nothing is persisted, so there is no cache to go
stale and no value is ever shown out of date; and a member's list read never
contends for the single SQLite writer that every save uses.
`tests/test_notebook_computed_reads_never_write.py` fails if a GET writes.
(⚰️ The first version cached values in a `j2_note_computed` table written on
read; that table was removed before it shipped.)

ROLLUP RULES (accepted by the controller, 2026-10-01):
  * win rate counts only the rows that HAVE a value (an empty row is not a loss);
  * a saved-view rollup uses the view's property filter, as the server applies
    it to the view; a formula condition in that view is applied too, a rollup
    condition is not (a rollup of a rollup is refused, and this keeps them apart);
  * the trades source counts closed trades and option strategies linked to the
    note; an open position that has not closed into a trade is not counted;
  * a rollup cannot summarise another rollup.

⛔ TENANT ISOLATION: every set query joins its member rows on `user_id = ?`.
A note link's `target_note_id` and an embed's `trade_ref` are client-supplied
text, so a link to ANOTHER member's note id is possible in the data -- and it
must never count. `tests/test_notebook_rollups.py` plants exactly that.

⛔ BOUNDED: a set is capped at MAX_ROLLUP_SET rows (most recently updated
first); past it the value covers the first N and says "first N of M". Sets
are read with one windowed query per source, and member values in chunks --
never one query per note.
"""
from __future__ import annotations

import functools
import json
import sqlite3
from typing import Any

from api.services.journal_two import formula_engine as fe
from api.services.notebook_flags import flag_on

FLAG = "NOTEBOOK_FORMULAS_ENABLED"
COMPUTED_TYPES = ("formula", "rollup")

ROLLUP_SOURCES = ("links_to_this", "links_from_this", "saved_view", "trades")
AGGREGATES = ("count", "sum", "avg", "min", "max", "win_rate")
#: A trade field a rollup may read -> its label. `result` is the one non-number.
TRADE_FIELDS = {
    "r_multiple": "R multiple",
    "pnl_dollar": "P&L ($)",
    "pnl_percent": "P&L (%)",
    "result": "Result",
}
TRADE_RESULTS = ("Win", "Loss", "BE")
MAX_ROLLUP_SET = 1000
_CHUNK = 400


class ComputedConfigError(ValueError):
    pass


def formulas_enabled() -> bool:
    """Read per call (never at import), the same parse as the auth payload."""
    return flag_on(FLAG, False)


def _now_iso() -> str:
    from api.services.journal_two.notes import _now_iso as _impl
    return _impl()


# ── Definition config: validation + cycles ───────────────────────────────────

def _live_user_defs(conn: sqlite3.Connection, user_id: str) -> list[dict[str, Any]]:
    rows = conn.execute(
        "SELECT id, name, type, options_json, config_json, updated_at FROM j2_note_properties"
        " WHERE user_id = ? AND deleted_at IS NULL ORDER BY sort_order, name",
        (user_id,),
    ).fetchall()
    out = []
    for r in rows:
        out.append({
            "id": r["id"], "name": r["name"], "type": r["type"],
            "options": json.loads(r["options_json"]) if r["options_json"] else None,
            "config": json.loads(r["config_json"]) if r["config_json"] else None,
            "updatedAt": r["updated_at"],
        })
    return out


def _name_map(defs: list[dict[str, Any]], types: tuple[str, ...]) -> dict[str, str | None]:
    out: dict[str, str | None] = {}
    for d in defs:
        if d["type"] not in types:
            continue
        key = d["name"].strip().lower()
        out[key] = None if key in out else d["id"]
    return out


def formula_graph(defs: list[dict[str, Any]]) -> dict[str, list[str]]:
    """formula id -> the formula ids its expression references."""
    formulas = {d["id"] for d in defs if d["type"] == "formula"}
    graph: dict[str, list[str]] = {}
    for d in defs:
        if d["type"] != "formula":
            continue
        try:
            refs = fe.refs_of(fe.parse((d.get("config") or {}).get("expression") or ""))
        except fe.FormulaError:
            refs = []
        graph[d["id"]] = [key for kind, key in refs if kind == "id" and key in formulas]
    return graph


def find_cycle(start: str, graph: dict[str, list[str]]) -> list[str] | None:
    """The path start -> ... -> start if one exists, else None (iterative DFS)."""
    stack: list[tuple[str, int]] = [(start, 0)]
    path: list[str] = [start]
    on_path = {start}
    seen: set[str] = set()
    while stack:
        node, idx = stack[-1]
        nexts = graph.get(node, [])
        if idx < len(nexts):
            stack[-1] = (node, idx + 1)
            nxt = nexts[idx]
            if nxt == start:
                return path + [start]
            if nxt in on_path or nxt in seen:
                continue
            stack.append((nxt, 0))
            path.append(nxt)
            on_path.add(nxt)
        else:
            stack.pop()
            done = path.pop()
            on_path.discard(done)
            seen.add(done)
    return None


def validate_config(
    conn: sqlite3.Connection, user_id: str, type_: str, config: Any, *, self_id: str | None = None,
) -> dict[str, Any]:
    """The normalized config to store, or ComputedConfigError with a sentence
    the member can act on. `self_id` is the definition being edited (None while
    creating), so a formula can be checked for referring back to itself."""
    if not isinstance(config, dict):
        raise ComputedConfigError("This property needs its settings")
    defs = _live_user_defs(conn, user_id)
    if type_ == "formula":
        return _validate_formula(defs, config, self_id)
    if type_ == "rollup":
        return _validate_rollup(conn, user_id, defs, config, self_id)
    raise ComputedConfigError(f"Unsupported property type: {type_!r}")


def _validate_formula(defs, config, self_id) -> dict[str, Any]:
    text = config.get("expression")
    if not isinstance(text, str) or not text.strip():
        raise ComputedConfigError("Write a formula first")
    try:
        stored = fe.to_stored(text, _name_map(defs, ("number", "formula")))
        node = fe.parse(stored)
    except fe.FormulaError as e:
        raise ComputedConfigError(e.message)
    by_id = {d["id"]: d for d in defs}
    for kind, key in fe.refs_of(node):
        d = by_id.get(key)
        if d is None:
            raise ComputedConfigError("A property this formula uses does not exist")
        if key == self_id:
            raise ComputedConfigError(f"Circular reference: {d['name']} uses itself")
        if d["type"] not in ("number", "formula"):
            raise ComputedConfigError(f"{d['name']} is not a number, so a formula can't use it")
    if self_id is not None:
        trial = [dict(d) for d in defs]
        for d in trial:
            if d["id"] == self_id:
                d["config"] = {"expression": stored}
        cycle = find_cycle(self_id, formula_graph(trial))
        if cycle:
            names = " -> ".join(by_id[i]["name"] for i in cycle if i in by_id)
            raise ComputedConfigError(f"Circular reference: {names}. A formula can't depend on its own result.")
    return {"expression": stored}


def _validate_rollup(conn, user_id, defs, config, self_id) -> dict[str, Any]:
    source = config.get("source")
    aggregate = config.get("aggregate")
    if source not in ROLLUP_SOURCES:
        raise ComputedConfigError("Pick which notes or trades to summarise")
    if aggregate not in AGGREGATES:
        raise ComputedConfigError("Pick how to summarise them (count, sum, average, min, max or win rate)")
    out: dict[str, Any] = {"source": source, "aggregate": aggregate}
    if source == "saved_view":
        vid = config.get("savedViewId")
        row = conn.execute(
            "SELECT 1 FROM j2_note_saved_views WHERE id = ? AND user_id = ? AND deleted_at IS NULL",
            (vid, user_id),
        ).fetchone() if isinstance(vid, str) else None
        if row is None:
            raise ComputedConfigError("Pick a saved view")
        out["savedViewId"] = vid
    if source == "trades":
        field = config.get("tradeField")
        if aggregate == "count" and field is None:
            return out
        if field not in TRADE_FIELDS:
            raise ComputedConfigError("Pick which trade number to summarise")
        if field == "result":
            if aggregate != "win_rate" and aggregate != "count":
                raise ComputedConfigError("A trade's result is a word; use count or win rate with it")
            opt = config.get("optionId") or "Win"
            if opt not in TRADE_RESULTS:
                raise ComputedConfigError("Win rate counts one result: Win, Loss or BE")
            out["optionId"] = opt
        out["tradeField"] = field
        return out
    pid = config.get("propertyId")
    if aggregate == "count" and pid is None:
        return out
    d = next((x for x in defs if x["id"] == pid), None)
    if d is None:
        raise ComputedConfigError("Pick the property to summarise")
    if d["id"] == self_id or d["type"] == "rollup":
        raise ComputedConfigError(f"{d['name']} is a rollup; a rollup can't summarise another rollup")
    if aggregate == "win_rate":
        if d["type"] == "select":
            opt = config.get("optionId")
            if opt not in {o["id"] for o in (d.get("options") or [])}:
                raise ComputedConfigError(f"Pick which {d['name']} option counts as a win")
            out["optionId"] = opt
        elif d["type"] not in ("number", "formula"):
            raise ComputedConfigError(f"Win rate needs a number or a select property, and {d['name']} is neither")
    elif aggregate != "count" and d["type"] not in ("number", "formula"):
        raise ComputedConfigError(f"{d['name']} is not a number, so it can't be added up or averaged")
    out["propertyId"] = d["id"]
    return out


# ── Formula evaluation for ONE note ─────────────────────────────────────────

@functools.lru_cache(maxsize=512)
def _compiled(expression: str):
    """One parse + compile per distinct expression (fe.compile_ast: the same
    semantics as fe.evaluate, held to the same shared vectors)."""
    return fe.compile_ast(fe.parse(expression))


def _eval_formula(def_id: str, props: dict[str, Any], by_id: dict[str, dict], stack: tuple[str, ...] = ()):
    """(value, reason, code) -- value None means an empty cell with `reason`."""
    d = by_id.get(def_id)
    if d is None or d["type"] != "formula":
        return None, "This formula's property was deleted", "unknown_ref"
    if def_id in stack:
        return None, "This formula refers back to itself", "cycle"
    try:
        run = _compiled(((d.get("config") or {}).get("expression")) or "")
    except fe.FormulaError as e:
        return None, e.message, e.code

    def lookup(kind: str, key: str):
        ref = by_id.get(key) if kind == "id" else None
        if ref is None:
            raise fe.FormulaEvalError("unknown_ref", "A property this formula uses was deleted")
        if ref["type"] == "formula":
            v, reason, code = _eval_formula(key, props, by_id, stack + (def_id,))
            if v is None:
                raise fe.FormulaEvalError(code, f"{ref['name']} has no value ({reason})")
            return v
        if ref["type"] != "number":
            raise fe.FormulaEvalError("not_number", f"{ref['name']} is not a number")
        v = props.get(key)
        if v is None:
            raise fe.FormulaEvalError("missing", f"{ref['name']} is empty")
        if isinstance(v, bool) or not isinstance(v, (int, float)):
            raise fe.FormulaEvalError("not_number", f"{ref['name']} is not a number")
        return v

    try:
        return run(lookup), None, None
    except fe.FormulaEvalError as e:
        return None, e.message, e.code


def _props_of(raw: str | None) -> dict[str, Any]:
    try:
        parsed = json.loads(raw) if raw else {}
    except (ValueError, TypeError):
        return {}
    return parsed if isinstance(parsed, dict) else {}


# ── Computing values IN MEMORY (a read never writes) ─────────────────────────

#: The partial covering index the whole-library reads use (db.py `_PERF_INDEXES`).
#: It holds only LIVE notes that HAVE properties, keyed (user_id, id), carrying the
#: properties JSON, so neither a scan for a formula nor a rollup's member lookup
#: touches a note row (whose body sits on overflow pages). Named with INDEXED BY
#: because, with no ANALYZE statistics, the planner prefers the broader live
#: indexes; asked for only when it exists, so a skipped index degrades to slower,
#: never to an error.
PROPS_INDEX = "idx_j2_notes_props_live"
_PROPS_WHERE = "user_id = ? AND deleted_at IS NULL AND properties_json IS NOT NULL"


def _props_index(conn) -> str:
    row = conn.execute("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = ?", (PROPS_INDEX,)).fetchone()
    return f" INDEXED BY {PROPS_INDEX}" if row else ""


def _now_stamp() -> str:
    return _now_iso()


def _chunks(seq: list[Any], n: int = _CHUNK):
    for i in range(0, len(seq), n):
        yield seq[i:i + n]


def _windowed(inner_sql: str) -> str:
    return (
        "SELECT src, mid, total, val FROM ("
        " SELECT src, mid, val,"
        " ROW_NUMBER() OVER (PARTITION BY src ORDER BY ord DESC, mid) AS rn,"
        " COUNT(*) OVER (PARTITION BY src) AS total"
        f" FROM ({inner_sql})"
        ") WHERE rn <= ?"
    )


def _link_sets(conn, user_id, direction: str, src_ids: list[str] | None) -> dict[str, tuple[int, list[str]]]:
    """src note id -> (set size, [member note ids, capped]). `direction` is
    links_from_this (the notes src links to) or links_to_this (notes linking to src)."""
    src_col, mid_col = ("note_id", "target_note_id") if direction == "links_from_this" else ("target_note_id", "note_id")
    out: dict[str, tuple[int, list[str]]] = {}

    def run(filter_sql: str, params: tuple):
        inner = (
            f"SELECT DISTINCT l.{src_col} AS src, t.id AS mid, t.updated_at AS ord, NULL AS val"
            " FROM j2_note_links l"
            # ⛔ TENANT ISOLATION: the member row must be THIS member's note. A link's
            # target id is client-supplied text and can name anyone's note.
            f" JOIN j2_notes t ON t.id = l.{mid_col} AND t.user_id = ? AND t.deleted_at IS NULL"
            f" WHERE l.user_id = ? AND l.{src_col} != l.{mid_col}{filter_sql}"
        )
        for r in conn.execute(_windowed(inner), (user_id, user_id, *params, MAX_ROLLUP_SET)):
            total, mids = out.get(r["src"], (r["total"], []))
            mids.append(r["mid"])
            out[r["src"]] = (r["total"], mids)

    if src_ids is None:
        run("", ())
    else:
        for part in _chunks(src_ids):
            run(f" AND l.{src_col} IN ({','.join('?' * len(part))})", tuple(part))
    return out


def _trade_sets(conn, user_id, field: str | None, src_ids: list[str] | None) -> dict[str, tuple[int, list[Any]]]:
    """src note id -> (set size, [the trade field's value per linked trade, capped])."""
    col = field if field in TRADE_FIELDS else "id"     # whitelisted: never member text
    out: dict[str, tuple[int, list[Any]]] = {}

    def run(filter_sql: str, params: tuple):
        refs = (
            "SELECT DISTINCT e.note_id AS src, e.trade_ref AS ref, e.trade_ref_type AS rtype FROM j2_note_embeds e"
            " JOIN j2_notes n ON n.id = e.note_id AND n.user_id = ? AND n.deleted_at IS NULL"
            f" WHERE e.user_id = ? AND e.trade_ref IS NOT NULL{filter_sql}"
        )
        # ⛔ Every branch re-checks ownership on the TRADE row: `trade_ref` is client text.
        # The three branches mirror note_trade_links.resolve_trade_ref: a typed equity
        # trade; a typed option strategy; an untyped legacy ref only when it names
        # exactly one of the two tables; and an open position that closed into
        # exactly one trade. An ambiguous legacy ref is in neither branch.
        rows = (
            f"SELECT r.src AS src, 't:' || t.id AS mid, t.exit_date AS ord, t.{col} AS val"
            " FROM refs r JOIN j2_trades t ON t.id = r.ref AND t.user_id = ?"
            " WHERE r.rtype = 'equity_trade' OR (r.rtype IS NULL AND NOT EXISTS ("
            "   SELECT 1 FROM j2_option_strategies s WHERE s.id = r.ref AND s.user_id = ?))"
            " UNION"
            f" SELECT r.src, 's:' || s.id, COALESCE(s.closed_at, s.entry_date), s.{col}"
            " FROM refs r JOIN j2_option_strategies s ON s.id = r.ref AND s.user_id = ?"
            " WHERE r.rtype = 'option_strategy' OR (r.rtype IS NULL AND NOT EXISTS ("
            "   SELECT 1 FROM j2_trades t2 WHERE t2.id = r.ref AND t2.user_id = ?))"
            " UNION"
            f" SELECT r.src, 't:' || t.id, t.exit_date, t.{col}"
            " FROM refs r JOIN j2_trades t ON t.position_id = r.ref AND t.user_id = ?"
            " WHERE r.rtype = 'position' AND (SELECT COUNT(*) FROM j2_trades t3"
            "   WHERE t3.position_id = r.ref AND t3.user_id = ?) = 1"
        )
        sql = (f"WITH refs AS ({refs}), rows AS ({rows}) "
               + _windowed("SELECT src, mid, ord, val FROM rows"))
        params_all = (user_id, user_id, *params, user_id, user_id, user_id, user_id, user_id, user_id, MAX_ROLLUP_SET)
        for r in conn.execute(sql, params_all):
            total, vals = out.get(r["src"], (r["total"], []))
            vals.append(r["val"])
            out[r["src"]] = (r["total"], vals)

    if src_ids is None:
        run("", ())
    else:
        for part in _chunks(src_ids):
            run(f" AND e.note_id IN ({','.join('?' * len(part))})", tuple(part))
    return out


def _saved_view_set(conn, user_id, view_id: str, defs: list[dict], memo: dict) -> tuple[int, list[str]] | None:
    """(set size, [member ids, capped]) for a saved view, or None if it is gone.

    The view's ordinary conditions are the same SQL the list uses; a FORMULA
    condition in the view is applied as the list applies it (a rowid set). A
    ROLLUP condition inside a view a rollup reads is dropped (a rollup of a
    rollup is refused at save, and this keeps the two from recursing)."""
    row = conn.execute(
        "SELECT spec_json FROM j2_note_saved_views WHERE id = ? AND user_id = ? AND deleted_at IS NULL",
        (view_id, user_id),
    ).fetchone()
    if row is None:
        return None
    try:
        spec = json.loads(row["spec_json"]) if row["spec_json"] else {}
    except (ValueError, TypeError):
        spec = {}
    by_id = {d["id"]: d for d in defs}
    plain, computed = [], []
    for c in spec.get("propertyFilter") or []:
        d = by_id.get(c.get("propertyId")) if isinstance(c, dict) else None
        if d is not None and d["type"] in COMPUTED_TYPES:
            if d["type"] == "formula":
                try:
                    check_filter(c.get("op"), c.get("value"))
                except ComputedConfigError:
                    continue
                computed.append((d, c.get("op"), c.get("value")))
        else:
            plain.append(c)
    from api.services.journal_two.note_properties import property_filter_sql
    where, params = property_filter_sql(user_id, plain, conn, strict=False)
    cwhere, cparams = filter_clauses(conn, user_id, computed, memo, defs)
    base = " FROM j2_notes WHERE user_id = ? AND deleted_at IS NULL" + where + cwhere
    allp = (user_id, *params, *cparams)
    total = conn.execute("SELECT COUNT(*)" + base, allp).fetchone()[0]
    ids = [r[0] for r in conn.execute("SELECT id" + base + " ORDER BY updated_at DESC, id LIMIT ?",
                                      (*allp, MAX_ROLLUP_SET))]
    return int(total), ids


def _member_values(conn, user_id, prop: dict | None, member_ids: list[str], by_id, memo: dict) -> dict[str, Any]:
    """note id -> the rolled-up property's value on that note (None when empty).
    A formula member is evaluated here, in memory, from that note's own values;
    read through the covering index, so no member's row is touched. Memoised per
    request: two rollups over the same property share one read."""
    if prop is None or not member_ids:
        return {}
    cache = memo.setdefault(("member", prop["id"]), {})
    need = [m for m in dict.fromkeys(member_ids) if m not in cache]
    hint = _props_index(conn) if need else ""
    for part in _chunks(need):
        marks = ",".join("?" * len(part))
        for r in conn.execute(
            f"SELECT id, properties_json FROM j2_notes{hint} WHERE {_PROPS_WHERE} AND id IN ({marks})",
            (user_id, *part),
        ):
            props = _props_of(r["properties_json"])
            if prop["type"] == "formula":
                cache[r["id"]] = _eval_formula(prop["id"], props, by_id)[0]
            else:
                cache[r["id"]] = props.get(prop["id"])
        for m in part:
            cache.setdefault(m, None)       # no properties at all: empty
    return cache


def _is_num(v: Any) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool)


_EMPTY_SET = {
    "links_to_this": "No notes link to this note yet",
    "links_from_this": "This note links to no notes yet",
    "saved_view": "No notes match the saved view",
    "trades": "No trades are linked to this note",
}


def _aggregate(config: dict, prop: dict | None, values: list[Any], set_size: int, used: int) -> tuple[Any, Any]:
    """(value, reason). `values` holds one entry per row in the (capped) set."""
    agg = config["aggregate"]
    source = config["source"]
    if set_size == 0:
        return None, _EMPTY_SET[source]
    if agg == "count":
        if prop is None and not config.get("tradeField"):
            return float(used), None
        return float(sum(1 for v in values if v is not None and v != "")), None
    label = (prop or {}).get("name") or TRADE_FIELDS.get(config.get("tradeField") or "", "the value")
    if agg == "win_rate":
        opt = config.get("optionId")
        if opt is not None:
            filled = [v for v in values if isinstance(v, str) and v]
            if not filled:
                return None, f"None of these has a {label} yet"
            wins = sum(1 for v in filled if v.lower() == str(opt).lower())
            return wins / len(filled) * 100.0, None
        nums = [float(v) for v in values if _is_num(v)]
        if not nums:
            return None, f"None of these has a {label} yet"
        return sum(1 for v in nums if v > 0) / len(nums) * 100.0, None
    nums = [float(v) for v in values if _is_num(v)]
    if not nums:
        return None, f"None of these has a {label} yet"
    if agg == "sum":
        total = sum(nums)
    elif agg == "avg":
        total = sum(nums) / len(nums)
    elif agg == "min":
        total = min(nums)
    else:
        total = max(nums)
    if total != total or total in (float("inf"), float("-inf")):
        return None, "The result is too large to show"
    return total + 0.0, None


def _rollup_cells(conn, user_id, d, defs, src_ids: list[str] | None, memo: dict):
    """({src id: (value, reason, set size, used size)}, default for any other note).
    Bounded: one windowed query per source (chunked by src when `src_ids` is given),
    member values in chunks -- never one query per note."""
    by_id = {x["id"]: x for x in defs}
    config = d.get("config") or {}
    source = config.get("source")
    prop = by_id.get(config.get("propertyId")) if config.get("propertyId") else None
    if config.get("propertyId") and prop is None:
        return {}, (None, "The property this rollup reads was deleted", None, None)
    if source == "saved_view":
        got = _saved_view_set(conn, user_id, config.get("savedViewId"), defs, memo)
        if got is None:
            return {}, (None, "The saved view this rollup reads was deleted", None, None)
        total, ids = got
        vals_by_id = _member_values(conn, user_id, prop, ids, by_id, memo)
        value, reason = _aggregate(config, prop, [vals_by_id.get(i) for i in ids], total, len(ids))
        return {}, (value, reason, total, len(ids))          # one value for every note
    empty = (None, _EMPTY_SET.get(source, "Nothing to summarise yet"), 0, 0)
    out = {}
    if source == "trades":
        sets = _trade_sets(conn, user_id, config.get("tradeField"), src_ids)
        for sid, (total, vals) in sets.items():
            value, reason = _aggregate(config, None, vals, total, len(vals))
            out[sid] = (value, reason, total, len(vals))
        return out, empty
    sets = _link_sets(conn, user_id, source, src_ids)
    all_mids = [m for _, mids in sets.values() for m in mids]
    vals_by_id = _member_values(conn, user_id, prop, all_mids, by_id, memo)
    for sid, (total, mids) in sets.items():
        value, reason = _aggregate(config, prop, [vals_by_id.get(m) for m in mids], total, len(mids))
        out[sid] = (value, reason, total, len(mids))
    return out, empty


def computed_defs(conn: sqlite3.Connection, user_id: str) -> list[dict[str, Any]]:
    return [d for d in _live_user_defs(conn, user_id) if d["type"] in COMPUTED_TYPES]


def values_for_notes(
    conn: sqlite3.Connection, user_id: str, note_ids: list[str],
    props_by_id: dict[str, dict[str, Any]] | None = None, memo: dict | None = None,
) -> dict[str, dict[str, dict[str, Any]]]:
    """note id -> property id -> {value, reason, computedAt, kind, name, ...} for
    every computed property of the member, computed NOW from the inputs. Reads
    only. `props_by_id` (a page's own propertiesJson) saves re-reading them."""
    if not note_ids:
        return {}
    defs = _live_user_defs(conn, user_id)
    comp = [d for d in defs if d["type"] in COMPUTED_TYPES]
    if not comp:
        return {}
    memo = memo if memo is not None else {}
    by_id = {d["id"]: d for d in defs}
    props_by_id = dict(props_by_id or {})
    missing = [i for i in note_ids if i not in props_by_id]
    for part in _chunks(missing):
        marks = ",".join("?" * len(part))
        for r in conn.execute(
            f"SELECT id, properties_json FROM j2_notes WHERE user_id = ? AND id IN ({marks})", (user_id, *part),
        ):
            props_by_id[r["id"]] = _props_of(r["properties_json"])
    now = _now_stamp()
    out: dict[str, dict[str, dict[str, Any]]] = {nid: {} for nid in note_ids}
    for d in comp:
        if d["type"] == "formula":
            for nid in note_ids:
                value, reason, _ = _eval_formula(d["id"], props_by_id.get(nid) or {}, by_id)
                out[nid][d["id"]] = {"value": value, "reason": reason, "computedAt": now,
                                     "kind": "formula", "name": d["name"]}
            continue
        cells, default = _rollup_cells(conn, user_id, d, defs, note_ids, memo)
        for nid in note_ids:
            value, reason, total, used = cells.get(nid, default)
            out[nid][d["id"]] = {
                "value": value, "reason": reason, "computedAt": now, "kind": "rollup", "name": d["name"],
                "setSize": total, "usedSize": used,
                "capped": bool(total is not None and used is not None and used < total),
                "aggregate": (d.get("config") or {}).get("aggregate"),
            }
    return out


def values_for_all(conn, user_id: str, d: dict, defs: list[dict] | None = None, memo: dict | None = None):
    """({note ROWID: value}, default) for ONE computed property across the member's
    live library -- what a sort or a filter needs. Only notes that HAVE a value are
    in the map; every other note takes `default` (None for a formula and a link or
    trade rollup; the one shared value for a saved-view rollup). Bounded: one
    covering-index scan for a formula's inputs, one windowed query per rollup
    source, member values in chunks. Memoised per request in `memo`."""
    memo = memo if memo is not None else {}
    key = ("all", d["id"])
    if key in memo:
        return memo[key]
    defs = defs if defs is not None else _live_user_defs(conn, user_id)
    by_id = {x["id"]: x for x in defs}
    values: dict[int, float] = {}
    if d["type"] == "formula":
        for rid, raw in conn.execute(
            f"SELECT j2_notes.rowid, properties_json FROM j2_notes{_props_index(conn)} WHERE {_PROPS_WHERE}",
            (user_id,),
        ):
            v = _eval_formula(d["id"], _props_of(raw), by_id)[0]
            if v is not None:
                values[rid] = v
        result = (values, None)
    else:
        cells, default = _rollup_cells(conn, user_id, d, defs, None, memo)
        valued = {sid: c[0] for sid, c in cells.items() if c[0] is not None}
        ids = list(valued)
        for part in _chunks(ids):
            marks = ",".join("?" * len(part))
            for rid, nid in conn.execute(
                f"SELECT rowid, id FROM j2_notes WHERE user_id = ? AND id IN ({marks})", (user_id, *part),
            ):
                values[rid] = valued[nid]
        result = (values, default[0])
    memo[key] = result
    return result


_FILTER_OPS = ("eq", "neq", "gt", "gte", "lt", "lte", "is_empty", "is_not_empty")


def check_filter(op: Any, value: Any) -> None:
    if op not in _FILTER_OPS:
        raise ComputedConfigError(f"{op!r} is not supported for a calculated property")
    if op in ("is_empty", "is_not_empty"):
        return
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ComputedConfigError("Filter a calculated property by a number")


def _passes(v: Any, op: str, target: Any) -> bool:
    if op == "is_empty":
        return v is None
    if op == "is_not_empty":
        return v is not None
    if v is None:
        return False
    t = float(target)
    return {"eq": v == t, "neq": v != t, "gt": v > t, "gte": v >= t, "lt": v < t, "lte": v <= t}[op]


def filter_clauses(conn, user_id: str, filters: list[tuple[dict, str, Any]], memo: dict,
                   defs: list[dict] | None = None) -> tuple[str, list[Any]]:
    """Computed conditions as rowid-SET clauses to AND onto a list's WHERE, so the
    page, its ORDER BY/LIMIT and its true total all stay in SQL and agree. A note
    with no value takes the condition's answer for `default` (so `is_empty` keeps
    them and `gt` drops them) without its rowid ever being listed."""
    sql, params = "", []
    if not filters:
        return sql, params
    defs = defs if defs is not None else _live_user_defs(conn, user_id)
    for d, op, target in filters:
        values, default = values_for_all(conn, user_id, d, defs, memo)
        if _passes(default, op, target):
            excluded = [rid for rid, v in values.items() if not _passes(v, op, target)]
            sql += " AND j2_notes.rowid NOT IN (SELECT value FROM json_each(?))"
            params.append(json.dumps(excluded))
        else:
            kept = [rid for rid, v in values.items() if _passes(v, op, target)]
            sql += " AND j2_notes.rowid IN (SELECT value FROM json_each(?))"
            params.append(json.dumps(kept))
    return sql, params


def sorted_page(conn, user_id: str, where_sql: str, params: list[Any], order_sql: str,
                sort: tuple[dict, str], offset: int, limit: int, memo: dict) -> list[int]:
    """The page's rowids for a sort by a computed value, empties last either way.

    Only notes WITH a value need ordering in memory; they are read in the base
    order (so ties keep it), sorted, and the page is cut from them. Every note
    without a value follows in the base order, read with LIMIT/OFFSET in SQL --
    so the cost follows the number of valued notes, never the library size."""
    d, direction = sort
    values, default = values_for_all(conn, user_id, d, None, memo)
    if default is not None and not values:
        # One shared value for every note (a saved-view rollup): nothing to reorder.
        return [r[0] for r in conn.execute(
            "SELECT j2_notes.rowid FROM j2_notes" + where_sql + order_sql + " LIMIT ? OFFSET ?",
            (*params, limit, offset))]
    keys = json.dumps(list(values))
    valued = [r[0] for r in conn.execute(
        "SELECT j2_notes.rowid FROM j2_notes" + where_sql
        + " AND j2_notes.rowid IN (SELECT value FROM json_each(?))" + order_sql, (*params, keys))]
    sign = -1.0 if direction == "desc" else 1.0
    valued.sort(key=lambda rid: sign * values[rid])            # stable: ties keep the base order
    page = valued[offset:offset + limit]
    need = limit - len(page)
    if need > 0:
        rest_offset = max(0, offset - len(valued))
        page += [r[0] for r in conn.execute(
            "SELECT j2_notes.rowid FROM j2_notes" + where_sql
            + " AND j2_notes.rowid NOT IN (SELECT value FROM json_each(?))" + order_sql + " LIMIT ? OFFSET ?",
            (*params, keys, need, rest_offset))]
    return page
