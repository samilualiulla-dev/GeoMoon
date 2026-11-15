"""Built-in scenario presets (editable starting points, not fixed missions)."""
VEH_TRANSFER = {"name": "Transfer stage (demo)", "dry_mass_kg": 8000.0, "fuel_mass_kg": 60000.0,
                "engines": [{"name": "Main engine", "thrust_n": 200000.0, "isp_s": 450.0}]}
VEH_LANDER = {"name": "Lander (demo)", "dry_mass_kg": 4500.0, "fuel_mass_kg": 6500.0,
              "engines": [{"name": "Descent engine", "thrust_n": 45000.0, "isp_s": 311.0}]}

SCENARIOS = [
    {"id": "leo_free", "title": "LEO free flight", "description": "Circular 400 km Earth orbit, no burns. Check J2/Moon/Sun perturbations.",
     "needs_plan": False, "config": {"name": "LEO free flight", "vehicle": VEH_TRANSFER, "initial": {"kind": "earth_orbit", "periapsis_alt_m": 400000, "inclination_deg": 28.5},
                                     "mission": {"kind": "free_flight", "duration_s": 3 * 5560.0}}},
    {"id": "lunar_flyby", "title": "Earth -> Moon flyby", "description": "Planner finds an impulsive trans-lunar burn for a 100 km periselene flyby.",
     "needs_plan": True, "config": {"name": "Lunar flyby", "vehicle": VEH_TRANSFER, "initial": {"kind": "earth_orbit", "periapsis_alt_m": 300000, "inclination_deg": 28.5},
                                    "mission": {"kind": "lunar_flyby", "target_altitude_m": 100000, "duration_s": 6 * 86400.0}}},
    {"id": "lunar_orbit", "title": "Earth -> 100 km lunar orbit", "description": "Trans-lunar injection + lunar orbit insertion (planner, impulsive).",
     "needs_plan": True, "config": {"name": "Lunar orbit capture", "vehicle": VEH_TRANSFER, "initial": {"kind": "earth_orbit", "periapsis_alt_m": 300000, "inclination_deg": 28.5},
                                    "mission": {"kind": "lunar_orbit", "target_altitude_m": 100000, "duration_s": 5 * 86400.0}}},
    {"id": "lunar_landing", "title": "Lunar orbit -> landing", "description": "De-orbit + guided powered descent from a 100 km lunar orbit. Uses the real DEM for contact when installed.",
     "needs_plan": True, "config": {"name": "Lunar descent", "vehicle": VEH_LANDER, "initial": {"kind": "moon_orbit", "periapsis_alt_m": 100000, "inclination_deg": 10},
                                    "mission": {"kind": "landing", "target_lat_deg": 0.0, "target_lon_deg": 10.0, "duration_s": 8000.0},
                                    "options": {"include_sun": False}}},
    {"id": "full_landing", "title": "Земля -> посадка на Луну (полная миссия)", "description": "Разгон к Луне, захват на орбиту 100 км, сход с орбиты и управляемая посадка. План строит ядро (несколько десятков секунд).",
     "needs_plan": True, "config": {"name": "Full lunar landing", "vehicle": VEH_TRANSFER, "initial": {"kind": "earth_orbit", "periapsis_alt_m": 300000, "inclination_deg": 28.5},
                                    "mission": {"kind": "landing", "target_altitude_m": 100000, "target_lat_deg": None, "target_lon_deg": None, "duration_s": 6 * 86400.0}}},
    {"id": "manual_burn", "title": "Manual flight (LEO)", "description": "Free LEO start; use the manual throttle/direction controls during the simulation.",
     "needs_plan": False, "config": {"name": "Manual flight", "vehicle": VEH_TRANSFER, "initial": {"kind": "earth_orbit", "periapsis_alt_m": 300000, "inclination_deg": 28.5},
                                     "mission": {"kind": "free_flight", "duration_s": 2 * 86400.0}}},
]
