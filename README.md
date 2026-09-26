# SiteFootprint

Location-resolved carbon and water footprints of AI training runs.

Most AI carbon calculators multiply energy by one fixed power usage effectiveness (PUE) for every data centre on Earth. SiteFootprint instead computes cooling energy and on-site water hour by hour from real weather at the chosen location, using a thermodynamic facility model calibrated against published campus PUE. It then combines this with the local grid carbon intensity and reports 95% ranges and paired comparisons between locations.

It answers questions like:

- How much CO₂ and water would a 10²⁵-FLOP training run cause in Lagos versus Oslo?
- How much of that difference comes from the power grid, and how much from the climate?
- Does direct-to-chip liquid cooling reduce emissions at this site, or only water use?
- What happens if 25% of the facility's electricity comes from diesel generators?

## Install

    pip install sitefootprint                 # core (NumPy only)
    pip install "sitefootprint[siting]"       # adds the capacity-constrained siting optimiser (SciPy)

From source: `pip install -e ".[test,siting]"` and run `pytest`.

## Command line

    sitefootprint estimate --flop 1e25 --site Oslo --site Ashburn --site Lagos
    sitefootprint estimate --gpu-hours 2e6 --loc "Nairobi,-1.29,36.82,Kenya" --arch dtc_dry --years 2023 2024
    sitefootprint estimate --flop 3.8e25 --site Lagos --diesel 0.25 --json
    sitefootprint countries
    sitefootprint site --runs runs.csv --cap 0.3

Reference sites: Oslo, Paris, Ashburn, Beijing, Marrakech, Lagos. Any other place is given as `name,lat,lon,country`.

## Python

```python
from sitefootprint import estimate

r = estimate(
    ["Oslo", "Lagos", {"name": "Nairobi", "lat": -1.29, "lon": 36.82, "country": "Kenya"}],
    flop=1e25,                 # or gpu_hours=...
    arch="evaporative",        # "evaporative", "dry" or "dtc_dry"
    years=[2024],              # 2010-2025
    diesel_share=0.0,          # or {"Lagos": 0.25}
)
for s in r["sites"]:
    print(s["name"], s["co2_t"]["median"], s["water_m3"]["median"], s["prob_lower_than_reference"])
```

Each site returns PUE, WUE (litres per kWh of IT energy), tCO₂e and m³ of water as median with 2.5th–97.5th percentiles; the probability that it emits less than the reference location in paired draws; and the split of its log-difference from the reference into grid and facility terms.

## What the model does

1. **IT energy.** Accelerator-hours = FLOP × wall-clock overhead ÷ (MFU × 989.4 TFLOP/s, H100 dense BF16), times average IT power per accelerator (host, fabric and storage included). If you supply measured GPU-hours, MFU is not used.
2. **Hourly facility model.** For every hour of hourly weather (Open-Meteo historical archive, ERA5-based), it evaluates economiser availability from dry-bulb and wet-bulb temperature (Stull 2011). Chillers run at a fixed fraction of Carnot efficiency when needed. Cooling-tower water follows from the latent heat of vaporisation and blow-down. Three architectures are modelled: air plus hybrid cooling tower, air plus dry cooler, and direct-to-chip liquid plus dry cooler.
3. **Carbon.** Facility energy × Ember annual life-cycle grid intensity (bundled for 212 countries, 2010–2025), optionally blended with on-site diesel (IPCC 2006 default 74.1 tCO₂/TJ, generator efficiency 30–40%).
4. **Uncertainty.** 16 parameters are drawn from triangular distributions. All locations share the same draws, so comparisons between them are paired.

All defaults and their sources are in `sitefootprint/params.py`.

## Validation

- **Facility model.** Two parameters (electrical overhead and chilled-water temperature) were fitted on 7 Google campuses (34 campus-years of published trailing-twelve-month PUE). It was then tested on 7 different campuses (33 campus-years). Hold-out mean absolute error was 0.010 PUE, against 0.014 for the uncalibrated model. The largest error is Singapore (+0.038), the only tropical campus, so tropical PUE is likely slightly overestimated.
- **IT-energy model.** It predicts 29.4 million H100-hours for Llama 3.1 405B (3.8 × 10²⁵ FLOP) against the 30.84 million Meta disclosed (−5%). Recomputed at Meta's reporting boundary, emissions are 9,172 t against the 8,930 t disclosed.

## Scope and limits

- Defaults represent efficient hyperscale facilities (calibration campuses report PUE 1.07–1.15). Typical enterprise data centres have higher overhead. Adjust `f_elec` and `f_air` through `overrides` if you model one.
- Grid intensity is national, annual and life-cycle. It is not hourly, marginal or market-based.
- Operational emissions only. Embodied hardware emissions and off-site water in electricity generation are not included.
- Weather comes from a reanalysis grid (about 0.25°) and does not capture site microclimate.

## Web app (Vercel)

The repository deploys as-is:

- `index.html` is a static front end.
- `api/footprint.py` is a Python serverless function (NumPy only).
- `vercel.json` bundles the package into the function and allows up to 60 s per request.

Steps:

1. Push the repository to GitHub.
2. In Vercel, choose Add New → Project and import the repository. Keep the default settings (no framework, no build command).
3. Deploy. The page is served at `/` and the API at `/api/footprint`.

Local preview: `npm i -g vercel`, then `vercel dev`.

Web limits (set in `api/footprint.py`): up to 6 locations, 3 years and 800 draws per request. A full request takes about 3–4 s of computation plus one weather download per location.

API:

    GET  /api/footprint?countries=1
    POST /api/footprint
         {"flop": 1e25, "arch": "evaporative", "years": [2024], "diesel_share": 0,
          "locations": ["Oslo", {"name": "Nairobi", "lat": -1.29, "lon": 36.82, "country": "Kenya"}]}

## Citing

Please cite the software (see `CITATION.cff`) and the accompanying study:

Adekunle A. Siting large AI training runs: a calibrated, hour-resolved assessment of how grid, climate and cooling shape carbon and water footprints across six global locations. (in review)

## Data licences

Weather: Open-Meteo (CC BY 4.0), ERA5 (Copernicus). Grid intensity: Ember via Our World in Data (CC BY 4.0). The bundled grid file records its retrieval date.
