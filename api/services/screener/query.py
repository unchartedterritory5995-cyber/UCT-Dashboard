"""Server-side scan: a JSON filter spec -> parametrized SQL over screener_rows.

All column names come from the registry (never from the client). Every value is
bound as a parameter, so the API surface is injection-safe.
"""
from . import filters, scan_store, snapshot_db

_SORTABLE = set(snapshot_db.COLUMNS)
_MAX_PAGE = 500
_SCAN_KEY = "scan"


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
    if not hashes or (isinstance(raw, list) and len(hashes) != len(raw)) \
            or (not isinstance(raw, (list, str))):
        raise ValueError("scan filter requires def_hash value(s)")
    for h in hashes:
        latest = scan_store.latest_covered_as_of(h, scan_store.SCAN_JOIN_TF)
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


def build_where(filter_specs, scan_joins=None):
    clauses, params = [], []
    for f in filter_specs or []:
        key, op = f.get("key"), f.get("op")
        if key == _SCAN_KEY:
            _scan_clauses(f, clauses, params, scan_joins)
            continue
        col = filters.column_for(key)
        if not col:
            raise ValueError(f"unknown filter key: {key}")
        if not filters.is_valid_op(key, op):
            raise ValueError(f"bad op {op} for {key}")
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


def run_scan(spec):
    spec = spec or {}
    scan_joins = []
    where, params = build_where(spec.get("filters"), scan_joins)
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
        select_sql = ", ".join(f'"{c}"' for c in select_cols)
        out_columns = select_cols
    else:
        select_sql = "*"
        out_columns = view["columns"]

    with snapshot_db.connect() as conn:
        rows = conn.execute(
            f"SELECT {select_sql} FROM screener_rows{where} "
            f'ORDER BY "{sort_key}" {sort_dir} NULLS LAST '
            f"LIMIT ? OFFSET ?", [*params, page_size, offset]).fetchall()
        # 🔴 THE DATE MUST DESCRIBE THE ROWS BEING SERVED, so the SAME `where`
        # and the SAME params that selected them select the description.
        #
        # This used to be `SELECT MAX(snapshot_date) FROM screener_rows` --
        # unfiltered, and the MAX. On the live snapshot that printed
        # *"snapshot 2026-08-08"* over 3,583 rows built 2026-07-11, because ONE
        # row had been rebuilt. The member screened on month-old fundamentals
        # under today's date. See `snapshot_db.describe_rows` for the argument;
        # the short version is that a rank statistic has no threshold to get
        # wrong, and one number cannot honestly describe three dates.
        #
        # ⛔ THE RESULT SET IS NOT TOUCHED. Filtering the rows down to the
        # representative date would silently drop symbols -- a fixed label at
        # the price of a missing-data bug -- and a screen that quietly returns
        # fewer names looks like a quiet market.
        snap = snapshot_db.describe_rows(conn, where, params)
    # `total` IS the described row count. One `GROUP BY` already counted every
    # matching row, so re-running `COUNT(*)` would be a second authority over
    # one value -- exactly the drift that lets a label and a total disagree.
    return {"total": snap["rows"], "rows": [dict(r) for r in rows],
            "view": view_key, "view_columns": out_columns,
            "snapshot_date": snap["snapshot_date"], "snapshot": snap,
            "page": page, "page_size": page_size, "scan_joins": scan_joins}
