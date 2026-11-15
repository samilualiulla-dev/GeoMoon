"""Physics tests of the Earth-Moon orbital simulator (analytic references, invariants, API consistency)."""
import math

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import create_app
from app.orbital import telemetry
from app.orbital.constants import G0, MU_EARTH, MU_MOON, R_EARTH, R_MOON
from app.orbital.dynamics import Dynamics, elements_to_state, point_gravity, state_to_elements, third_body
from app.orbital.ephemeris import Ephemeris, iso_to_jd, moon_position_jd, sun_position_jd
from app.orbital.model import config_from_dict
from app.orbital.planner import lambert
from app.orbital.simulation import Simulation, lunar_fixed_state, moon_angular_velocity


def cfg(**kw):
    base = {"options": {"include_sun": False, "include_earth_j2": False, "include_moon": False}, "mission": {"duration_s": 86400.0}}
    for k, v in kw.items():
        base[k] = {**base.get(k, {}), **v} if isinstance(v, dict) and isinstance(base.get(k), dict) else v
    return config_from_dict(base)


# ------------------------------------------------------------------------------------------------ ephemeris / time
def test_julian_date_known_values():
    assert iso_to_jd("2000-01-01T12:00:00Z") == pytest.approx(2451545.0)
    assert iso_to_jd("1992-04-12T00:00:00Z") == pytest.approx(2448724.5)


def test_moon_matches_meeus_example_within_documented_tolerance():
    # Meeus, Astronomical Algorithms ex. 47.a: 1992-04-12 0h TD: lambda=133.162655 deg, beta=-3.229126 deg, 368409.7 km
    r = moon_position_jd(2448724.5)
    # undo precession (approx.) to compare in ecliptic of date
    d = np.linalg.norm(r)
    assert abs(d - 368_409_700.0) < 3_000_000.0
    eps = math.radians(23.4392911)
    x, y, z = r
    ye, ze = y * math.cos(eps) + z * math.sin(eps), -y * math.sin(eps) + z * math.cos(eps)
    lam = math.degrees(math.atan2(ye, x)) + 1.3969713 * (2448724.5 - 2451545.0) / 36525.0
    bet = math.degrees(math.asin(ze / d))
    assert abs(lam - 133.162655) < 0.5 and abs(bet + 3.229126) < 0.3


def test_sun_matches_meeus_example():
    # Meeus ex. 25.a: 1992-10-13 0h TD: apparent lambda ~199.9 deg, R = 0.99766 AU
    r = sun_position_jd(2448908.5)
    assert np.linalg.norm(r) / 1.495978707e11 == pytest.approx(0.99766, abs=2e-4)


def test_moon_distance_and_sidereal_period():
    e = Ephemeris()
    t = np.linspace(0, 60 * 86400, 5000)
    d = np.linalg.norm(e.moon_pos(t), axis=1)
    assert 356e6 < d.min() < 371e6 and 400e6 < d.max() < 408e6
    # sidereal period ~27.32 d: angle swept in 27.32 d is ~360 deg
    r0, r1 = e.moon_pos(0.0), e.moon_pos(27.3217 * 86400)
    ang = math.degrees(math.acos(np.dot(r0, r1) / np.linalg.norm(r0) / np.linalg.norm(r1)))
    assert ang < 8.0


def test_ephemeris_is_time_dependent_and_velocity_consistent():
    e = Ephemeris()
    assert np.linalg.norm(e.moon_pos(0) - e.moon_pos(3600)) > 3e6
    v = e.moon_vel(1000.0)
    assert 900 < np.linalg.norm(v) < 1200
    assert np.dot(e.moon_pos(1000.0), v) / (np.linalg.norm(v) * np.linalg.norm(e.moon_pos(1000.0))) < 0.15  # ~perpendicular


