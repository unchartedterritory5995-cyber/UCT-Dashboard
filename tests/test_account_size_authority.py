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

#: (file, function, exact expression) for the reads that are NOT a second authority, each with
#: why. Matched on the exact expression (ast.unparse), so a NEW read in the same function still
#: fails (fix round 2, finding 8d). A new entry needs a reason a reviewer can check.
EXEMPT = {
    # The settings WRITE path: validating the member's PUT body, and passing that validated
    # value to accounts.marked_after_write. It reads what the member typed, not a stored size.
    ("api/services/journal_two/settings.py", "validate_settings_payload", "payload.get('accountSize')"),
    ("api/services/journal_two/settings.py", "upsert_settings", "validated['accountSize']"),
    # Reads `chart_plan.account_inputs`' answer, which is already accounts.account_size_of.
    ("api/routers/notebook_chart_alerts.py", "size", "account['accountSize']"),
    # Compass chat tool ARGUMENTS the model was handed (coach_chat_tools reads j2_accounts rows
    # elsewhere, so the module is in scope); a stored size goes through the helper beside them.
    ("api/services/journal_two/coach_chat_tools.py", "_exec_grade_ticker", "args.get('account_size')"),
    ("api/services/journal_two/coach_chat_tools.py", "_exec_portfolio_heat", "args.get('account_size')"),
    ("api/services/journal_two/coach_chat_tools.py", "_exec_grade_watchlist", "args.get('account_size')"),
}
#: Schema and migration DDL name the column without reading a member's size.
SQL_EXEMPT_FILES = {"api/services/journal_two/db.py"}

_SELECT_SIZE = re.compile(
    r"\bselect\b[\s\S]*?\baccount_size\b(?!_)[\s\S]*?\bfrom\s+j2_accounts\b|\bsum\s*\(\s*account_size\s*\)",
    re.IGNORECASE)
_SELECTS_ACCOUNTS = re.compile(r"\bselect\b[\s\S]*?\bfrom\s+j2_accounts\b", re.IGNORECASE)


def _const(node):
    return node.value if isinstance(node, ast.Constant) and isinstance(node.value, str) else None


def _text(node):
    """A string literal's text; an f-string's literal parts with `{}` for each hole (finding 8c)."""
    if _const(node) is not None:
        return node.value
    if isinstance(node, ast.JoinedStr):
        return "".join(_const(v) if _const(v) is not None else "{}" for v in node.values)
    return None


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

    strings = [t for t in (_text(n) for n in ast.walk(tree)) if t is not None]
    selects_rows = any(_SELECTS_ACCOUNTS.search(s) for s in strings)
    out = []
    for n in ast.walk(tree):
        what = None
        if isinstance(n, ast.Subscript) and isinstance(n.ctx, ast.Load):
            key = _const(n.slice)
            if key == "accountSize" or (key == "account_size" and selects_rows):
                what = f'[{key!r}]'
        elif isinstance(n, ast.Call):
            f = n.func
            name = f.attr if isinstance(f, ast.Attribute) else (f.id if isinstance(f, ast.Name) else None)
            if name in ("get", "pop") and isinstance(f, ast.Attribute) and n.args:
                key = _const(n.args[0])
                # the settings key anywhere; the column name in a module that reads j2_accounts
                # rows, where dict(row) / a row dict has .get too (finding 8a)
                if key == "accountSize" or (key == "account_size" and selects_rows):
                    what = f".{name}({key!r})"
            elif name == "member_set_account_size":
                # the predicate called directly drops the member-set marker (finding 8b): ask
                # own_account_size / account_size_of instead
                what = "member_set_account_size() called directly"
        elif rel not in SQL_EXEMPT_FILES and isinstance(n, (ast.Constant, ast.JoinedStr))                 and not isinstance(parents.get(n), ast.JoinedStr):
            t = _text(n)
            if t is not None and _SELECT_SIZE.search(t):
                what = "SQL reads account_size"
        if what is None:
            continue
        fn = func_of(n)
        if (rel, fn, ast.unparse(n)) in EXEMPT:
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
    for entry in sorted(EXEMPT):
        rel, fn, _expr = entry
        src = (REPO / rel).read_text(encoding="utf-8")
        EXEMPT.discard(entry)
        try:
            assert any(f" {fn}: " in r for r in raw_reads(src, rel)), entry
        finally:
            EXEMPT.add(entry)


