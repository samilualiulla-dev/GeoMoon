import numpy as np
import pytest

from app.core.constants import G0, MOON_MU, MOON_RADIUS_M, MOON_ROTATION_RATE
from app.spacecraft.schemas import (BurnPlan, Dimensions, Engine, InitialConditions, LandingGear, SimSettings, SpacecraftConfig)
from app.trajectory.dynamics import simulate
from app.trajectory.gravity import gravity_acceleration, gravity_magnitude
from app.trajectory.integrator import integrate_phase, rk4_step
from app.trajectory.propulsion import mass_flow_kg_s, thrust_and_flow
from app.trajectory.planning import suggest_vertical_ignition_altitude


def cfg(fuel=300.0, thrust=5000.0, isp=300.0, **kw):
    return SpacecraftConfig(name="t", dry_mass_kg=900, fuel_mass_kg=fuel, dimensions=Dimensions(length_m=3, width_m=3, height_m=4),
                            landing_gear=LandingGear(span_m=5), engine=Engine(thrust_n=thrust, isp_s=isp, **kw))


def ic(alt=10000.0, v=0.0, **kw):
    return InitialConditions(target_latitude_deg=0, target_longitude_deg=0, initial_altitude_m=alt, initial_speed_m_s=v, **kw)


# ---- gravity --------------------------------------------------------------------------------
def test_gravity_values():
    assert gravity_magnitude(MOON_RADIUS_M) == pytest.approx(1.625, abs=0.005)
    assert gravity_magnitude(2 * MOON_RADIUS_M) == pytest.approx(gravity_magnitude(MOON_RADIUS_M) / 4)   # inverse square
    a = gravity_acceleration(np.array([MOON_RADIUS_M, 0, 0]))
    assert a[0] == pytest.approx(-MOON_MU / MOON_RADIUS_M ** 2) and a[1] == a[2] == 0
    with pytest.raises(ValueError):
        gravity_magnitude(0)


# ---- integrators ----------------------------------------------------------------------------
def test_rk4_exponential_convergence_order():
    f = lambda t, y: -y
    errs = []
    for h in (0.2, 0.1, 0.05):
        y, t = np.array([1.0]), 0.0
        while t < 1 - 1e-12:
            y = rk4_step(f, t, y, h); t += h
        errs.append(abs(y[0] - np.exp(-1)))
    assert errs[0] / errs[1] == pytest.approx(16, rel=0.15) and errs[1] / errs[2] == pytest.approx(16, rel=0.15)


def test_circular_orbit_conserves_radius_and_energy():
    r0 = MOON_RADIUS_M + 100_000.0
    v = np.sqrt(MOON_MU / r0); T = 2 * np.pi * r0 / v
    from app.trajectory.gravity import gravity_acceleration as g
    f = lambda t, y: np.concatenate([y[3:6], g(y[:3])])
    y0 = np.array([r0, 0, 0, 0, v, 0.0])
    for method in ("dop853", "rk4"):
        res = integrate_phase(f, 0.0, y0, T, [], method=method, dt_out=60.0, rk4_step_s=2.0)
        r = np.linalg.norm(res.y[:, :3], axis=1)
        assert np.max(np.abs(r - r0)) / r0 < 1e-6
        assert np.linalg.norm(res.y[-1, :3] - y0[:3]) / r0 < 1e-4


def test_event_localisation_both_methods():
    f = lambda t, y: np.array([y[1], -1.62])
    ev = lambda t, y: y[0]
    for m in ("dop853", "rk4"):
        res = integrate_phase(f, 0.0, np.array([100.0, 0.0]), 100.0, [ev], method=m, dt_out=1.0, rk4_step_s=0.1)
        assert res.event_index == 0
        assert res.t_end == pytest.approx(np.sqrt(2 * 100 / 1.62), rel=2e-3)