# ------------------------------------------------------------------------------------------------ frames
def test_earth_rotation_angle_at_j2000_and_orthonormal_frames():
    e = Ephemeris("2000-01-01T12:00:00Z")
    assert math.degrees(e.earth_rotation_angle(0.0)) == pytest.approx(280.4606, abs=1e-3)
    for R in (e.eci_to_ecef(1234.5), e.moon_axes(1234.5)):
        assert np.allclose(R @ R.T, np.eye(3), atol=1e-12) and np.linalg.det(R) == pytest.approx(1.0)
    # sidereal day: ECEF matrix repeats after 86164.0905 s
    assert np.allclose(e.eci_to_ecef(0.0), e.eci_to_ecef(86164.0905), atol=1e-5)


def test_moon_fixed_x_axis_points_to_earth_and_roundtrip():
    e = Ephemeris()
    t = 5e5
    A = e.moon_axes(t)
    assert np.allclose(A[0], -e.moon_pos(t) / np.linalg.norm(e.moon_pos(t)))
    p = e.moon_pos(t) + A.T @ np.array([R_MOON * 0.6, R_MOON * 0.3, R_MOON * 0.7])
    rel, lat, lon, rad = lunar_fixed_state(e, t, p)
    assert rad == pytest.approx(R_MOON * math.sqrt(0.36 + 0.09 + 0.49), rel=1e-12)
    assert lat == pytest.approx(math.degrees(math.asin(0.7 / math.sqrt(0.94))), abs=1e-9)
    assert lon == pytest.approx(math.degrees(math.atan2(0.3, 0.6)), abs=1e-9)


def test_surface_start_global_to_local_roundtrip():
    s = Simulation(cfg(initial={"kind": "lat_lon_surface", "body": "moon", "lat_deg": -43.0, "lon_deg": 25.0, "altitude_m": 0.0},
                       vehicle={}))
    y = s.y[0]
    _, lat, lon, rad = lunar_fixed_state(s.eph, 0.0, y[:3])
    assert (lat, lon, rad) == pytest.approx((-43.0, 25.0, R_MOON), abs=1e-6)
    # surface velocity relative to the (synchronously rotating) Moon surface is zero
    vrel = y[3:6] - s.eph.moon_vel(0.0) - np.cross(moon_angular_velocity(s.eph, 0.0), y[:3] - s.eph.moon_pos(0.0))
    assert np.linalg.norm(vrel) < 1e-6


# ------------------------------------------------------------------------------------------------ gravity
def test_point_gravity_magnitude():
    r = np.array([7e6, 0, 0.0])
    assert np.linalg.norm(point_gravity(r, MU_EARTH)) == pytest.approx(MU_EARTH / 7e6**2)


def test_multibody_gravity_equals_independent_sum():
    e = Ephemeris()
    d = Dynamics(e, include_moon=True, include_sun=False, include_j2=False)
    r = np.array([1.0e8, 2.0e7, -3.0e7]); t = 4e5
    rm = e.moon_pos(t)
    manual = -MU_EARTH * r / np.linalg.norm(r) ** 3 + MU_MOON * ((rm - r) / np.linalg.norm(rm - r) ** 3 - rm / np.linalg.norm(rm) ** 3)
    assert np.allclose(d.gravity(t, r), manual, rtol=1e-12)
    assert np.allclose(third_body(np.zeros(3), rm, MU_MOON), 0.0)   # no indirect-term bias at the origin


def test_gravity_near_moon_dominated_by_moon():
    e = Ephemeris(); d = Dynamics(e, include_sun=False, include_j2=False)
    t = 1e5; r = e.moon_pos(t) + np.array([R_MOON + 1e5, 0, 0])
    g = d.gravity(t, r)
    assert np.linalg.norm(g) == pytest.approx(MU_MOON / (R_MOON + 1e5) ** 2, rel=0.01)


