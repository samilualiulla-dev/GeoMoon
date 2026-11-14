"""Database + API integration tests (use SYNTHETIC test DEM fixture; flagged as such in every response)."""
import numpy as np
import pytest
from sqlalchemy.exc import IntegrityError

from app.db import models as M

SC = {"name": "Test lander", "dry_mass_kg": 900, "fuel_mass_kg": 300,
      "dimensions": {"length_m": 3, "width_m": 3, "height_m": 4},
      "landing_gear": {"span_m": 5, "pad_diameter_m": 0.3, "gear_height_m": 0.5},
      "engine": {"thrust_n": 5000, "number_of_engines": 1, "isp_s": 300},
      "constraints": {"max_vertical_touchdown_speed_m_s": 3.0, "max_horizontal_touchdown_speed_m_s": 1.0,
                      "max_distance_to_target_m": 200.0}}
# target on the flat 2-deg plane away from the pit/hole (fixture covers lat 0.90..1.00, lon 23.00..23.0987)
TARGET = {"target_latitude_deg": 0.95, "target_longitude_deg": 23.05}


def ic(**kw):
    d = {**TARGET, "initial_altitude_m": 300.0, "initial_speed_m_s": 0.0}
    d.update(kw); return d


# ---- system / data ---------------------------------------------------------------------------
def test_health_and_sources(client):
    h = client.get("/api/health").json()
    assert h["status"] == "ok" and h["datasets_installed"] == 1 and h["real_datasets_installed"] == 0
    s = client.get("/api/data/sources").json()
    assert s["installed"][0]["synthetic"] is True and s["known_products"]
    assert any("SLDEM2015" in p["product"] and "ONLY" in p["coverage"] for p in s["known_products"])


def test_no_real_data_means_clear_error_not_fake(client):
    r = client.get("/api/lunar/terrain", params={"latitude_deg": 0.95, "longitude_deg": 23.05, "radius_m": 500})
    assert r.status_code == 404 and r.json()["error"]["code"] == "data_unavailable"
    r = client.get("/api/lunar/terrain", params={"latitude_deg": -89.0, "longitude_deg": 0, "radius_m": 500, "allow_synthetic": True})
    assert r.status_code == 404           # outside coverage (pole)


def test_terrain_window_and_elevation(client):
    p = {"latitude_deg": 0.95, "longitude_deg": 23.05, "radius_m": 500, "allow_synthetic": True, "max_grid": 16}
    r = client.get("/api/lunar/terrain", params=p).json()
    assert r["provenance"]["synthetic"] and "NOT REAL" in r["provenance"]["data_notice"]
    assert r["elevation_m"]["rows"] <= 16 and r["geometry"]["row0_is_north"]
    e = client.get("/api/lunar/elevation", params={k: p[k] for k in ("latitude_deg", "longitude_deg", "allow_synthetic")}).json()
    assert np.isfinite(e["elevation_m"]) and e["synthetic"]


def test_synthetic_requires_explicit_opt_in(client):
    r = client.post("/api/terrain/analyze", json={"latitude_deg": 0.95, "longitude_deg": 23.05, "radius_m": 500, "dataset_id": "plane_test"})
    assert r.status_code == 422 and "SYNTHETIC" in r.json()["error"]["message"]


# ---- terrain analysis ------------------------------------------------------------------------
def analyze(client, **kw):
    body = {"latitude_deg": 0.95, "longitude_deg": 23.05, "radius_m": 1000, "allow_synthetic": True, "max_grid": 32,
            "params": {"window_m": 100, "footprint_radius_m": 15}}
    body.update(kw)
    return client.post("/api/terrain/analyze", json=body)