# ---- free fall vs analytic energy solution --------------------------------------------------
def test_free_fall_matches_energy_conservation():
    out = simulate(cfg(), ic(10000.0), SimSettings(moon_rotation=False))
    td = out.summary["touchdown"]
    v_exact = np.sqrt(2 * MOON_MU * (1 / MOON_RADIUS_M - 1 / (MOON_RADIUS_M + 10000.0)))
    assert abs(td["vertical_speed_m_s"]) == pytest.approx(v_exact, rel=1e-6)
    assert td["miss_distance_m"] < 1e-6
    assert out.summary["fuel_used_kg"] == 0 and out.final_state["mass_kg"] == 1200
    # rough sanity vs constant-g estimate
    assert out.summary["duration_s"] == pytest.approx(np.sqrt(2 * 10000 / 1.625), rel=0.02)


def test_dop853_and_rk4_agree():
    a = simulate(cfg(), ic(10000, 100, burn=BurnPlan(mode="altitude", ignition_altitude_m=4000)), SimSettings())
    b = simulate(cfg(), ic(10000, 100, burn=BurnPlan(mode="altitude", ignition_altitude_m=4000)),
                 SimSettings(integrator="rk4", rk4_step_s=0.02))
    assert a.summary["duration_s"] == pytest.approx(b.summary["duration_s"], rel=1e-4)
    assert a.summary["fuel_used_kg"] == pytest.approx(b.summary["fuel_used_kg"], rel=1e-4)


# ---- propulsion / fuel ---------------------------------------------------------------------
def test_mass_flow_formula():
    assert mass_flow_kg_s(5000, 300) == pytest.approx(5000 / (300 * G0))
    with pytest.raises(ValueError):
        mass_flow_kg_s(1, 0)


def test_thrust_and_flow_rules():
    e = Engine(thrust_n=1000, number_of_engines=2, isp_s=300, throttle_min=0.4, throttle_max=0.9)
    assert thrust_and_flow(e, 0.0, 10) == (0.0, 0.0)
    assert thrust_and_flow(e, 1.0, 0.0) == (0.0, 0.0)          # no fuel
    assert thrust_and_flow(e, 1.0, 10)[0] == pytest.approx(1800)   # clamped to throttle_max
    assert thrust_and_flow(e, 0.1, 10)[0] == pytest.approx(800)    # clamped up to throttle_min


def test_fuel_consumption_matches_tsiolkovsky():
    """Full-throttle burn in free space-like short interval: dm = F t / (Isp g0); dv ~ Isp g0 ln(m0/m1) (+gravity)."""
    c = cfg(fuel=100.0)
    out = simulate(c, ic(100000, 0, flight_path_angle_deg=-90, burn=BurnPlan(mode="time", ignition_time_s=0, direction="radial_up")),
                   SimSettings(moon_rotation=False, max_time_s=40, output_dt_s=1))
    ts = out.time_series
    mdot = 5000 / (300 * G0)
    t_end = ts["time_s"][-1]
    assert t_end == pytest.approx(40)
    assert ts["fuel_remaining_kg"][-1] == pytest.approx(100 - mdot * 40, rel=1e-6)
    # delta-v along radial: thrust accel integral minus gravity
    m0 = 1000; m1 = ts["mass_kg"][-1]
    dv_thrust = 300 * G0 * np.log(m0 / m1)
    v_up = ts["vertical_speed_m_s"][-1]
    assert v_up == pytest.approx(dv_thrust - gravity_magnitude(MOON_RADIUS_M + 100000) * 40, rel=0.005)


def test_fuel_exhaustion_stops_thrust_and_mass_floor():
    out = simulate(cfg(fuel=20.0), ic(50000, 50, burn=BurnPlan(mode="time", ignition_time_s=0.0)), SimSettings(moon_rotation=False))
    events = [e["event"] for e in out.summary["events"]]
    assert "fuel_exhausted" in events
    ts = out.time_series
    assert min(ts["mass_kg"]) >= 900 - 1e-6 and ts["fuel_remaining_kg"][-1] == pytest.approx(0, abs=1e-6)
    i = next(i for i, t in enumerate(ts["time_s"]) if t > [e["t_s"] for e in out.summary["events"] if e["event"] == "fuel_exhausted"][0] + 1)
    assert ts["thrust_n"][i] == 0.0


