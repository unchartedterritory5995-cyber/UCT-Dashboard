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

THE CACHE, AND WHY IT IS "RECOMPUTE WHEN AN INPUT CHANGES" (not a TTL)
---------------------------------------------------------------------
Values are cached per (member, property, note) in `j2_note_computed`, so the
table view can sort and filter by them in SQL like any other property. Every
row carries a FINGERPRINT of the inputs it was computed from, and a row is
served only while its fingerprint still equals the inputs' fingerprint NOW:

* a formula row's inputs are its own note (`updated_at` + the length of its
  `properties_json`) and the member's property definitions;
* a rollup row's inputs are the member's whole library -- notes (live count,
  newest `updated_at`, newest `deleted_at`), trades (count and the sums of the
  three numbers a rollup can read, since `j2_trades` has no `updated_at`),
  option strategies, saved views -- plus the definitions. One indexed query.

A TTL was rejected: inside its window it serves a value whose inputs already
changed, without saying so. Hooking every note write door instead was rejected
too -- there are more than twenty, and a door that forgot the hook would leave
a stale value with nothing to notice it. The fingerprint is checked at READ,
so no write path can forget it. The cost is a false invalidation (any edit
anywhere recomputes a rollup), which is the cheap direction to be wrong in.

⛔ A value is NEVER shown stale without saying so: if a recompute raises, the
last cached row is served with `stale: true` and the time it was computed.

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

import hashlib
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

def _eval_formula(def_id: str, props: dict[str, Any], by_id: dict[str, dict], stack: tuple[str, ...] = ()):
    """(value, reason, code) -- value None means an empty cell with `reason`."""
    d = by_id.get(def_id)
    if d is None or d["type"] != "formula":
        return None, "This formula's property was deleted", "unknown_ref"
    if def_id in stack:
        return None, "This formula refers back to itself", "cycle"
    try:
        node = fe.parse(((d.get("config") or {}).get("expression")) or "")
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
        return fe.evaluate(node, lookup), None, None
    except fe.FormulaEvalError as e:
        return None, e.message, e.code


def _props_of(raw: str | None) -> dict[str, Any]:
    try:
        parsed = json.loads(raw) if raw else {}
    except (ValueError, TypeError):
        return {}
    return parsed if isinstance(parsed, dict) else {}


# ── Fingerprints ─────────────────────────────────────────────────────────────

def _defs_fp(defs: list[dict[str, Any]]) -> str:
    blob = json.dumps(
        [[d["id"], d["type"], d.get("config"), d.get("options"), d.get("updatedAt")] for d in defs],
        sort_keys=True, separators=(",", ":"),
    )
    return hashlib.sha1(blob.encode("utf-8")).hexdigest()[:16]


_LIBRARY_FP_SQL = """
SELECT
  (SELECT COUNT(*) FROM j2_notes WHERE user_id = :u AND deleted_at IS NULL),
  (SELECT COUNT(*) FROM j2_notes WHERE user_id = :u),
  (SELECT MAX(updated_at) FROM j2_notes WHERE user_id = :u),
  (SELECT MAX(deleted_at) FROM j2_notes WHERE user_id = :u),
  (SELECT COUNT(*) || ':' || COALESCE(MAX(created_at), '') || ':' || COALESCE(SUM(pnl_dollar), 0)
          || ':' || COALESCE(SUM(r_multiple), 0) || ':' || COALESCE(SUM(pnl_percent), 0)
          || ':' || COALESCE(SUM(result = 'Win'), 0)
     FROM j2_trades WHERE user_id = :u),
  (SELECT COUNT(*) || ':' || COALESCE(MAX(updated_at), '') FROM j2_option_strategies WHERE user_id = :u),
  (SELECT COUNT(*) || ':' || COALESCE(MAX(updated_at), '') || ':' || COALESCE(MAX(deleted_at), '')
     FROM j2_note_saved_views WHERE user_id = :u)
"""


