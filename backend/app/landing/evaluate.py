"""Landing Analysis Core: combines terrain analysis and a simulated trajectory.

Produces SEPARATE assessments (surface, trajectory, vehicle) - never one opaque number - with
issues, explanations, uncertainty and model limitations.  Verdict vocabulary is deliberately
"within / outside checked limits", never "safe".
"""
from __future__ import annotations

import numpy as np

from ..lunar_data.engine import TerrainPatch
from ..spacecraft.schemas import SpacecraftConfig
from ..terrain.suitability import CLASS_NAMES, AnalysisParams, explain_point
from ..trajectory.dynamics import SimulationOutput

PASS, FAIL, UNKNOWN = "within_limits", "outside_limits", "not_assessed"


def _check(name, value, limit, *, kind="max", unit=""):
    if value is None or limit is None or not np.isfinite(value):
        return {"check": name, "status": UNKNOWN, "value": None, "limit": limit, "unit": unit}
    ok = value <= limit if kind == "max" else value >= limit
    return {"check": name, "status": PASS if ok else FAIL, "value": float(value), "limit": float(limit), "unit": unit,
            "margin": float(limit - value) if kind == "max" else float(value - limit)}


def evaluate_surface(cfg: SpacecraftConfig, lat: float, lon: float, analysis: dict | None, patch: TerrainPatch | None,
                     params: AnalysisParams | None) -> dict:
    if analysis is None or patch is None or params is None:
        return {"status": "no_terrain_data", "checks": [], "issues": ["No real DEM available at the touchdown point; surface not assessed."],
                "explanation": None}
    layers = analysis["layers"]
    row, col = patch.latlon_to_rowcol(lat, lon)
    r, c = int(round(row)), int(round(col))
    inside = 0 <= r < patch.shape[0] and 0 <= c < patch.shape[1]
    if not inside:
        return {"status": "touchdown_outside_analysed_region", "checks": [],
                "issues": ["Touchdown point lies outside the analysed DEM window; enlarge the analysis radius."], "explanation": None}
    # footprint statistics on the DEM
    fr_y, fr_x = cfg.footprint_radius_m / patch.dy_m, cfg.footprint_radius_m / patch.dx_m
    yy, xx = np.ogrid[:patch.shape[0], :patch.shape[1]]
    mask = (((yy - r) / max(fr_y, 1e-9)) ** 2 + ((xx - c) / max(fr_x, 1e-9)) ** 2) <= 1.0
    if mask.sum() < 3:
        mask = np.zeros(patch.shape, bool); mask[max(r - 1, 0):r + 2, max(c - 1, 0):c + 2] = True
    z = patch.elevation[mask]
    nan_frac = float(np.mean(~np.isfinite(z)))
    slope_fp = layers["slope"][mask]
    fp_slope_max = float(np.nanmax(slope_fp)) if np.isfinite(slope_fp).any() else None
    fp_relief = float(np.nanmax(z) - np.nanmin(z)) if np.isfinite(z).any() else None
    # best-fit plane tilt across the footprint (what the pads actually see)
    plane_tilt = None
    if np.isfinite(z).sum() >= 3:
        X = (xx.repeat(patch.shape[0], 0) * patch.dx_m)[mask]; Y = (yy.repeat(patch.shape[1], 1) * patch.dy_m)[mask]
        ok = np.isfinite(z)
        A = np.c_[X[ok], Y[ok], np.ones(ok.sum())]
        coef, *_ = np.linalg.lstsq(A, z[ok], rcond=None)
        plane_tilt = float(np.degrees(np.arctan(np.hypot(coef[0], coef[1]))))
    cls = CLASS_NAMES[int(layers["class"][r, c])] if np.isfinite(layers["class"][r, c]) else "insufficient_data"
    checks = [
        _check("footprint best-fit plane tilt", plane_tilt, cfg.max_tilt_deg, unit="deg"),
        _check("max local slope within footprint", fp_slope_max, cfg.max_tilt_deg, unit="deg"),
        _check("relief within footprint vs gear clearance", fp_relief, cfg.landing_gear.gear_height_m, unit="m"),
        _check("data coverage within footprint (missing fraction)", nan_frac, 0.0, unit="fraction"),
    ]
    issues = [f"{k['check']}: {k['value']:.3g} {k['unit']} exceeds {k['limit']:.3g}" for k in checks if k["status"] == FAIL]
    if cls == "insufficient_data" or nan_frac > 0:
        issues.append("Terrain data around the touchdown point are incomplete (missing cells or window touches the patch edge).")
    if cls == "geometrically_unsuitable":
        issues.append("Touchdown cell is classified geometrically unsuitable by the terrain analysis (see explanation).")
    cell = max(patch.dx_m, patch.dy_m)
    coarse = cell > cfg.footprint_radius_m
    if coarse:
        issues.append(f"DEM cell size ({cell:,.0f} m) is larger than the vehicle footprint radius ({cfg.footprint_radius_m:.2f} m): the terrain under the "
                      "landing gear is not resolved, so the values above are regional averages and the surface cannot be confirmed suitable. A finer DEM is needed.")
    status = (UNKNOWN if cls == "insufficient_data" or nan_frac > 0 else FAIL if any(k["status"] == FAIL for k in checks) or cls == "geometrically_unsuitable" else PASS)
    if coarse and status == PASS:
        status = UNKNOWN                      # never report "within limits" for terrain the DEM cannot resolve
    return {"status": status, "resolution_too_coarse": coarse, "terrain_classification": cls, "checks": checks, "issues": issues,
            "point_values": {"slope_deg": _f(layers["slope"][r, c]), "roughness_m": _f(layers["roughness"][r, c]),
                             "local_relief_m": _f(layers["local_relief"][r, c]), "elevation_m": _f(patch.elevation[r, c]),
                             "suitability": _f(layers["suitability"][r, c])},
            "footprint": {"radius_m": cfg.footprint_radius_m, "cells": int(mask.sum()), "missing_fraction": nan_frac,
                          "max_slope_deg": fp_slope_max, "relief_m": fp_relief, "best_fit_plane_tilt_deg": plane_tilt},
            "explanation": explain_point(layers, r, c, params)}