def test_analyze_endpoint_full_result(client):
    r = analyze(client)
    assert r.status_code == 200, r.text
    j = r.json()
    assert set(j["layers"]) >= {"elevation", "slope", "roughness", "local_relief", "hazard", "suitability", "class"}
    sl = j["layers"]["slope"]
    assert sl["unit"] == "deg"
    vals = [v for row in sl["data"] for v in row if v is not None]
    assert np.mean(vals) == pytest.approx(2.0, abs=0.3)       # fixture plane is a 2 deg ramp
    assert j["summary"]["slope_deg"]["mean"] == pytest.approx(2.0, abs=0.3)
    assert j["provenance"]["synthetic"] and "disclaimer" in j and j["analysis_id"]
    assert j["candidates"] and all("explanation" in c for c in j["candidates"])
    # persisted and retrievable at full resolution
    a = client.get(f"/api/terrain/analysis/{j['analysis_id']}").json()
    assert a["synthetic"] and a["parameters"]["window_m"] == 100
    layer = client.get(f"/api/terrain/analysis/{j['analysis_id']}/layers/slope", params={"max_grid": 64}).json()
    assert layer["rows"] <= 64 and layer["unit"] == "deg"
    assert client.get(f"/api/terrain/analysis/{j['analysis_id']}/layers/nope").status_code == 404
    assert client.get("/api/terrain/analysis/9999").status_code == 404


def test_weights_update_suitability_via_api(client):
    a = analyze(client, save=False).json()["layers"]["suitability"]["data"]
    b = analyze(client, save=False, params={"window_m": 100, "footprint_radius_m": 15, "slope_limit_deg": 2.5,
                                            "weights": {"slope": 1, "roughness": 0, "relief": 0, "hazard": 0}}).json()["layers"]["suitability"]["data"]
    assert a != b


@pytest.mark.parametrize("bad", [{"radius_m": -5}, {"latitude_deg": 123}, {"layers": ["bogus"]},
                                 {"params": {"weights": {"slope": 1}}}, {"params": {"weights": {"slope": 0, "roughness": 0, "relief": 0, "hazard": 0}}},
                                 {"unknown": 1}])
def test_analyze_validation_errors(client, bad):
    r = analyze(client, **bad)
    assert r.status_code in (400, 422) and "error" in r.json()


def test_analyze_unknown_layer_and_dataset(client):
    assert analyze(client, dataset_id="sldem2015").status_code == 404
    assert analyze(client, region_id=77).status_code == 404


# ---- spacecraft CRUD --------------------------------------------------------------------------
def test_spacecraft_crud_and_validation(client):
    r = client.post("/api/spacecraft", json=SC)
    assert r.status_code == 201
    sc = r.json()
    assert sc["derived"]["total_mass_kg"] == 1200 and sc["derived"]["thrust_to_weight_lunar_surface"] > 2
    assert client.get(f"/api/spacecraft/{sc['id']}").json()["name"] == "Test lander"
    assert len(client.get("/api/spacecraft").json()) == 1
    assert client.get("/api/spacecraft/999").status_code == 404
    bad = {**SC, "dry_mass_kg": -1}
    r = client.post("/api/spacecraft", json=bad)
    assert r.status_code == 422 and r.json()["error"]["code"] == "request_validation_failed"
    assert client.post("/api/spacecraft", json={**SC, "engine": {"thrust_n": 100}}).status_code == 422


# ---- simulation lifecycle ---------------------------------------------------------------------
def make_sc(client):
    return client.post("/api/spacecraft", json=SC).json()["id"]


def create_sim(client, sid, **ickw):
    body = {"spacecraft_id": sid, "initial_conditions": ic(**ickw), "settings": {"output_dt_s": 1.0},
            "terrain": {"allow_synthetic": True, "radius_m": 800, "params": {"window_m": 60, "footprint_radius_m": 4}}}
    return client.post("/api/simulation/create", json=body)


