"""Compare our own rendering of a Pine indicator against a human-provided
TradingView screenshot. The TradingView side is NEVER automated — a human has
already opened and authenticated that chart before this tool runs; see the
module-level docstring further down and spec §2 NG1
(docs/superpowers/specs/universal-indicator-ecosystem/RENDERING_PARITY_VERIFICATION_PROGRAM.md).

Uses SSIM (structural similarity), not chart_parity.py's exact-pixel diff() —
two renders of the same data on two different platforms (different fonts, AA,
DPI, JPEG compression, watermarks) are never near-pixel-identical, and an
exact-pixel comparator would report ~100% "changed" on every real pair. SSIM
compares local structure (luminance/contrast/structure windows) instead of
per-pixel bytes, so it tolerates that class of rendering noise while still
catching a genuinely different shape or color family.
"""
from __future__ import annotations

import pathlib

from PIL import Image
from skimage.metrics import structural_similarity
import numpy as np


def compare(a_path: pathlib.Path, b_path: pathlib.Path) -> dict:
    """Perceptual comparison. Returns {"score", "a_size", "b_size", "size_mismatch"}.

    A size mismatch is reported, never silently resized past — resizing one
    image to match the other changes what's being measured and would hide
    exactly the "the two builds framed the chart differently" class of
    problem chart_parity.py's own diff() refuses to paper over.
    """
    a = Image.open(a_path).convert("RGB")
    b = Image.open(b_path).convert("RGB")
    if a.size != b.size:
        return {"score": None, "a_size": list(a.size), "b_size": list(b.size),
                 "size_mismatch": True}

    a_arr = np.asarray(a)
    b_arr = np.asarray(b)
    # channel_axis=-1, never a greyscale conversion first: chart_parity.py's own
    # diff() documents a real incident where luma-weighted greyscale hid a
    # whole-canvas color change because blue only weighs 0.114 in that
    # formula. SSIM's multichannel mode compares each channel's structure
    # rather than collapsing to one luminance value first.
    score = structural_similarity(a_arr, b_arr, channel_axis=-1)
    return {"score": float(score), "a_size": list(a.size), "b_size": list(b.size),
             "size_mismatch": False}
