"""Static, honest catalogue of real lunar DEM products GeoMoon knows how to ingest.

This is *informational only*: nothing here is data.  A product becomes usable only when the
actual file is placed in ``datasets/dem/`` together with a ``<file>.meta.json`` sidecar.
"""

KNOWN_PRODUCTS = [
    {
        "product": "LOLA LDEM (global/regional gridded DEM)",
        "provider": "NASA LRO / LOLA (PDS Geosciences Node)",
        "url": "https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/",
        "format": "PDS3 .IMG + .LBL (GDAL-readable) or GeoTIFF",
        "coverage": "global (polar stereographic LDEM_*S/N products cover the poles)",
        "notes": "Elevations are relative to the 1737.4 km reference sphere. Use polar products for |lat|>~80.",
    },
    {
        "product": "SLDEM2015",
        "provider": "NASA GSFC PGDA (LOLA + SELENE/Kaguya TC)",
        "url": "https://pgda.gsfc.nasa.gov/products/54",
        "format": "GeoTIFF / IMG",
        "coverage": "approx. 60S-60N ONLY - does not cover the lunar poles",
        "notes": "Must not be used outside its coverage; GeoMoon enforces this via raster bounds.",
    },
    {
        "product": "LROC NAC/WAC regional DTMs",
        "provider": "NASA LRO / LROC (ASU)",
        "url": "https://www.lroc.im-ldi.com/",
        "format": "GeoTIFF / IMG (site-specific)",
        "coverage": "individual sites (high-resolution, ~1-5 m/px)",
        "notes": "Best for landing-site studies; coverage is tiny, so coverage checks matter.",
    },
    {
        "product": "Moon Trek / Lunar Orbital Data Explorer",
        "provider": "NASA JPL / WUSTL",
        "url": "https://trek.nasa.gov/moon/ , https://ode.rsl.wustl.edu/moon/",
        "format": "discovery portals (download links to the products above)",
        "coverage": "n/a",
        "notes": "Used to locate and download products; no direct API is assumed.",
    },
]