def test_simulation_full_lifecycle_and_persistence(client):
    sid = make_sc(client)
    c = create_sim(client, sid, burn={"mode": "altitude", "ignition_altitude_m": 120, "cutoff_speed_m_s": 0.8})
    assert c.status_code == 201 and c.json()["status"] == "created"
    simid = c.json()["id"]
    # results before run -> clear error
    assert client.get(f"/api/simulation/{simid}/results").status_code == 422
    r = client.post(f"/api/simulation/{simid}/run")          # background; TestClient executes it before returning
    assert r.status_code == 202
    s = client.get(f"/api/simulation/{simid}").json()
    assert s["status"] == "completed", s
    res = client.get(f"/api/simulation/{simid}/results").json()
    ts = res["time_series"]
    assert res["summary"]["termination_reason"] == "touchdown" and res["summary"]["terrain_synthetic"] is True
    assert ts["time_s"][0] == 0 and ts["fuel_remaining_kg"][-1] < 300 and ts["mass_kg"][-1] < 1200
    assert res["trajectory"]["frame"] == "body_fixed" and res["trajectory"]["points_xyz"]
    la = res["landing_assessment"]
    assert la["overall"] in ("limits_exceeded", "within_all_assessed_limits", "insufficient_data_or_not_fully_assessed")
    assert {"surface_assessment", "trajectory_assessment", "vehicle_assessment", "uncertainty", "limitations", "explanation"} <= set(la)
    assert "does NOT guarantee" in la["explanation"] or la["overall"] != "within_all_assessed_limits"
    assert la["uncertainty"]["level"] == "not_applicable_synthetic_terrain"
    assert la["surface_assessment"]["explanation"]["components"]["slope"]["limit"] > 0
    assert res["terrain_analysis_id"]
    # intermediate state + field subset + stride
    mid = client.get(f"/api/simulation/{simid}/results", params={"t": ts["time_s"][-1] / 2}).json()["state"]
    assert 0 < mid["altitude_m"] and mid["altitude_m"] < ts["altitude_m"][0]
    sub = client.get(f"/api/simulation/{simid}/results", params={"fields": "time_s,mass_kg", "stride": 2}).json()["time_series"]
    assert set(sub) == {"time_s", "mass_kg"} and len(sub["time_s"]) == (len(ts["time_s"]) + 1) // 2
    assert client.get(f"/api/simulation/{simid}/results", params={"fields": "bogus"}).status_code == 422
    # rerun allowed, replaces result
    assert client.post(f"/api/simulation/{simid}/run", params={"wait": True}).json()["status"] == "completed"


def test_simulation_without_terrain_data_degrades_honestly(client):
    sid = make_sc(client)
    body = {"spacecraft_id": sid, "initial_conditions": ic(initial_altitude_m=200),
            "terrain": {"allow_synthetic": False}}                      # synthetic not allowed -> no real DEM
    simid = client.post("/api/simulation/create", json=body).json()["id"]
    j = client.post(f"/api/simulation/{simid}/run", params={"wait": True}).json()
    assert j["status"] == "completed"
    res = client.get(f"/api/simulation/{simid}/results").json()
    assert res["summary"]["terrain_used"] is False
    assert any("Terrain not available" in w for w in res["summary"]["warnings"])
    assert res["landing_assessment"]["surface_assessment"]["status"] == "no_terrain_data"
    assert res["landing_assessment"]["overall"] != "within_all_assessed_limits"
    assert res["landing_assessment"]["uncertainty"]["level"] == "high"


def test_hard_landing_flagged_and_horizontal_miss(client):
    sid = make_sc(client)
    simid = create_sim(client, sid, initial_altitude_m=1000, initial_speed_m_s=50, azimuth_deg=90, flight_path_angle_deg=-30).json()["id"]
    client.post(f"/api/simulation/{simid}/run", params={"wait": True})
    la = client.get(f"/api/simulation/{simid}/results").json()["landing_assessment"]
    assert la["overall"] == "limits_exceeded" and la["issues"]
    assert la["trajectory_assessment"]["status"] == "outside_limits"
    assert any("vertical touchdown speed" in i for i in la["issues"])


def test_simulation_validation_and_not_found(client):
    sid = make_sc(client)
    assert client.post("/api/simulation/create", json={"spacecraft_id": 999, "initial_conditions": ic()}).status_code == 404
    assert create_sim(client, sid, initial_altitude_m=-5).status_code == 422
    r = create_sim(client, sid, burn={"mode": "altitude"})            # missing ignition altitude
    assert r.status_code == 422
    assert client.get("/api/simulation/12345").status_code == 404
    assert client.post("/api/simulation/12345/run").status_code == 404
    fuelless = client.post("/api/spacecraft", json={**SC, "name": "dry", "fuel_mass_kg": 0}).json()["id"]
    r = create_sim(client, fuelless, burn={"mode": "time", "ignition_time_s": 1})
    assert r.status_code == 422 and "fuel" in r.json()["error"]["message"]


def test_failed_status_recorded_for_runtime_error(client, monkeypatch):
    sid = make_sc(client)
    simid = create_sim(client, sid).json()["id"]
    import app.simulation.manager as mgr
    monkeypatch.setattr(mgr, "simulate", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("boom")))
    client.post(f"/api/simulation/{simid}/run", params={"wait": True})
    s = client.get(f"/api/simulation/{simid}").json()
    assert s["status"] == "failed" and "boom" in s["error"] and not s["has_result"]
    assert client.get(f"/api/simulation/{simid}/results").status_code == 422


