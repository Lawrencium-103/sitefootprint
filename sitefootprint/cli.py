"""Command-line interface.

    sitefootprint estimate --flop 1e25 --site Oslo --site Lagos
    sitefootprint estimate --gpu-hours 2e6 --loc "Nairobi,-1.29,36.82,Kenya" --arch dtc_dry --years 2023 2024
    sitefootprint countries
    sitefootprint site --runs runs.csv --cap 0.3 --flop-col flop       (needs scipy)
"""
import argparse
import csv
import json
import sys

from . import estimate, countries, REFERENCE_SITES


def _loc(s):
    name, lat, lon, country = [x.strip() for x in s.split(",", 3)]
    return {"name": name, "lat": float(lat), "lon": float(lon), "country": country}


def _print(r):
    print(f"\nSiteFootprint {r['version']}  |  {r['inputs']['arch_label']}  |  years {r['inputs']['years']}")
    e = r["it_energy_kwh"]
    print(f"IT energy: {e['median'] / 1e6:.2f} GWh (95%: {e['lo'] / 1e6:.2f}-{e['hi'] / 1e6:.2f})\n")
    print(f"{'Location':<16}{'Grid g/kWh':>11}{'PUE':>8}{'tCO2e':>10}{'95% range':>20}{'Water m3':>11}{'P<ref':>7}")
    for s in sorted(r["sites"], key=lambda s: s["co2_t"]["median"]):
        c = s["co2_t"]
        p = "ref" if s["prob_lower_than_reference"] is None else f"{s['prob_lower_than_reference']:.2f}"
        print(f"{s['name']:<16}{s['grid_g_per_kwh']:>11.0f}{s['pue']['median']:>8.3f}{c['median']:>10,.0f}"
              f"{c['lo']:>10,.0f}-{c['hi']:<9,.0f}{s['water_m3']['median']:>11,.0f}{p:>7}")
    print(f"\nNote: {r['validity_note']}")


def main(argv=None):
    ap = argparse.ArgumentParser(prog="sitefootprint")
    sub = ap.add_subparsers(dest="cmd", required=True)
    e = sub.add_parser("estimate", help="footprint of one training run at one or more locations")
    g = e.add_mutually_exclusive_group(required=True)
    g.add_argument("--flop", type=float)
    g.add_argument("--gpu-hours", type=float)
    e.add_argument("--site", action="append", default=[], help=f"reference site: {', '.join(REFERENCE_SITES)}")
    e.add_argument("--loc", action="append", default=[], type=_loc, help='"name,lat,lon,country"')
    e.add_argument("--arch", default="evaporative", choices=["evaporative", "dry", "dtc_dry"])
    e.add_argument("--years", nargs="+", type=int, default=[2024])
    e.add_argument("--diesel", type=float, default=0.0, help="share of facility energy from diesel (0-1)")
    e.add_argument("--draws", type=int, default=500)
    e.add_argument("--json", action="store_true", help="print full JSON")
    sub.add_parser("countries", help="list country names accepted for grid intensity")
    s = sub.add_parser("site", help="capacity-constrained siting of a cohort (needs scipy)")
    s.add_argument("--runs", required=True, help="CSV with one run per row")
    s.add_argument("--flop-col", default="flop")
    s.add_argument("--cap", type=float, required=True, help="max share of cohort IT energy per site (0-1)")
    s.add_argument("--arch", default="evaporative", choices=["evaporative", "dry", "dtc_dry"])
    s.add_argument("--years", nargs="+", type=int, default=[2024])
    a = ap.parse_args(argv)

    if a.cmd == "countries":
        print("\n".join(countries())); return 0
    if a.cmd == "estimate":
        locs = a.site + a.loc
        if not locs:
            ap.error("give at least one --site or --loc")
        r = estimate(locs, flop=a.flop, gpu_hours=a.gpu_hours, arch=a.arch, years=a.years,
                     diesel_share=a.diesel, n_draws=a.draws)
        print(json.dumps(r, indent=2)) if a.json else _print(r)
        return 0
    if a.cmd == "site":
        from .siting import optimise
        with open(a.runs, newline="") as f:
            flops = [float(row[a.flop_col]) for row in csv.DictReader(f)]
        names = list(REFERENCE_SITES)
        r = estimate(names, flop=1e25, arch=a.arch, years=a.years)
        per_kwh = [s["co2_t"]["median"] / r["it_energy_kwh"]["median"] for s in r["sites"]]
        e_fu = r["it_energy_kwh"]["median"]
        res = optimise([f / 1e25 * e_fu for f in flops], per_kwh, a.cap, names=names)
        print(json.dumps(res, indent=2)); return 0


if __name__ == "__main__":
    sys.exit(main())
