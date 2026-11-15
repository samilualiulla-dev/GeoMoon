#!/usr/bin/env bash
# Render build step: install deps, download NASA LOLA LDEM_16 from the PDS Geosciences Node, import and verify it.
set -euo pipefail
cd "$(dirname "$0")/.."
pip install -r requirements.txt
mkdir -p ../datasets/dem /tmp/ldem
URL="https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/cylindrical/img/ldem_16.img"
curl -fL --retry 3 -o /tmp/ldem/ldem_16.img "$URL"
python scripts/import_pds.py ../datasets/labels/LDEM_16.LBL --img /tmp/ldem/ldem_16.img
python scripts/verify_data.py
