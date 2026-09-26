"""
Capacity-constrained siting (requires SciPy >= 1.9: pip install sitefootprint[siting]).

Assign indivisible training runs to locations to minimise total CO2, with each location
able to host at most `cap_share` of the cohort's IT energy (energy-based capacity).
"""
import numpy as np


def optimise(run_energy_kwh, co2_per_kwh_it, cap_share, names=None, time_limit=20, mip_rel_gap=1e-3):
    try:
        from scipy.optimize import milp, LinearConstraint, Bounds
        from scipy.sparse import lil_matrix
    except ImportError as e:  # pragma: no cover
        raise ImportError("Siting needs SciPy: pip install 'sitefootprint[siting]'") from e
    e = np.asarray(run_energy_kwh, dtype=float)
    c = np.asarray(co2_per_kwh_it, dtype=float)  # tCO2 per kWh IT, one per site
    R, S = len(e), len(c)
    K = cap_share * e.sum()
    if e.max() > K:
        return {"feasible": False, "reason": "largest run exceeds per-site capacity"}
    A = lil_matrix((R + S, R * S))
    lb = np.zeros(R + S); ub = np.zeros(R + S)
    for r in range(R):
        A[r, r * S:(r + 1) * S] = 1; lb[r] = ub[r] = 1
    for s in range(S):
        for r in range(R):
            A[R + s, r * S + s] = e[r]
        ub[R + s] = K
    cost = np.outer(e, c).ravel()
    res = milp(cost, constraints=LinearConstraint(A.tocsr(), lb, ub), integrality=np.ones(R * S),
               bounds=Bounds(0, 1), options={"time_limit": time_limit, "mip_rel_gap": mip_rel_gap})
    if res.x is None:
        return {"feasible": False, "reason": res.message}
    x = np.round(res.x).reshape(R, S)
    choice = x.argmax(axis=1)
    names = names or [f"site{i}" for i in range(S)]
    share = {names[s]: float(e[choice == s].sum() / e.sum()) for s in range(S)}
    return {"feasible": True, "co2_t": float((cost * x.ravel()).sum()), "assignment": [names[i] for i in choice],
            "energy_share": share, "mip_gap": float(getattr(res, "mip_gap", 0.0) or 0.0)}
