"""Tests for the theme taxonomy DB batch lookup behind the breadth "group by
theme" drill view, plus the POST /api/breadth/themes endpoint.

Verifies primary-theme resolution (core > relevant > peripheral, tie-broken
by theme_id) matches the existing single-ticker ticker_meta._primary_theme
algorithm, that the batch path returns one entry per requested ticker, and
that the endpoint degrades to nulls rather than raising.
"""
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.services import auth_db
from api.services import theme_db


def test_resolve_primary_prefers_core_then_relevant_then_peripheral():
    rows = [
        {"theme_name": "Peripheral One", "tier": "peripheral", "theme_id": "a"},
        {"theme_name": "Core One", "tier": "core", "theme_id": "z"},
        {"theme_name": "Relevant One", "tier": "relevant", "theme_id": "b"},
    ]
    primary = theme_db._resolve_primary(rows)
    assert primary["theme_name"] == "Core One"


def test_resolve_primary_tie_breaks_by_theme_id():
    rows = [
        {"theme_name": "Semiconductors", "tier": "core", "theme_id": "semis"},
        {"theme_name": "Artificial Intelligence", "tier": "core", "theme_id": "ai"},
    ]
    primary = theme_db._resolve_primary(rows)
    assert primary["theme_name"] == "Artificial Intelligence"  # "ai" < "semis"


def test_resolve_primary_none_for_empty_or_missing():
    assert theme_db._resolve_primary([]) is None
    assert theme_db._resolve_primary(None) is None


def test_resolve_primary_unknown_tier_ranks_last():
    rows = [
        {"theme_name": "Weird", "tier": "watchlist", "theme_id": "a"},
        {"theme_name": "Peripheral One", "tier": "peripheral", "theme_id": "z"},
    ]
    primary = theme_db._resolve_primary(rows)
    assert primary["theme_name"] == "Peripheral One"
