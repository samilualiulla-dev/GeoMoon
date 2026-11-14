"""PDS3 label parser and IMG -> GeoTIFF importer for LOLA / LRO gridded products.

Why: LOLA products are distributed as raw binary ``.IMG`` + a PDS3 ``.LBL`` label.  The label holds everything needed to
georeference and scale the numbers.  This module reads it, writes a tiled, compressed integer GeoTIFF (scale/offset are
kept in the sidecar so no precision is lost) and a provenance ``.meta.json`` understood by the dataset registry.

Quantity classification (what the raster *is*), because a roughness or slope map must never be used as a DEM:
  * ``elevation`` - heights/radii (label OFFSET ~ lunar radius, e.g. LDEM) -> topography = DN*scale + OFFSET - R_ref
  * ``roughness`` - product id LDRM*;  ``slope`` - LDSM*;  anything else is ``other``.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import rasterio
from rasterio.crs import CRS
from rasterio.transform import from_bounds, from_origin
from rasterio.windows import Window

PDS_URL = "https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/"
LOLA_CITATION = ("Smith, D. E., et al. (2010), Initial observations from the Lunar Orbiter Laser Altimeter (LOLA), "
                 "Geophys. Res. Lett., 37, L18204; Smith, D. E., et al. (2017), Summary of the results from the Lunar Orbiter "
                 "Laser Altimeter after seven years in lunar orbit, Icarus, 283, 70-91. Data: PDS LRO-L-LOLA-4-GDR-V1.0.")


class PdsError(ValueError):
    pass


def _strip_comments(text: str) -> str:
    return re.sub(r"/\*.*?\*/", "", text, flags=re.S)


def _convert(raw: str):
    v = raw.strip()
    if v.startswith('"') and v.endswith('"'):
        return re.sub(r"\s+", " ", v[1:-1]).strip()
    if v.startswith("'") and v.endswith("'"):
        return v[1:-1]
    if v.startswith("{") or v.startswith("("):
        parts = [p.strip() for p in re.split(r",(?![^\"]*\"[^\"]*(?:\"[^\"]*\"[^\"]*)*$)", v.strip("{}()")) if p.strip()]
        return [_convert(p) for p in parts]
    m = re.fullmatch(r"([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)\s*(?:<[^>]*>)?", v)
    if m:
        f = float(m.group(1))
        return int(f) if re.fullmatch(r"[-+]?\d+", m.group(1)) else f
    return v


def parse_label(text: str) -> dict:
    """Parse a PDS3 label into a flat dict (the FIRST occurrence of a repeated keyword wins). Pointers ('^IMAGE') are kept with their caret."""
    out: dict = {}
    units: dict[str, str] = {}
    lines = _strip_comments(text).splitlines()
    i = 0
    while i < len(lines):
        line = lines[i].rstrip()
        i += 1
        s = line.strip()
        if not s or s == "END":
            if s == "END":
                break
            continue
        if "=" not in s:
            continue
        key, val = (p.strip() for p in s.split("=", 1))
        # multi-line quoted string / brace list
        if val.startswith('"') and not (len(val) > 1 and val.endswith('"')):
            while i < len(lines) and not val.rstrip().endswith('"'):
                val += " " + lines[i].strip(); i += 1
        elif val.startswith("{") and "}" not in val:
            while i < len(lines) and "}" not in val:
                val += " " + lines[i].strip(); i += 1
        elif val.startswith("(") and ")" not in val:
            while i < len(lines) and ")" not in val:
                val += " " + lines[i].strip(); i += 1
        if key not in out:   # first occurrence wins (e.g. product-level DESCRIPTION, not the IMAGE object one)
            out[key] = _convert(val)
            mu = re.search(r"<([^>]*)>\s*$", val)
            if mu:
                units[key] = mu.group(1).strip()
    out["__units__"] = units
    return out


def length_in_m(label: dict, key: str) -> float | None:
    """Numeric label value converted to metres using its <unit> tag (km, m). Unit-less values are assumed to be metres."""
    if key not in label:
        return None
    u = label.get("__units__", {}).get(key, "m").lower().replace(" ", "")
    v = float(label[key])
    if u.startswith("km"):
        return v * 1000.0
    if u.startswith("m"):
        return v
    raise PdsError(f"Unsupported unit <{u}> for {key}")


_DTYPES = {("LSB_INTEGER", 16): "<i2", ("MSB_INTEGER", 16): ">i2", ("LSB_INTEGER", 32): "<i4", ("MSB_INTEGER", 32): ">i4",
           ("PC_REAL", 32): "<f4", ("IEEE_REAL", 32): ">f4", ("LSB_UNSIGNED_INTEGER", 16): "<u2", ("MSB_UNSIGNED_INTEGER", 16): ">u2"}


@dataclass
class ImportResult:
    tif: Path
    meta_path: Path
    meta: dict
    shape: tuple[int, int]


def classify(label: dict) -> str:
    pid = str(label.get("PRODUCT_ID", "")).upper()
    if pid.startswith("LDRM"):
        return "roughness"
    if pid.startswith("LDSM"):
        return "slope"
    offset = float(label.get("OFFSET", 0) or 0)
    if pid.startswith("LDEM") or offset > 1e5:
        return "elevation"
    return "other"


def _georef(label: dict, width: int, height: int):
    proj = str(label.get("MAP_PROJECTION_TYPE", "")).upper()
    radius_m = float(label["A_AXIS_RADIUS"]) * 1000.0
    if str(label.get("POSITIVE_LONGITUDE_DIRECTION", "EAST")).upper() != "EAST":
        raise PdsError("Only east-positive longitude products are supported")
    if "CYLINDRICAL" in proj:
        crs = CRS.from_proj4(f"+proj=longlat +R={radius_m} +no_defs")
        west, east = float(label["WESTERNMOST_LONGITUDE"]), float(label["EASTERNMOST_LONGITUDE"])
        south, north = float(label["MINIMUM_LATITUDE"]), float(label["MAXIMUM_LATITUDE"])
        transform = from_bounds(west, south, east, north, width, height)
        ppd = float(label["MAP_RESOLUTION"]) if "MAP_RESOLUTION" in label else None
        res_m = radius_m * np.pi / 180.0 / ppd if ppd else length_in_m(label, "MAP_SCALE")
        return crs, transform, res_m, radius_m, f"{south:g}..{north:g} N, {west:g}..{east:g} E"
    if "POLAR" in proj and "STEREO" in proj:
        lat0 = float(label["CENTER_LATITUDE"]); lon0 = float(label.get("CENTER_LONGITUDE", 0.0))
        if abs(abs(lat0) - 90.0) > 1e-6:
            raise PdsError(f"Polar stereographic with CENTER_LATITUDE={lat0} is not supported (expected +/-90)")
        scale = length_in_m(label, "MAP_SCALE")  # metres / pixel (unit tag respected)
        lo, so = float(label["LINE_PROJECTION_OFFSET"]), float(label["SAMPLE_PROJECTION_OFFSET"])
        # offsets are pixel-centre indices (0-based) of the projection origin -> raster edge = origin -/+ (offset + 0.5) px
        left, top = -(so + 0.5) * scale, (lo + 0.5) * scale
        crs = CRS.from_proj4(f"+proj=stere +lat_0={lat0:g} +lon_0={lon0:g} +k=1 +x_0=0 +y_0=0 +R={radius_m} +units=m +no_defs")
        return crs, from_origin(left, top, scale, scale), scale, radius_m, f"polar stereographic, centre lat {lat0:g}"
    raise PdsError(f"Unsupported MAP_PROJECTION_TYPE: {proj!r} (supported: SIMPLE CYLINDRICAL, POLAR STEREOGRAPHIC)")


def _image_offset(label: dict, lbl_path: Path) -> tuple[Path, int]:
    ptr = label.get("^IMAGE")
    rec = int(label.get("RECORD_BYTES", 0) or 0)
    name, off = label.get("FILE_NAME") or lbl_path.with_suffix(".IMG").name, 0
    if isinstance(ptr, str) and not re.fullmatch(r"\d+", ptr):
        name = ptr
    elif isinstance(ptr, list):
        name = ptr[0]
        if len(ptr) > 1 and isinstance(ptr[1], (int, float)):
            off = (int(ptr[1]) - 1) * rec
    elif isinstance(ptr, int):
        off = (ptr - 1) * rec
    p = lbl_path.parent / str(name)
    if not p.exists():  # tolerate case differences / .img
        for cand in lbl_path.parent.iterdir():
            if cand.name.lower() == str(name).lower():
                p = cand; break
    return p, off


def import_pds(lbl_path: str | Path, out_dir: str | Path, *, chunk_rows: int = 1024, mark_synthetic: bool = False,
               overview_min_pixels: int = 4_000_000, img_path: str | Path | None = None) -> ImportResult:
    lbl_path, out_dir = Path(lbl_path), Path(out_dir)
    label = parse_label(lbl_path.read_text(encoding="latin-1"))
    for k in ("LINES", "LINE_SAMPLES", "SAMPLE_TYPE", "SAMPLE_BITS", "SCALING_FACTOR", "OFFSET", "A_AXIS_RADIUS"):
        if k not in label:
            raise PdsError(f"Label {lbl_path.name} lacks required keyword {k}")
    height, width = int(label["LINES"]), int(label["LINE_SAMPLES"])
    dt = _DTYPES.get((str(label["SAMPLE_TYPE"]).upper(), int(label["SAMPLE_BITS"])))
    if dt is None:
        raise PdsError(f"Unsupported sample type {label['SAMPLE_TYPE']}/{label['SAMPLE_BITS']}")
    img, offset_bytes = _image_offset(label, lbl_path)
    if img_path is not None:                      # image supplied separately (e.g. unzipped under another name/folder)
        img = Path(img_path)
    if not img.exists():
        raise PdsError(f"Image file {img.name} not found next to the label ({lbl_path.parent})")
    expected = offset_bytes + height * width * np.dtype(dt).itemsize
    if img.stat().st_size < expected:
        raise PdsError(f"{img.name} is {img.stat().st_size} bytes but the label ({label.get('PRODUCT_ID')}: {width} x {height} px, {np.dtype(dt).itemsize * 8} bit) "
                       f"needs {expected}. Either the download is incomplete/truncated, or the label belongs to a DIFFERENT product than this image "
                       f"(e.g. LDEM_128's label with the LDEM_16 image). Use the .LBL with the same product name as the .IMG.")
    if img.stat().st_size > expected + 2 * int(label.get("RECORD_BYTES", 0) or 0) + 1:
        raise PdsError(f"{img.name} is {img.stat().st_size} bytes but the label ({label.get('PRODUCT_ID')}) describes only {expected}: "
                       "the label belongs to a different (smaller) product than this image.")
    crs, transform, res_m, radius_m, coverage = _georef(label, width, height)
    quantity = classify(label)
    scale, offset = float(label["SCALING_FACTOR"]), float(label["OFFSET"])
    # elevation: label stores RADIUS = DN*scale + OFFSET; topography is relative to the reference sphere.
    phys_offset = offset - radius_m if quantity == "elevation" else offset
    missing = label.get("MISSING_CONSTANT")
    arr = np.memmap(img, dtype=dt, mode="r", offset=offset_bytes, shape=(height, width))
    out_dir.mkdir(parents=True, exist_ok=True)
    stem = str(label.get("PRODUCT_ID", lbl_path.stem)).lower()
    tif = out_dir / f"{stem}.tif"
    out_dtype = "int16" if dt.endswith("i2") else ("int32" if dt.endswith("i4") else "float32")
    if dt.endswith("u2"):
        out_dtype = "uint16"
    nodata = float(missing) if missing is not None else None
    with rasterio.open(tif, "w", driver="GTiff", height=height, width=width, count=1, dtype=out_dtype, crs=crs, transform=transform,
                       nodata=nodata, tiled=True, blockxsize=512, blockysize=512, compress="deflate", predictor=2 if out_dtype != "float32" else 3,
                       BIGTIFF="IF_SAFER") as dst:
        for r in range(0, height, chunk_rows):
            h = min(chunk_rows, height - r)
            dst.write(np.asarray(arr[r:r + h]).astype(out_dtype, copy=False), 1, window=Window(0, r, width, h))
    if width * height >= overview_min_pixels:
        # pyramid: makes whole-Moon (globe) and zoomed-out reads fast instead of scanning gigabytes
        from rasterio.enums import Resampling
        with rasterio.open(tif, "r+") as dst:
            levels = [f for f in (2, 4, 8, 16, 32, 64, 128) if width // f >= 256 and height // f >= 128]
            if levels:
                dst.build_overviews(levels, Resampling.average)
                dst.update_tags(ns="rio_overview", resampling="average")
    descr = label.get("DESCRIPTION", "")
    meta = {
        "name": f"LOLA {label.get('PRODUCT_ID')} ({label.get('DATA_SET_ID')})",
        "provider": "NASA LRO / LOLA (PDS Geosciences Node)",
        "product": str(label.get("PRODUCT_ID")),
        "version": str(label.get("PRODUCT_VERSION_ID", "")) or None,
        "url": PDS_URL, "citation": LOLA_CITATION,
        "quantity": quantity, "unit": str(label.get("UNIT", "METER")).lower() if str(label.get("UNIT", "")) else "m",
        "resolution_m_per_px": res_m, "vertical_reference_radius_m": radius_m,
        "elevation_scale": scale, "elevation_offset": phys_offset,
        "nominal_coverage": coverage, "synthetic": mark_synthetic,
        "source_label_file": lbl_path.name, "source_description": descr, "label_note": label.get("GEOMOON_NOTE"),
        "projection": str(label.get("MAP_PROJECTION_TYPE")), "map_resolution": label.get("MAP_RESOLUTION"),
        "missing_constant": missing, "imported_by": "geomoon import_pds",
        "sample_range_dn": [label.get("MINIMUM", label.get("DERIVED_MINIMUM")), label.get("MAXIMUM", label.get("DERIVED_MAXIMUM"))],
    }
    meta_path = tif.with_suffix(".meta.json")
    meta_path.write_text(json.dumps(meta, indent=2, ensure_ascii=False), encoding="utf-8")
    return ImportResult(tif, meta_path, meta, (height, width))


def sanity_report(tif: Path, meta: dict) -> dict:
    """Quick physical plausibility summary of an imported raster (read at reduced size)."""
    with rasterio.open(tif) as ds:
        step = max(1, int(max(ds.width, ds.height) / 1500))
        a = ds.read(1, out_shape=(ds.height // step, ds.width // step), masked=True).astype("float64")
    z = np.ma.filled(a, np.nan) * meta["elevation_scale"] + meta["elevation_offset"]
    valid = np.isfinite(z)
    rep = {"valid_fraction": float(valid.mean()), "min": float(np.nanmin(z)) if valid.any() else None,
           "max": float(np.nanmax(z)) if valid.any() else None, "mean": float(np.nanmean(z)) if valid.any() else None, "warnings": []}
    q = meta.get("quantity")
    if q == "elevation" and valid.any():
        if not (-12000 < rep["min"] and rep["max"] < 13000):
            rep["warnings"].append("elevation range outside the plausible lunar range (-12..+13 km): check scale/offset in the label")
    if q == "roughness" and valid.any() and (rep["min"] < 0 or rep["max"] > 40):
        rep["warnings"].append("roughness values outside 0..40 m: check scale")
    if rep["valid_fraction"] < 0.5:
        rep["warnings"].append("more than half of the raster is no-data")
    return rep
