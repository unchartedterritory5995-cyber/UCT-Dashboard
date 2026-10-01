"""hub_nav_smoke.nav_link WAITS for a nav link rather than sampling it once.

The /dashboard fan-out used `locator(...).count() == 0` a fixed 900 ms after a goto, so a slow
mount silently skipped links (12 entries on one run, 3 on the next, same live build, 2026-09-30).
"""
from tools import hub_nav_smoke as H


class _Loc:
    def __init__(self, appears_after_ms, now):
        self.appears_after_ms = appears_after_ms
        self.now = now
        self.waited_with = None

    @property
    def first(self):
        return self

    def count(self):  # what the old code sampled: absent at the sampling instant
        return 1 if self.now >= self.appears_after_ms else 0

    def wait_for(self, state="attached", timeout=0):
        self.waited_with = (state, timeout)
        if self.appears_after_ms > timeout:
            raise TimeoutError("not attached")
        self.now = self.appears_after_ms


class _Page:
    def __init__(self, appears_after_ms, now=900):
        self.loc = _Loc(appears_after_ms, now)
        self.asked = []

    def locator(self, sel):
        self.asked.append(sel)
        return self.loc


def test_a_link_that_mounts_late_is_found_not_skipped():
    page = _Page(appears_after_ms=2500)          # absent at the old 900 ms sample
    assert page.loc.count() == 0                  # control: the old sampling read would skip it
    link = H.nav_link(page, "/charts")
    assert link is not None
    assert page.asked == ['a[href="/charts"]']
    assert page.loc.waited_with == ("attached", H.NAV_LINK_WAIT_MS)


def test_a_link_that_never_mounts_is_None_after_the_bounded_wait():
    page = _Page(appears_after_ms=10**9)
    assert H.nav_link(page, "/locked", wait_ms=50) is None
    assert page.loc.waited_with == ("attached", 50)


def test_the_two_call_sites_use_the_waiter_not_a_count_sample():
    import inspect
    src = inspect.getsource(H)
    assert src.count("nav_link(page,") >= 2
    assert "link.count() == 0" not in src   # the old call-site form (the docstring quotes locator(...))