# ---- landing evaluate -------------------------------------------------------------------------
def test_landing_evaluate_site_only_and_validation(client):
    sid = make_sc(client)
    r = client.post("/api/landing/evaluate", json={"spacecraft_id": sid, "latitude_deg": 0.95, "longitude_deg": 23.05,
                                                   "radius_m": 800, "allow_synthetic": True})
    assert r.status_code == 200, r.text
    j = r.json()
    assert "surface_assessment" in j and "not a safety guarantee" in j["disclaimer"].lower() or "Not a safety guarantee" in j["disclaimer"]
    assert j["provenance"]["synthetic"] is True
    assert client.post("/api/landing/evaluate", json={}).status_code == 422
    assert client.post("/api/landing/evaluate", json={"simulation_id": 5}).status_code == 404


def test_landing_evaluate_by_simulation(client):
    sid = make_sc(client)
    simid = create_sim(client, sid).json()["id"]
    assert client.post("/api/landing/evaluate", json={"simulation_id": simid}).status_code == 422   # not run yet
    client.post(f"/api/simulation/{simid}/run", params={"wait": True})
    assert "assessment" in client.post("/api/landing/evaluate", json={"simulation_id": simid}).json()


# ---- regions / missions / users ------------------------------------------------------------
def test_regions_missions_reports(client):
    r = client.post("/api/lunar/regions", json={"name": "Test region", "latitude_deg": 0.95, "longitude_deg": 23.05,
                                                "radius_m": 1000, "dataset_id": "plane_test"})
    assert r.status_code == 201 and r.json()["dataset_key"] == "plane_test"
    assert client.post("/api/lunar/regions", json={"name": "Test region", "latitude_deg": 0, "longitude_deg": 0, "radius_m": 5}).status_code == 409
    assert client.post("/api/lunar/regions", json={"name": "x", "latitude_deg": 0, "longitude_deg": 0, "radius_m": 5, "dataset_id": "sldem2015"}).status_code == 404
    assert len(client.get("/api/lunar/regions").json()) == 1
    rid = r.json()["id"]
    sid = make_sc(client)
    simid = client.post("/api/simulation/create", json={"spacecraft_id": sid, "region_id": rid, "initial_conditions": ic(),
                                                       "terrain": {"allow_synthetic": True, "radius_m": 800}}).json()["id"]
    client.post(f"/api/simulation/{simid}/run", params={"wait": True})
    u = client.post("/api/users", json={"username": "researcher_1"}); assert u.status_code == 201
    assert client.post("/api/users", json={"username": "researcher_1"}).status_code == 409
    m = client.post("/api/missions", json={"name": "Study A", "description": "d", "region_id": rid, "spacecraft_id": sid,
                                           "simulation_id": simid, "user_id": u.json()["id"]})
    assert m.status_code == 201
    mid = m.json()["id"]
    assert client.post("/api/missions", json={"name": "Study A"}).status_code == 409
    assert client.post("/api/missions", json={"name": "B", "simulation_id": 424242}).status_code == 404
    got = client.get(f"/api/missions/{mid}").json()
    assert got["simulation"]["status"] == "completed" and got["landing_assessment"]
    rep = client.get(f"/api/missions/{mid}/report").json()
    assert {"mission", "spacecraft", "region", "simulation", "final_state", "landing_assessment", "terrain_analysis", "disclaimer"} <= set(rep)
    assert rep["terrain_analysis"]["synthetic"] is True
    assert len(client.get("/api/missions").json()) == 1


def test_suggest_ignition_endpoint(client):
    sid = make_sc(client)
    j = client.post("/api/trajectory/suggest-ignition", json={"spacecraft_id": sid, "initial_altitude_m": 10000, "initial_speed_m_s": 100}).json()
    assert j["feasible"] and j["ignition_altitude_m"] > 1000
    assert client.post("/api/trajectory/suggest-ignition", json={"initial_altitude_m": 1, "initial_speed_m_s": 1}).status_code == 422


