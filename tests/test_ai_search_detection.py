from api.routers import ai_search as r

class _U(dict): pass
PAID = {"user_id": "u1", "plan": "pro"}

def _wire(monkeypatch, paid=True, has_data=True):
    monkeypatch.setattr(r, "_is_paid_server", lambda u: paid)
    monkeypatch.setattr(r.ai_search_personal, "has_data", lambda uid: has_data)

def test_personal_positive_cases(monkeypatch):
    _wire(monkeypatch)
    for q in ["am i overexposed", "should i add to my nvda", "how's my week",
              "should I trim my NVDA", "room to add here?", "which of my positions is near its stop"]:
        assert r.is_personal(q, PAID) is True, q

def test_personal_negative_cases(monkeypatch):
    _wire(monkeypatch)
    for q in ["is TSLA extended here?", "thoughts on NVDA", "should I worry about the Fed",
              "what is a VCP", "why is NOW up today"]:
        assert r.is_personal(q, PAID) is False, q

def test_personal_requires_paid_and_data(monkeypatch):
    _wire(monkeypatch, paid=False); assert r.is_personal("am i overexposed", PAID) is False
    _wire(monkeypatch, has_data=False); assert r.is_personal("am i overexposed", PAID) is False
    assert r.is_personal("am i overexposed", None) is False
