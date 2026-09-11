"""The startup contract line must MEASURE the contract, not restate it.

Four of its six tokens (`model`, `active_set_only`, `skip_if_stable`,
`confirmed_only`) were string literals inside the print(), so every
"contract byte-identical" check in this program verified a format string and
nothing else. These tests pin the two properties that make the line an
instrument: an env-supplied value has to reach it, and a value it names has to
change when the underlying source changes.
"""


def _line():
    import api.main as main
    return main._pattern_vision_contract_line()


def test_env_value_reaches_the_line_and_is_marked_env(monkeypatch):
    """A NON-DEFAULT env value must appear, tagged [env] -- the literal-string
    version of this line could not have shown it."""
    monkeypatch.setenv("PATTERN_VISION_MAX_PER_RUN", "7")
    monkeypatch.setenv("PATTERN_VISION_COST_HARD_CAP", "3.5")
    line = _line()
    assert "max_per_run=7[env]" in line
    assert "cost_hard_cap=$3.5[env]" in line
    # ...and the code defaults must NOT be what is printed.
    assert "max_per_run=150" not in line
    assert "cost_hard_cap=$10.0" not in line


def test_unset_value_is_marked_default_not_env(monkeypatch):
    """Provenance is the point: unset must read [default], so the ledger
    question 'was 10.0 chosen or inherited?' is answered by the line itself."""
    monkeypatch.delenv("PATTERN_VISION_COST_HARD_CAP", raising=False)
    monkeypatch.delenv("PATTERN_VISION_MAX_PER_RUN", raising=False)
    line = _line()
    assert "cost_hard_cap=$10.0[default]" in line
    assert "max_per_run=150[default]" in line


def test_active_set_size_is_derived_not_literal(monkeypatch):
    """Mutation proof. If active_set_only were still a literal, this would pass
    with the real universe size and the assertion below would fail."""
    import api.main as main
    monkeypatch.setattr(main, "_resolve_active_set_for_patterns",
                        lambda **kw: ["AAA", "BBB", "CCC"])
    assert "active_set_only=on:3[resolved]" in _line()


def test_line_survives_an_unresolvable_active_set(monkeypatch):
    """A contract line must never be the reason a boot fails."""
    import api.main as main

    def _boom(**kw):
        raise RuntimeError("universe file gone")

    monkeypatch.setattr(main, "_resolve_active_set_for_patterns", _boom)
    line = _line()
    assert "active_set_only=on:unresolved(RuntimeError)" in line
    assert line.startswith("[startup] pattern-vision: on ")


def test_behaviour_tokens_report_their_real_sources():
    """`skip_if_stable` tracks judge_ticker's `force` default; `confirmed_only`
    tracks the /api/patterns Query default. Both are 'on' today -- the value
    matters less than the fact that it is now read rather than typed."""
    line = _line()
    assert "skip_if_stable=on[force_default]" in line
    assert "confirmed_only=on[api_default]" in line
    assert "model=claude-opus-4-8[code]" in line
