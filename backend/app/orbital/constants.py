"""Physical constants (SI). Sources: IAU 2012 / IERS 2010 / JPL DE430 headers (GM values)."""
import math

MU_EARTH = 3.986004418e14          # m^3/s^2 (GM, IERS 2010)
MU_MOON = 4.902800066e12           # m^3/s^2 (GRAIL GM)
MU_SUN = 1.32712440018e20          # m^3/s^2
R_EARTH = 6378137.0                # WGS-84 equatorial radius, m
R_MOON = 1737400.0                 # IAU mean lunar radius, m
J2_EARTH = 1.08262668e-3
G0 = 9.80665                       # standard gravity, m/s^2
AU = 1.495978707e11
OMEGA_EARTH = 7.2921150e-5         # rad/s (rotation rate)
MOON_SOI_M = 66.1e6                # Laplace sphere of influence radius of the Moon w.r.t. Earth, m (approx.)
OBLIQUITY_J2000 = math.radians(23.4392911)
JD_J2000 = 2451545.0