def _f(v):
    return float(v) if np.isfinite(v) else None


def evaluate_trajectory(cfg: SpacecraftConfig, sim: SimulationOutput) -> dict:
    td = sim.summary.get("touchdown")
    con = cfg.constraints
    if td is None:
        return {"status": "no_touchdown", "checks": [], "issues": ["Vehicle did not reach the surface within max_time_s."]}
    checks = [
        _check("vertical touchdown speed", abs(td["vertical_speed_m_s"]), con.max_vertical_touchdown_speed_m_s, unit="m/s"),
        _check("horizontal touchdown speed", td["horizontal_speed_m_s"], con.max_horizontal_touchdown_speed_m_s, unit="m/s"),
        _check("miss distance from target", td["miss_distance_m"], con.max_distance_to_target_m, unit="m"),
    ]
    issues = [f"{k['check']}: {k['value']:.3g} {k['unit']} exceeds limit {k['limit']:.3g}" for k in checks if k["status"] == FAIL]
    status = FAIL if any(k["status"] == FAIL for k in checks) else PASS
    return {"status": status, "checks": checks, "issues": issues,
            "touchdown": td, "flight_path_angle_at_touchdown_deg": td["flight_path_angle_deg"]}


def evaluate_vehicle(cfg: SpacecraftConfig, sim: SimulationOutput) -> dict:
    con = cfg.constraints
    peak = sim.summary["peak_proper_acceleration_m_s2"]
    fuel_left = sim.summary["fuel_remaining_kg"]
    checks = [_check("peak thrust acceleration", peak, con.max_acceleration_m_s2, unit="m/s^2"),
              _check("remaining fuel (>= 0)", fuel_left, 0.0, kind="min", unit="kg")]
    issues = [f"{k['check']}: {k['value']:.3g} exceeds limit {k['limit']:.3g}" for k in checks if k["status"] == FAIL]
    ev = [e["event"] for e in sim.summary["events"]]
    if "fuel_exhausted" in ev:
        issues.append("Fuel was exhausted during the burn.")
    status = FAIL if issues else (UNKNOWN if con.max_acceleration_m_s2 is None else PASS)
    return {"status": status, "checks": checks, "issues": issues, "fuel_remaining_kg": fuel_left,
            "fuel_fraction_remaining": fuel_left / cfg.fuel_mass_kg if cfg.fuel_mass_kg else None,
            "derived": cfg.derived(),
            "notes": ["max_acceleration_m_s2 not set by user: acceleration limit not assessed."] if con.max_acceleration_m_s2 is None else []}


