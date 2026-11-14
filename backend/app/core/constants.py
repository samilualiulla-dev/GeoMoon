"""Physical constants (SI units). Sources noted per constant."""

# Mean lunar reference radius used by LOLA/LDEM products (IAU / LRO convention).
MOON_RADIUS_M = 1_737_400.0
# Lunar gravitational parameter GM, JPL DE430 / GRAIL-era value: 4902.800066 km^3/s^2.
MOON_MU = 4.902800066e12  # m^3 / s^2
# Standard gravity used in the Isp -> exhaust velocity relation (CGPM 1901).
G0 = 9.80665  # m / s^2
# Nominal surface gravity of the Moon, mu / R^2 (~1.625 m/s^2); used for sanity checks only.
MOON_SURFACE_GRAVITY = MOON_MU / MOON_RADIUS_M**2
# Sidereal rotation of the Moon (rad/s). NOT used by the 3-DOF model (documented limitation).
MOON_ROTATION_RATE = 2.0 * 3.141592653589793 / (27.321661 * 86400.0)
