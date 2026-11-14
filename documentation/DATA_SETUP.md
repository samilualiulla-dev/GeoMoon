# Installing real lunar DEM data

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
window exceeds `GEOMOON_MAX_PATCH_CELLS` (default 4 M cells) and caches recent windows. For geographic-CRS products GeoMoon refuses |lat| > 85°.

## Offline demo / tests
`python backend/scripts/make_demo_dem.py` writes a **synthetic** test DEM (`synthetic: true`). It is never used unless a request sets
`allow_synthetic=true`, and every result built on it is marked synthetic. It is not NASA data.

*Note: this development environment could not reach NASA/USGS/ASU hosts (egress blocked), so no real dataset is bundled.*
