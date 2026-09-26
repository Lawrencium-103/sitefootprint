"""
High-level API.

    from sitefootprint import estimate
    r = estimate(["Oslo", "Lagos"], flop=1e25)                 # reference sites by name
    r = estimate([{"name": "Nairobi", "lat": -1.29, "lon": 36.82, "country": "Kenya"}],
                 gpu_hours=2.0e6, arch="dtc_dry", years=[2023, 2024])

All locations share the same parameter draws (common random numbers), so differences
between them are paired comparisons, as in the accompanying study.
"""
import numpy as np

from . import __version__
from .params import PARAMS, REFERENCE_SITES, ARCHITECTURES, VALIDITY_NOTE, F_PEAK_FLOPS, central
from . import physics as P
from .data import fetch_weather, grid_intensity


def _q(a):
    a = np.asarray(a, dtype=float)
    return {"median": float(np.median(a)), "lo": float(np.percentile(a, 2.5)), "hi": float(np.percentile(a, 97.5))}


def draw_parameters(n, seed=20260925, overrides=None):
    rng = np.random.default_rng(seed)
    out = {k: rng.triangular(v[0], v[1], v[2], n) if v[2] > v[0] else np.full(n, v[1]) for k, v in PARAMS.items()}
    for k, v in (overrides or {}).items():
        if k not in PARAMS:
            raise KeyError(f"Unknown parameter '{k}'")
        out[k] = np.full(n, float(v))
    return out


def _resolve(loc):
    if isinstance(loc, str):
        key = next((k for k in REFERENCE_SITES if k.lower() == loc.lower()), None)
        if key is None:
            raise KeyError(f"'{loc}' is not a reference site; pass a dict with name, lat, lon, country")
        lat, lon, country = REFERENCE_SITES[key]
        return {"name": key, "lat": lat, "lon": lon, "country": country}
    missing = {"lat", "lon", "country"} - set(loc)
    if missing:
        raise KeyError(f"Location is missing {sorted(missing)}")
    return {"name": loc.get("name") or f"{loc['lat']:.2f}, {loc['lon']:.2f}",
            "lat": float(loc["lat"]), "lon": float(loc["lon"]), "country": loc["country"]}


def _facility_draws(t_db, rh, draws, arch, chunk=100):
    t_wb = P.wet_bulb_stull(t_db, rh)
    n = len(next(iter(draws.values())))
    pue, wue = np.empty(n), np.empty(n)
    for s in range(0, n, chunk):
        sub = {k: v[s:s + chunk] for k, v in draws.items()}
        ph, wh = P.hourly_facility(t_db, t_wb, sub, arch)
        pue[s:s + chunk] = ph.mean(axis=1)
        wue[s:s + chunk] = wh.mean(axis=1)
    pc, wc = P.hourly_facility(t_db, t_wb, central(), arch)
    free_h = float(((np.asarray(t_db) + central()["a_dry"]) <= (central()["t_chw"] - 2.0)).mean() * 8760)
    return pue, wue, float(pc.mean()), float(wc.mean()), free_h


