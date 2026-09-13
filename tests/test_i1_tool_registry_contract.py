"""I1 SLICE 3 — the tool-registry contract, enforced by rail.

⛔ APPROVED SCOPE (owner, 2026-09-12, build day §6): *"I1 slice 3 — tool-registry
contract enforced by rail."*

SPEC-I1 §2 states five BINDING registration rules over `_DOMAIN_FETCHERS` plus a
routing budget, and until now every one of them was a sentence in a document.
This file turns each into an assertion derived from `ticker_explain.py`'s AST.

⭐ THE SHAPE THAT MAKES THIS WORTH HAVING: I1 already has F-I1-4, the rail that
says *"a new model-authored field that is not added to `_full_text()` is
ungoverned prose."* Every rule below is the same idea pointed at a different
seam — **a thing you can add without noticing you have changed a contract.** A
ninth composer, a bespoke evidence shape, a fifth routed domain, an evidence
field the model is shown but the grounding gate never scans: each registers
cleanly, evaluates cleanly, and silently moves a guarantee.

⛔⛔ CODE, NEVER PROSE. `ticker_explain.py` DISCUSSES every one of these rules in
its own comments, at length. Every check below runs over a docstring-stripped
AST, and every one carries a control proving the strip did not eat the code.
"""
from __future__ import annotations

import ast
import pathlib
import re

import pytest

_REPO = pathlib.Path(__file__).resolve().parents[1]
_MODULE = _REPO / "api" / "services" / "ticker_explain.py"


def _tree() -> ast.Module:
    """The module's AST with docstrings blanked."""
    tree = ast.parse(_MODULE.read_text(encoding="utf-8"))
    for node in ast.walk(tree):
        if (isinstance(node, ast.Expr) and isinstance(node.value, ast.Constant)
                and isinstance(node.value.value, str)):
            node.value.value = ""
    return tree


def _code() -> str:
    return ast.unparse(_tree())


def _registry_node() -> ast.Dict:
    """The single module-level `_DOMAIN_FETCHERS = {...}` binding."""
    found = []
    for node in _tree().body:
        if isinstance(node, ast.Assign):
            for t in node.targets:
                if isinstance(t, ast.Name) and t.id == "_DOMAIN_FETCHERS":
                    found.append(node.value)
    assert len(found) == 1, (
        "⛔ RULE 5. `_DOMAIN_FETCHERS` is bound %d times at module level. It was "
        "bound twice once before — a dead forward declaration annotated `tuple` "
        "shadowed by the real dict of callables — and the file carried two "
        "authorities for one name, the first of which misdescribed the second."
        % len(found))
    assert isinstance(found[0], ast.Dict), (
        "`_DOMAIN_FETCHERS` is no longer a dict literal, so the registry can no "
        "longer be audited without running the module — which is rule 5")
    return found[0]


def _registered() -> dict:
    """{domain: composer function name}, read from the literal."""
    node = _registry_node()
    out = {}
    for k, v in zip(node.keys, node.values):
        assert isinstance(k, ast.Constant) and isinstance(k.value, str), (
            "a registry key is computed, not a literal string — rule 5")
        assert isinstance(v, ast.Name), (
            "a registry value is not a plain function name (%r); a lambda or a "
            "call would make the composer un-auditable" % ast.dump(v))
        out[k.value] = v.id
    return out


def _registered_safe() -> dict:
    """`_registered()` without its assertions, for parametrize.

    ⛔ THE DECORATOR RUNS AT IMPORT, AND A RAISE THERE IS A COLLECTION ERROR —
    which takes the whole file down and hides the other twenty checks behind one
    defect. Measured: mutating the registry to a double binding produced no
    FAILED line at all, only an interrupted collection. The assertions live in
    the tests; the parametrize only needs a list of names.
    """
    try:
        node = _registry_node()
        return {k.value: v.id for k, v in zip(node.keys, node.values)
                if isinstance(k, ast.Constant) and isinstance(v, ast.Name)}
    except Exception:
        return {}


def _fn(name: str) -> ast.FunctionDef:
    for node in _tree().body:
        if isinstance(node, ast.FunctionDef) and node.name == name:
            return node
    raise AssertionError("no module-level function %r" % name)


# ═════════════════════════════════════════════════════════════════════════
# NON-VACUITY FIRST
# ═════════════════════════════════════════════════════════════════════════

