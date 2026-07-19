from tools.theme_curation import liveness


def test_live_syms_keeps_priced_names_only():
    # PAYO/RPAY quote a price (live); GONE has no quote (None); ZERO quotes 0 (delisted).
    prices = {"PAYO": 12.3, "RPAY": 4.5, "GONE": None, "ZERO": 0.0}
    live = liveness.live_syms(["PAYO", "RPAY", "GONE", "ZERO"], quote_fn=prices.get)
    assert live == {"PAYO", "RPAY"}          # price>0 => live; None/0 => delisted candidate


def test_live_syms_class_share_passed_to_quote_fn():
    seen = []
    def qf(sym):
        seen.append(sym)
        return 400.0
    assert liveness.live_syms(["BRK-B"], quote_fn=qf) == {"BRK-B"}
    assert seen == ["BRK-B"]                  # app form reaches quote_fn; boundary maps to dot


def test_live_syms_never_raises_on_quote_error():
    def boom(sym):
        raise RuntimeError("finnhub down")
    assert liveness.live_syms(["ANY"], quote_fn=boom) == set()   # per-ticker error => not live


def test_live_syms_dedups_and_uppercases():
    calls = []
    def qf(sym):
        calls.append(sym); return 1.0
    liveness.live_syms(["fi", "FI", "Fi"], quote_fn=qf)
    assert calls == ["FI"]                    # deduped + uppercased


def test_live_syms_empty_input():
    assert liveness.live_syms([]) == set()