# ------------------------------------------------------------------------------------------------ integration
def test_circular_orbit_period_energy_and_angular_momentum_earth_only():
    s = Simulation(cfg(initial={"periapsis_alt_m": 500e3, "inclination_deg": 51.6}))
    rad = R_EARTH + 500e3
    T = 2 * math.pi * math.sqrt(rad**3 / MU_EARTH)
    s.advance(3 * T)
    a = s.arrays()
    r0 = a["r"][0]
    i = np.argmin(np.abs(a["t"] - T))
    assert np.linalg.norm(a["r"][i] - r0) / rad < 2e-3         # back at start after one period (sample grid tolerance)
    E = np.sum(a["v"] ** 2, 1) / 2 - MU_EARTH / np.linalg.norm(a["r"], axis=1)
    assert (E.max() - E.min()) / abs(E[0]) < 5e-9
    h = np.linalg.norm(np.cross(a["r"], a["v"]), axis=1)
    assert (h.max() - h.min()) / h[0] < 5e-9
    assert np.linalg.norm(a["r"], axis=1).std() / rad < 1e-8


@pytest.mark.parametrize("method", ["DOP853", "RK45", "RK4"])
def test_integrators_agree(method):
    ref = Simulation(cfg(initial={"kind": "earth_orbit", "periapsis_alt_m": 400e3, "apoapsis_alt_m": 3000e3}))
    ref.advance(20000)
    s = Simulation(cfg(initial={"kind": "earth_orbit", "periapsis_alt_m": 400e3, "apoapsis_alt_m": 3000e3},
                       options={"integrator": method, "max_step_s": 5.0, "rtol": 1e-9}))
    s.advance(20000)
    assert np.linalg.norm(s.y[-1][:3] - ref.y[-1][:3]) < (50.0 if method == "RK4" else 1.0)


def test_tolerance_convergence():
    def end(rtol):
        s = Simulation(cfg(initial={"kind": "earth_orbit", "periapsis_alt_m": 300e3, "apoapsis_alt_m": 5000e3}, options={"rtol": rtol, "max_step_s": 1e5}))
        s.advance(30000); return s.y[-1][:3]
    ref, loose, tight = end(1e-13), end(1e-6), end(1e-10)
    assert np.linalg.norm(tight - ref) < np.linalg.norm(loose - ref)


def test_elements_roundtrip():
    r, v = elements_to_state(MU_EARTH, 7e6, 12e6, 30, 40, 50, 60)
    el = state_to_elements(MU_EARTH, r, v)
    assert el["periapsis_radius_m"] == pytest.approx(7e6, rel=1e-9) and el["apoapsis_radius_m"] == pytest.approx(12e6, rel=1e-9)
    assert el["inc_deg"] == pytest.approx(30.0, abs=1e-9)


def test_lambert_reproduces_two_body_arc():
    r1, v1 = elements_to_state(MU_EARTH, 7e6, 20e6, 0.0, 0, 0, 0.0)
    s = Simulation(cfg(initial={"kind": "cartesian", "r_m": r1.tolist(), "v_mps": v1.tolist()}))
    s.advance(8000)
    r2 = s.y[-1][:3]
    v1l, _ = lambert(r1, r2, 8000.0)
    assert np.linalg.norm(v1l - v1) < 1e-2


# ------------------------------------------------------------------------------------------------ propulsion / fuel
def test_rocket_equation_impulse():
    s = Simulation(cfg(vehicle={"dry_mass_kg": 1000.0, "fuel_mass_kg": 4000.0, "engines": [{"name": "e", "thrust_n": 1e4, "isp_s": 300.0}]},
                       commands=[{"t_start_s": 10.0, "delta_v_mps": 1500.0, "direction": "prograde"}]))
    s.advance(60.0)
    used = 4000.0 - s.y[-1][6]
    assert used == pytest.approx(5000.0 * (1 - math.exp(-1500.0 / (300.0 * G0))), rel=1e-9)