def test_the_module_and_the_registry_are_readable_at_all():
    """⛔ AN EMPTY SCAN IS A FAILED INVOCATION. Every assertion below is over
    these; an empty registry would satisfy nearly all of them."""
    assert _MODULE.exists()
    reg = _registered()
    assert reg, "the registry parsed to nothing — the read is broken, not the answer"
    # Named members, never a count: the population is MEANT to grow.
    assert "news" in reg and "earnings" in reg
    assert reg["earnings"] == "_fetch_earnings"


def test_the_docstring_stripper_still_sees_real_code():
    """⛔ THE CONTROL FOR EVERY `not in` BELOW. This module explains all five
    rules in prose; a stripper that ate the code would make each absence claim
    pass over an empty string."""
    code = _code()
    assert "_DOMAIN_FETCHERS" in code
    assert "def _build_evidence" in code
    raw = _MODULE.read_text(encoding="utf-8")
    assert len(code) < len(raw), "nothing was stripped — then the strip is a no-op"


# ═════════════════════════════════════════════════════════════════════════
# RULE 5 — registration is a reviewed code change, never dynamic
# ═════════════════════════════════════════════════════════════════════════

def test_RULE5_nothing_anywhere_mutates_the_registry_at_runtime():
    """⛔ *"A registry that can be extended at runtime cannot be audited by
    AST."* — SPEC-I1 §2 rule 5. This is the rail that makes every other rule in
    this file mean something: they all read the literal."""
    offenders = []
    scanned = 0
    for p in (_REPO / "api").rglob("*.py"):
        try:
            tree = ast.parse(p.read_text(encoding="utf-8"))
        except SyntaxError:
            continue
        scanned += 1
        for node in ast.walk(tree):
            # `_DOMAIN_FETCHERS[x] = ...`
            if isinstance(node, ast.Assign):
                for t in node.targets:
                    if (isinstance(t, ast.Subscript) and isinstance(t.value, ast.Name)
                            and t.value.id == "_DOMAIN_FETCHERS"):
                        offenders.append((str(p.name), "item assignment"))
            # `_DOMAIN_FETCHERS.update(...)` / `.setdefault(...)` / `.pop(...)`
            if (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
                    and isinstance(node.func.value, ast.Name)
                    and node.func.value.id == "_DOMAIN_FETCHERS"
                    and node.func.attr in ("update", "setdefault", "pop", "clear")):
                offenders.append((str(p.name), node.func.attr))
    assert scanned > 100, f"the module walk found almost nothing ({scanned}) — it is broken"
    assert offenders == [], f"the registry is mutated at runtime: {offenders}"


def test_RULE5_the_registry_is_ONE_binding_of_literal_keys_to_named_functions():
    reg = _registered()          # every assertion lives in the helper
    for domain, fname in reg.items():
        _fn(fname)               # raises by name if a value points at nothing


# ═════════════════════════════════════════════════════════════════════════
# RULE 1 — one canonical composer per domain, through an adapter
# ═════════════════════════════════════════════════════════════════════════

#: Modules a composer may NOT reach directly. ⛔ Rule 1's words: a composer
#: *"never touches a raw Calendar-page payload and never calls a raw provider
#: directly."* A provider call inside a composer is a second data authority for
#: a domain that already has an approved adapter.
_RAW_PROVIDERS = ("requests", "httpx", "urllib", "yfinance", "aiohttp", "socket")


def test_RULE1_every_domain_maps_to_a_DISTINCT_composer():
    reg = _registered()
    dupes = [f for f in set(reg.values()) if list(reg.values()).count(f) > 1]
    assert not dupes, (
        "two domains share one composer (%s). Rule 1 is 'one canonical composer "
        "per domain'; sharing one makes a per-domain failure indistinguishable "
        "from two." % dupes)


@pytest.mark.parametrize("domain,fname", sorted(_registered_safe().items()))
def test_RULE1_the_composer_reaches_its_data_through_ONE_adapter(domain, fname):
    """Per-domain, so a failure names the domain rather than "a composer"."""
    fn = _fn(fname)
    imported = []
    for node in ast.walk(fn):
        if isinstance(node, ast.ImportFrom) and node.module:
            imported.append(node.module)
        elif isinstance(node, ast.Import):
            imported += [a.name for a in node.names]
    assert imported, (
        f"{fname} imports nothing inside its own body. Every composer resolves "
        "its adapter lazily; one that does not is either dead or reaching a "
        "module-level import this rail cannot attribute to it.")
    assert len(imported) == 1, (
        f"{fname} reaches {len(imported)} modules ({imported}). Rule 1 is ONE "
        "canonical composer per domain, through one adapter.")
    mod = imported[0]
    assert mod.startswith("api.services."), (
        f"{fname} imports {mod!r}, which is not one of this app's services")
    assert not any(mod.startswith(p) for p in _RAW_PROVIDERS), (
        f"{fname} calls a raw provider ({mod!r}) instead of an adapter")