def _library_fp(conn: sqlite3.Connection, user_id: str) -> str:
    row = conn.execute(_LIBRARY_FP_SQL, {"u": user_id}).fetchone()
    return hashlib.sha1("|".join(str(v) for v in tuple(row)).encode("utf-8")).hexdigest()[:16]


def _rollup_fp(lib_fp: str, defs_fp: str, config: dict[str, Any]) -> str:
    blob = f"{lib_fp}|{defs_fp}|{json.dumps(config, sort_keys=True)}"
    return "r:" + hashlib.sha1(blob.encode("utf-8")).hexdigest()[:20]


# ── The cache ────────────────────────────────────────────────────────────────

_UPSERT = (
    "INSERT INTO j2_note_computed"
    " (user_id, note_id, property_id, num_value, reason, set_size, used_size, fingerprint, computed_at)"
    " VALUES (?,?,?,?,?,?,?,?,?)"
    " ON CONFLICT(user_id, property_id, note_id) DO UPDATE SET"
    " num_value = excluded.num_value, reason = excluded.reason, set_size = excluded.set_size,"
    " used_size = excluded.used_size, fingerprint = excluded.fingerprint, computed_at = excluded.computed_at"
)


def _chunks(seq: list[Any], n: int = _CHUNK):
    for i in range(0, len(seq), n):
        yield seq[i:i + n]


def _ensure_formula(conn, user_id, d, by_id, defs_fp, note_ids: list[str] | None) -> None:
    fp_expr = "COALESCE(n.updated_at, '') || '|' || COALESCE(length(n.properties_json), 0) || '|' || ?"
    base = (
        f"SELECT n.id, n.properties_json, {fp_expr} AS fp FROM j2_notes n"
        " LEFT JOIN j2_note_computed c ON c.user_id = n.user_id AND c.property_id = ? AND c.note_id = n.id"
        " WHERE n.user_id = ? AND n.deleted_at IS NULL"
        f" AND (c.note_id IS NULL OR c.fingerprint != {fp_expr})"
    )
    rows: list[sqlite3.Row] = []
    if note_ids is None:
        rows = conn.execute(base, (defs_fp, d["id"], user_id, defs_fp)).fetchall()
    else:
        for part in _chunks(note_ids):
            marks = ",".join("?" * len(part))
            rows += conn.execute(base + f" AND n.id IN ({marks})", (defs_fp, d["id"], user_id, defs_fp, *part)).fetchall()
    if not rows:
        return
    now = _now_iso()
    batch = []
    for r in rows:
        value, reason, _code = _eval_formula(d["id"], _props_of(r["properties_json"]), by_id)
        batch.append((user_id, r["id"], d["id"], value, reason, None, None, r["fp"], now))
    conn.executemany(_UPSERT, batch)
    conn.commit()


def _stale_note_ids(conn, user_id, pid, fp, note_ids: list[str] | None) -> list[str]:
    base = (
        "SELECT n.id FROM j2_notes n"
        " LEFT JOIN j2_note_computed c ON c.user_id = n.user_id AND c.property_id = ? AND c.note_id = n.id"
        " WHERE n.user_id = ? AND n.deleted_at IS NULL AND (c.note_id IS NULL OR c.fingerprint != ?)"
    )
    if note_ids is None:
        return [r[0] for r in conn.execute(base, (pid, user_id, fp))]
    out: list[str] = []
    for part in _chunks(note_ids):
        marks = ",".join("?" * len(part))
        out += [r[0] for r in conn.execute(base + f" AND n.id IN ({marks})", (pid, user_id, fp, *part))]
    return out


# ── Rollup sets ──────────────────────────────────────────────────────────────

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


def _saved_view_set(conn, user_id, view_id: str) -> tuple[int, list[str]] | None:
    """(set size, [member ids, capped]) for a saved view, or None if it is gone."""
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
    from api.services.journal_two.note_properties import property_filter_sql
    where, params = property_filter_sql(user_id, spec.get("propertyFilter"), conn, strict=False)
    base = " FROM j2_notes WHERE user_id = ? AND deleted_at IS NULL" + where
    total = conn.execute("SELECT COUNT(*)" + base, (user_id, *params)).fetchone()[0]
    ids = [r[0] for r in conn.execute(
        "SELECT id" + base + " ORDER BY updated_at DESC, id LIMIT ?", (user_id, *params, MAX_ROLLUP_SET))]
    return int(total), ids


