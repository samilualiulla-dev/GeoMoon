"""Check an installed REAL elevation dataset against well-known facts (Apollo sites, basin floors, highest point, far/near side).

usage:  python scripts/verify_data.py [dataset_id] [--dem ../datasets/dem]
"""
import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.lunar_data.registry import DatasetRegistry  # noqa: E402
from app.lunar_data.verify import verify  # noqa: E402

p = argparse.ArgumentParser()
p.add_argument("dataset", nargs="?", help="dataset id (file stem, e.g. ldem_16); default: every real elevation dataset")
p.add_argument("--dem", type=Path, default=Path(__file__).resolve().parents[2] / "datasets" / "dem")
a = p.parse_args()
reg = DatasetRegistry(a.dem)
ids = [a.dataset] if a.dataset else [d.id for d in reg.datasets.values() if d.quantity == "elevation" and not d.synthetic]
if not ids:
    sys.exit(f"No real elevation dataset found in {a.dem}. Run scripts/import_pds.py first. Rejected files: {reg.errors or 'none'}")
bad = 0
for i in ids:
    print(f"== {i}  ({reg.get(i).resolution_m_per_px:.0f} m/px)")
    for c in verify(reg, i):
        print(f"  [{c.status}] {c.name}: {c.detail}")
        bad += c.status == "FAIL"
print("\nALL CHECKS PASSED" if not bad else f"\n{bad} CHECK(S) FAILED - the scale/offset or map orientation of this import is probably wrong; send this output.")
sys.exit(1 if bad else 0)
