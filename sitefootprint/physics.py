"""
Physical model (NumPy only).

Climate arrays have shape (H,); parameters may be scalars or arrays of shape (n,),
giving outputs of shape (n, H). Energies are per kW of IT load.
"""
import numpy as np
from .params import CONST, F_PEAK_FLOPS

K0 = 273.15


def wet_bulb_stull(t_db, rh_pct):
    """Wet-bulb temperature (degC), Stull (2011). RH clipped to 5-99 %."""
    rh = np.clip(np.asarray(rh_pct, dtype=float), 5.0, 99.0)
    t = np.asarray(t_db, dtype=float)
    return (t * np.arctan(0.151977 * np.sqrt(rh + 8.313659))
            + np.arctan(t + rh) - np.arctan(rh - 1.676331)
            + 0.00391838 * rh ** 1.5 * np.arctan(0.023101 * rh) - 4.686035)


def _cop(t_evap_c, t_cond_c, eta):
    lift = np.maximum(t_cond_c - t_evap_c, 1.0)
    return np.minimum(CONST["cop_max"], eta * (t_evap_c + K0) / lift)


def _mech_fraction(t_source_out, t_supply):
    return np.clip((t_source_out - (t_supply - CONST["a_hx"])) / CONST["econ_band"], 0.0, 1.0)


def _tower_l_per_kwh_heat(cycles):
    evap = 3.6 / CONST["h_fg_MJ_per_kg"] * CONST["latent_fraction"]
    return evap * cycles / (cycles - 1.0)


def hourly_facility(t_db, t_wb, p, arch):
    """Hourly PUE and on-site water (L per kWh IT) for one cooling architecture."""
    t_db = np.asarray(t_db, dtype=float)[None, :]
    t_wb = np.asarray(t_wb, dtype=float)[None, :]
    g = {k: (np.asarray(v, dtype=float).reshape(-1, 1) if np.ndim(v) else float(v)) for k, v in p.items()}
    f_el, f_air = g["f_elec"], g["f_air"]

    if arch in ("evaporative", "dry"):
        q = 1.0 + f_el + f_air
        x_dry = _mech_fraction(t_db + g["a_dry"], g["t_chw"])
        if arch == "dry":
            cop = _cop(g["t_chw"] - CONST["evap_lift"], t_db + CONST["cond_lift_air"], g["eta_carnot"])
            p_cool = q * g["e_dry_fan"] + x_dry * q / cop
            water = np.zeros(np.broadcast(p_cool, t_db).shape)
        else:
            dry_ok = x_dry <= 0.0
            t_tw = t_wb + g["a_tower"]
            x_ch = _mech_fraction(t_tw, g["t_chw"])
            cop = _cop(g["t_chw"] - CONST["evap_lift"], t_tw + CONST["cond_lift_tower"], g["eta_carnot"])
            p_cool = np.where(dry_ok, q * g["e_dry_fan"], q * g["e_pump_tower"] + x_ch * q / cop)
            water = np.where(dry_ok, 0.0, q * (1.0 + x_ch / cop) * _tower_l_per_kwh_heat(g["cycles_conc"]))
        pue = 1.0 + f_el + f_air + p_cool
        return pue, np.broadcast_to(water, pue.shape)

    if arch == "dtc_dry":
        phi = g["phi_liquid"]
        f_air_eff = f_air * (1.0 - phi)
        q_air = (1.0 - phi) + f_el + f_air_eff
        x_l = _mech_fraction(t_db + g["a_dry"], g["t_liquid"])
        cop_l = _cop(g["t_liquid"] - CONST["evap_lift"], t_db + CONST["cond_lift_air"], g["eta_carnot"])
        p_liq = phi * (g["e_dry_fan"] + g["e_pump_tower"]) + x_l * phi / cop_l
        x_a = _mech_fraction(t_db + g["a_dry"], g["t_chw"])
        cop_a = _cop(g["t_chw"] - CONST["evap_lift"], t_db + CONST["cond_lift_air"], g["eta_carnot"])
        p_air = q_air * g["e_dry_fan"] + x_a * q_air / cop_a
        pue = 1.0 + f_el + f_air_eff + p_liq + p_air
        return pue, np.zeros_like(pue)

    raise ValueError(f"unknown architecture: {arch}")


def gpu_hours(flop, p, peak_flops=F_PEAK_FLOPS):
    return flop / (np.asarray(p["mfu"]) * peak_flops) * np.asarray(p["overhead_wallclock"]) / 3600.0


def diesel_ef_kg_per_kwh(eta):
    return CONST["diesel_tco2_per_TJ"] * 1e-3 * 3.6 / np.asarray(eta)


def effective_ci(ci_grid_kg, p, diesel_share=0.0):
    grid = np.asarray(ci_grid_kg) * (1.0 + np.asarray(p["grid_rel_err"]))
    return (1.0 - diesel_share) * grid + diesel_share * diesel_ef_kg_per_kwh(p["eta_diesel"])
