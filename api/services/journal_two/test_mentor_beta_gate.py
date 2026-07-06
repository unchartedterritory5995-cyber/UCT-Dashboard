import sqlite3
from api.services.journal_two import coach_chat as cc


def _conn_with_user(role, email):
    c = sqlite3.connect(":memory:")
    c.row_factory = sqlite3.Row
    c.execute("CREATE TABLE users (id TEXT, role TEXT, email TEXT)")
    c.execute("INSERT INTO users VALUES ('u1', ?, ?)", (role, email))
    c.commit()
    return c


def test_beta_mode_admits_admin_and_cohort(monkeypatch):
    monkeypatch.setenv("COMPASS_MENTOR_MODE", "beta")
    monkeypatch.setenv("COMPASS_MENTOR_BETA_EMAILS", "beta@x.com, vip@y.com")
    assert cc._mentor_mode_active("u1", conn=_conn_with_user("user", "Beta@X.com")) is True   # cohort (case-insensitive)
    assert cc._mentor_mode_active("u1", conn=_conn_with_user("admin", "nope@z.com")) is True  # admin always
    assert cc._mentor_mode_active("u1", conn=_conn_with_user("user", "rando@z.com")) is False # neither


def test_admin_mode_excludes_beta_cohort(monkeypatch):
    monkeypatch.setenv("COMPASS_MENTOR_MODE", "admin")
    monkeypatch.setenv("COMPASS_MENTOR_BETA_EMAILS", "beta@x.com")
    assert cc._mentor_mode_active("u1", conn=_conn_with_user("user", "beta@x.com")) is False  # admin mode ignores cohort
    assert cc._mentor_mode_active("u1", conn=_conn_with_user("admin", "x")) is True


def test_off_and_all(monkeypatch):
    monkeypatch.setenv("COMPASS_MENTOR_MODE", "0")
    assert cc._mentor_mode_active("u1", conn=_conn_with_user("admin", "x")) is False
    monkeypatch.setenv("COMPASS_MENTOR_MODE", "1")
    assert cc._mentor_mode_active("u1", conn=_conn_with_user("user", "x")) is True