def evaluate_landing(cfg: SpacecraftConfig, sim: SimulationOutput, analysis: dict | None, patch: TerrainPatch | None,
                     params: AnalysisParams | None) -> dict:
    traj = evaluate_trajectory(cfg, sim)
    td = traj.get("touchdown")
    surface = (evaluate_surface(cfg, td["latitude_deg"], td["longitude_deg"], analysis, patch, params) if td
               else {"status": "no_touchdown", "checks": [], "issues": [], "explanation": None})
    vehicle = evaluate_vehicle(cfg, sim)
    statuses = [surface["status"], traj["status"], vehicle["status"]]
    if FAIL in statuses:
        overall = "limits_exceeded"
    elif any(s not in (PASS,) for s in statuses):
        overall = "insufficient_data_or_not_fully_assessed"
    else:
        overall = "within_all_assessed_limits"
    uncertainty = {"level": "high" if patch is None else "moderate",
                   "factors": ["Simplified 3-DOF model without attitude control, gravity harmonics or guidance.",
                               "DEM-derived metrics cannot resolve boulders/craters smaller than ~2 cells."]}
    if patch is not None:
        uncertainty["dem_resolution_m"] = {"dx": patch.dx_m, "dy": patch.dy_m}
        uncertainty["min_resolvable_feature_m"] = 2 * max(patch.dx_m, patch.dy_m)
        if max(patch.dx_m, patch.dy_m) > cfg.footprint_radius_m:
            uncertainty["factors"].append(f"DEM resolution ({max(patch.dx_m, patch.dy_m):,.0f} m/cell) is coarser than the landing footprint ({cfg.footprint_radius_m:.2f} m radius): "
                                          "surface suitability at the touchdown point is not resolved.")
            uncertainty["level"] = "high"
        if patch.dataset.synthetic:
            uncertainty["factors"].append("SYNTHETIC TERRAIN: surface results are not real lunar data.")
            uncertainty["level"] = "not_applicable_synthetic_terrain"
        va = patch.dataset.meta.get("vertical_accuracy_m")
        uncertainty["dem_vertical_accuracy_m"] = va if va is not None else "not provided in dataset metadata"
    issues = surface["issues"] + traj["issues"] + vehicle["issues"]
    return {
        "overall": overall,
        "surface_assessment": surface, "trajectory_assessment": traj, "vehicle_assessment": vehicle,
        "issues": issues,
        "explanation": _explain(overall, surface, traj, vehicle),
        "uncertainty": uncertainty,
        "limitations": sim.summary["assumptions"] + [
            "This is an analytical research estimate, not a certified landing-safety assessment or probability."],
    }


def _explain(overall, s, t, v) -> str:
    parts = [f"Surface: {s['status']}", f"Trajectory: {t['status']}", f"Vehicle: {v['status']}"]
    txt = "; ".join(parts) + ". "
    txt += {"limits_exceeded": "At least one checked limit was exceeded - see the issue list.",
            "within_all_assessed_limits": "All assessed limits were met in this simplified model; this does NOT guarantee a safe landing.",
            "insufficient_data_or_not_fully_assessed": "Some domains lack data or limits, so the result is incomplete."}[overall]
    return txt
