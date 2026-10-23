"""The rail: no module outside accounts.py reads a raw account size (Round B task 3).

`accounts.member_set_account_size` is the ONE predicate for "did the member set a size", and
`accounts.own_account_size` / `account_size_of` / `read_member_account_size` /
`account_size_basis` are its doors. A module that reads the size key itself (`accountSize` off a
settings dict, `account_size` off a j2_accounts row, or a SELECT of the column) builds a second
authority, and the migrated 100,000 placeholder reads as a real size again. That is how eleven
readers disagreed until Round B.

Derived by AST over api/**, never by grep. A planted raw read must fail it (the controls)."""

import ast
import pathlib
import re

REPO = pathlib.Path(__file__).resolve().parents[1]
AUTHORITY = "api/services/journal_two/accounts.py"

#: (file, function) pairs that read a size key and are NOT a second authority, each with why.
#: A new entry needs a reason a reviewer can check; the set is matched exactly.
EXEMPT = {
    # The settings WRITE path: validating the member's PUT body, and passing that validated
    # value to accounts.marked_after_write. It reads what the member typed, not a stored size.
    ("api/services/journal_two/settings.py", "validate_settings_payload"),
    ("api/services/journal_two/settings.py", "upsert_settings"),
    # Reads `chart_plan.account_inputs`' answer, which is already accounts.own_account_size.
    ("api/routers/notebook_chart_alerts.py", "size"),
}
#: Schema and migration DDL name the column without reading a member's size.
SQL_EXEMPT_FILES = {"api/services/journal_two/db.py"}

_SELECT_SIZE = re.compile(
    r"\bselect\b[\s\S]*?\baccount_size\b(?!_)[\s\S]*?\bfrom\s+j2_accounts\b|\bsum\s*\(\s*account_size\s*\)",
    re.IGNORECASE)
_SELECTS_ACCOUNTS = re.compile(r"\bselect\b[\s\S]*?\bfrom\s+j2_accounts\b", re.IGNORECASE)


def _const(node):
    return node.value if isinstance(node, ast.Constant) and isinstance(node.value, str) else None


def raw_reads(source: str, rel: str) -> list[str]:
    """Every raw account-size read in one module, as 'file:line function: what'."""
    tree = ast.parse(source)
    parents: dict[ast.AST, ast.AST] = {}
    for p in ast.walk(tree):
        for c in ast.iter_child_nodes(p):
            parents[c] = p

    def func_of(node):
        while node in parents:
            node = parents[node]
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                return node.name
        return "<module>"

    strings = [n.value for n in ast.walk(tree) if _const(n) is not None]
    selects_rows = any(_SELECTS_ACCOUNTS.search(s) for s in strings)
    out = []
    for n in ast.walk(tree):
        what = None
        if isinstance(n, ast.Subscript) and isinstance(n.ctx, ast.Load):
            key = _const(n.slice)
            if key == "accountSize" or (key == "account_size" and selects_rows):
                what = f'[{key!r}]'
        elif (isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)
              and n.func.attr in ("get", "pop") and n.args):
            # Only the settings key: a sqlite3.Row has no .get, so a snake-case .get is a tool
            # argument or an already-resolved dict, never a j2_accounts row.
            if _const(n.args[0]) == "accountSize":
                what = f".{n.func.attr}('accountSize')"
        elif _const(n) is not None and rel not in SQL_EXEMPT_FILES and _SELECT_SIZE.search(n.value):
            what = "SQL reads account_size"
        if what is None:
            continue
        fn = func_of(n)
        if (rel, fn) in EXEMPT:
            continue
        out.append(f"{rel}:{n.lineno} {fn}: {what}")
    return out


def _modules():
    for path in sorted((REPO / "api").rglob("*.py")):
        rel = path.relative_to(REPO).as_posix()
        if path.name.startswith("test_") or path.name.endswith("_test.py") or rel == AUTHORITY:
            continue
        yield rel, path.read_text(encoding="utf-8")


def test_no_module_outside_accounts_reads_a_raw_account_size():
    mods = list(_modules())
    assert len(mods) > 500, f"the scan saw {len(mods)} modules; it is not looking at api/"
    found = [r for rel, src in mods for r in raw_reads(src, rel)]
    assert not found, ("these read a raw account size instead of asking accounts.own_account_size /"
                       " account_size_of / read_member_account_size / account_size_basis:\n  "
                       + "\n  ".join(found))


def test_every_exemption_still_names_a_real_read():
    """An exemption whose read is gone is a hole waiting for the next one: drop it."""
    for rel, fn in EXEMPT:
        src = (REPO / rel).read_text(encoding="utf-8")
        saved = set(EXEMPT)
        try:
            EXEMPT.discard((rel, fn))
            assert any(f" {fn}: " in r for r in raw_reads(src, rel)), (rel, fn)
        finally:
            EXEMPT.clear()
            EXEMPT.update(saved)


# ── Non-vacuity controls: a planted raw read fails it ────────────────────────────────────────

def test_a_planted_settings_read_is_caught():
    src = 'def f(settings):\n    return float(settings.get("accountSize") or 0)\n'
    assert raw_reads(src, "api/services/planted.py") == [
        "api/services/planted.py:2 f: .get('accountSize')"]
    src = 'def g(s):\n    return s["accountSize"]\n'
    assert raw_reads(src, "api/services/planted.py") == ["api/services/planted.py:2 g: ['accountSize']"]


def test_a_planted_sql_read_and_row_read_are_caught():
    src = ('def h(conn, u):\n'
           '    row = conn.execute("SELECT account_size FROM j2_accounts WHERE user_id = ?", (u,)).fetchone()\n'
           '    return row["account_size"]\n')
    got = raw_reads(src, "api/services/planted.py")
    assert "api/services/planted.py:2 h: SQL reads account_size" in got
    assert "api/services/planted.py:3 h: ['account_size']" in got
    src = 'Q = "SELECT COALESCE(SUM(account_size), 0) AS t FROM j2_accounts"\n'
    assert raw_reads(src, "api/services/planted.py") == [
        "api/services/planted.py:1 <module>: SQL reads account_size"]


def test_the_scan_is_not_blind_to_the_authority_itself():
    """accounts.py is where the raw reads belong; scanned as an ordinary module it must show them."""
    src = (REPO / AUTHORITY).read_text(encoding="utf-8")
    assert raw_reads(src, "api/services/journal_two/not_accounts.py")


def test_quiet_cases_stay_quiet():
    """A tool argument named account_size, an output key, a write and the marker column are not
    reads of a stored size."""
    src = ('def k(args, out, conn):\n'
           '    n = args.get("account_size")\n'
           '    out["accountSize"] = 1\n'
           '    conn.execute("UPDATE j2_accounts SET account_size = ? WHERE id = ?", (1, 2))\n'
           '    conn.execute("SELECT account_size_set FROM j2_accounts")\n'
           '    return {"accountSize": n}\n')
    assert raw_reads(src, "api/services/planted.py") == []
