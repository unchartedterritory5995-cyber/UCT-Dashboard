"""Canonical logical diff of two SQLite artifacts (both opened immutable).

Usage: python3 logical_diff.py A.db B.db OUT.json

Per table, every row (ALL columns, timestamps included) keyed by the table's primary key:
inserted / deleted / modified, plus schema (sqlite_master) and database-level pragmas.
"""
import hashlib
import json
import sqlite3
import sys

A, B, OUT = sys.argv[1:4]


def ro(p):
    return sqlite3.connect(f"file:{p}?immutable=1", uri=True)


def snapshot(p):
    c = ro(p)
    schema = sorted(c.execute("SELECT type, name, tbl_name, sql FROM sqlite_master").fetchall(), key=str)
    prag = {k: c.execute(f"PRAGMA {k}").fetchone()[0] for k in ("user_version", "application_id", "page_size",
                                                              "encoding", "journal_mode", "auto_vacuum")}
    tables = {}
    for (t,) in c.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"):
        info = c.execute(f"PRAGMA table_info({t})").fetchall()
        cols = [r[1] for r in info]
        pk = [r[1] for r in sorted(info, key=lambda r: r[5]) if r[5] > 0] or cols
        rows = {}
        for r in c.execute(f"SELECT {','.join(cols)} FROM {t}"):
            d = dict(zip(cols, r))
            rows[json.dumps([d[k] for k in pk], default=str)] = r
        tables[t] = {"cols": cols, "pk": pk, "rows": rows}
    c.close()
    return schema, prag, tables


sa, pa, ta = snapshot(A)
sb, pb, tb = snapshot(B)
rep = {"a": A, "b": B, "schema_identical": sa == sb, "pragmas_a": pa, "pragmas_b": pb,
       "pragmas_identical": pa == pb, "tables": {}}
for t in sorted(set(ta) | set(tb)):
    ra, rb = ta.get(t, {}).get("rows", {}), tb.get(t, {}).get("rows", {})
    ins = sorted(k for k in rb if k not in ra)
    dele = sorted(k for k in ra if k not in rb)
    mod = sorted(k for k in ra if k in rb and ra[k] != rb[k])
    h = lambda rows: hashlib.sha256(json.dumps(sorted(rows.values(), key=lambda r: json.dumps(r, default=str)),
                                               default=str).encode()).hexdigest()
    rep["tables"][t] = {"rows_a": len(ra), "rows_b": len(rb), "inserted": len(ins), "deleted": len(dele),
                        "modified": len(mod), "inserted_rows": [[k, rb[k]] for k in ins[:50]],
                        "deleted_keys": dele[:50], "modified_keys": mod[:50],
                        "content_sha256_a": h(ra), "content_sha256_b": h(rb)}
rep["summary"] = {"inserted": sum(v["inserted"] for v in rep["tables"].values()),
                  "deleted": sum(v["deleted"] for v in rep["tables"].values()),
                  "modified": sum(v["modified"] for v in rep["tables"].values()),
                  "tables_changed": [t for t, v in rep["tables"].items() if v["inserted"] or v["deleted"] or v["modified"]]}
json.dump(rep, open(OUT, "w"), indent=1, sort_keys=True, default=str)
print(json.dumps({"schema_identical": rep["schema_identical"], "pragmas_identical": rep["pragmas_identical"],
                  **rep["summary"]}))