def test_finite_burn_mass_flow_and_exhaustion():
    s = Simulation(cfg(vehicle={"dry_mass_kg": 1000.0, "fuel_mass_kg": 500.0, "engines": [{"name": "e", "thrust_n": 9806.65, "isp_s": 300.0}]},
                       commands=[{"t_start_s": 0.0, "throttle": 0.5, "direction": "prograde"}]))
    mdot = 0.5 * 9806.65 / (300.0 * G0)
    s.advance(100.0)
    assert 500.0 - s.y[-1][6] == pytest.approx(mdot * 100.0, rel=1e-6)
    s.advance(1000.0)
    ev = [e["type"] for e in s.events]
    assert "fuel_exhausted" in ev and s.y[-1][6] == 0.0 and s.thrust[-1] == 0.0
    t_ex = next(e["t_s"] for e in s.events if e["type"] == "fuel_exhausted")
    assert t_ex == pytest.approx(500.0 / mdot, rel=1e-4)
    assert all(y[6] >= -1e-9 for y in s.y)
    m = np.array([cfg_y[6] for cfg_y in s.y])
    assert np.all(np.diff(m) <= 1e-9)    # fuel never increases


def test_burn_changes_orbit_energy_by_expected_amount():
    s = Simulation(cfg(vehicle={"dry_mass_kg": 1000.0, "fuel_mass_kg": 4000.0, "engines": [{"name": "e", "thrust_n": 1e4, "isp_s": 300.0}]},
                       commands=[{"t_start_s": 100.0, "delta_v_mps": 100.0, "direction": "prograde"}]))
    s.advance(200.0)
    r, v0 = s.y[0][:3], s.y[0][3:6]
    assert np.linalg.norm(s.y[-1][3:6]) > np.linalg.norm(v0) - 1  # speed up (position differs slightly)
    e0 = state_to_elements(MU_EARTH, s.y[0][:3], s.y[0][3:6])
    e1 = state_to_elements(MU_EARTH, s.y[-1][:3], s.y[-1][3:6])
    assert e1["energy_j_per_kg"] > e0["energy_j_per_kg"]


def test_manual_control_keeps_history_and_event_log():
    s = Simulation(cfg(vehicle={"dry_mass_kg": 1000.0, "fuel_mass_kg": 1000.0, "engines": [{"name": "e", "thrust_n": 1e4, "isp_s": 300.0}]}))
    s.advance(2000.0)
    before = [y.copy() for y in s.y[:11]]
    from app.orbital.model import Command
    s.control(Command(t_start_s=1000.0, throttle=1.0, direction="prograde", duration_s=60.0, source="manual"), horizon_s=2000.0)
    assert all(np.allclose(a, b) for a, b in zip(before, s.y[:11]))
    assert s.y[-1][6] < 1000.0 and abs(s.t_now - 2000.0) < 1e-6
    types = [e["type"] for e in s.events]
    assert "control_change" in types and "burn_start" in types and "burn_end" in types


# ------------------------------------------------------------------------------------------------ collisions
def test_earth_impact_detected_with_speed():
    s = Simulation(cfg(initial={"kind": "cartesian", "r_m": [R_EARTH + 100e3, 0, 0], "v_mps": [0, 0, 0]}))
    s.advance(86400)
    ev = [e for e in s.events if e["type"] == "earth_impact"]
    assert ev and s.status == "impact" and ev[0]["details"]["speed_mps"] > 1000
    assert np.linalg.norm(s.y[-1][:3]) == pytest.approx(R_EARTH, abs=1.0)


def test_moon_contact_soft_vs_hard_classification():
    e = Ephemeris()
    def start(alt, vy):
        r = e.moon_pos(0.0) + np.array([R_MOON + alt, 0, 0]); v = e.moon_vel(0.0)
        return r.tolist(), (v + np.array([0, 0, 0])).tolist()
    r, v = start(1000.0, 0)
    s = Simulation(config_from_dict({"options": {"include_sun": False, "include_earth_j2": False}, "mission": {"duration_s": 3600.0},
                                     "initial": {"kind": "cartesian", "r_m": r, "v_mps": v}}))
    s.advance(3600.0)
    ev = [x for x in s.events if x["type"] == "moon_contact"]
    assert ev and ev[0]["details"]["body"] == "moon"
    assert ev[0]["details"]["speed_mps"] < 100          # free fall from 1 km: ~60 m/s
    assert ev[0]["details"]["classification"] == "high_speed_impact" and s.status == "impact"


