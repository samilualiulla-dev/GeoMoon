"""Gravity model: point-mass (central) field g(r) = mu / r^2.  No J2/mascons (documented limitation)."""
import numpy as np

from ..core.constants import MOON_MU


def gravity_magnitude(r_m: float, mu: float = MOON_MU) -> float:
    if r_m <= 0:
        raise ValueError("r must be positive")
    return mu / (r_m * r_m)


def gravity_acceleration(r_vec: np.ndarray, mu: float = MOON_MU) -> np.ndarray:
    """Vector acceleration [m/s^2] = -mu * r_vec / |r|^3 (pointing to the Moon's centre)."""
    r = float(np.linalg.norm(r_vec))
    if r == 0:
        raise ValueError("r must be non-zero")
    return -mu * np.asarray(r_vec, float) / r ** 3
