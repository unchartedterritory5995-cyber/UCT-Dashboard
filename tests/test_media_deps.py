import pytest


def test_media_and_linkify_deps_are_importable():
    # pi_heif is the only importorskip: some local platforms (e.g. Windows on a
    # new CPython) have no wheel for the pinned range. Production (manylinux
    # cp312) does; the AVIF and linkify assertions below still run everywhere.
    import linkify_it
    from PIL import features

    assert features.check("avif")
    assert linkify_it.LinkifyIt().test("see www.example.com")


def test_pi_heif_importable_and_registers():
    pi_heif = pytest.importorskip("pi_heif")
    pi_heif.register_heif_opener()
