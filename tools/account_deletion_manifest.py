"""The account-deletion manifest's purge table, DERIVED from the purge code (wave 7 lane J, J4).

`docs/account-deletion-manifest.md` lists the tables an account deletion clears. It was
hand-typed, and at the wave-6 close it was 16 tables short of what
`api/services/journal_two/account_purge.py` actually deletes (20 by wave 7). A list beside
the code it describes drifts; so the table is generated from that code and never typed:

    python tools/account_deletion_manifest.py            # print the generated block
    python tools/account_deletion_manifest.py --write    # rewrite the block in the doc
    python tools/account_deletion_manifest.py --check    # exit 1 when the doc's block differs

Read by AST, never by importing the purge module: `_DIRECT_USER_TABLES` (one
`DELETE ... WHERE user_id = ?` each) and every `_run("<table>", "<sql>", ...)` call whose
table is a literal. Such a call is one of two shapes, and anything else RAISES:
  * an indirect-ownership JOIN delete, whose owner key is read out of its own SQL;
  * a KEYED delete, `DELETE FROM <t> WHERE <col> = ?` with the member's `user_id` as its one
    parameter, for a member-keyed table whose column is not named `user_id` (ruling D-H10's
    `daily_usage_counters`, keyed by `subject`). A keyed delete ON `user_id` is refused: that
    table belongs in `_DIRECT_USER_TABLES`, the one list of direct deletes.
`tests/test_account_deletion_manifest.py` parses the doc's table and this derivation and fails
BY NAME on a difference in either direction.

Pure text in, text out: this touches no database and no path outside the repo.
"""
from __future__ import annotations

import ast
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
PURGE = REPO / "api" / "services" / "journal_two" / "account_purge.py"
DOC = REPO / "docs" / "account-deletion-manifest.md"

BEGIN = ("<!-- BEGIN GENERATED: python tools/account_deletion_manifest.py --write "
         "(derived from api/services/journal_two/account_purge.py) -- never hand-edit -->")
END = "<!-- END GENERATED -->"

_JOIN = re.compile(
    r"DELETE FROM (?P<table>\w+) WHERE (?P<fk>\w+) IN\s*"
    r"\(SELECT id FROM (?P<parent>\w+) WHERE user_id = \?\)",
    re.IGNORECASE,
)
_KEYED = re.compile(r"^\s*DELETE FROM (?P<table>\w+) WHERE (?P<col>\w+) = \?\s*$", re.IGNORECASE)


def _params_are_the_user_id(node: ast.Call) -> bool:
    """`_run(table, sql, (user_id,))` -- the member's id and nothing else."""
    if len(node.args) < 3 or not isinstance(node.args[2], ast.Tuple):
        return False
    elts = node.args[2].elts
    return len(elts) == 1 and isinstance(elts[0], ast.Name) and elts[0].id == "user_id"


class DerivationError(RuntimeError):
    """The purge code no longer has the shape this derivation reads. Never a silent empty list."""