def estimate(locations, flop=None, gpu_hours=None, arch="evaporative", years=(2024,), diesel_share=0.0,
             n_draws=500, seed=20260925, overrides=None, weather=None, reference=None,
             peak_flops=F_PEAK_FLOPS):
    """
    Carbon and on-site water footprint of one training run at one or more locations.

    flop / gpu_hours : give exactly one. gpu_hours bypasses MFU and overhead.
    arch             : 'evaporative', 'dry' or 'dtc_dry'.
    years            : weather and grid years (2010-2025); results average over them.
    diesel_share     : share of facility energy from on-site diesel (0-1), applied to every location,
                       or a dict {location name: share}.
    weather          : optional {name: {"t_db": array, "rh": array}} to skip downloading (offline use, tests).
    reference        : location name used for paired comparisons (default: first location).
    """
    if (flop is None) == (gpu_hours is None):
        raise ValueError("Give exactly one of flop or gpu_hours")
    if arch not in ARCHITECTURES:
        raise ValueError(f"arch must be one of {list(ARCHITECTURES)}")
    locs = [_resolve(l) for l in (locations if isinstance(locations, (list, tuple)) else [locations])]
    if not locs:
        raise ValueError("At least one location is required")
    years = sorted(set(int(y) for y in years))
    draws = draw_parameters(n_draws, seed, overrides)

    if flop is not None:
        gh = P.gpu_hours(float(flop), draws, peak_flops)
        gh_c = float(P.gpu_hours(float(flop), central(), peak_flops))
    else:
        gh = np.full(n_draws, float(gpu_hours))
        gh_c = float(gpu_hours)
    e_it = gh * draws["p_it_per_gpu_kw"]
    e_it_c = gh_c * PARAMS["p_it_per_gpu_kw"][1]

    sites, co2_by = [], {}
    for loc in locs:
        w = (weather or {}).get(loc["name"]) or fetch_weather(loc["lat"], loc["lon"], years)
        pue, wue, pue_c, wue_c, free_h = _facility_draws(w["t_db"], w["rh"], draws, arch)
        ci_list = [grid_intensity(loc["country"], y) for y in years]
        ci = float(np.mean([c for c, _ in ci_list]))
        ds = diesel_share.get(loc["name"], 0.0) if isinstance(diesel_share, dict) else float(diesel_share)
        ci_eff = P.effective_ci(ci, draws, ds)
        co2 = e_it * pue * ci_eff / 1000.0
        water = e_it * wue / 1000.0
        co2_by[loc["name"]] = co2
        sites.append({
            **loc,
            "grid_g_per_kwh": round(ci * 1000, 1),
            "grid_years_used": sorted(set(y for _, y in ci_list)),
            "diesel_share": ds,
            "hours": int(len(w["t_db"])),
            "mean_temp_c": float(np.mean(w["t_db"])),
            "dry_free_cooling_h_per_yr": round(free_h),
            "pue": {**_q(pue), "central": pue_c},
            "wue_l_per_kwh_it": {**_q(wue), "central": wue_c},
            "co2_t": _q(co2),
            "water_m3": _q(water),
            "_pue_c": pue_c, "_ci_c": float(P.effective_ci(ci, central(), ds)),
        })

    ref = reference or sites[0]["name"]
    if ref not in co2_by:
        raise KeyError(f"reference '{ref}' is not one of the locations")
    cen = {s["name"]: (s.pop("_ci_c"), s.pop("_pue_c")) for s in sites}
    ci0, pue0 = cen[ref]
    for s in sites:
        s["prob_lower_than_reference"] = None if s["name"] == ref else float(np.mean(co2_by[s["name"]] < co2_by[ref]))
        lg = float(np.log(cen[s["name"]][0] / ci0))
        lf = float(np.log(cen[s["name"]][1] / pue0))
        s["vs_reference"] = {"ln_grid": lg, "ln_facility": lf,
                             "grid_share": (abs(lg) / (abs(lg) + abs(lf))) if (lg or lf) else None,
                             "carbon_ratio": float(np.median(co2_by[s["name"]]) / np.median(co2_by[ref]))}

    return {
        "tool": "sitefootprint", "version": __version__,
        "inputs": {"flop": flop, "gpu_hours": gpu_hours, "arch": arch, "arch_label": ARCHITECTURES[arch],
                   "years": years, "n_draws": n_draws, "seed": seed, "overrides": overrides or {},
                   "reference": ref},
        "gpu_hours": _q(gh), "it_energy_kwh": _q(e_it),
        "sites": sites,
        "ranking": [s["name"] for s in sorted(sites, key=lambda s: s["co2_t"]["median"])],
        "validity_note": VALIDITY_NOTE,
        "cite": "Adekunle A. SiteFootprint: location-resolved carbon and water footprints of AI training. "
                "Software, version " + __version__ + ".",
    }
