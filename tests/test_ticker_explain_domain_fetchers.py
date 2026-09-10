"""`_DOMAIN_FETCHERS` has exactly one binding, and it is the one that was live.

The module bound the name twice: a forward declaration
`_DOMAIN_FETCHERS: dict[str, tuple] = {}` about seventy lines above the real
registry, which then rebound it. Python keeps the last binding, so the empty
placeholder never reached a caller -- but it made the file carry two authorities
for one name, and the dead one's annotation said `tuple` while the live values
are callables. Anyone reading top-down met the wrong definition first.

Removing a duplicate binding is exactly the change that can silently alter
behaviour if the WRONG one is removed, so this pins the surviving registry
rather than trusting that the deletion was the harmless one.
"""
from api.services import ticker_explain as te


EXPECTED = {
    "news": "_fetch_news",
    "analyst": "_fetch_analyst",
    "financials": "_fetch_financials",
    "estimates": "_fetch_estimates",
    "ownership": "_fetch_ownership",
    "filings": "_fetch_filings",
    "rating": "_fetch_rating",
    "earnings": "_fetch_earnings",
}


def test_every_domain_still_maps_to_its_own_fetcher():
    """Behaviour-unchanged proof: the same eight domains, each bound to the same
    function object the module defines for it."""
    assert set(te._DOMAIN_FETCHERS) == set(EXPECTED)
    for domain, fn_name in EXPECTED.items():
        assert te._DOMAIN_FETCHERS[domain] is getattr(te, fn_name), domain


def test_the_registry_is_not_the_empty_placeholder():
    """If the surviving binding were the forward declaration, every domain
    lookup in _build_evidence would raise KeyError and the module would still
    import cleanly -- so 'it imports' proves nothing here."""
    assert te._DOMAIN_FETCHERS, "registry is empty -- the placeholder won"
    assert all(callable(v) for v in te._DOMAIN_FETCHERS.values())


def test_the_name_is_bound_exactly_once_at_module_level():
    """The rail that generalises: an AST sweep for a top-level rebinding of this
    specific name, so a future forward declaration cannot creep back in without
    failing here as well as in test_no_shadowed_definitions."""
    import ast
    import inspect

    tree = ast.parse(inspect.getsource(te))
    binds = 0
    for node in tree.body:
        targets = []
        if isinstance(node, ast.Assign):
            targets = node.targets
        elif isinstance(node, ast.AnnAssign):
            targets = [node.target]
        for t in targets:
            if isinstance(t, ast.Name) and t.id == "_DOMAIN_FETCHERS":
                binds += 1
    assert binds == 1, f"_DOMAIN_FETCHERS bound {binds} times at module level"