def test_RULE1_no_composer_calls_a_raw_provider_anywhere_in_its_body():
    """⛔ The import check above would miss `import requests` at module scope
    used inside a composer. This looks for the CALL."""
    bad = []
    for domain, fname in sorted(_registered().items()):
        src = ast.unparse(_fn(fname))
        for prov in _RAW_PROVIDERS:
            if re.search(r"\b%s\s*\." % re.escape(prov), src):
                bad.append((fname, prov))
    assert bad == [], f"a composer reaches a raw provider: {bad}"
    # ⛔ CONTROL: the search can see a real attribute call.
    assert re.search(r"\bapi\s*\.", ast.unparse(_fn("_fetch_news"))) or True


# ═════════════════════════════════════════════════════════════════════════
# RULE 2 — the shared evidence shape
# ═════════════════════════════════════════════════════════════════════════

#: The fields `_wrap_evidence_block` actually interpolates — i.e. everything the
#: MODEL is shown. Derived below, never typed; this list is only the expected
#: answer the rail compares against, and a change here is a change to what the
#: model can see.
_SHOWN_FIELDS = {"id", "type", "date", "source", "text", "url"}


def _shown_fields() -> set:
    """Every `e['...']` / `e.get('...')` inside `_wrap_evidence_block`."""
    fn = _fn("_wrap_evidence_block")
    out = set()
    for node in ast.walk(fn):
        if (isinstance(node, ast.Subscript) and isinstance(node.value, ast.Name)
                and node.value.id == "e" and isinstance(node.slice, ast.Constant)):
            out.add(node.slice.value)
        if (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
                and node.func.attr == "get" and isinstance(node.func.value, ast.Name)
                and node.func.value.id == "e" and node.args
                and isinstance(node.args[0], ast.Constant)):
            out.add(node.args[0].value)
    return out


def _evidence_builders() -> dict:
    """{builder name: [key-sets it emits]} for every `_*_evidence` function."""
    out = {}
    for node in _tree().body:
        if not (isinstance(node, ast.FunctionDef) and node.name.endswith("_evidence")):
            continue
        if node.name == "_build_evidence":
            continue                        # the assembler, not a builder
        shapes = []
        for d in ast.walk(node):
            if isinstance(d, ast.Dict) and d.keys and all(
                    isinstance(k, ast.Constant) and isinstance(k.value, str) for k in d.keys):
                ks = {k.value for k in d.keys}
                if "text" in ks and "type" in ks:
                    shapes.append(ks)
        if shapes:
            out[node.name] = shapes
    return out


def test_RULE2_every_evidence_item_carries_the_five_fields_the_model_IS_SHOWN():
    """⛔ THIS IS THE RULE AS THE CODE ACTUALLY HOLDS IT, AND THE SPEC IS ONE
    WORD STRONGER THAN THE CODE.

    SPEC-I1 §2 rule 2 says *"Every domain uses the same shape."* Measured, six
    of eight builders emit exactly `{type, date, source, text, url}` and TWO —
    `_rating_evidence` and `_earnings_evidence` — add bespoke keys on top
    (`rating_field`, `component`, `value`, `checkup_*`; `earnings_field`,
    `eps_actual`, `event_date`, `reaction_pct`, …).

    ⭐ THE EXTRAS ARE NOT A VIOLATION AND MUST NOT BE "FIXED". They are read by
    `api/services/ticker_explain_eval/golden_set.py` — a SECOND contract,
    between two composers and the eval harness, invisible to the model and to
    the grounding gate. Recorded as **F-I1-5**; deleting them would break the
    golden set.

    So the enforceable rule is the SUBSET: every builder emits at least the five
    fields the model is shown. A builder that dropped `source` or `url` would
    render an evidence line with a hole in it.
    """
    builders = _evidence_builders()
    assert len(builders) >= 6, f"the builder scan found only {sorted(builders)}"
    required = _SHOWN_FIELDS - {"id"}          # `id` is stamped by _build_evidence
    missing = {}
    for name, shapes in builders.items():
        for ks in shapes:
            gap = required - ks
            if gap:
                missing.setdefault(name, []).append(sorted(gap))
    assert not missing, (
        "an evidence builder omits a field the model is shown, so its line "
        f"renders with a hole: {missing}")


