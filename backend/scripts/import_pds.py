"""Import a LOLA PDS3 product (.LBL + .IMG) into GeoMoon.

usage:  python scripts/import_pds.py PATH/TO/LDEM_16.LBL [--out ../datasets/dem]

Reads the label, writes <product>.tif + <product>.meta.json into the DEM directory, prints a plausibility report.
The .IMG must sit in the same folder as the .LBL.  Nothing is downloaded or invented.
"""
import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.lunar_data.pds import PdsError, import_pds, sanity_report  # noqa: E402

p = argparse.ArgumentParser()
p.add_argument("label", type=Path, help="path to the .LBL file (the .IMG must be next to it)")
p.add_argument("--out", type=Path, default=Path(__file__).resolve().parents[2] / "datasets" / "dem")
a = p.parse_args()
try:
    r = import_pds(a.label, a.out)
except (PdsError, OSError) as e:
    sys.exit(f"IMPORT FAILED: {e}")
rep = sanity_report(r.tif, r.meta)
print(f"OK  {r.tif}  ({r.shape[1]} x {r.shape[0]} px)")
print(f"    product={r.meta['product']}  quantity={r.meta['quantity']}  resolution={r.meta['resolution_m_per_px']} m/px")
print(f"    physical range (reduced read): min={rep['min']:.3f}  max={rep['max']:.3f}  mean={rep['mean']:.3f}  valid={rep['valid_fraction']:.1%}  [{r.meta['unit']}]")
for w in rep["warnings"]:
    print("    WARNING:", w)
if r.meta["quantity"] != "elevation":
    print(f"    NOTE: this is a '{r.meta['quantity']}' product, not a DEM. GeoMoon lists it but will not use it for terrain analysis.")
print("Restart the backend (or open Data Sources and press Rescan).")
