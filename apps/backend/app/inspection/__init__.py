"""03 public API: in-memory RGB/BGR images, explicit config, no HTTP or storage."""
from .annotate import annotate_image, annotate_fields, format_match_text
from .config_document import (build_detector_config, catalog_fingerprint,
                              config_fingerprint, rgb_fingerprint)
from .shape import ShapeConfig, ShapeResult, analyze_shape
from .config import DetectorConfig, PositionRules, ProductConfig
from .locate import locate_label
from .pipeline import inspect_image
from .types import (Box, Decision, Evidence, InspectionConfigError,
                    InspectionInputError, LocatorResult)

__all__ = ["annotate_image", "annotate_fields", "format_match_text",
           "build_detector_config", "catalog_fingerprint", "config_fingerprint", "rgb_fingerprint",
           "ShapeConfig", "ShapeResult", "analyze_shape",
           "DetectorConfig", "PositionRules", "ProductConfig",
           "locate_label", "inspect_image", "Box", "Decision", "Evidence",
           "InspectionConfigError", "InspectionInputError", "LocatorResult"]