def test_throttle_schedule_and_cutoff_and_multi_engine():
    c = cfg()
    plan = BurnPlan(mode="schedule", throttle_schedule=[(5.0, 1.0), (15.0, 0.0), (25.0, 0.5)], direction="radial_up")
    out = simulate(c, ic(100000, 0), SimSettings(moon_rotation=False, max_time_s=40, output_dt_s=1) if False else SimSettings(moon_rotation=False, max_time_s=40))
    # (reuse plan below)
    out = simulate(c, InitialConditions(target_latitude_deg=0, target_longitude_deg=0, initial_altitude_m=100000, initial_speed_m_s=0, burn=plan),
                   SimSettings(moon_rotation=False, max_time_s=40))
    ts = out.time_series
    T = np.array(ts["time_s"]); thr = np.array(ts["thrust_n"])
    assert thr[T < 4.9].max() == 0 and thr[(T > 5.5) & (T < 14.5)].min() == pytest.approx(5000)
    assert thr[(T > 15.5) & (T < 24.5)].max() == 0 and thr[T > 26].max() == pytest.approx(2500)
    expected_fuel = (10 * 1.0 + 15 * 0.5) * 5000 / (300 * G0)
    assert 300 - ts["fuel_remaining_kg"][-1] == pytest.approx(expected_fuel, rel=1e-5)
    # two engines of half thrust behave identically
    c2 = SpacecraftConfig(**{**c.model_dump(), "engine": Engine(thrust_n=2500, number_of_engines=2, isp_s=300).model_dump()})
    out2 = simulate(c2, InitialConditions(target_latitude_deg=0, target_longitude_deg=0, initial_altitude_m=100000, initial_speed_m_s=0, burn=plan),
                    SimSettings(moon_rotation=False, max_time_s=40))
    assert out2.time_series["fuel_remaining_kg"][-1] == pytest.approx(ts["fuel_remaining_kg"][-1])


def test_cutoff_speed_event():
    p = suggest_vertical_ignition_altitude(cfg(), 100, initial_altitude_m=10000)
    out = simulate(cfg(), ic(10000, 100, burn=BurnPlan(mode="altitude", ignition_altitude_m=p["ignition_altitude_m"], cutoff_speed_m_s=5.0)),
                   SimSettings(moon_rotation=False))
    ev = {e["event"]: e for e in out.summary["events"]}
    assert "ignition" in ev and ev["ignition"]["altitude_m"] == pytest.approx(p["ignition_altitude_m"], rel=1e-6)
    assert "cutoff_speed" in ev
    T = np.array(out.time_series["time_s"]); sp = np.array(out.time_series["speed_surface_m_s"])
    assert sp[np.searchsorted(T, ev["cutoff_speed"]["t_s"])] == pytest.approx(5.0, abs=0.5)


# ---- touchdown / surface collision -----------------------------------------------------------
def test_touchdown_terminates_at_surface_with_target_elevation():
    out = simulate(cfg(), ic(1000, 0), SimSettings(moon_rotation=False), target_elevation_m=1500.0)
    fs = out.final_state
    assert out.summary["termination_reason"] == "touchdown"
    assert fs["distance_to_surface_m"] == pytest.approx(0, abs=1e-6)
    assert fs["altitude_m"] == pytest.approx(1500.0, abs=1e-6)


def test_touchdown_on_dem_surface_function():
    slope_surface = lambda lat, lon: 100.0 if lat > -1 else 0.0   # raised terrain at target
    out = simulate(cfg(), ic(1000, 0), SimSettings(moon_rotation=False), surface_fn=slope_surface, target_elevation_m=0.0)
    assert out.final_state["altitude_m"] == pytest.approx(100.0, abs=1e-6)
    assert out.time_series["distance_to_surface_m"][0] == pytest.approx(1000.0)   # start altitude is above local surface


