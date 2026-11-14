import numpy as np
import pytest

from app.terrain import analysis as A
from app.terrain.suitability import (CLASS_INSUFFICIENT, CLASS_SUITABLE, CLASS_UNSUITABLE, AnalysisParams, analyze_grid,
                                     explain_point, extract_candidates)


def inclined(n=60, deg=10.0, d=5.0):
    return np.tile(np.tan(np.radians(deg)) * np.arange(n) * d, (n, 1))


@pytest.mark.parametrize("deg", [0.0, 5.0, 10.0, 30.0, 45.0])
def test_slope_of_inclined_plane(deg):
    s, _ = A.slope_aspect(inclined(deg=deg), 5.0, 5.0)
    assert np.nanmax(s) == pytest.approx(deg, abs=1e-9) and np.nanmin(s) == pytest.approx(deg, abs=1e-9)


def test_aspect_direction():
    _, asp = A.slope_aspect(inclined(), 5, 5)           # rises east -> downslope west
    assert asp[30, 30] == pytest.approx(270.0)
    _, asp = A.slope_aspect(inclined().T, 5, 5)         # z rises with row index (southward) -> downslope north
    assert asp[30, 30] == pytest.approx(0.0, abs=1e-9) or asp[30, 30] == pytest.approx(360.0, abs=1e-9)


def test_slope_uses_cell_size():
    z = inclined(d=5.0)
    s_wrong, _ = A.slope_aspect(z, 10.0, 10.0)   # claiming bigger cells -> gentler slope
    assert np.nanmax(s_wrong) < 10.0


def test_slope_nan_propagates_to_neighbours_only():
    z = inclined(); z[30, 30] = np.nan
    s, _ = A.slope_aspect(z, 5, 5)
    assert np.isnan(s[29:32, 29:32]).all() and np.isfinite(s[10, 10]) and np.isnan(s[30, 30])


def test_flat_zero_slope_zero_roughness():
    z = np.full((50, 50), 7.0)
    s, _ = A.slope_aspect(z, 1, 1)
    assert np.nanmax(s) == 0
    assert np.nanmax(A.roughness_std(z, 1, 1, 9)) == pytest.approx(0, abs=1e-6)
    assert np.nanmax(A.local_relief(z, 1, 1, 9)) == 0


def test_roughness_methods_on_plane_vs_noise():
    z = inclined(80, 10, 1.0)
    assert np.nanmax(A.roughness_detrended(z, 1, 1, 9)) < 1e-6          # plane -> zero residual
    assert np.nanmean(A.roughness_std(z, 1, 1, 9)) == pytest.approx(0.1763 * np.sqrt(80 / 12), rel=1e-3)   # plain std includes the tilt
    rng = np.random.default_rng(1)
    noise = rng.normal(0, 0.5, (300, 300))
    assert np.nanmean(A.roughness_detrended(noise, 1, 1, 15)) == pytest.approx(0.5, rel=0.05)
    assert np.nanmean(A.roughness_std(noise, 1, 1, 15)) == pytest.approx(0.5, rel=0.05)


def test_roughness_window_with_nan_is_nan_and_edges_nan():
    z = np.zeros((40, 40)); z[20, 20] = np.nan
    r = A.roughness_std(z, 1, 1, 5)
    assert np.isnan(r[18:23, 18:23]).all() and np.isfinite(r[10, 10])
    assert np.isnan(r[0, 0]) and np.isnan(r[:, 0]).all()


def test_local_relief_known():
    z = np.zeros((30, 30)); z[15, 15] = 4.0; z[16, 16] = -1.0
    rel = A.local_relief(z, 1, 1, 5)
    assert rel[15, 15] == 5.0 and rel[5, 5] == 0.0


def test_tpi_pit():
    z = np.zeros((40, 40)); z[20, 20] = -10
    t = A.topographic_position(z, 1, 1, 5)
    assert t[20, 20] < -9 and t[10, 10] == pytest.approx(0, abs=1e-12)


def test_elevation_stats_and_profile():
    z = np.arange(100, dtype=float).reshape(10, 10); z[0, 0] = np.nan
    st = A.elevation_stats(z)
    assert st["min_m"] == 1 and st["max_m"] == 99 and st["valid_fraction"] == pytest.approx(0.99)
    prof = A.elevation_profile(np.arange(100.).reshape(10, 10), (0, 0), (0, 9), 10)
    assert np.allclose(prof, np.arange(10))
    assert A.elevation_stats(np.full((3, 3), np.nan))["min_m"] is None


# --- suitability -----------------------------------------------------------------------------
def scene():
    """100x100 @ 2 m: smooth flat terrain, steep 25-deg ramp strip at right, pit in the middle, NaN corner."""
    z = np.zeros((100, 100))
    z[:, 80:] = np.tan(np.radians(25)) * np.arange(20) * 2.0
    yy, xx = np.mgrid[0:100, 0:100]
    z[np.hypot(yy - 50, xx - 40) < 6] -= 6.0
    z[:12, :12] = np.nan
    return z


P = AnalysisParams(window_m=10, footprint_radius_m=4, hazard_safe_distance_m=10, slope_limit_deg=10, relief_limit_m=2, tpi_limit_m=2)


