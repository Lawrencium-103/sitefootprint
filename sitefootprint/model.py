"""
High-level API.

    from sitefootprint import estimate
    r = estimate(["Oslo", "Lagos"], flop=1e25)
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


def _months(w):
    if w.get("month") is not None:
        return np.asarray(w["month"], dtype=int)
    n = len(w["t_db"])  # hourly series assumed to start on 1 January
    doy = (np.arange(n) // 24) % 365
    edges = np.cumsum([0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31])
    return np.searchsorted(edges, doy, side="right")


def _facility(t_db, rh, months, draws, arch, chunk=100):
    t_wb = P.wet_bulb_stull(t_db, rh)
    n = len(next(iter(draws.values())))
    pue, wue = np.empty(n), np.empty(n)
    for s in range(0, n, chunk):
        sub = {k: v[s:s + chunk] for k, v in draws.items()}
        ph, wh = P.hourly_facility(t_db, t_wb, sub, arch)
        pue[s:s + chunk] = ph.mean(axis=1)
        wue[s:s + chunk] = wh.mean(axis=1)
    c = central()
    arch_central = {}
    for a in ARCHITECTURES:
        pc, wc = P.hourly_facility(t_db, t_wb, c, a)
        arch_central[a] = (pc[0], wc[0])
    pc, wc = arch_central[arch]
    monthly = {"t_db": [], "t_wb": [], "pue": [], "wue": []}
    for m in range(1, 13):
        k = months == m
        for key, arr in (("t_db", t_db), ("t_wb", t_wb), ("pue", pc), ("wue", wc)):
            monthly[key].append(float(np.mean(np.asarray(arr)[k])) if k.any() else None)
    free_h = float(((np.asarray(t_db) + c["a_dry"]) <= (c["t_chw"] - 2.0)).mean() * 8760)
    return pue, wue, arch_central, monthly, free_h, t_wb


def _hist(values, edges):
    counts, _ = np.histogram(values, bins=edges)
    return counts.tolist()


def estimate(locations, flop=None, gpu_hours=None, arch="evaporative", years=(2024,), diesel_share=0.0,
             n_draws=500, seed=20260925, overrides=None, weather=None, reference=None,
             peak_flops=F_PEAK_FLOPS):
    """
    Carbon and on-site water footprint of one training run at one or more locations.

    flop / gpu_hours : give exactly one. gpu_hours bypasses MFU and overhead.
    arch             : 'evaporative', 'dry' or 'dtc_dry'.
    years            : weather and grid years (2010-2025); results average over them.
    diesel_share     : share of facility energy from on-site diesel (0-1), for every location,
                       or a dict {location name: share}.
    weather          : optional {name: {"t_db": array, "rh": array[, "month": array]}} (offline use, tests).
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
    c = central()
    c.update({k: float(v) for k, v in (overrides or {}).items()})

    if flop is not None:
        gh = P.gpu_hours(float(flop), draws, peak_flops)
        gh_c = float(P.gpu_hours(float(flop), c, peak_flops))
    else:
        gh = np.full(n_draws, float(gpu_hours))
        gh_c = float(gpu_hours)
    e_it = gh * draws["p_it_per_gpu_kw"]
    e_it_c = gh_c * c["p_it_per_gpu_kw"]
    diesel_ef_c = float(P.diesel_ef_kg_per_kwh(c["eta_diesel"]))

    sites, co2_by = [], {}
    for loc in locs:
        w = (weather or {}).get(loc["name"]) or fetch_weather(loc["lat"], loc["lon"], years)
        t_db = np.asarray(w["t_db"], dtype=float)
        pue, wue, arch_c, monthly, free_h, t_wb = _facility(t_db, w["rh"], _months(w), draws, arch)
        ci_list = [grid_intensity(loc["country"], y) for y in years]
        ci = float(np.mean([v for v, _ in ci_list]))
        ds = diesel_share.get(loc["name"], 0.0) if isinstance(diesel_share, dict) else float(diesel_share)
        ci_eff = P.effective_ci(ci, draws, ds)
        co2 = e_it * pue * ci_eff / 1000.0
        water = e_it * wue / 1000.0
        co2_by[loc["name"]] = co2
        ci_eff_c = float(P.effective_ci(ci, c, ds))
        sites.append({
            **loc,
            "grid_g_per_kwh": round(ci * 1000, 1),
            "grid_years_used": sorted(set(y for _, y in ci_list)),
            "diesel_share": ds,
            "hours": int(len(t_db)),
            "climate": {"mean_t_db": float(t_db.mean()), "p99_t_db": float(np.percentile(t_db, 99)),
                        "mean_t_wb": float(t_wb.mean()), "p99_t_wb": float(np.percentile(t_wb, 99)),
                        "mean_rh": float(np.mean(w["rh"])), "dry_free_cooling_h_per_yr": round(free_h)},
            "monthly": monthly,
            "pue": {**_q(pue), "central": float(arch_c[arch][0].mean())},
            "wue_l_per_kwh_it": {**_q(wue), "central": float(arch_c[arch][1].mean())},
            "co2_t": _q(co2),
            "water_m3": _q(water),
            "central": {"pue": float(arch_c[arch][0].mean()), "ci_kg_per_kwh": ci, "ci_eff_kg_per_kwh": ci_eff_c,
                        "co2_t": e_it_c * float(arch_c[arch][0].mean()) * ci_eff_c / 1000.0},
            "architectures": {a: {"pue": float(v[0].mean()), "wue_l_per_kwh_it": float(v[1].mean()),
                                  "co2_t": e_it_c * float(v[0].mean()) * ci_eff_c / 1000.0,
                                  "water_m3": e_it_c * float(v[1].mean()) / 1000.0}
                              for a, v in arch_c.items()},
        })

    ref = reference or sites[0]["name"]
    if ref not in co2_by:
        raise KeyError(f"reference '{ref}' is not one of the locations")
    ci0, pue0 = next((s["central"]["ci_eff_kg_per_kwh"], s["central"]["pue"]) for s in sites if s["name"] == ref)
    all_co2 = np.concatenate(list(co2_by.values()))
    edges = np.logspace(np.log10(max(all_co2.min(), 1e-6)) - 0.02, np.log10(all_co2.max()) + 0.02, 41)
    for s in sites:
        s["prob_lower_than_reference"] = None if s["name"] == ref else float(np.mean(co2_by[s["name"]] < co2_by[ref]))
        lg = float(np.log(s["central"]["ci_eff_kg_per_kwh"] / ci0))
        lf = float(np.log(s["central"]["pue"] / pue0))
        s["vs_reference"] = {"ln_grid": lg, "ln_facility": lf,
                             "grid_share": (abs(lg) / (abs(lg) + abs(lf))) if (lg or lf) else None,
                             "carbon_ratio": float(np.median(co2_by[s["name"]]) / np.median(co2_by[ref]))}
        s["co2_hist"] = _hist(co2_by[s["name"]], edges)

    names = [s["name"] for s in sites]
    pairwise = [[None if a == b else float(np.mean(co2_by[a] < co2_by[b])) for b in names] for a in names]

    return {
        "tool": "sitefootprint", "version": __version__,
        "inputs": {"flop": flop, "gpu_hours": gpu_hours, "arch": arch, "arch_label": ARCHITECTURES[arch],
                   "years": years, "n_draws": n_draws, "seed": seed, "overrides": overrides or {},
                   "reference": ref, "peak_flops": peak_flops},
        "gpu_hours": _q(gh), "it_energy_kwh": _q(e_it),
        "central": {"gpu_hours": gh_c, "it_energy_kwh": e_it_c, "diesel_ef_kg_per_kwh": diesel_ef_c,
                    "mfu": c["mfu"], "p_it_per_gpu_kw": c["p_it_per_gpu_kw"],
                    "overhead_wallclock": c["overhead_wallclock"]},
        "sites": sites,
        "ranking": [s["name"] for s in sorted(sites, key=lambda s: s["co2_t"]["median"])],
        "pairwise_prob_lower": {"names": names, "matrix": pairwise},
        "co2_hist_edges": edges.tolist(),
        "architectures": ARCHITECTURES,
        "validity_note": VALIDITY_NOTE,
        "cite": "Oladeji L. SiteFootprint: location-resolved carbon and water footprints of AI training. "
                "Software, version " + __version__ + ".",
    }
