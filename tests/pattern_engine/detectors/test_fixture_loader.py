from tests.pattern_engine.detectors.fixture_loader import (
    load_fixture, load_all_fixtures, Fixture,
)


def test_load_fixture_parses_json():
    f = load_fixture("bull_flag", "_sample.json")
    assert f.name == "sample_for_loader_test"
    assert len(f.bars) == 2
    assert f.bars[0]["c"] == 100
    assert f.expected_fires is True
    assert f.min_confidence == 60.0


def test_load_all_fixtures_returns_at_least_one():
    fixtures = load_all_fixtures("bull_flag", include_internal=True)
    assert len(fixtures) >= 1
    assert any(f.name == "sample_for_loader_test" for f in fixtures)


def test_fixture_skipping_underscore_prefixed_works():
    """The loader is responsible for treating `_sample.json` as test-only and
    excluding it from the real battery — done via a parameter to load_all_fixtures."""
    fixtures = load_all_fixtures("bull_flag", include_internal=False)
    assert not any(f.name == "sample_for_loader_test" for f in fixtures)
