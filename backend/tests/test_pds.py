"""PDS3 label parsing + IMG import. The LDRM_16 label is the REAL label of NASA's LOLA roughness product (fixture);
the binary rasters here are tiny test fixtures generated for the tests (never lunar data)."""
import re
import struct
from pathlib import Path

import numpy as np
import pytest
import rasterio
from pyproj import CRS, Transformer

from app.core.errors import ValidationFailure
from app.lunar_data.engine import LunarDataEngine
from app.lunar_data.pds import PdsError, classify, import_pds, parse_label, sanity_report
from app.lunar_data.registry import DatasetRegistry

FIX = Path(__file__).parent / "fixtures"
REAL_LABEL = (FIX / "LDRM_16.LBL").read_text()


def write_img(path: Path, arr: np.ndarray, dtype="<i2"):
    path.write_bytes(arr.astype(dtype).tobytes())


def small_label(name, lines, samples, *, scale, offset, ppd=2, extra=""):
    t = REAL_LABEL
    t = re.sub(r'LDRM_16', name, t)
    t = re.sub(r'(LINES\s+=\s+)2880', rf'\g<1>{lines}', t)
    t = re.sub(r'(LINE_SAMPLES\s+=\s+)5760', rf'\g<1>{samples}', t)
    t = re.sub(r'(SCALING_FACTOR\s+=\s+)0\.001', rf'\g<1>{scale}', t)
    t = re.sub(r'(\n    OFFSET\s+=\s+)0', rf'\g<1>{offset}', t)
    t = re.sub(r'(LINE_LAST_PIXEL\s+=\s+)2880', rf'\g<1>{lines}', t)
    t = re.sub(r'(SAMPLE_LAST_PIXEL\s+=\s+)5760', rf'\g<1>{samples}', t)
    t = re.sub(r'(MAP_RESOLUTION\s+=\s+)16', rf'\g<1>{ppd}', t)
    t = re.sub(r'1\.89520940151', f"{1737.4 * np.pi / 180 / ppd:.11f}", t)
    return t + extra


def test_parse_real_label():
    l = parse_label(REAL_LABEL)
    assert (l["PRODUCT_ID"], l["LINES"], l["LINE_SAMPLES"]) == ("LDRM_16", 2880, 5760)
    assert l["SCALING_FACTOR"] == 0.001 and l["OFFSET"] == 0 and l["MISSING_CONSTANT"] == -32768
    assert l["A_AXIS_RADIUS"] == 1737.4 and l["^IMAGE"] == "LDRM_16.IMG"
    assert l["MISSION_PHASE_NAME"] == ["COMMISSIONING", "NOMINAL MISSION", "SCIENCE MISSION"]   # multi-line brace list
    assert l["DESCRIPTION"].startswith("This data product is a map of the surface roughness")      # multi-line string
    assert l["WESTERNMOST_LONGITUDE"] == 0 and l["EASTERNMOST_LONGITUDE"] == 360
    assert classify(l) == "roughness"
    assert "PDS_VERSION_ID" in l and "END" not in l


def test_import_real_roughness_label_is_not_a_dem(tmp_path):
    lbl = tmp_path / "in" / "LDRM_16.LBL"; lbl.parent.mkdir()
    lbl.write_text(small_label("LDRM_16", 90, 180, scale=0.001, offset=0))
    dn = np.full((90, 180), 5000, "<i2"); dn[0, 0] = -32768
    write_img(lbl.parent / "LDRM_16.IMG", dn)
    r = import_pds(lbl, tmp_path / "dem")
    assert r.meta["quantity"] == "roughness" and r.meta["elevation_scale"] == 0.001 and r.meta["elevation_offset"] == 0
    rep = sanity_report(r.tif, r.meta)
    assert rep["max"] == pytest.approx(5.0) and not rep["warnings"]
    reg = DatasetRegistry(tmp_path / "dem")
    info = reg.get("ldrm_16")
    assert info.quantity == "roughness" and info.to_dict()["usable_as_dem"] is False
    assert any("not elevation" in w for w in info.warnings)
    eng = LunarDataEngine(reg)
    with pytest.raises(ValidationFailure, match="not elevation"):
        eng.read_patch("ldrm_16", 10, 20, 100000)
    with pytest.raises(ValidationFailure):
        eng.elevation_at("ldrm_16", 10, 20)
    from app.core.errors import DataUnavailableError
    with pytest.raises(DataUnavailableError):
        reg.find_covering(10, 20, allow_synthetic=True)          # roughness raster is never auto-selected as DEM


