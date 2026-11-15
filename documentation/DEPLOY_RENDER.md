# Deploying GeoMoon on Render

1. Render dashboard -> **New -> Blueprint** -> select the GeoMoon GitHub repo (it reads `render.yaml`).
2. Two services are created: `geomoon-api` (FastAPI, downloads and imports NASA LOLA LDEM_16 during the build) and `geomoon` (static frontend).
3. If Render assigns different URLs, set `GEOMOON_CORS_ORIGINS` (api) to the frontend URL and `VITE_API_URL` (frontend) to `<api-url>/api`, then redeploy both.
4. Free plan: the API sleeps after inactivity (first request ~50 s) and its SQLite database is wiped on redeploy.