def test_classification_regions():
    res = analyze_grid(scene(), 2, 2, P)
    cls = res["layers"]["class"]
    assert cls[75, 15] == CLASS_SUITABLE               # open flat area
    assert cls[50, 34] == CLASS_UNSUITABLE             # on the pit wall (flat floor itself is geometrically fine)
    assert cls[50, 90] == CLASS_UNSUITABLE             # on steep ramp
    assert cls[3, 3] == CLASS_INSUFFICIENT             # missing data corner
    assert cls[9, 14] == CLASS_INSUFFICIENT or cls[9, 14] == CLASS_UNSUITABLE  # near hole -> never 'suitable'
    assert cls[9, 14] != CLASS_SUITABLE


def test_footprint_must_fit():
    big = AnalysisParams(**{**P.__dict__, "footprint_radius_m": 40})   # footprint larger than any clean zone
    assert (analyze_grid(scene(), 2, 2, big)["layers"]["class"] == CLASS_SUITABLE).sum() < \
           (analyze_grid(scene(), 2, 2, P)["layers"]["class"] == CLASS_SUITABLE).sum()


def test_weights_change_scores():
    a = analyze_grid(scene(), 2, 2, P)["layers"]["suitability"]
    p2 = AnalysisParams(**{**P.__dict__, "weights": {"slope": 1.0, "roughness": 0.0, "relief": 0.0, "hazard": 0.0}})
    b = analyze_grid(scene(), 2, 2, p2)["layers"]["suitability"]
    assert not np.allclose(a, b, equal_nan=True)
    assert b[75, 15] == pytest.approx(1.0)               # flat => slope score 1 => total = slope score only
    assert np.nanmax(a) <= 1.0 and np.nanmin(a) >= 0.0


def test_weights_are_normalised():
    p1 = AnalysisParams(**{**P.__dict__, "weights": {"slope": 1, "roughness": 1, "relief": 1, "hazard": 1}})
    p2 = AnalysisParams(**{**P.__dict__, "weights": {"slope": 10, "roughness": 10, "relief": 10, "hazard": 10}})
    a = analyze_grid(scene(), 2, 2, p1)["layers"]["suitability"]; b = analyze_grid(scene(), 2, 2, p2)["layers"]["suitability"]
    assert np.allclose(a, b, equal_nan=True)


def test_slope_score_linear_ramp():
    z = inclined(80, 5.0, 2.0)  # 5 deg, limit 10 -> score 0.5
    p = AnalysisParams(window_m=10, slope_limit_deg=10, weights={"slope": 1, "roughness": 0, "relief": 0, "hazard": 0})
    s = analyze_grid(z, 2, 2, p)["layers"]["score_slope"]
    assert s[40, 40] == pytest.approx(0.5, abs=1e-9)


def test_invalid_params_rejected():
    for bad in ({"weights": {"slope": -1, "roughness": 1, "relief": 1, "hazard": 1}}, {"weights": {"slope": 1}},
                {"roughness_method": "x"}, {"window_m": 0}, {"suitable_threshold": 1.5}):
        with pytest.raises(ValueError):
            AnalysisParams(**{**P.__dict__, **bad}).validate()
    with pytest.raises(ValueError):
        AnalysisParams(**{**P.__dict__, "weights": {k: 0 for k in P.weights}}).validate()


def test_candidates_and_explanation():
    res = analyze_grid(scene(), 2, 2, P)
    cands = extract_candidates(res["layers"], 2, 2, P, res["footprint"])
    assert 1 <= len(cands) <= P.max_candidates
    for c in cands:
        assert res["layers"]["class"][c["row"], c["col"]] == CLASS_SUITABLE
    # separation respected
    if len(cands) > 1:
        d = np.hypot((cands[0]["row"] - cands[1]["row"]) * 2, (cands[0]["col"] - cands[1]["col"]) * 2)
        assert d >= 3 * P.footprint_radius_m - 1e-9
    ex = explain_point(res["layers"], 50, 90, P)
    assert ex["classification"] == "geometrically_unsuitable" and any("slope" in n for n in ex["notes"])
    assert "not a certified" in ex["disclaimer"]
    ex_nan = explain_point(res["layers"], 3, 3, P)
    assert ex_nan["classification"] == "insufficient_data" and ex_nan["suitability"] is None


def test_all_nan_grid_gives_no_candidates():
    res = analyze_grid(np.full((40, 40), np.nan), 1, 1, P)
    assert (res["layers"]["class"] == CLASS_INSUFFICIENT).all()
    assert extract_candidates(res["layers"], 1, 1, P, res["footprint"]) == []


def test_explanation_lists_only_real_hazard_detectors():
    res = analyze_grid(scene(), 2, 2, P)
    clean = explain_point(res["layers"], 75, 15, P)
    assert not any("flagged by hazard detectors" in n for n in clean["notes"])     # open flat area: no detector fires
    wall = explain_point(res["layers"], 50, 34, P)
    flagged = [n for n in wall["notes"] if "flagged by hazard detectors" in n][0]
    assert "distance" not in flagged and ("steep_slope" in flagged or "elevation_discontinuity" in flagged)
