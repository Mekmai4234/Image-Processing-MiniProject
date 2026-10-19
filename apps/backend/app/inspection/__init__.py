"""03 public API: in-memory RGB/BGR images, explicit config, no HTTP or storage."""
from .annotate import annotate_image
from .config import DetectorConfig, PositionRules, ProductConfig
from .locate import locate_label
from .pipeline import inspect_image
from .types import (Box, Decision, Evidence, InspectionConfigError,
                    InspectionInputError, LocatorResult)

__all__ = ["annotate_image", "DetectorConfig", "PositionRules", "ProductConfig",
           "locate_label", "inspect_image", "Box", "Decision", "Evidence",
           "InspectionConfigError", "InspectionInputError", "LocatorResult"]