def make_ldem(tmp_path, name="LDEM_2"):
    """cylindrical elevation product: elevation[m] = row  (+1000 m east of lon 180)  via scale 0.5 / offset 1737400."""
    lbl = tmp_path / "in" / f"{name}.LBL"; lbl.parent.mkdir(exist_ok=True)
    lbl.write_text(small_label(name, 360, 720, scale=0.5, offset=1737400, ppd=2))
    rows = np.arange(360)[:, None] * np.ones((1, 720))
    dn = (2 * rows).astype("<i2"); dn[:, 360:] += 2000     # +1000 m for lon >= 180
    dn[10, 10] = -32768                                      # one missing pixel
    write_img(lbl.parent / f"{name}.IMG", dn)
    return lbl


def test_elevation_import_georeferencing_and_scaling(tmp_path):
    lbl = make_ldem(tmp_path)
    r = import_pds(lbl, tmp_path / "dem", mark_synthetic=True)
    assert r.meta["quantity"] == "elevation" and r.meta["elevation_offset"] == pytest.approx(0.0)   # 1737400 - R_ref
    with rasterio.open(r.tif) as ds:
        assert ds.bounds.left == 0 and ds.bounds.right == 360 and ds.bounds.top == 90 and ds.bounds.bottom == -90
        assert ds.dtypes[0] == "int16" and ds.nodata == -32768
    eng = LunarDataEngine(DatasetRegistry(tmp_path / "dem"))
    # pixel (row 99) -> lat = 90 - 99.5*0.5 = 40.25 ; lon 50 E -> col 100 (west half)
    assert eng.elevation_at("ldem_2", 40.25, 50.25) == pytest.approx(99.0, abs=1e-6)
    # lon -50 == 310 E -> east half: +1000 m
    assert eng.elevation_at("ldem_2", 40.25, -49.75) == pytest.approx(1099.0, abs=1e-6)
    # the missing pixel (row 10, col 10) is NaN -> error, not a number
    from app.core.errors import OutOfCoverageError
    with pytest.raises(OutOfCoverageError):
        eng.elevation_at("ldem_2", 90 - 10.5 * 0.5, 10.5 * 0.5)
    g = eng.read_global_grid("ldem_2", 36, 72)
    assert g["elevation"].shape == (36, 72) and g["lon_west_deg"] == 0 and g["lat_north_deg"] == 90
    assert g["elevation"][0, 0] < g["elevation"][-1, 0]          # row index increases southwards in the source


