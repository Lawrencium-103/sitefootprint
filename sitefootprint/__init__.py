"""SiteFootprint: location-resolved carbon and water footprints of AI training."""
__version__ = "0.1.0"

from .model import estimate, draw_parameters  # noqa: E402,F401
from .data import countries, grid_intensity, fetch_weather  # noqa: E402,F401
from .params import PARAMS, REFERENCE_SITES, ARCHITECTURES  # noqa: E402,F401
