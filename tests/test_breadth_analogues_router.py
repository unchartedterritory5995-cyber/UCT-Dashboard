import inspect
from api.services.breadth_analogues import find_analogues


def test_find_analogues_accepts_a_match_count():
    sig = inspect.signature(find_analogues)
    assert "top_n" in sig.parameters
    assert sig.parameters["top_n"].default == 5


def test_router_exposes_top_n_as_a_bounded_query_param():
    from api.routers import breadth_monitor as r
    sig = inspect.signature(r.get_breadth_analogues)
    assert "top_n" in sig.parameters, "the endpoint must let the caller pick the match count"