def test_polar_stereographic_import(tmp_path):
    lbl = tmp_path / "in" / "LDEM_80S_TEST.LBL"; lbl.parent.mkdir()
    n, scale = 200, 100.0
    t = REAL_LABEL.replace("LDRM_16", "LDEM_80S_TEST").replace('"SIMPLE CYLINDRICAL"', '"POLAR STEREOGRAPHIC"')
    t = re.sub(r"LINES\s+=\s+2880", f"LINES = {n}", t); t = re.sub(r"LINE_SAMPLES\s+=\s+5760", f"LINE_SAMPLES = {n}", t)
    t = re.sub(r"(SCALING_FACTOR\s+=\s+)0\.001", r"\g<1>0.5", t); t = re.sub(r"(\n    OFFSET\s+=\s+)0", r"\g<1>1737400", t)
    t = re.sub(r"CENTER_LATITUDE\s+=\s+0\. <deg>", "CENTER_LATITUDE = -90. <deg>", t)
    t = re.sub(r"CENTER_LONGITUDE\s+=\s+180\. <deg>", "CENTER_LONGITUDE = 0. <deg>", t)
    t = re.sub(r"MAP_SCALE\s+=\s+[\d.]+ <km/pix>", f"MAP_SCALE = {scale} <m/pix>", t)
    t = re.sub(r"LINE_PROJECTION_OFFSET\s+=\s+[\d.]+", f"LINE_PROJECTION_OFFSET = {n/2 - 0.5}", t)
    t = re.sub(r"SAMPLE_PROJECTION_OFFSET\s+=\s+[\d.]+", f"SAMPLE_PROJECTION_OFFSET = {n/2 - 0.5}", t)
    lbl.write_text(t)
    cols = np.ones((n, 1)) * np.arange(n)[None, :]
    write_img(lbl.parent / "LDEM_80S_TEST.IMG", (2 * cols).astype("<i2"))        # elevation = column index
    r = import_pds(lbl, tmp_path / "dem", mark_synthetic=True)
    reg = DatasetRegistry(tmp_path / "dem")
    info = reg.get("ldem_80s_test")
    assert info.includes_pole and not info.is_geographic
    # point at projected (x=3000, y=-2000) m  -> column = (x + 100*100)/100 - 0.5 = 129.5
    crs = CRS.from_user_input(info.crs_wkt)
    lon, lat = Transformer.from_crs(crs, crs.geodetic_crs, always_xy=True).transform(3000.0, -2000.0)
    assert lat < -89.5
    eng = LunarDataEngine(reg)
    assert eng.elevation_at("ldem_80s_test", lat, lon) == pytest.approx(129.5, abs=1e-3)


@pytest.mark.parametrize("mutate,msg", [
    (lambda t: t.replace('"SIMPLE CYLINDRICAL"', '"ORTHOGRAPHIC"'), "Unsupported MAP_PROJECTION_TYPE"),
    (lambda t: t.replace('"EAST"', '"WEST"'), "east-positive"),
    (lambda t: t.replace("LSB_INTEGER", "WEIRD_TYPE"), "Unsupported sample type"),
    (lambda t: re.sub(r"SCALING_FACTOR\s+=.*\n", "", t), "required keyword"),
])
def test_bad_labels_rejected(tmp_path, mutate, msg):
    d = tmp_path / "in"; d.mkdir()
    (d / "LDRM_16.LBL").write_text(mutate(small_label("LDRM_16", 90, 180, scale=0.001, offset=0)))
    write_img(d / "LDRM_16.IMG", np.zeros((90, 180)))
    with pytest.raises(PdsError, match=msg):
        import_pds(d / "LDRM_16.LBL", tmp_path / "out")


def test_truncated_or_missing_img_reported(tmp_path):
    d = tmp_path / "in"; d.mkdir()
    (d / "LDRM_16.LBL").write_text(small_label("LDRM_16", 90, 180, scale=0.001, offset=0))
    with pytest.raises(PdsError, match="not found"):
        import_pds(d / "LDRM_16.LBL", tmp_path / "out")
    (d / "LDRM_16.IMG").write_bytes(b"\0" * 1000)
    with pytest.raises(PdsError, match="incomplete or truncated"):
        import_pds(d / "LDRM_16.LBL", tmp_path / "out")


def test_sanity_warns_on_implausible_elevation(tmp_path):
    lbl = tmp_path / "in" / "LDEM_2.LBL"; lbl.parent.mkdir()
    lbl.write_text(small_label("LDEM_2", 36, 72, scale=0.5, offset=1737400, ppd=0.2))
    write_img(lbl.parent / "LDEM_2.IMG", np.full((36, 72), 30000))               # 15 km above the reference sphere
    r = import_pds(lbl, tmp_path / "dem")
    assert any("plausible" in w for w in sanity_report(r.tif, r.meta)["warnings"])


def test_filename_case_and_record_pointer(tmp_path):
    d = tmp_path / "in"; d.mkdir()
    (d / "ldrm_16.lbl").write_text(small_label("LDRM_16", 90, 180, scale=0.001, offset=0))
    write_img(d / "ldrm_16.img", np.ones((90, 180)))                              # lower-case file names (Windows downloads)
    assert import_pds(d / "ldrm_16.lbl", tmp_path / "out").shape == (90, 180)