def _member_values(conn, user_id, prop: dict | None, member_ids: list[str], by_id, defs_fp) -> dict[str, Any]:
    """note id -> the rolled-up property's value on that note (None when empty)."""
    if prop is None or not member_ids:
        return {}
    uniq = list(dict.fromkeys(member_ids))
    out: dict[str, Any] = {}
    if prop["type"] == "formula":
        _ensure_formula(conn, user_id, prop, by_id, defs_fp, uniq)
        for part in _chunks(uniq):
            marks = ",".join("?" * len(part))
            for r in conn.execute(
                "SELECT note_id, num_value FROM j2_note_computed"
                f" WHERE user_id = ? AND property_id = ? AND note_id IN ({marks})",
                (user_id, prop["id"], *part),
            ):
                out[r["note_id"]] = r["num_value"]
        return out
    for part in _chunks(uniq):
        marks = ",".join("?" * len(part))
        for r in conn.execute(
            f"SELECT id, properties_json FROM j2_notes WHERE user_id = ? AND id IN ({marks})",
            (user_id, *part),
        ):
            out[r["id"]] = _props_of(r["properties_json"]).get(prop["id"])
    return out


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


def _compute_rollups(conn, user_id, d, by_id, defs_fp, src_ids: list[str], fp: str) -> None:
    config = d.get("config") or {}
    source = config.get("source")
    prop = by_id.get(config.get("propertyId")) if config.get("propertyId") else None
    now = _now_iso()
    batch = []
    if config.get("propertyId") and prop is None:
        for sid in src_ids:
            batch.append((user_id, sid, d["id"], None, "The property this rollup reads was deleted", None, None, fp, now))
    elif source == "saved_view":
        got = _saved_view_set(conn, user_id, config.get("savedViewId"))
        if got is None:
            for sid in src_ids:
                batch.append((user_id, sid, d["id"], None, "The saved view this rollup reads was deleted",
                              None, None, fp, now))
        else:
            total, ids = got
            vals_by_id = _member_values(conn, user_id, prop, ids, by_id, defs_fp)
            vals = [vals_by_id.get(i) for i in ids]
            value, reason = _aggregate(config, prop, vals, total, len(ids))
            for sid in src_ids:
                batch.append((user_id, sid, d["id"], value, reason, total, len(ids), fp, now))
    elif source == "trades":
        sets = _trade_sets(conn, user_id, config.get("tradeField"), None if len(src_ids) > _CHUNK * 4 else src_ids)
        for sid in src_ids:
            total, vals = sets.get(sid, (0, []))
            value, reason = _aggregate(config, None, vals, total, len(vals))
            batch.append((user_id, sid, d["id"], value, reason, total, len(vals), fp, now))
    else:
        sets = _link_sets(conn, user_id, source, None if len(src_ids) > _CHUNK * 4 else src_ids)
        all_mids = [m for sid in src_ids for m in sets.get(sid, (0, []))[1]]
        vals_by_id = _member_values(conn, user_id, prop, all_mids, by_id, defs_fp)
        for sid in src_ids:
            total, mids = sets.get(sid, (0, []))
            value, reason = _aggregate(config, prop, [vals_by_id.get(m) for m in mids], total, len(mids))
            batch.append((user_id, sid, d["id"], value, reason, total, len(mids), fp, now))
    conn.executemany(_UPSERT, batch)
    conn.commit()


# ── Public entry points ──────────────────────────────────────────────────────

def computed_defs(conn: sqlite3.Connection, user_id: str) -> list[dict[str, Any]]:
    return [d for d in _live_user_defs(conn, user_id) if d["type"] in COMPUTED_TYPES]