def test_an_exemption_covers_its_exact_read_only():
    """A second raw read planted in an exempt function still fails (finding 8d)."""
    src = ('def size(body, account):\n'
           '    a = account["accountSize"]\n'
           '    b = body.get("accountSize")\n')
    got = raw_reads(src, "api/routers/notebook_chart_alerts.py")
    assert got == ["api/routers/notebook_chart_alerts.py:3 size: .get('accountSize')"]


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
    """A tool argument named account_size (in a module that reads no j2_accounts rows), an output
    key, a write and the marker column are not reads of a stored size."""
    src = ('def k(args, out, conn):\n'
           '    n = args.get("account_size")\n'
           '    out["accountSize"] = 1\n'
           '    conn.execute("UPDATE j2_accounts SET account_size = ? WHERE id = ?", (1, 2))\n'
           '    conn.execute("SELECT account_size_set FROM accounts_audit")\n'
           '    return {"accountSize": n}\n')
    assert raw_reads(src, "api/services/planted.py") == []


# ── Fix round 2, finding 8: each new pattern has a planted read that fails it ────────────────

def test_a_planted_snake_case_get_in_a_module_that_reads_rows_is_caught():
    src = ('def m(conn):\n'
           '    row = dict(conn.execute("SELECT * FROM j2_accounts WHERE id = 1").fetchone())\n'
           '    return row.get("account_size")\n')
    assert raw_reads(src, "api/services/planted.py") == [
        "api/services/planted.py:3 m: .get('account_size')"]


def test_a_planted_direct_predicate_call_is_caught():
    src = ('from api.services.journal_two import accounts\n'
           'def n(s):\n'
           '    return accounts.member_set_account_size(s.get("size"))\n'
           'def o(v):\n'
           '    return member_set_account_size(v)\n')
    assert raw_reads(src, "api/services/planted.py") == [
        "api/services/planted.py:3 n: member_set_account_size() called directly",
        "api/services/planted.py:5 o: member_set_account_size() called directly"]


def test_a_planted_f_string_sql_read_is_caught():
    src = ('def q(conn, cols):\n'
           '    return conn.execute(f"SELECT {cols}, account_size FROM j2_accounts WHERE id = 1")\n')
    assert raw_reads(src, "api/services/planted.py") == [
        "api/services/planted.py:2 q: SQL reads account_size"]


def test_the_client_unset_size_is_the_servers():
    """app/src/constants/accountSizeDefault.json is the client's one copy (chart calculator default,
    Journal surfaces); it must equal voice_position_sizing.UNSET_ACCOUNT_SIZE."""
    import json
    from api.services.voice_position_sizing import UNSET_ACCOUNT_SIZE
    path = REPO / "app" / "src" / "constants" / "accountSizeDefault.json"
    assert json.loads(path.read_text(encoding="utf-8"))["unsetAccountSize"] == UNSET_ACCOUNT_SIZE


def test_the_client_default_size_sentence_is_the_servers():
    """R2-3: the client's one copy of the default-size sentence (DefaultSizeMarker's hover text, the
    Portfolio Risk notice) lives in accountSizeDefault.json and must equal
    voice_position_sizing.default_size_sentence(); no component restates it."""
    import json
    from api.services.voice_position_sizing import default_size_sentence
    path = REPO / "app" / "src" / "constants" / "accountSizeDefault.json"
    assert json.loads(path.read_text(encoding="utf-8"))["defaultSizeSentence"] == default_size_sentence()
    for rel in ("app/src/components/account/DefaultSizeMarker.jsx", "app/src/pages/PortfolioHeat.jsx"):
        assert "No account size on file" not in (REPO / rel).read_text(encoding="utf-8"), rel
