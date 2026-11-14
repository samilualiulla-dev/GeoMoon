"""Plausibility check of an installed REAL elevation dataset against well-known facts about the Moon.

Windows are deliberately generous (they must hold for 16-250 m/px products, which smooth peaks differently).
This catches wrong scale/offset, a flipped or shifted map, and a wrong longitude origin; it is NOT a calibration.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from ..core.errors import GeoMoonError
from .engine import LunarDataEngine
from .registry import DatasetRegistry


@dataclass
class Check:
    name: str
    status: str            # PASS | FAIL | SKIP
    detail: str


# (name, lat, lon_E, low, high, note)  elevations in metres relative to the 1737.4 km sphere
POINT_FACTS = [
    ("Apollo 11 site, Mare Tranquillitatis", 0.674, 23.473, -2300, -1500, "literature ~ -1.9 km"),
    ("Apollo 17 site, Taurus-Littrow", 20.19, 30.77, -3100, -2000, "literature ~ -2.6 km"),
    ("Mare Imbrium", 35.0, -15.0, -3300, -1500, "low basaltic plain"),
    ("Antoniadi / South Pole-Aitken floor", -70.34, 187.53, -9800, -7500, "lowest area on the Moon (~ -9 km)"),
    ("Highest region (far side, 5.4N 201.3E)", 5.41, 201.34, 8800, 11200, "highest area (~ +10.7 km)"),
]


def verify(registry: DatasetRegistry, dataset_id: str) -> list[Check]:
    info = registry.get(dataset_id)
    eng = LunarDataEngine(registry)
    out: list[Check] = []
    if info.synthetic:
        return [Check("dataset", "SKIP", f"'{dataset_id}' is flagged synthetic: facts about the real Moon do not apply")]
    if info.quantity != "elevation":
        return [Check("dataset", "SKIP", f"'{dataset_id}' is a {info.quantity} product, not elevation")]
    for name, la, lo, lo_m, hi_m, note in POINT_FACTS:
        try:
            z = eng.elevation_at(dataset_id, la, lo)
        except GeoMoonError as e:
            out.append(Check(name, "SKIP", f"not covered / no data ({e.message})")); continue
        ok = lo_m <= z <= hi_m
        out.append(Check(name, "PASS" if ok else "FAIL", f"{z:.0f} m  (expected {lo_m}..{hi_m} m; {note})"))
    try:
        g = eng.read_global_grid(dataset_id, 90, 180)["elevation"]
        lon = (np.arange(180) + 0.5) * 2.0
        near = (lon <= 90) | (lon >= 270)
        a, b = float(np.nanmean(g[:, near])), float(np.nanmean(g[:, ~near]))
        out.append(Check("far side is higher than near side", "PASS" if b > a else "FAIL", f"near {a:.0f} m, far {b:.0f} m"))
        lo_, hi_ = float(np.nanmin(g)), float(np.nanmax(g))
        out.append(Check("global range plausible", "PASS" if -11500 < lo_ and hi_ < 12000 else "FAIL", f"{lo_:.0f} .. {hi_:.0f} m (block-averaged)"))
    except GeoMoonError as e:
        out.append(Check("global statistics", "SKIP", f"not a global dataset ({e.message})"))
    if (info.resolution_m_per_px or 1e9) <= 500 and info.coverage_has_pole():
        try:
            p = eng.read_patch(dataset_id, -89.9, 129.78, 15_000.0)
            depth = float(np.nanmax(p.elevation) - np.nanmin(p.elevation))
            out.append(Check("Shackleton crater at the south pole is a >2.5 km deep depression", "PASS" if depth > 2500 else "FAIL",
                             f"relief within 15 km of 89.9S 129.8E: {depth:.0f} m (crater is ~4 km deep)"))
        except GeoMoonError as e:
            out.append(Check("Shackleton crater", "SKIP", e.message))
    return out
