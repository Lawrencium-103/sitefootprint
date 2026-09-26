import numpy as np
import pytest

from sitefootprint import estimate, grid_intensity, countries
from sitefootprint import physics as P
from sitefootprint.params import central, PARAMS


def weather(mean, amp=8.0, rh=70.0, hours=8784):
    h = np.arange(hours)
    t = mean + amp * np.sin(2 * np.pi * h / 8784) + 4 * np.sin(2 * np.pi * h / 24)
    return {"t_db": t, "rh": np.full(hours, rh)}


W = {"Oslo": weather(6), "Lagos": weather(27, amp=1.5, rh=82), "Marrakech": weather(21, rh=45),
     "Ashburn": weather(14), "Paris": weather(12), "Beijing": weather(13, amp=14, rh=55)}


def test_llama_405b_gpu_hours_within_10pct_of_disclosure():
    # Meta Llama 3.1 model card: 30.84 M H100-hours for 3.8e25 FLOP (Dubey et al. 2024)
    gh = P.gpu_hours(3.8e25, central())
    assert abs(gh / 30.84e6 - 1) < 0.10


def test_wet_bulb_below_dry_bulb_and_equal_at_saturation():
    t = np.array([0.0, 20.0, 35.0])
    assert np.all(P.wet_bulb_stull(t, np.array([50, 50, 50])) < t)
    assert np.allclose(P.wet_bulb_stull(t, np.array([99, 99, 99])), t, atol=1.2)


@pytest.mark.parametrize("arch", ["evaporative", "dry", "dtc_dry"])
def test_pue_physical_and_rises_with_heat(arch):
    p = central()
    cold, _ = P.hourly_facility(np.array([0.0]), P.wet_bulb_stull([0.0], [70]), p, arch)
    hot, _ = P.hourly_facility(np.array([38.0]), P.wet_bulb_stull([38.0], [40]), p, arch)
    assert 1.0 < cold[0, 0] < 1.2 and hot[0, 0] > cold[0, 0] and hot[0, 0] < 1.6


def test_dry_architectures_use_no_water():
    for arch in ("dry", "dtc_dry"):
        _, w = P.hourly_facility(np.array([35.0]), np.array([25.0]), central(), arch)
        assert np.all(w == 0)


def test_evaporative_water_in_physical_range():
    _, w = P.hourly_facility(np.array([35.0]), np.array([25.0]), central(), "evaporative")
    assert 1.4 < w[0, 0] < 2.5  # litres per kWh IT when the tower runs


def test_diesel_factor_matches_ipcc_default():
    assert P.diesel_ef_kg_per_kwh(0.35) == pytest.approx(0.762, abs=0.001)


def test_grid_lookup_and_nearest_year():
    no, _ = grid_intensity("Norway", 2024)
    ma, _ = grid_intensity("Morocco", 2024)
    assert no < 0.05 < 0.5 < ma
    _, used = grid_intensity("Norway", 2099)
    assert used <= 2025
    assert "Nigeria" in countries()
    with pytest.raises(KeyError):
        grid_intensity("Atlantis", 2024)


def test_estimate_ranking_and_paired_probabilities():
    r = estimate(list(W), flop=1e25, weather=W, n_draws=200, reference="Ashburn")
    s = {x["name"]: x for x in r["sites"]}
    assert r["ranking"][0] == "Oslo"
    assert s["Oslo"]["prob_lower_than_reference"] == 1.0
    assert s["Marrakech"]["prob_lower_than_reference"] == 0.0
    assert s["Ashburn"]["prob_lower_than_reference"] is None


def test_decomposition_is_exact():
    r = estimate(["Oslo", "Lagos"], flop=1e25, weather=W, n_draws=50)
    lagos = next(x for x in r["sites"] if x["name"] == "Lagos")
    v = lagos["vs_reference"]
    pc = {x["name"]: x["pue"]["central"] for x in r["sites"]}
    ci = {x["name"]: x["grid_g_per_kwh"] for x in r["sites"]}
    assert v["ln_facility"] == pytest.approx(np.log(pc["Lagos"] / pc["Oslo"]), rel=1e-9)
    assert v["ln_grid"] == pytest.approx(np.log(ci["Lagos"] / ci["Oslo"]), rel=1e-3)


def test_gpu_hours_input_scales_linearly():
    a = estimate(["Oslo"], gpu_hours=1e6, weather=W, n_draws=100)
    b = estimate(["Oslo"], gpu_hours=2e6, weather=W, n_draws=100)
    assert b["sites"][0]["co2_t"]["median"] == pytest.approx(2 * a["sites"][0]["co2_t"]["median"], rel=1e-9)


def test_diesel_increases_emissions():
    a = estimate(["Lagos"], flop=1e25, weather=W, n_draws=100)
    b = estimate(["Lagos"], flop=1e25, weather=W, n_draws=100, diesel_share=0.25)
    assert b["sites"][0]["co2_t"]["median"] > a["sites"][0]["co2_t"]["median"]


def test_input_validation():
    with pytest.raises(ValueError):
        estimate(["Oslo"], weather=W)
    with pytest.raises(ValueError):
        estimate(["Oslo"], flop=1e25, gpu_hours=1, weather=W)
    with pytest.raises(KeyError):
        estimate(["Atlantis"], flop=1e25, weather=W)


def test_all_parameter_ranges_are_ordered():
    for k, (lo, mode, hi, *_rest) in PARAMS.items():
        assert lo <= mode <= hi, k


def test_rich_outputs_for_web_app():
    r = estimate(["Oslo", "Lagos", "Marrakech"], flop=1e25, weather=W, n_draws=120)
    s = r["sites"][1]
    assert len(s["monthly"]["pue"]) == 12 and all(v is not None for v in s["monthly"]["pue"])
    assert set(s["architectures"]) == {"evaporative", "dry", "dtc_dry"}
    assert s["architectures"]["dry"]["water_m3"] == 0
    assert sum(s["co2_hist"]) == 120
    m = r["pairwise_prob_lower"]["matrix"]
    assert m[0][1] == 1.0 and m[1][0] == 0.0 and m[0][0] is None
    # central CO2 reproduces E_IT x PUE x CI
    c = s["central"]
    assert c["co2_t"] == pytest.approx(r["central"]["it_energy_kwh"] * c["pue"] * c["ci_eff_kg_per_kwh"] / 1000)