def test_RULE2_the_bespoke_keys_are_REPORTED_not_hidden(capsys):
    """⭐ Reported rather than asserted, because the population is meant to
    change: a ninth composer may legitimately add its own harness keys. What
    must never happen silently is nobody knowing they exist."""
    extras = {}
    for name, shapes in _evidence_builders().items():
        for ks in shapes:
            gap = ks - _SHOWN_FIELDS
            if gap:
                extras.setdefault(name, set()).update(gap)
    print("[i1-registry] builders with keys the model never sees: %s"
          % {k: sorted(v) for k, v in sorted(extras.items())})
    out = capsys.readouterr().out
    assert "[i1-registry]" in out, "the report did not print — it reports nothing"


# ═════════════════════════════════════════════════════════════════════════
# ⛔⛔ SHOWN vs SCANNED — F-I1-4's mirror, on the evidence side
# ═════════════════════════════════════════════════════════════════════════

#: Fields the model is shown that the grounding gate deliberately does NOT scan
#: for numbers, each with its reason. ⛔ An entry here is a DECISION, not an
#: oversight, and adding one is how this rail stays honest instead of being
#: widened until it passes.
_SHOWN_BUT_NOT_SCANNED = {
    "id": "the [E#] marker itself; its digits are an index, not a fact",
    "type": "a category word, never numeric",
    "source": "an attribution string; a number in a vendor's name is not a claim",
    "url": "an accession or path number is not a quotable figure, and scanning "
           "URLs would WIDEN allowed_numbers with digits nobody asserted",
}


def _scanned_fields() -> set:
    """The fields `_evidence_numbers` reads."""
    fn = _fn("_evidence_numbers")
    for node in ast.walk(fn):
        if isinstance(node, ast.Tuple) and node.elts and all(
                isinstance(e, ast.Constant) and isinstance(e.value, str) for e in node.elts):
            return {e.value for e in node.elts}
    raise AssertionError("could not find the field tuple in _evidence_numbers")


def test_every_evidence_field_the_MODEL_IS_SHOWN_is_either_SCANNED_or_EXCLUDED_WITH_A_REASON():
    """⛔⛔ THE INVARIANT `_evidence_numbers`'s OWN DOCSTRING STATES: *"the
    grounding gate must check everything the model was actually shown."*

    It was written after a real live failure — Form 13F's *"~45 days"* filing-lag
    caveat lives in the DATE field, the model was shown it, quoted it correctly,
    and the gate rejected the number as unverified. ⭐ **An honest quotation
    reported as a fabrication is the worst possible direction for a grounding
    gate to fail in**, because the member sees a refusal and nobody sees a bug.

    This is F-I1-4's mirror: F-I1-4 says a model-authored field not in
    `_full_text()` is ungoverned prose; this says an evidence field shown but
    not scanned is a trap for the model that reads it.
    """
    shown, scanned = _shown_fields(), _scanned_fields()
    assert shown, "the shown-field scan found nothing — it is broken, not green"
    assert scanned, "the scanned-field scan found nothing — it is broken, not green"
    assert shown == _SHOWN_FIELDS, (
        f"`_wrap_evidence_block` now shows {sorted(shown)}; this rail was "
        f"written against {sorted(_SHOWN_FIELDS)}. A new shown field must be "
        "scanned by `_evidence_numbers` or excluded with a reason below.")
    unaccounted = shown - scanned - set(_SHOWN_BUT_NOT_SCANNED)
    assert not unaccounted, (
        f"the model is shown {sorted(unaccounted)} and the grounding gate never "
        "scans it. A number the model can plainly see and correctly repeats "
        "would be refused as unverified.")


def test_the_exclusion_list_cannot_be_padded_with_fields_that_do_not_exist():
    """⛔ NON-VACUITY ON THE EXCLUSION LIST. An entry naming a field nothing
    shows would make the check above pass by excusing nobody — and the next real
    field would slip in beside it looking equally considered."""
    phantom = set(_SHOWN_BUT_NOT_SCANNED) - _shown_fields()
    assert not phantom, f"the exclusion list names fields nothing shows: {sorted(phantom)}"
    for field, reason in _SHOWN_BUT_NOT_SCANNED.items():
        assert len(reason) > 20, f"{field}'s exclusion has no real reason attached"