# ---- database level ---------------------------------------------------------------------------
def test_foreign_keys_enforced_and_cascade(client):
    ctx = client.app_state.ctx
    with ctx.SessionLocal() as db:
        db.add(M.Simulation(spacecraft_id=424242, initial_conditions={}, settings={}))
        with pytest.raises(IntegrityError):
            db.commit()
        db.rollback()
        db.add(M.User(username="dup")); db.commit()
        db.add(M.User(username="dup"))
        with pytest.raises(IntegrityError):
            db.commit()


def test_datasource_provenance_persisted(client):
    ctx = client.app_state.ctx
    with ctx.SessionLocal() as db:
        ds = db.query(M.DataSource).one()
        assert ds.provider == "pytest" and ds.synthetic and ds.status == "synthetic_demo" and ds.resolution == 20.0
        assert ds.meta["citation"]


def test_error_format_unknown_route(client):
    r = client.get("/api/nope")
    assert r.status_code == 404 and r.json()["error"]["code"] == "http_error"


# ---- imported PDS products: quantity gating, globe, resolution warnings ---------------------------
def test_sources_flag_non_elevation_products(client_pds):
    s = {d["id"]: d for d in client_pds.get("/api/data/sources").json()["installed"]}
    assert s["ldrm_16"]["quantity"] == "roughness" and s["ldrm_16"]["usable_as_dem"] is False
    assert s["ldem_2"]["quantity"] == "elevation" and s["ldem_2"]["usable_as_dem"] and s["ldem_2"]["synthetic"]
    assert s["ldrm_16"]["provider"].startswith("NASA LRO / LOLA") and "Smith" in s["ldrm_16"]["citation"]
    assert s["ldem_2"]["coverage"]["includes_pole"] is True


def test_roughness_product_refused_as_dem(client_pds):
    r = client_pds.get("/api/lunar/terrain", params={"latitude_deg": 10, "longitude_deg": 20, "radius_m": 200000, "dataset_id": "ldrm_16"})
    assert r.status_code == 422 and "not elevation" in r.json()["error"]["message"]
    r = client_pds.post("/api/terrain/analyze", json={"latitude_deg": 10, "longitude_deg": 20, "radius_m": 200000, "dataset_id": "ldrm_16"})
    assert r.status_code == 422


def test_globe_endpoint(client_pds):
    r = client_pds.get("/api/lunar/globe")
    assert r.status_code == 404 and r.json()["error"]["code"] == "data_unavailable"       # only a synthetic global DEM -> not used silently
    r = client_pds.get("/api/lunar/globe", params={"allow_synthetic": True, "rows": 36, "cols": 72})
    assert r.status_code == 200, r.text
    j = r.json()
    assert (j["rows"], j["cols"]) == (36, 72) and j["lat_north_deg"] == 90 and j["lon_west_deg"] == 0 and j["lon_east_deg"] == 360
    assert j["provenance"]["synthetic"] and "NOT REAL" in j["provenance"]["data_notice"]
    assert j["elevation_m"]["rows"] == 36 and j["statistics"]["min_m"] < j["statistics"]["max_m"]
    assert client_pds.get("/api/lunar/globe", params={"dataset_id": "plane_test", "allow_synthetic": True}).status_code == 404   # not global
    assert client_pds.get("/api/lunar/globe", params={"dataset_id": "ldrm_16"}).status_code == 422


def test_coarse_dem_triggers_resolution_warning(client_pds):
    r = client_pds.post("/api/terrain/analyze", json={"latitude_deg": 40.25, "longitude_deg": 50.25, "radius_m": 150000, "dataset_id": "ldem_2",
                                                       "allow_synthetic": True, "params": {"window_m": 100, "footprint_radius_m": 15}, "save": False})
    assert r.status_code == 200, r.text
    w = r.json()["summary"]["warnings"]
    assert any("larger than the landing footprint" in x for x in w) and any("regional-scale" in x for x in w)
    # fine DEM: no resolution warnings
    ok = client_pds.post("/api/terrain/analyze", json={"latitude_deg": 0.95, "longitude_deg": 23.05, "radius_m": 1000, "dataset_id": "plane_test",
                                                        "allow_synthetic": True, "save": False, "params": {"footprint_radius_m": 30}}).json()
    assert ok["summary"]["warnings"] == []                      # 20 m cells vs 30 m footprint radius: adequate
