# Installing real lunar DEM data

## Quick path: LOLA products from the PDS (`.IMG` + `.LBL`)
LOLA gridded products come as a raw `.IMG` plus a text label `.LBL`. GeoMoon reads the label itself — you do **not** send files anywhere:

1. Download **both** files of a product into one folder, e.g. `C:\GeoMoonData\`.
   * Global relief for the globe (≈ 33 MB): `LDEM_16.IMG` + `LDEM_16.LBL`
   * Folder: https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/cylindrical/img/
   * Polar products (south pole): folder `.../lola_gdr/polar/south_pole/` (`LDEM_80S_*M.IMG/.LBL`; files at 20 m are gigabytes — start coarser).
2. Import (from the `backend` folder):
   ```powershell
   python scripts/import_pds.py C:\GeoMoonData\LDEM_16.LBL
   ```
   It writes a compressed GeoTIFF + `.meta.json` into `datasets/dem/`, converts the label's scale/offset to metres above the 1737.4 km
   reference sphere and prints a plausibility report (elevation must be roughly −9 … +11 km).
3. Restart the backend (or press *Rescan* in Data Sources).

**Check the product name:** `LDEM_*` = elevation (what GeoMoon needs). `LDRM_*` = roughness and `LDSM_*` = slope maps — they import fine and are
listed in Data Sources but are marked *not a DEM* and are never used for terrain analysis.

### Which product to choose
| File | Size | Resolution | Good for |
|---|---|---|---|
| `LDEM_16.IMG` + `.LBL` | ≈ 33 MB | 1.9 km/px | the 3-D globe, regional context |
| `LDEM_128.IMG` + `.LBL` | ≈ 2.1 GB | 237 m/px | whole-Moon relief **and the poles** (see below), regional slopes |
| `LDEM_80S_*M.IMG` + `.LBL` (polar) | 0.1–2 GB+ | 20–120 m/px | south-pole sites (finest = best for landing analysis) |

* The PDS4 `.xml` label that sits next to some products is **not needed**; the PDS3 `.LBL` is enough.
* Large files: importing `LDEM_128` streams the file in blocks (a few hundred MB of RAM), takes a few minutes, writes a compressed GeoTIFF
  **with a pyramid** (so the globe and zoomed-out views stay fast) and needs ~3–4 GB of free disk. The importer prints nothing until it
  finishes — wait for the `OK` line.
* The south pole works from the global `LDEM_128`/`LDEM_16` directly: within ~10° of a pole the core resamples the lon/lat raster onto a local,
  square-metre grid centred on your target (azimuthal-equidistant), so the pole is not a special case. It is limited by the source resolution
  (237 m/px for LDEM_128): good for regional slopes and crater-scale terrain, **too coarse for choosing a landing footprint of a few metres** —
  the analysis tells you so.

Unverified assumptions (no real polar file was available when this was written): polar stereographic products are assumed to use scale factor
k = 1 at the pole and the PDS convention that `LINE/SAMPLE_PROJECTION_OFFSET` are 0-based pixel-centre indices of the pole. After importing a polar
product, check a known feature (e.g. Shackleton crater near 89.9°S should be a ~4 km deep depression) with *Probe elevation*. If it is mirrored or
shifted, report it — the importer must then be adjusted.

## Manual path (any GDAL raster)

GeoMoon never generates or substitutes terrain. Place a real DEM raster plus a provenance sidecar in `datasets/dem/`
(or set `GEOMOON_DEM_DIR`).

```
datasets/dem/
  LDEM_80S_20M.tif          # any GDAL-readable raster: GeoTIFF, PDS3 .IMG/.LBL, JP2 …
  LDEM_80S_20M.meta.json    # required sidecar
```

Sidecar (`<same stem>.meta.json`):
```json
{
  "name": "LOLA LDEM 80S 20 m",
  "provider": "NASA LRO / LOLA (PDS Geosciences Node)",
  "product": "LDEM_80S_20M",
  "version": "…",
  "url": "https://pds-geosciences.wustl.edu/…",
  "citation": "Smith et al. (2017) Icarus 283, 70-91 …",
  "resolution_m_per_px": 20,
  "vertical_reference_radius_m": 1737400,
  "elevation_scale": 1.0, "elevation_offset": 0.0,
  "vertical_accuracy_m": null,
  "nominal_coverage": "south polar, 80S-90S"
}
```
Required: `name`, `provider`, `product`. The raster **must carry a CRS** (polar stereographic or geographic on the lunar sphere).
Raw PDS `.IMG` data stored as integers need `elevation_scale`/`elevation_offset` so that `physical = raw*scale + offset` is metres
(check the product label). Hit `GET /api/data/sources?refresh=true` to re-scan; unusable files are listed under `rejected_files` with the reason.

## Where to get data
| Product | Source | Coverage / caveat |
|---|---|---|
| LOLA LDEM (global + polar) | https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/ | Polar stereographic products cover the poles — **use these for the south pole** |
| SLDEM2015 | https://pgda.gsfc.nasa.gov/products/54 | ≈60°S–60°N only. **Does not cover the poles.** GeoMoon refuses points outside the raster bounds |
| LROC NAC/WAC DTMs | https://www.lroc.im-ldi.com/ | Small high-resolution sites |
| Moon Trek / ODE | https://trek.nasa.gov/moon/ · https://ode.rsl.wustl.edu/moon/ | Discovery portals; download links lead to the products above |

Large rasters are fine: the engine reads only a window around the requested point (`radius_m`), resamples with averaging when the
window exceeds `GEOMOON_MAX_PATCH_CELLS` (default 4 M cells) and caches recent windows. For geographic-CRS products within ~10° of a pole the window is resampled onto a local metric grid (see above).

## Offline demo / tests
`python backend/scripts/make_demo_dem.py` writes a **synthetic** test DEM (`synthetic: true`). It is never used unless a request sets
`allow_synthetic=true`, and every result built on it is marked synthetic. It is not NASA data.

*Note: this development environment could not reach NASA/USGS/ASU hosts (egress blocked), so no real dataset is bundled.*
