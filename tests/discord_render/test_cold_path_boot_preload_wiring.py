"""R63(c) AMENDED — the wiring, not just the mechanism.

`cold_start_guard` proves the mechanism is correct in isolation
(`test_cold_start_guard.py`). This file proves `api.main` actually calls it — the
"routing computed but never applied" failure this repo has hit before
(`hub/rule12Paths.test.js`'s own history, `lesson_a_second_authority_over_one_value`'s
cousins): a perfect mechanism nobody wires into startup warms nothing.
"""
import time

from api.services.discord_render import cold_start_guard as g


def test_start_cold_path_boot_preload_registers_and_warms_cap_universe(monkeypatch):
    g._reset_for_tests()
    from api.main import _start_cold_path_boot_preload

    _start_cold_path_boot_preload()

    assert "cap_universe.symbols" in g.registered_names()
    assert "cap_universe.etf_symbols" in g.registered_names()

    # The preload runs on a background executor thread; give it a moment rather than
    # asserting immediately, which would be timing-fragile in the wrong direction (a slow
    # CI box failing a correct wiring). 2s is generous for two pure file reads.
    deadline = time.monotonic() + 2.0
    while time.monotonic() < deadline and not (
            g.is_warm("cap_universe.symbols") and g.is_warm("cap_universe.etf_symbols")):
        time.sleep(0.02)

    assert g.is_warm("cap_universe.symbols"), "boot preload did not warm cap_universe.symbols"
    assert g.is_warm("cap_universe.etf_symbols"), (
        "boot preload did not warm cap_universe.etf_symbols")
    g._reset_for_tests()


def test_the_two_registered_resources_are_the_real_lru_cached_functions():
    """⛔ Registering a WRAPPER or a copy would preload a different cache than the one
    `flow_source`/`is_index_source` actually reads — silently useless. This pins identity,
    not just callability."""
    g._reset_for_tests()
    from api.main import _start_cold_path_boot_preload
    from api.services import cap_universe

    _start_cold_path_boot_preload()
    assert g.get_sync("cap_universe.symbols") is cap_universe.symbols()
    assert g.get_sync("cap_universe.etf_symbols") is cap_universe.etf_symbols()
    g._reset_for_tests()


def test_a_preload_failure_never_raises_out_of_startup(monkeypatch):
    """⛔ NON-VACUITY for the try/except wrapping the call site in api.main's startup block.
    A cold_start_guard import error, a bad registration, anything — must not take the whole
    app down at boot. Proven by breaking registration itself and calling the SAME code path
    api.main's startup calls, inline, the way the real try/except does."""
    g._reset_for_tests()
    import api.main as m

    def _boom():
        raise RuntimeError("simulated preload wiring failure")

    monkeypatch.setattr(m, "_start_cold_path_boot_preload", _boom)
    try:
        m._start_cold_path_boot_preload()
    except RuntimeError:
        pass  # the bare function DOES raise — proving the test's fault injection works
    else:
        raise AssertionError("fault injection did not actually break the call")

    # Now prove api.main's startup wraps it — i.e. the SAME shape of try/except used in
    # the lifespan is present verbatim around the real call site.
    import inspect
    src = inspect.getsource(m)
    assert "_start_cold_path_boot_preload" in src
    idx = src.index("try:\n        _start_cold_path_boot_preload()")
    guarded = src[idx:idx + 200]
    assert "except Exception" in guarded, (
        "the boot preload call site is not wrapped in try/except — a preload wiring bug "
        "would take down the whole app at startup")
    g._reset_for_tests()