def ensure_fresh(
    conn: sqlite3.Connection, user_id: str, property_id: str, note_ids: list[str] | None = None,
) -> bool:
    """Make the cached rows of ONE computed property current for `note_ids`
    (None = every live note of the member). True when the rows are current,
    False when a recompute failed and the cache may be stale."""
    defs = _live_user_defs(conn, user_id)
    by_id = {d["id"]: d for d in defs}
    d = by_id.get(property_id)
    if d is None or d["type"] not in COMPUTED_TYPES:
        return True
    defs_fp = _defs_fp(defs)
    try:
        if d["type"] == "formula":
            _ensure_formula(conn, user_id, d, by_id, defs_fp, note_ids)
        else:
            fp = _rollup_fp(_library_fp(conn, user_id), defs_fp, d.get("config") or {})
            stale = _stale_note_ids(conn, user_id, property_id, fp, note_ids)
            if stale:
                _compute_rollups(conn, user_id, d, by_id, defs_fp, stale, fp)
        return True
    except sqlite3.Error:
        conn.rollback()
        return False


def values_for_notes(
    conn: sqlite3.Connection, user_id: str, note_ids: list[str],
) -> dict[str, dict[str, dict[str, Any]]]:
    """note id -> property id -> {value, reason, computedAt, setSize, usedSize,
    capped, stale} for every computed property of the member."""
    if not note_ids:
        return {}
    defs = computed_defs(conn, user_id)
    if not defs:
        return {}
    out: dict[str, dict[str, dict[str, Any]]] = {nid: {} for nid in note_ids}
    for d in defs:
        fresh = ensure_fresh(conn, user_id, d["id"], note_ids)
        for part in _chunks(note_ids):
            marks = ",".join("?" * len(part))
            for r in conn.execute(
                "SELECT note_id, num_value, reason, set_size, used_size, computed_at FROM j2_note_computed"
                f" WHERE user_id = ? AND property_id = ? AND note_id IN ({marks})",
                (user_id, d["id"], *part),
            ):
                cell = {
                    "value": r["num_value"], "reason": r["reason"], "computedAt": r["computed_at"],
                    "kind": d["type"], "name": d["name"],
                }
                if d["type"] == "rollup":
                    cell["setSize"] = r["set_size"]
                    cell["usedSize"] = r["used_size"]
                    cell["capped"] = bool(r["set_size"] is not None and r["used_size"] is not None
                                          and r["used_size"] < r["set_size"])
                    cell["aggregate"] = (d.get("config") or {}).get("aggregate")
                if not fresh:
                    cell["stale"] = True
                out.setdefault(r["note_id"], {})[d["id"]] = cell
    return out


def sort_sql(user_id: str, property_id: str, direction: str) -> tuple[str, list[Any]]:
    """An ORDER BY fragment over the cached value, empties last either way."""
    sub = ("(SELECT c.num_value FROM j2_note_computed c"
           " WHERE c.user_id = ? AND c.property_id = ? AND c.note_id = j2_notes.id)")
    d = "ASC" if direction == "asc" else "DESC"
    return f"({sub} IS NULL), {sub} {d}, j2_notes.id ASC", [user_id, property_id, user_id, property_id]


_FILTER_OPS = {"eq": "=", "neq": "!=", "gt": ">", "gte": ">=", "lt": "<", "lte": "<="}


def filter_sql(user_id: str, property_id: str, op: str, value: Any) -> tuple[str, list[Any]]:
    sub = ("(SELECT c.num_value FROM j2_note_computed c"
           " WHERE c.user_id = ? AND c.property_id = ? AND c.note_id = j2_notes.id)")
    if op == "is_empty":
        return f"{sub} IS NULL", [user_id, property_id]
    if op == "is_not_empty":
        return f"{sub} IS NOT NULL", [user_id, property_id]
    if op not in _FILTER_OPS:
        raise ComputedConfigError(f"{op!r} is not supported for a calculated property")
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ComputedConfigError("Filter a calculated property by a number")
    return f"{sub} {_FILTER_OPS[op]} ?", [user_id, property_id, float(value)]