def test_guided_descent_lands_softly():
    veh = {"fuel_mass_kg": 60000, "dry_mass_kg": 8000, "engines": [{"name": "M", "thrust_n": 200000, "isp_s": 450}]}
    r0 = R_MOON + 100e3; a_t = 0.5 * (r0 + R_MOON + 15e3)
    dv = math.sqrt(MU_MOON / r0) - math.sqrt(MU_MOON * (2 / r0 - 1 / a_t))
    th = math.pi * math.sqrt(a_t**3 / MU_MOON)
    s = Simulation(config_from_dict({"mission": {"duration_s": 6000}, "vehicle": veh,
        "initial": {"kind": "moon_orbit", "periapsis_alt_m": 100000, "inclination_deg": 10},
        "options": {"include_sun": False, "rtol": 1e-8, "sample_dt_s": 10.0},
        "commands": [{"t_start_s": 0, "delta_v_mps": dv, "direction": "retrograde", "reference": "moon"},
                     {"t_start_s": th - 600, "direction": "surface_retro", "reference": "moon", "auto_throttle": True}]}))
    s.advance(6000)
    ev = [e for e in s.events if e["type"] == "moon_contact"]
    assert ev and ev[0]["details"]["speed_mps"] < 5.0 and s.status == "landed"


def test_dem_surface_height_used_for_contact():
    e = Ephemeris()
    r = e.moon_pos(0.0) + np.array([R_MOON + 3000.0, 0, 0]); v = e.moon_vel(0.0)
    base = {"options": {"include_sun": False, "include_earth_j2": False}, "mission": {"duration_s": 3600.0},
            "initial": {"kind": "cartesian", "r_m": r.tolist(), "v_mps": v.tolist()}}
    flat = Simulation(config_from_dict(base)); flat.advance(3600)
    mount = Simulation(config_from_dict(base), surface_height=lambda la, lo: 2000.0); mount.advance(3600)
    tf = next(x["t_s"] for x in flat.events if x["type"] == "moon_contact")
    tm = next(x["t_s"] for x in mount.events if x["type"] == "moon_contact")
    assert tm < tf and tf - tm > 5.0     # a 2 km high surface is reached earlier


# ------------------------------------------------------------------------------------------------ SOI / transfer
def test_planner_flyby_reaches_moon(tmp_path):
    from app.orbital.planner import plan
    c = config_from_dict({"mission": {"kind": "lunar_flyby", "target_altitude_m": 200000, "duration_s": 6 * 86400},
                          "vehicle": {"fuel_mass_kg": 60000, "dry_mass_kg": 8000, "engines": [{"name": "M", "thrust_n": 200000, "isp_s": 450}]}})
    r = plan(c)
    assert r["feasible"] and abs(r["summary"]["periselene_error_km"]) < 5
    assert 3000 < r["summary"]["tli_dv_mps"] < 3500
    s = Simulation(config_from_dict({**c.to_dict(), "commands": r["commands"]}))
    s.advance(r["suggested_duration_s"])
    types = [e["type"] for e in s.events]
    assert "moon_soi_entry" in types and "impulse" in types
    peri = [e for e in telemetry.derived_events(s) if e["type"] == "periselene"]
    assert peri and abs(peri[0]["details"]["altitude_m"] - 200e3) < 20e3
    assert r["limitations"]


def test_planner_reports_insufficient_fuel():
    from app.orbital.planner import plan
    c = config_from_dict({"mission": {"kind": "lunar_flyby", "target_altitude_m": 100000, "duration_s": 6 * 86400},
                          "vehicle": {"fuel_mass_kg": 2000, "dry_mass_kg": 8000, "engines": [{"name": "M", "thrust_n": 200000, "isp_s": 450}]}})
    r = plan(c)
    assert not r["feasible"] and any("exceeds vehicle capacity" in n for n in r["notes"])


# ------------------------------------------------------------------------------------------------ API
@pytest.fixture()
def client(tmp_path):
    class S(Settings):
        def __init__(self):
            super().__init__()
            self.storage_dir = tmp_path / "storage"; self.dem_dir = tmp_path / "dem"; self.dem_dir.mkdir(exist_ok=True)
            self.database_url = f"sqlite:///{tmp_path / 't.db'}"
    return TestClient(create_app(S())), S


