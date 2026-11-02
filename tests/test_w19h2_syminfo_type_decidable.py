"""W19-H2 -- ``syminfo.type``'s decidable comparisons, the Python lane's half.

The JS door turns ``syminfo.type == "forex"`` (any type in ``symbolScope.json::
type_decidable.never_on_a_confirmed_exchange``) into ``textop ne(symtext listing_kind,
"exchange-listing")`` and ``!=`` into ``eq``. The binding supplies ``listing_kind`` only
for a symbol whose exchange has a ``confirmed`` entry. This lane must fold the same tree
to the same number, and refuse it by name for any other exchange (``bind.js`` twin;
the JS rail is ``pine.w19h2SyminfoType.test.js``).
"""
import pytest

import api.services.ast_bind as ab

US = {"ticker": "SPY", "exchange": "NYSE Arca"}
UNKNOWN = {"ticker": "XYZ", "exchange": "Some Free Text Exchange"}


def _cmp(name):
    return {"type": "textop", "name": name, "args": [
        {"type": "symtext", "name": "listing_kind"}, {"type": "str", "value": ab.SYMBOL_LISTING_KIND}]}


def test_the_ruling_is_read_off_the_manifest():
    assert ab.SYMBOL_TYPE_NEVER_LISTED == frozenset(
        ["forex", "crypto", "cfd", "futures", "index", "economic", "spread"])
    assert ab.SYMBOL_LISTING_KIND == "exchange-listing"
    assert "NYSE Arca" in ab.SYMBOL_EXCHANGE_CONFIRMED


def test_a_confirmed_exchange_answers_eq_false_and_ne_true():
    consts = ab.binding_constants(symbol=US)
    assert consts["syminfo.listing_kind"] == "exchange-listing"
    assert ab.fold_scalar(_cmp("ne"), consts) == 0   # syminfo.type == "forex"
    assert ab.fold_scalar(_cmp("eq"), consts) == 1   # syminfo.type != "forex"


def test_an_unconfirmed_exchange_stops_the_fold_by_name():
    consts = ab.binding_constants(symbol=UNKNOWN)
    assert "syminfo.listing_kind" not in consts
    with pytest.raises(ab.NotFoldable, match="syminfo"):
        ab.fold_scalar(_cmp("ne"), consts)