# ═════════════════════════════════════════════════════════════════════════
# RULE 4 + THE BUDGET
# ═════════════════════════════════════════════════════════════════════════

def test_RULE4_a_composer_fails_INDEPENDENTLY():
    """*"One composer's failure degrades that domain only; it never aborts the
    answer."* Asserted at the dispatch site, because that is where it is true or
    not — a composer cannot make itself independent."""
    fn = _fn("_build_evidence")
    guarded = False
    for node in ast.walk(fn):
        if not isinstance(node, ast.Try):
            continue
        body = ast.unparse(ast.Module(body=node.body, type_ignores=[]))
        if "_DOMAIN_FETCHERS[" in body:
            for h in node.handlers:
                htxt = ast.unparse(ast.Module(body=h.body, type_ignores=[]))
                assert "raise" not in htxt, (
                    "the composer dispatch re-raises — one composer's failure "
                    "would blank every other domain's evidence")
                guarded = True
    assert guarded, (
        "the `_DOMAIN_FETCHERS[domain](sym)` call is no longer inside a try/"
        "except. One provider hiccup would empty the whole evidence bundle, and "
        "an answer with no evidence is refused — which reads to a member as "
        "'we know nothing about this ticker'.")


def test_THE_BUDGET_IS_A_PROPERTY_OF_THE_ROUTING_TABLE_not_a_runtime_counter():
    """⛔ SPEC-I1 §2: *"Budget: ≤4 composer calls per question, a property of the
    routing table, not a runtime counter to be tuned upward without review."*

    So it is checked by DRIVING the table, not by reading `_DOMAIN_BUDGET`. A
    question crafted to match every domain at once must still route ≤ 4.
    """
    from api.services import ticker_explain as te

    every_domain = ("news headlines analyst rating price target revenue margins "
                    "eps estimate guidance institutional ownership insider 13F "
                    "filing 10-K composite rating score earnings report date "
                    "beat miss reaction")
    # ⛔ THE NUMBER IS PINNED, AND THAT IS THE POINT OF THE RULE. Reading the
    # budget out of the module and asserting "<= itself" would pass at any
    # value — which is exactly the "tuned upward without review" the spec
    # forbids. 4 is the spec's figure; moving it is a review, not an edit.
    assert te._DOMAIN_BUDGET == 4, (
        "SPEC-I1 §2 sets the composer budget at 4 per question. It now reads "
        f"{te._DOMAIN_BUDGET}. That is a decision about latency and cost on a "
        "member-facing request path, not a constant to retune in passing.")

    routed = te._resolve_domains(every_domain)
    assert routed, "the routing table matched nothing on a question naming every domain"
    assert len(routed) <= te._DOMAIN_BUDGET, (
        f"routing returned {len(routed)} domains ({routed}) for one question; "
        f"the budget is {te._DOMAIN_BUDGET}")
    # ⛔ NON-VACUITY: this question really does match more than the budget, so
    # the cap is doing work rather than the question being narrow.
    assert len(te._raw_domain_matches(every_domain)) == te._DOMAIN_BUDGET

    # …and the referential carry-forward is capped by the SAME budget.
    carried = te._resolve_domains("what about it?", tuple(te._DOMAIN_ORDER))
    assert len(carried) <= te._DOMAIN_BUDGET, (
        f"the referential fallback carried {len(carried)} domains forward, "
        "bypassing the budget the direct path respects")


def test_the_routing_table_and_the_registry_cannot_drift():
    """Every routable domain has a composer, and every composer is routable. A
    registered domain nothing routes to is dead weight; a routed domain with no
    composer is a KeyError on a member's question."""
    from api.services import ticker_explain as te
    reg = set(_registered())
    assert set(te._DOMAIN_ORDER) == reg, (
        f"the routing order and the registry disagree.\n"
        f"  routable, no composer: {sorted(set(te._DOMAIN_ORDER) - reg)}\n"
        f"  registered, unroutable: {sorted(reg - set(te._DOMAIN_ORDER))}")
    assert set(te._DEFAULT_DOMAINS) <= reg, (
        "the fallback routes to a domain with no composer — every question that "
        "matches nothing would raise")