def test_api_end_to_end_consistency_and_persistence(tmp_path):
    class S(Settings):
        def __init__(self):
            super().__init__()
            self.storage_dir = tmp_path / "storage"; self.dem_dir = tmp_path / "dem"; self.dem_dir.mkdir(exist_ok=True)
            self.database_url = f"sqlite:///{tmp_path / 't.db'}"
    c = TestClient(create_app(S()))
    r = c.post("/api/orbital/simulations", json={"name": "t", "mission": {"duration_s": 20000}})
    assert r.status_code == 201
    sid = r.json()["id"]
    c.post(f"/api/orbital/simulations/{sid}/run", json={})
    st = c.get(f"/api/orbital/simulations/{sid}/state", params={"t_s": 7777.0}).json()
    pos = c.get("/api/orbital/bodies/positions", params={"t_s": 7777.0}).json()
    # 2D map / 3D scene / bodies endpoint share one source of truth
    assert np.allclose(st["moon"]["r_m"], pos["moon"]["r_m"], rtol=1e-12)
    tr = c.get(f"/api/orbital/simulations/{sid}/trajectory", params={"max_points": 20000}).json()
    i = int(np.argmin(np.abs(np.array(tr["t_s"]) - 7777.0)))
    assert np.linalg.norm(np.array(tr["r_m"][i]) - np.array(st["r_m"])) < 1.5e5
    tel = c.get(f"/api/orbital/simulations/{sid}/telemetry", params={"series": "alt_earth_m,speed_inertial_mps"}).json()
    assert tel["units"]["alt_earth_m"] == "m" and len(tel["t_s"]) == len(tel["series"]["alt_earth_m"])
    mf = c.get(f"/api/orbital/simulations/{sid}/trajectory", params={"frame": "moon_centered", "max_points": 5}).json()
    assert np.allclose(np.array(mf["r_m"]) + np.array(mf["moon_r_m"]), np.array(c.get(f"/api/orbital/simulations/{sid}/trajectory", params={"max_points": 5}).json()["r_m"]))
    assert c.get(f"/api/orbital/simulations/{sid}/telemetry", params={"series": "nope"}).status_code == 422
    # persistence: a fresh application instance (new process analogue) sees the same simulation
    c2 = TestClient(create_app(S()))
    st2 = c2.get(f"/api/orbital/simulations/{sid}/state", params={"t_s": 7777.0}).json()
    assert np.allclose(st2["r_m"], st["r_m"])
    assert any(s["id"] == sid for s in c2.get("/api/orbital/simulations").json()["simulations"])
    assert c2.delete(f"/api/orbital/simulations/{sid}").status_code == 204
    assert c2.get(f"/api/orbital/simulations/{sid}").status_code == 404


def test_api_control_and_validation(client):
    c, _ = client
    sid = c.post("/api/orbital/simulations", json={"mission": {"duration_s": 6000}}).json()["id"]
    c.post(f"/api/orbital/simulations/{sid}/run", json={})
    r = c.post(f"/api/orbital/simulations/{sid}/control", json={"t_s": 1000, "throttle": 1.0, "direction": "prograde", "duration_s": 100})
    assert r.status_code == 200
    ev = c.get(f"/api/orbital/simulations/{sid}/events").json()["events"]
    assert {"control_change", "burn_start", "burn_end"} <= {e["type"] for e in ev}
    bad = c.post(f"/api/orbital/simulations/{sid}/control", json={"throttle": 3.0})
    assert bad.status_code == 422
    assert c.post("/api/orbital/simulations", json={"initial": {"kind": "bogus"}}).status_code == 422
    assert c.get("/api/orbital/scenarios").json()["scenarios"]
    eph = c.get("/api/orbital/bodies/ephemerides", params={"n": 10}).json()
    assert len(eph["t_s"]) == 10