# ---- LDEM_128 (real label supplied by the user: 236.901 m/pix, 2.1 GB IMG) --------------------------------------
LDEM128 = (FIX / "LDEM_128.LBL").read_text()


def test_parse_real_ldem128_label():
    l = parse_label(LDEM128)
    assert (l["PRODUCT_ID"], l["LINES"], l["LINE_SAMPLES"]) == ("LDEM_128", 23040, 46080)
    assert l["SCALING_FACTOR"] == 0.5 and l["OFFSET"] == 1737400.0 and "MISSING_CONSTANT" not in l
    assert (l["MINIMUM"], l["MAXIMUM"]) == (-18255, 21557)                    # DN -> -9.13 km .. +10.78 km
    assert len(l["MISSION_PHASE_NAME"]) == 6 and "THIRD EXTENDED SCIENCE MISSION" in l["MISSION_PHASE_NAME"]
    assert l["__units__"]["MAP_SCALE"] == "m/pix"                              # NOT km (LDRM_16 uses km/pix)
    assert l["DESCRIPTION"].startswith("This data product is a shape map (radius)")
    assert classify(l) == "elevation"
    assert l["MINIMUM"] * 0.5 == pytest.approx(-9127.5) and l["MAXIMUM"] * 0.5 == pytest.approx(10778.5)


def test_map_scale_units_are_respected():
    from app.lunar_data.pds import _georef, length_in_m
    a, b = parse_label(REAL_LABEL), parse_label(LDEM128)
    assert length_in_m(a, "MAP_SCALE") == pytest.approx(1895.2094, rel=1e-6)   # <km/pix>
    assert length_in_m(b, "MAP_SCALE") == pytest.approx(236.901)               # <m/pix>
    assert _georef(a, 5760, 2880)[2] == pytest.approx(1895.21, abs=0.01)
    assert _georef(b, 46080, 23040)[2] == pytest.approx(236.90, abs=0.01)      # from MAP_RESOLUTION, consistent with the label


def test_import_ldem128_scaled_down_with_overviews(tmp_path):
    d = tmp_path / "in"; d.mkdir()
    t = LDEM128.replace("LDEM_128", "LDEM_4")
    t = re.sub(r"(LINES\s+=\s+)23040", r"\g<1>720", t); t = re.sub(r"(LINE_SAMPLES\s+=\s+)46080", r"\g<1>1440", t)
    t = re.sub(r"(MAP_RESOLUTION\s+=\s+)128", r"\g<1>4", t)
    (d / "LDEM_4.LBL").write_text(t)
    rows = np.arange(720)[:, None] * np.ones((1, 1440))
    write_img(d / "LDEM_4.IMG", (rows - 360).astype("<i2"))                    # DN -360..359 -> -180..+179.5 m
    r = import_pds(d / "LDEM_4.LBL", tmp_path / "dem", overview_min_pixels=100_000)
    assert r.meta["quantity"] == "elevation" and r.meta["elevation_offset"] == pytest.approx(0.0)
    assert r.meta["resolution_m_per_px"] == pytest.approx(1737400 * np.pi / 180 / 4)
    assert r.meta["nominal_coverage"].startswith("-90..90 N")
    with rasterio.open(r.tif) as ds:
        assert ds.overviews(1) and ds.nodata is None
    eng = LunarDataEngine(DatasetRegistry(tmp_path / "dem"))
    assert eng.elevation_at("ldem_4", 90 - 360.5 / 4, 10.0) == pytest.approx(0.0, abs=1e-6)     # DN 0 at row 360 -> 0 m
    rep = sanity_report(r.tif, r.meta)
    assert rep["min"] == pytest.approx(-179.0, abs=2.0) and not rep["warnings"]
    g = eng.read_global_grid("ldem_4", 36, 72)                                 # overview-backed decimated read
    assert g["elevation"].shape == (36, 72) and g["elevation"][0].mean() < g["elevation"][-1].mean()   # row index grows southward: -180 m (north) -> +180 m (south)
