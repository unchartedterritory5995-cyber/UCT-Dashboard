"""Early Hints Link header on index.html (desktop speed plan 10.3)."""
from __future__ import annotations

import json

import pytest


@pytest.fixture
def dist(tmp_path, monkeypatch):
    import api.main as main
    (tmp_path / ".vite").mkdir()
    (tmp_path / "index.html").write_text("<!doctype html><title>t</title>", encoding="utf-8")
    manifest = {
        "index.html": {"file": "assets/index-AAA.js", "isEntry": True, "src": "index.html",
                       "imports": ["_vendor-react-BBB.js", "_vendor-swr-CCC.js"],
                       "css": ["assets/index-DDD.css"], "dynamicImports": ["src/pages/X.jsx"]},
        "_vendor-react-BBB.js": {"file": "assets/vendor-react-BBB.js"},
        "_vendor-swr-CCC.js": {"file": "assets/vendor-swr-CCC.js"},
        "src/pages/X.jsx": {"file": "assets/X-EEE.js", "isDynamicEntry": True},
    }
    (tmp_path / ".vite" / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
    monkeypatch.setattr(main, "DIST", str(tmp_path))
    monkeypatch.setattr(main, "_EARLY_HINTS_CACHE", None)
    return main


def test_the_page_hints_its_entry_vendors_and_css_with_crossorigin(dist):
    resp = dist.spa_index_response("charts")
    link = resp.headers["link"]
    assert link == (
        "</assets/index-AAA.js>; rel=preload; as=script; crossorigin, "
        "</assets/vendor-react-BBB.js>; rel=preload; as=script; crossorigin, "
        "</assets/vendor-swr-CCC.js>; rel=preload; as=script; crossorigin, "
        "</assets/index-DDD.css>; rel=preload; as=style; crossorigin")
    assert "X-EEE" not in link  # lazy pages are never hinted: that would be first-open bytes
    assert resp.headers["cache-control"] == "no-cache, no-store, must-revalidate"


def test_no_manifest_means_no_header_and_the_page_still_serves(dist, tmp_path):
    (tmp_path / ".vite" / "manifest.json").unlink()
    resp = dist.spa_index_response("charts")
    assert "link" not in resp.headers
    assert resp.status_code == 200


def test_the_header_is_read_once(dist, tmp_path):
    first = dist.early_hint_link_header()
    (tmp_path / ".vite" / "manifest.json").write_text("{}", encoding="utf-8")
    assert dist.early_hint_link_header() == first