def derive(source: str | None = None) -> dict:
    """`{"direct": [names in code order], "indirect": [(table, fk, parent)],
    "keyed": [(table, column)]}`."""
    src = PURGE.read_text(encoding="utf-8") if source is None else source
    tree = ast.parse(src)
    direct = None
    for node in tree.body:
        if isinstance(node, ast.Assign) and any(
                isinstance(t, ast.Name) and t.id == "_DIRECT_USER_TABLES" for t in node.targets):
            if not isinstance(node.value, (ast.Tuple, ast.List)):
                raise DerivationError("_DIRECT_USER_TABLES is no longer a literal tuple/list")
            direct = []
            for elt in node.value.elts:
                if not (isinstance(elt, ast.Constant) and isinstance(elt.value, str)):
                    raise DerivationError(f"_DIRECT_USER_TABLES holds a non-literal at line {elt.lineno}")
                direct.append(elt.value)
    if not direct:
        raise DerivationError("no _DIRECT_USER_TABLES assignment found in account_purge.py")
    indirect, keyed = [], []
    for node in ast.walk(tree):
        if not (isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == "_run"):
            continue
        if not (node.args and isinstance(node.args[0], ast.Constant) and isinstance(node.args[0].value, str)):
            continue                     # the loop's `_run(table, ...)` over _DIRECT_USER_TABLES
        table = node.args[0].value
        sql = node.args[1].value if len(node.args) > 1 and isinstance(node.args[1], ast.Constant) else ""
        m = _JOIN.search(sql or "")
        if m and m.group("table") == table:
            indirect.append((table, m.group("fk"), m.group("parent")))
            continue
        k = _KEYED.match(sql or "")
        if k and k.group("table") == table and k.group("col").lower() != "user_id" \
                and _params_are_the_user_id(node):
            keyed.append((table, k.group("col")))
            continue
        why = ("a `user_id` delete belongs in _DIRECT_USER_TABLES" if k and k.group("col").lower() == "user_id"
               else "its SQL is neither a join delete nor a keyed delete on the member's user_id")
        raise DerivationError(f"_run({table!r}, ...) at line {node.lineno}: {why}")
    dupes = sorted({t for t in direct if direct.count(t) > 1})
    if dupes:
        raise DerivationError(f"listed twice in _DIRECT_USER_TABLES: {dupes}")
    return {"direct": direct, "indirect": indirect, "keyed": keyed}


def purged_tables(source: str | None = None) -> set[str]:
    d = derive(source)
    return set(d["direct"]) | {t for t, _fk, _p in d["indirect"]} | {t for t, _c in d["keyed"]}


def render(source: str | None = None) -> str:
    d = derive(source)
    rows = [
        BEGIN,
        "",
        f"**{len(d['direct']) + len(d['keyed']) + len(d['indirect'])} tables** "
        f"({len(d['direct'])} direct by `user_id`, {len(d['keyed'])} direct by another member key, "
        f"{len(d['indirect'])} indirect).",
        "",
        "| Table | Owner key | Ownership | How the purge deletes it |",
        "|---|---|---|---|",
    ]
    for table, fk, parent in d["indirect"]:
        rows.append(f"| `{table}` | `{fk}` → `{parent}.user_id` | **Indirect** | "
                    f"join delete through `{parent}`, run before the direct deletes |")
    for table in d["direct"]:
        rows.append(f"| `{table}` | `user_id` | Direct | `DELETE FROM {table} WHERE user_id = ?` |")
    for table, col in d["keyed"]:
        rows.append(f"| `{table}` | `{col}` (the member's id) | Direct | "
                    f"`DELETE FROM {table} WHERE {col} = ?` |")
    rows += ["", END]
    return "\n".join(rows)


def doc_block(text: str) -> str:
    """The generated block as it stands in the doc, markers included."""
    try:
        start = text.index(BEGIN)
        end = text.index(END, start) + len(END)
    except ValueError as exc:
        raise DerivationError("the doc carries no generated block (markers missing)") from exc
    return text[start:end]


def main(argv: list[str]) -> int:
    fresh = render()
    if "--write" in argv:
        raw = DOC.read_bytes().decode("utf-8")
        eol = "\r\n" if "\r\n" in raw else "\n"
        text = raw.replace("\r\n", "\n")
        new = text.replace(doc_block(text), fresh)
        DOC.write_bytes(new.replace("\n", eol).encode("utf-8"))
        print(f"wrote {DOC.relative_to(REPO)}")
        return 0
    if "--check" in argv:
        text = DOC.read_bytes().decode("utf-8").replace("\r\n", "\n")
        if doc_block(text) != fresh:
            print("docs/account-deletion-manifest.md is STALE -- run: "
                  "python tools/account_deletion_manifest.py --write")
            return 1
        print("docs/account-deletion-manifest.md matches account_purge.py")
        return 0
    print(fresh)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
