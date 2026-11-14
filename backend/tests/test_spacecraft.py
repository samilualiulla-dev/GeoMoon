import pytest
from pydantic import ValidationError

from app.spacecraft.schemas import (BurnPlan, Dimensions, Engine, InitialConditions, LandingGear, SimSettings,
                                    SpacecraftConfig, check_initial_state)


def cfg(**kw):
    base = dict(name="t", dry_mass_kg=900, fuel_mass_kg=300, dimensions=Dimensions(length_m=3, width_m=3, height_m=4),
                landing_gear=LandingGear(span_m=5), engine=Engine(thrust_n=5000, isp_s=300))
    base.update(kw)
    return SpacecraftConfig(**base)


def test_valid_and_derived():
    c = cfg()
    d = c.derived()
    assert d["total_mass_kg"] == 1200 and d["thrust_to_weight_lunar_surface"] == pytest.approx(5000 / (1200 * 1.6247), rel=1e-3)
    assert d["mass_flow_full_throttle_kg_s"] == pytest.approx(5000 / (300 * 9.80665))
    assert d["tipping_angle_deg"] == pytest.approx(45.0)  # span/2=2.5, cg = 0.5+2


@pytest.mark.parametrize("field,val", [("dry_mass_kg", 0), ("dry_mass_kg", -5), ("fuel_mass_kg", -1)])
def test_nonpositive_mass_rejected(field, val):
    with pytest.raises(ValidationError):
        cfg(**{field: val})


def test_dimensions_and_extra_fields_rejected():
    with pytest.raises(ValidationError):
        Dimensions(length_m=0, width_m=1, height_m=1)
    with pytest.raises(ValidationError):
        cfg(unknown_field=1)


def test_engine_needs_isp_or_flow_and_consistency():
    with pytest.raises(ValidationError):
        Engine(thrust_n=100)
    with pytest.raises(ValidationError):
        Engine(thrust_n=5000, isp_s=300, fuel_consumption_kg_s=5.0)   # implies Isp ~102 s
    e = Engine(thrust_n=5000, fuel_consumption_kg_s=5000 / (300 * 9.80665))
    assert e.effective_isp_s == pytest.approx(300)
    with pytest.raises(ValidationError):
        Engine(thrust_n=100, isp_s=300, throttle_min=0.9, throttle_max=0.5)


def test_multi_engine_total_thrust():
    assert Engine(thrust_n=1000, number_of_engines=4, isp_s=300).total_thrust_n == 4000


def test_low_twr_warning_and_zero_fuel_warning():
    c = cfg(engine=Engine(thrust_n=1000, isp_s=300))
    assert any("cannot hover" in w for w in c.warnings())
    assert any("ballistic" in w for w in cfg(fuel_mass_kg=0).warnings())


def test_initial_conditions_validation():
    with pytest.raises(ValidationError):
        InitialConditions(target_latitude_deg=95, target_longitude_deg=0, initial_altitude_m=100, initial_speed_m_s=1)
    with pytest.raises(ValidationError):
        InitialConditions(target_latitude_deg=0, target_longitude_deg=0, initial_altitude_m=-1, initial_speed_m_s=1)
    with pytest.raises(ValidationError):
        InitialConditions(target_latitude_deg=0, target_longitude_deg=0, initial_altitude_m=100, initial_speed_m_s=-1)


def test_burn_plan_validation():
    with pytest.raises(ValidationError):
        BurnPlan(mode="altitude")
    with pytest.raises(ValidationError):
        BurnPlan(mode="schedule", throttle_schedule=[(5, 1.0), (2, 0.5)])
    with pytest.raises(ValidationError):
        BurnPlan(mode="schedule", throttle_schedule=[(0, 1.5)])
    with pytest.raises(ValidationError):
        BurnPlan(direction="fixed_enu")


def test_cross_validation_burn_vs_config():
    ic = InitialConditions(target_latitude_deg=0, target_longitude_deg=0, initial_altitude_m=1000, initial_speed_m_s=10,
                           burn=BurnPlan(mode="time", ignition_time_s=1))
    with pytest.raises(ValueError):
        check_initial_state(cfg(fuel_mass_kg=0), ic)
    c = cfg(engine=Engine(thrust_n=5000, isp_s=300, throttle_min=0.5))
    ic2 = ic.model_copy(update={"burn": BurnPlan(mode="time", ignition_time_s=1, throttle=0.2)})
    with pytest.raises(ValueError):
        check_initial_state(c, ic2)


def test_sim_settings_limits():
    with pytest.raises(ValidationError):
        SimSettings(output_dt_s=0.001, max_time_s=86400)
    with pytest.raises(ValidationError):
        SimSettings(output_dt_s=0)
