"""EXPLAIN QUERY PLAN for get_symbol_backlinks' two statements, against the 50k seeded DB
left behind by pc4_backlinks_isolated_timing.py. Also EXPLAIN for count_notes,
folder_note_counts and list_tasks, to document the shared-model diagnostic breaches' cause.
"""
import sqlite3
import sys

DB = sys.argv[1] if len(sys.argv) > 1 else r"C:\Users\Patrick\AppData\Local\Temp\pc4_backlinks_r7ry8e71\pc4_tier_50000_yzvyl2zi\bench.db"
SYM = "AMD"
USER = "bench_user"

c = sqlite3.connect(DB)
c.row_factory = sqlite3.Row


def explain(label, sql, params):
    print(f"\n--- {label} ---")
    print(sql)
    for row in c.execute("EXPLAIN QUERY PLAN " + sql, params):
        print(" ", dict(row))


ids_sql = ("SELECT note_id FROM j2_note_embeds WHERE user_id = ? AND symbol IN (?)"
           " UNION SELECT note_id FROM j2_note_mentions WHERE user_id = ? AND symbol IN (?)")
main_sql = ("SELECT n.id, n.title, n.updated_at, COUNT(*) OVER () AS total"
            f" FROM ({ids_sql}) x"
            " CROSS JOIN j2_notes n ON n.id = x.note_id"
            " WHERE n.user_id = ? AND n.deleted_at IS NULL"
            " ORDER BY n.updated_at DESC, n.id"
            " LIMIT ?")
explain("get_symbol_backlinks main query", main_sql, [USER, SYM, USER, SYM, USER, 5])

detail_sql = ("SELECT note_id, COUNT(*) AS refs, GROUP_CONCAT(DISTINCT widget_id) AS widgets"
              " FROM j2_note_embeds WHERE user_id = ? AND symbol = ? AND note_id IN (?,?,?,?,?)"
              " GROUP BY note_id")
explain("get_symbol_backlinks detail query", detail_sql, [USER, SYM, "a", "b", "c", "d", "e"])

explain("count_notes", "SELECT count(*) FROM j2_notes WHERE user_id = ? AND deleted_at IS NULL"
        " AND archived_at IS NULL", [USER])

explain("folder_note_counts",
        "SELECT folder_id, count(*) FROM j2_notes WHERE user_id = ? AND deleted_at IS NULL"
        " AND archived_at IS NULL GROUP BY folder_id", [USER])

explain("list_tasks (body scan)",
        "SELECT id FROM j2_notes WHERE user_id = ? AND deleted_at IS NULL AND archived_at IS NULL"
        " AND instr(body_json, 'taskItem') > 0 ORDER BY updated_at DESC", [USER])

# Actual counts to size k (the symbol's hit count) vs n (library size).
k = c.execute(f"SELECT COUNT(*) FROM ({ids_sql}) x", [USER, SYM, USER, SYM]).fetchone()[0]
n_total = c.execute("SELECT COUNT(*) FROM j2_notes WHERE user_id = ?", [USER]).fetchone()[0]
print(f"\nk (symbol hit rows, pre-dedupe union) = {k}, n (library size) = {n_total}, k/n = {k/n_total:.4f}")

c.close()
