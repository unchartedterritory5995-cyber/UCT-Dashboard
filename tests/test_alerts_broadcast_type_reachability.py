"""⛔⛔ THE DOCSTRING IS THE CONTRACT, SO THE DOCSTRING IS RAILED.

`api/services/alerts.py` listed five broadcast alert types with no status column,
and three of them could not reach a member: `stop_hit` and `scanner_match` have
emitters nothing outside `tests/` calls, and `ep_resolved` has no emitter at all.
The code was not the defect — the SENTENCE was, because a reader who believes
five types ship spends planning lanes on three that do not, and nothing in the
repo contradicted them.

The fix gives each row a `[LIVE] / [NOT WIRED] / [NOT IMPLEMENTED]` status. This
file is what stops that status from becoming the next stale artifact: every one
is DERIVED from this repo's source and compared against what the table declares.
Wire an emitter up and the row must move, or this goes red by name.

⚠️ WHAT "DERIVED" CAN AND CANNOT SETTLE, stated because a rail that overclaims is
worse than none. `add_alert` takes any string for its type, and one live caller
passes a VARIABLE (`watchlist_alert_service.deliver_alert_payload` →
`add_alert(source, …)`). No amount of source reading settles what that variable
holds at runtime. So the statuses here are about LITERAL producers: an `alert_*`
emitter in `alerts.py` that passes the type as a string constant, and Python call
sites of that emitter. That is exactly the claim the docstring makes, and it is
the claim a reader planning work needs.

⛔ EVERY SEARCH BELOW IS AST-BASED, NEVER A SUBSTRING GREP, and that is
load-bearing rather than tidy: `alerts.py`'s own docstring contains the words
`alert_regime_change`, `scanner_match`, `ep_resolved` and `stop_hit` — it is a
page of prose ABOUT the thing being measured. A text search for callers would
match the explanation and report every type as wired. An `ast.Call` node cannot
be a comment or a docstring, so prose is excluded by construction; the control
`test_CONTROL_the_caller_finder_ignores_prose_and_still_sees_a_real_call` proves
it both ways on a source deliberately stuffed with decoys. This repo has logged
six instances of a check matching its own explanation.
"""
import ast
import pathlib
import re

import pytest

_REPO = pathlib.Path(__file__).resolve().parents[1]
_ALERTS = _REPO / "api" / "services" / "alerts.py"
_ALERT_BELL = _REPO / "app" / "src" / "components" / "AlertBell.jsx"

#: Where a Python caller of a broadcast emitter could live. `app/src` is
#: JavaScript and reaches this module over HTTP, never by a Python call.
_CALLER_ROOTS = ("api", "tools", "scripts")
_SKIP_DIRS = {"__pycache__", "node_modules", "dist", ".git"}

_STATUSES = ("LIVE", "NOT WIRED", "NOT IMPLEMENTED")

#: The table row shape in `alerts.py`'s module docstring. Anchored on the
#: four-space indent, the bracketed status and the em dash, so an ordinary prose
#: mention of a type name cannot be mistaken for a row.
_ROW = re.compile(
    r"^ {4}(?P<type>\w+)\s+\[(?P<status>LIVE|NOT WIRED|NOT IMPLEMENTED)\]\s+— (?P<desc>\S.*)$",
    re.MULTILINE,
)


# ── helpers: read the source, never the prose ───────────────────────────────

def _is_test_path(path: pathlib.Path) -> bool:
    """A test file, wherever it lives. This repo keeps some beside the code it
    tests (`api/services/test_alert_durability.py`,
    `api/services/bar_broadcaster_test.py`), so `tests/` alone is not the test."""
    if "tests" in path.parts:
        return True
    return path.name.startswith("test_") or path.name.endswith("_test.py")


def _called_names(source: str) -> list[str]:
    """Every name that is CALLED in this source, as `f(...)` or `x.f(...)`.

    A docstring is an `ast.Constant`; a comment is not in the tree at all. So
    neither can appear here, which is why this is an AST walk and not a grep.
    """
    out = []
    for node in ast.walk(ast.parse(source)):
        if not isinstance(node, ast.Call):
            continue
        fn = node.func
        if isinstance(fn, ast.Attribute):
            out.append(fn.attr)
        elif isinstance(fn, ast.Name):
            out.append(fn.id)
    return out


