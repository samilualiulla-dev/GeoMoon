"""Frame conventions for trajectory propagation.

* MCI  : Moon-centred, inertial (non-rotating) axes. Coincides with the body-fixed (selenographic)
         frame at t = 0.  Dynamics are integrated here.
* BF   : body-fixed frame, rotating about +Z at ``omega``; BF = Rz(-omega t) * MCI.
         Latitude/longitude, DEM lookups and the 3-D viewer use BF.
* ENU  : local East-North-Up at the START point (fixed vectors in MCI/BF at t=0).
Surface-relative velocity: v_rel = v_inertial - omega x r.
"""
from __future__ import annotations

import numpy as np


def omega_vec(omega: float) -> np.ndarray:
    return np.array([0.0, 0.0, omega])


def mci_to_bf(vec: np.ndarray, t: float, omega: float) -> np.ndarray:
    c, s = np.cos(omega * t), np.sin(omega * t)
    v = np.asarray(vec, float)
    return np.array([c * v[0] + s * v[1], -s * v[0] + c * v[1], v[2]])


def surface_relative_velocity(r: np.ndarray, v_inertial: np.ndarray, omega: float) -> np.ndarray:
    """Velocity of the vehicle relative to the rotating surface, expressed in MCI axes."""
    return np.asarray(v_inertial, float) - np.cross(omega_vec(omega), r)