def test_max_time_without_touchdown_reported():
    out = simulate(cfg(), ic(100000, 0), SimSettings(max_time_s=10, moon_rotation=False))
    assert out.summary["termination_reason"] == "max_time_reached" and out.summary["touchdown"] is None
    assert any("did not reach" in w for w in out.warnings)


def test_zero_fuel_ballistic_and_horizontal_motion():
    out = simulate(cfg(fuel=0.0), ic(5000, 200, azimuth_deg=90, flight_path_angle_deg=0), SimSettings(moon_rotation=False))
    td = out.summary["touchdown"]
    assert td["horizontal_speed_m_s"] > 150 and td["miss_distance_m"] > 1000
    assert td["longitude_deg"] > 0 and abs(td["latitude_deg"]) < 1e-3          # moved east
    assert out.summary["fuel_used_kg"] == 0


def test_downrange_start_offset():
    out = simulate(cfg(), ic(1000, 0, azimuth_deg=0, initial_downrange_m=5000), SimSettings(moon_rotation=False))
    assert out.time_series["distance_to_target_m"][0] == pytest.approx(5000, rel=1e-6)
    assert out.time_series["latitude_deg"][0] < 0                  # start is south of target (approaching northward)


# ---- rotation / frames ----------------------------------------------------------------------
def test_moon_rotation_surface_relative_velocity_and_longitude_drift():
    out = simulate(cfg(), ic(10000, 0), SimSettings(moon_rotation=True, output_dt_s=5))
    ts = out.time_series
    assert ts["speed_surface_m_s"][0] == pytest.approx(0, abs=1e-9)          # starts at rest relative to surface
    v_inertial0 = np.hypot(ts["inertial_velocity_x_m_s"][0], ts["inertial_velocity_y_m_s"][0])
    assert v_inertial0 == pytest.approx(MOON_ROTATION_RATE * (MOON_RADIUS_M + 10000), rel=1e-6)   # ~4.6 m/s
    # body-fixed trajectory stays nearly above the target, but a hover-start drops with small eastward drift
    assert out.summary["touchdown"]["miss_distance_m"] < 50


def test_series_fields_and_consistency():
    out = simulate(cfg(), ic(10000, 100, burn=BurnPlan(mode="altitude", ignition_altitude_m=3000)), SimSettings(output_dt_s=2))
    ts = out.time_series
    required = {"time_s", "position_x_m", "position_y_m", "position_z_m", "velocity_x_m_s", "velocity_y_m_s", "velocity_z_m_s",
                "acceleration_m_s2", "mass_kg", "fuel_remaining_kg", "altitude_m", "distance_to_surface_m", "thrust_n"}
    assert required <= set(ts)
    n = len(ts["time_s"]); assert all(len(v) == n for v in ts.values())
    assert np.all(np.diff(ts["time_s"]) > 0)
    r = np.sqrt(np.array(ts["position_x_m"]) ** 2 + np.array(ts["position_y_m"]) ** 2 + np.array(ts["position_z_m"]) ** 2)
    assert np.allclose(r - MOON_RADIUS_M, ts["altitude_m"], atol=1e-6)
    assert np.all(np.diff(ts["mass_kg"]) <= 1e-9)                      # mass never increases
    assert np.allclose(np.array(ts["mass_kg"]) - 900, ts["fuel_remaining_kg"], atol=1e-6)


def test_suggest_ignition_infeasible_when_twr_low():
    assert suggest_vertical_ignition_altitude(cfg(thrust=1000), 100)["feasible"] is False
    ok = suggest_vertical_ignition_altitude(cfg(), 100)
    assert ok["feasible"] and ok["ignition_altitude_m"] == pytest.approx(100 ** 2 / (2 * ok["constant_decel_m_s2"]) * 1.05)