def _emitter_for(alert_type: str) -> str | None:
    """The `alert_*` function in `alerts.py` that produces this type, by name.

    Derived: a module-level `def` whose body calls `add_alert` with this type as
    its first positional argument, as a string CONSTANT. No name convention is
    assumed and no list is typed here.
    """
    tree = ast.parse(_ALERTS.read_text(encoding="utf-8"))
    for node in tree.body:
        if not isinstance(node, ast.FunctionDef):
            continue
        for call in ast.walk(node):
            if not isinstance(call, ast.Call):
                continue
            fn = call.func
            name = fn.attr if isinstance(fn, ast.Attribute) else getattr(fn, "id", None)
            if name != "add_alert" or not call.args:
                continue
            first = call.args[0]
            if isinstance(first, ast.Constant) and first.value == alert_type:
                return node.name
    return None


def _caller_files(fn_name: str, *, include_tests: bool) -> list[str]:
    """Repo-relative paths that CALL `fn_name`, newest search first.

    ⛔ The `fn_name in text` line is a PREFILTER for speed, never the verdict —
    a file that passes it is then parsed, and only an `ast.Call` counts. Dropping
    the prefilter would change nothing but the runtime.
    """
    found = []
    for root in _CALLER_ROOTS:
        base = _REPO / root
        if not base.is_dir():
            continue
        for path in base.rglob("*.py"):
            if any(part in _SKIP_DIRS for part in path.parts):
                continue
            if _is_test_path(path) and not include_tests:
                continue
            text = path.read_text(encoding="utf-8", errors="replace")
            if fn_name not in text:
                continue
            try:
                names = _called_names(text)
            except SyntaxError:
                continue
            if fn_name in names:
                found.append(path.relative_to(_REPO).as_posix())
    if include_tests:
        for path in (_REPO / "tests").rglob("*.py"):
            text = path.read_text(encoding="utf-8", errors="replace")
            if fn_name not in text:
                continue
            try:
                names = _called_names(text)
            except SyntaxError:
                continue
            if fn_name in names:
                found.append(path.relative_to(_REPO).as_posix())
    return sorted(found)


def _measured_status(alert_type: str) -> str:
    emitter = _emitter_for(alert_type)
    if emitter is None:
        return "NOT IMPLEMENTED"
    return "LIVE" if _caller_files(emitter, include_tests=False) else "NOT WIRED"


@pytest.fixture(scope="module")
def declared() -> dict[str, str]:
    """The table, parsed out of `alerts.py`'s own module docstring."""
    doc = ast.get_docstring(ast.parse(_ALERTS.read_text(encoding="utf-8")))
    assert doc, "alerts.py lost its module docstring — the contract lived there"
    return {m.group("type"): m.group("status") for m in _ROW.finditer(doc)}


# ── the contract ────────────────────────────────────────────────────────────

def test_the_table_parses_and_is_the_registry(declared):
    """⛔ NON-VACUITY FIRST. Every assertion in this file is trivially satisfied
    by an empty table, so a regex that stopped matching would read as a clean
    pass. Name the count, and name the set against the type registry."""
    assert len(declared) == 5, (
        f"expected 5 broadcast rows in alerts.py's docstring table, parsed "
        f"{len(declared)}: {declared}. A row whose format drifted is invisible "
        f"to every check below."
    )
    from api.services import alerts as alerts_svc
    assert set(declared) == set(alerts_svc._TYPE_SEVERITY), (
        f"the docstring table and `_TYPE_SEVERITY` disagree about which types "
        f"exist — table {sorted(declared)} vs registry "
        f"{sorted(alerts_svc._TYPE_SEVERITY)}"
    )
    assert set(declared.values()) <= set(_STATUSES)


def test_every_declared_status_is_what_the_source_actually_says(declared):
    """THE RAIL. One assertion per row, each naming its own evidence."""
    mismatches = []
    for alert_type, status in sorted(declared.items()):
        measured = _measured_status(alert_type)
        if measured != status:
            emitter = _emitter_for(alert_type)
            callers = _caller_files(emitter, include_tests=False) if emitter else []
            mismatches.append(
                f"  {alert_type}: docstring says [{status}], source says "
                f"[{measured}] (emitter={emitter!r}, non-test callers={callers})"
            )
    assert not mismatches, (
        "alerts.py's broadcast table has drifted from the code it describes:\n"
        + "\n".join(mismatches)
        + "\n\nMove the row, do not delete this rail. The table is the contract "
          "a planning lane reads."
    )


def test_the_two_live_types_name_their_caller(declared):
    """⛔ THE CONTROL FOR THE RAIL ABOVE, and it is not decoration. If the caller
    finder returned nothing for any reason — a broken walk, a wrong root, an
    exception swallowed — every type would measure NOT WIRED and two rows would
    already be red. Assert the positive case explicitly so the failure says
    "the finder is broken" rather than "the code changed"."""
    live = [t for t, s in declared.items() if s == "LIVE"]
    assert live, "no row claims LIVE — this control cannot discriminate"
    for alert_type in live:
        emitter = _emitter_for(alert_type)
        callers = _caller_files(emitter, include_tests=False)
        assert callers, f"{emitter} measured as having no caller at all"
        assert "api/routers/push.py" in callers, (
            f"{emitter}'s caller moved off the wire-push path: {callers}"
        )


