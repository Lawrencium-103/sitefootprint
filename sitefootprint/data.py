"""Weather (Open-Meteo archive, ERA5-based) and grid intensity (bundled Ember/OWID)."""
import json
import time
import urllib.parse
import urllib.request
from functools import lru_cache
from pathlib import Path

import numpy as np

OPEN_METEO = "https://archive-api.open-meteo.com/v1/archive"
_GRID = Path(__file__).parent / "data" / "grid_intensity.json"


@lru_cache(maxsize=1)
def _grid():
    return json.loads(_GRID.read_text(encoding="utf-8"))


def countries():
    return sorted(_grid()["countries"])


def grid_intensity(country, year):
    """Return (kgCO2e/kWh, year actually used). Falls back to the nearest available year."""
    g = _grid()["countries"]
    key = next((c for c in g if c.lower() == str(country).lower()), None)
    if key is None:
        key = next((c for c, v in g.items() if v["iso3"].lower() == str(country).lower()), None)
    if key is None:
        raise KeyError(f"Country '{country}' not found. Use sitefootprint.data.countries() for valid names.")
    series = {int(y): v for y, v in g[key]["g_per_kwh"].items()}
    used = min(series, key=lambda y: (abs(y - int(year)), -y))
    return series[used] / 1000.0, used


def fetch_weather(lat, lon, years, timeout=45, retries=3):
    """Hourly 2 m temperature (degC) and relative humidity (%) for the given years (UTC)."""
    years = sorted(set(int(y) for y in years))
    q = urllib.parse.urlencode({
        "latitude": round(float(lat), 4), "longitude": round(float(lon), 4),
        "start_date": f"{years[0]}-01-01", "end_date": f"{years[-1]}-12-31",
        "hourly": "temperature_2m,relative_humidity_2m", "timezone": "UTC",
    })
    last = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(f"{OPEN_METEO}?{q}", headers={"User-Agent": "sitefootprint"})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                h = json.loads(r.read().decode())["hourly"]
            t = np.array(h["temperature_2m"], dtype=float)
            rh = np.array(h["relative_humidity_2m"], dtype=float)
            yrs = np.array([int(s[:4]) for s in h["time"]])
            months = np.array([int(s[5:7]) for s in h["time"]])
            keep = np.isin(yrs, years)
            t, rh, months = t[keep], rh[keep], months[keep]
            # linear interpolation over any gaps
            for a in (t, rh):
                bad = np.isnan(a)
                if bad.any():
                    a[bad] = np.interp(np.flatnonzero(bad), np.flatnonzero(~bad), a[~bad])
            return {"t_db": t, "rh": rh, "month": months, "n_hours": int(len(t)),
                    "source": "Open-Meteo historical archive (ERA5-based)"}
        except Exception as e:  # network or rate limit
            last = e
            time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f"Weather download failed for ({lat}, {lon}): {last}")
