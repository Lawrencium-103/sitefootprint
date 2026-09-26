"""
Default parameters of the SiteFootprint model.

Every value is taken from the accompanying study (Adekunle et al., in review), where
the facility model was calibrated against published PUE of 7 Google campuses and tested
on 7 hold-out campuses (hold-out MAE 0.010), and the IT-energy model was validated
against Meta's disclosed Llama 3.1 405B training (-5% on H100-hours).

Each entry: (min, mode, max, unit, source). Distributions are triangular.
"""

PARAMS = {
    # IT energy
    "mfu": (0.30, 0.40, 0.50, "-",
            "Model FLOP utilisation; Llama 3 405B 38-43% (Dubey et al. 2024), PaLM 46.2% (Chowdhery et al. 2023)"),
    "p_it_per_gpu_kw": (0.85, 1.05, 1.30, "kW",
            "Average IT power per accelerator incl. host, fabric, storage share; H100 TDP 0.70 kW, DGX H100 10.2 kW / 8"),
    "overhead_wallclock": (1.00, 1.08, 1.20, "-",
            "Checkpointing, restarts, evaluation; Llama 3 reports >90% effective training time"),
    # Facility (f_elec and t_chw modes calibrated in the accompanying study)
    "f_elec": (0.02, 0.040, 0.07, "kW/kW_IT",
            "UPS, distribution and lighting losses; mode calibrated to Google campus PUE"),
    "f_air": (0.01, 0.02, 0.04, "kW/kW_IT", "Air-handler fan power"),
    "t_chw": (20.6, 24.6, 25.0, "degC",
            "Chilled-water supply temperature; mode calibrated to Google campus PUE"),
    "a_tower": (3.0, 4.0, 6.0, "K", "Cooling-tower approach to wet-bulb"),
    "a_dry": (6.0, 8.0, 12.0, "K", "Dry-cooler approach to dry-bulb"),
    "eta_carnot": (0.45, 0.55, 0.65, "-", "Chiller second-law efficiency (fraction of Carnot COP)"),
    "e_pump_tower": (0.010, 0.015, 0.030, "kW/kW_heat", "Condenser pumps and tower fans"),
    "e_dry_fan": (0.010, 0.020, 0.040, "kW/kW_heat", "Dry-cooler fans"),
    "cycles_conc": (3.0, 5.0, 8.0, "-", "Cooling-tower cycles of concentration"),
    "phi_liquid": (0.70, 0.80, 0.90, "-", "Share of IT heat captured by direct-to-chip cold plates"),
    "t_liquid": (30.0, 35.0, 40.0, "degC", "Warm-water loop supply, ASHRAE W32-W40"),
    # Grid and backup
    "grid_rel_err": (-0.10, 0.0, 0.10, "-", "Relative uncertainty of Ember annual intensity"),
    "eta_diesel": (0.30, 0.35, 0.40, "-", "Diesel genset efficiency; with IPCC 2006 default 74.1 tCO2/TJ"),
}

CONST = {
    "h_fg_MJ_per_kg": 2.43,
    "latent_fraction": 0.90,
    "diesel_tco2_per_TJ": 74.1,
    "a_hx": 2.0,
    "econ_band": 4.0,
    "evap_lift": 3.0,
    "cond_lift_tower": 6.0,
    "cond_lift_air": 12.0,
    "cop_max": 12.0,
}

F_PEAK_FLOPS = 989.4e12  # H100 SXM dense BF16

ARCHITECTURES = {
    "evaporative": "Air cooling + hybrid cooling tower",
    "dry": "Air cooling + dry cooler / air-cooled chiller",
    "dtc_dry": "Direct-to-chip liquid + dry cooler",
}

# Reference locations used in the accompanying study
REFERENCE_SITES = {
    "Oslo": (59.91, 10.75, "Norway"),
    "Paris": (48.86, 2.35, "France"),
    "Ashburn": (39.04, -77.49, "United States"),
    "Beijing": (39.90, 116.40, "China"),
    "Marrakech": (31.63, -8.01, "Morocco"),
    "Lagos": (6.52, 3.38, "Nigeria"),
}

VALIDITY_NOTE = (
    "Facility parameters are calibrated on efficient hyperscale campuses (reported PUE 1.07-1.15). "
    "Estimates represent best-practice facilities; older or smaller data centres typically have higher overhead."
)


def central():
    return {k: v[1] for k, v in PARAMS.items()}