def test_excluding_tests_is_what_makes_scanner_match_NOT_WIRED(declared):
    """⛔ THE DISCRIMINATOR. `scanner_match` reads NOT WIRED, and that must be a
    MEASUREMENT rather than a finder that sees nothing: including `tests/` the
    same search DOES find its one caller. Without this, a silently broken search
    and a genuinely unwired emitter are the same observation.

    ⚠️ And what that one caller protects, read before relying on it:
    `tests/test_alerts_privacy.py::test_a_broadcast_alert_reaches_every_member`
    uses `alert_scanner_match` as the representative BROADCAST producer to prove
    the 2026-08-06 scoping fix did not OVER-scope and silence the market-wide
    feed. It is a privacy rail that happens to need a broadcast emitter — it is
    not protecting `scanner_match` itself. Deleting the emitter means editing
    that rail.
    """
    assert declared["scanner_match"] == "NOT WIRED"
    emitter = _emitter_for("scanner_match")
    assert emitter == "alert_scanner_match"
    assert _caller_files(emitter, include_tests=False) == [], (
        "a non-test caller appeared — move the row to [LIVE]"
    )
    with_tests = _caller_files(emitter, include_tests=True)
    assert "tests/test_alerts_privacy.py" in with_tests, (
        f"the caller search found NOTHING even with tests included, so "
        f"[NOT WIRED] above is an artefact of a broken search, not a fact "
        f"about the code: {with_tests}"
    )


def test_stop_hit_has_an_emitter_and_no_caller_anywhere_at_all(declared):
    """`stop_hit` is the stronger case than `scanner_match`: not one reference,
    test or otherwise, calls `alert_stop_hit`. Recorded so the next reader does
    not have to re-derive it — and so that a test appearing here is noticed."""
    assert declared["stop_hit"] == "NOT WIRED"
    emitter = _emitter_for("stop_hit")
    assert emitter == "alert_stop_hit"
    assert _caller_files(emitter, include_tests=True) == [], (
        "somebody wired `alert_stop_hit` up — if the caller is a test, this "
        "docstring row is still NOT WIRED; if it is production, move it to [LIVE]"
    )


def test_the_ep_resolved_registry_row_is_behaviourally_inert(declared):
    """The docstring claims `ep_resolved`'s two artefacts are inert. Prove the
    severity half: an unknown type resolves to the SAME severity the registry
    row assigns, so that row changes nothing and never did."""
    assert declared["ep_resolved"] == "NOT IMPLEMENTED"
    assert _emitter_for("ep_resolved") is None, (
        "an `ep_resolved` emitter now exists — move the row off [NOT IMPLEMENTED]"
    )

    from api.services import alerts as alerts_svc
    declared_sev = alerts_svc._TYPE_SEVERITY["ep_resolved"]
    fallback_sev = alerts_svc._TYPE_SEVERITY.get(
        "a_type_that_has_never_existed", alerts_svc.SEVERITY_INFO)
    assert declared_sev == fallback_sev, (
        f"`ep_resolved`'s registry row is no longer inert: it maps to "
        f"{declared_sev!r} while an unknown type falls back to {fallback_sev!r}. "
        f"The docstring's [NOT IMPLEMENTED] note says removing the row is a "
        f"no-op — that stopped being true."
    )


def test_the_bell_glyph_for_an_unreachable_type_is_a_lookup_not_a_legend():
    """⛔ THE ONE THING THAT WOULD MAKE THIS A MEMBER-FACING DEFECT RATHER THAN A
    READER-FACING ONE. A bell glyph for an alert that can never arrive is
    harmless — nothing renders it until such an alert exists. A LEGEND, a filter
    strip or any enumeration of the icon map would be different: it would promise
    a member a notification they can never receive.

    Measured: `TYPE_ICONS` is read exactly once, as `TYPE_ICONS[a.type] ||
    'bell'`, per row. `app/src` is not this change's to edit, so this is a rail
    on someone else's file — it fails if that becomes an enumeration.
    """
    raw = _ALERT_BELL.read_text(encoding="utf-8")
    # Strip JS comments: AlertBell.jsx opens with a page of prose about alerts,
    # and its comments name `ep_resolved`'s neighbours.
    code = re.sub(r"/\*.*?\*/", "", raw, flags=re.DOTALL)
    code = re.sub(r"^\s*//.*$", "", code, flags=re.MULTILINE)

    # (a) the stripper still sees real code — without this the checks below pass
    #     on an empty string.
    assert "const TYPE_ICONS = {" in code, "the comment stripper ate the code"
    assert "TYPE_ICONS[a.type]" in code, (
        "the per-row lookup is gone — re-measure how the icon map is consumed"
    )
    # (b) and the prose really was in there, so (a) is not a coincidence.
    assert "unauthenticated global list" in raw
    assert "unauthenticated global list" not in code

    for enumeration in ("Object.keys(TYPE_ICONS", "Object.entries(TYPE_ICONS",
                        "Object.values(TYPE_ICONS", "TYPE_ICONS)."):
        assert enumeration not in code, (
            f"`{enumeration}` — the icon map is now ENUMERATED, so the UI may be "
            f"rendering a legend that promises members `ep_resolved`, an alert "
            f"type with no producer. Either wire the type up or drop it from the "
            f"legend; a glyph is harmless, a promise is not."
        )


