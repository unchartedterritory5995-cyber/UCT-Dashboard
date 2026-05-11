import math
from api.services.pattern_engine.primitives.geometry import (
    slope_angle_deg, line_intersect, parallel_score,
    polynomial_fit, line_at,
)


def test_slope_angle_horizontal_line_is_zero():
    angle = slope_angle_deg({"t": 0, "price": 100}, {"t": 100, "price": 100})
    assert abs(angle) < 0.01


def test_slope_angle_45_degrees():
    # Rise = run (using unit-normalized: dt=1, dprice=1) -> 45 deg
    angle = slope_angle_deg({"t": 0, "price": 100}, {"t": 1, "price": 101})
    assert abs(angle - 45.0) < 0.01


def test_slope_angle_negative_slope():
    angle = slope_angle_deg({"t": 0, "price": 100}, {"t": 1, "price": 99})
    assert -46 < angle < -44


def test_line_intersect_perpendicular():
    """Horizontal line at y=100 meets vertical-ish line at x=5"""
    line_a = ({"t": 0, "price": 100}, {"t": 10, "price": 100})
    line_b = ({"t": 5, "price": 50}, {"t": 5, "price": 150})
    pt = line_intersect(line_a, line_b)
    assert abs(pt["t"] - 5) < 0.01
    assert abs(pt["price"] - 100) < 0.01


def test_line_intersect_parallel_returns_none():
    line_a = ({"t": 0, "price": 100}, {"t": 10, "price": 110})
    line_b = ({"t": 0, "price": 200}, {"t": 10, "price": 210})
    assert line_intersect(line_a, line_b) is None


def test_parallel_score_identical_slopes_is_1():
    line_a = ({"t": 0, "price": 100}, {"t": 10, "price": 110})
    line_b = ({"t": 0, "price": 200}, {"t": 10, "price": 210})
    assert abs(parallel_score(line_a, line_b) - 1.0) < 0.01


def test_parallel_score_diverging_slopes_low():
    line_a = ({"t": 0, "price": 100}, {"t": 10, "price": 110})    # slope 1
    line_b = ({"t": 0, "price": 100}, {"t": 10, "price": 130})    # slope 3
    score = parallel_score(line_a, line_b)
    assert 0 <= score < 0.5


def test_polynomial_fit_linear_data():
    """y = 2x + 3, degree 1 → coeffs [2, 3]"""
    xs = [0.0, 1.0, 2.0, 3.0]
    ys = [3.0, 5.0, 7.0, 9.0]
    coeffs = polynomial_fit(xs, ys, degree=1)
    assert len(coeffs) == 2
    assert abs(coeffs[0] - 2.0) < 0.01
    assert abs(coeffs[1] - 3.0) < 0.01


def test_polynomial_fit_quadratic_data():
    """y = x^2 — degree 2 should recover [1, 0, 0]"""
    xs = [-2.0, -1.0, 0.0, 1.0, 2.0]
    ys = [4.0, 1.0, 0.0, 1.0, 4.0]
    coeffs = polynomial_fit(xs, ys, degree=2)
    assert len(coeffs) == 3
    assert abs(coeffs[0] - 1.0) < 0.05
    assert abs(coeffs[1]) < 0.05
    assert abs(coeffs[2]) < 0.05


def test_line_at_returns_price_on_line():
    line = ({"t": 0, "price": 100}, {"t": 10, "price": 110})  # slope 1
    assert abs(line_at(line, 5) - 105) < 0.01
    assert abs(line_at(line, 0) - 100) < 0.01
    assert abs(line_at(line, 10) - 110) < 0.01
