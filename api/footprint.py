"""Vercel serverless function.

GET  /api/footprint?countries=1      -> list of countries
GET  /api/footprint?references=1     -> reference sites
POST /api/footprint  JSON body       -> estimate(); see README for the schema
"""
import json
import os
import sys
from http.server import BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from sitefootprint import estimate, countries, REFERENCE_SITES  # noqa: E402

MAX_LOCATIONS = 6
MAX_YEARS = 3
MAX_DRAWS = 800


def compute(body):
    locs = body.get("locations") or []
    if not 1 <= len(locs) <= MAX_LOCATIONS:
        raise ValueError(f"Give between 1 and {MAX_LOCATIONS} locations")
    years = body.get("years") or [2024]
    if len(years) > MAX_YEARS or any(not 2010 <= int(y) <= 2025 for y in years):
        raise ValueError(f"Choose up to {MAX_YEARS} years between 2010 and 2025")
    kw = dict(arch=body.get("arch", "evaporative"), years=years,
              diesel_share=body.get("diesel_share", 0.0),
              n_draws=min(int(body.get("n_draws", 400)), MAX_DRAWS),
              reference=body.get("reference"))
    if body.get("gpu_hours"):
        kw["gpu_hours"] = float(body["gpu_hours"])
    else:
        kw["flop"] = float(body.get("flop", 1e25))
    return estimate(locs, **kw)


class handler(BaseHTTPRequestHandler):
    def _send(self, code, obj):
        data = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        q = parse_qs(urlparse(self.path).query)
        if "countries" in q:
            return self._send(200, {"countries": countries()})
        return self._send(200, {"references": {k: {"lat": v[0], "lon": v[1], "country": v[2]}
                                               for k, v in REFERENCE_SITES.items()}})

    def do_POST(self):
        try:
            n = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(n) or b"{}")
            self._send(200, compute(body))
        except (ValueError, KeyError) as e:
            self._send(400, {"error": str(e)})
        except RuntimeError as e:
            self._send(502, {"error": str(e)})
        except Exception as e:  # pragma: no cover
            self._send(500, {"error": f"Unexpected error: {e}"})