def test_the_five_names_are_enumerated_in_ONE_place_in_the_docstring():
    """⛔ THE SECOND-AUTHORITY GUARD. A paragraph further down used to re-list all
    five names while explaining the broadcast/private split. Two lists, one
    value: the copy with no rail is the one that goes stale, and nothing fails
    when it does. The table is the only enumeration."""
    doc = ast.get_docstring(ast.parse(_ALERTS.read_text(encoding="utf-8")))
    names = {m.group("type") for m in _ROW.finditer(doc)}
    assert len(names) == 5, f"precondition: expected 5 table rows, saw {names}"

    row_lines = {m.group(0) for m in _ROW.finditer(doc)}
    offenders = []
    for line in doc.splitlines():
        if line in row_lines:
            continue
        mentioned = {n for n in names if n in line}
        if len(mentioned) >= 3:
            offenders.append((line.strip(), sorted(mentioned)))
    assert not offenders, (
        "a second enumeration of the broadcast types appeared in the docstring:\n"
        + "\n".join(f"  {line!r} names {names_}" for line, names_ in offenders)
        + "\nPoint at the table instead of restating it."
    )


# ── CONTROLS on the instruments themselves ──────────────────────────────────

_DECOY_SOURCE = '''
"""A module docstring that calls alert_stop_hit(symbol, 1.0, 2.0) in prose."""
# A comment mentioning alert_stop_hit("AAPL", 1.0, 2.0) and alert_scanner_match(1)
HELP = "run alert_stop_hit() to notify"

def real():
    """Docstring saying alert_scanner_match() again."""
    return alert_stop_hit("AAPL", 1.0, 2.0)
'''


def test_CONTROL_the_caller_finder_ignores_prose_and_still_sees_a_real_call():
    """⛔ BOTH HALVES, because either alone is worthless. A finder that sees
    nothing ignores prose perfectly; a finder that sees everything finds every
    real call. The decoy source puts `alert_stop_hit` in a module docstring, a
    comment, a string literal and a function docstring, and calls it ONCE."""
    called = _called_names(_DECOY_SOURCE)
    assert called.count("alert_stop_hit") == 1, (
        f"the finder matched prose or missed the real call: {called}"
    )
    assert "alert_scanner_match" not in called, (
        f"a docstring/comment mention was counted as a call: {called}"
    )
    # and the decoys really are in the text, so the assertion above is not
    # passing because the decoy source is empty.
    assert _DECOY_SOURCE.count("alert_stop_hit") == 4
    assert _DECOY_SOURCE.count("alert_scanner_match") == 2


def test_CONTROL_the_emitter_finder_can_tell_presence_from_absence():
    """A finder that always returns None makes every type NOT IMPLEMENTED; one
    that always returns a name makes none of them. Pin both directions."""
    assert _emitter_for("regime_change") == "alert_regime_change"
    assert _emitter_for("exposure_shift") == "alert_exposure_shift"
    assert _emitter_for("a_type_that_has_never_existed") is None


def test_CONTROL_test_paths_are_recognised_wherever_they_live():
    """`_is_test_path` decides LIVE vs NOT WIRED, so its blind spot would be a
    type silently promoted by its own test. This repo keeps tests beside code."""
    assert _is_test_path(_REPO / "tests" / "test_alerts_privacy.py")
    assert _is_test_path(_REPO / "api" / "services" / "test_alert_durability.py")
    assert _is_test_path(_REPO / "api" / "services" / "bar_broadcaster_test.py")
    assert not _is_test_path(_REPO / "api" / "routers" / "push.py")
    assert not _is_test_path(_REPO / "api" / "services" / "alerts.py")
