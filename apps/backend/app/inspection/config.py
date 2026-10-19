"""Explicit, in-memory configuration. No filesystem, env loader or real catalog."""
from dataclasses import dataclass
from math import isfinite

import numpy as np

from .types import InspectionConfigError


def _range(value, low, high, name):
    if (isinstance(value, bool) or not isinstance(value, (int, float))
            or not isfinite(value) or not low <= value <= high):
        raise InspectionConfigError(f"{name} must be finite in [{low}, {high}]")


@dataclass(frozen=True)
class PositionRules:
    # Normalized x/y/width/height relative to the entire visible bottle.
    expected_roi: tuple[float, float, float, float]
    center_tolerance: tuple[float, float]
    size_tolerance: tuple[float, float]
    max_tilt_deg: float

    def validate(self):
        if not isinstance(self.expected_roi, (tuple, list)) or len(self.expected_roi) != 4:
            raise InspectionConfigError("expected_roi needs x/y/width/height")
        for value in self.expected_roi:
            _range(value, 0, 1, "expected_roi")
        x, y, w, h = self.expected_roi
        if w <= 0 or h <= 0 or x + w > 1 or y + h > 1:
            raise InspectionConfigError("expected_roi must fit inside bottle ROI")
        for name, values in (("center_tolerance", self.center_tolerance),
                             ("size_tolerance", self.size_tolerance)):
            if not isinstance(values, (tuple, list)) or len(values) != 2:
                raise InspectionConfigError(f"{name} needs two values")
            for value in values:
                _range(value, 0, 1, name)
        _range(self.max_tilt_deg, 0, 45, "max_tilt_deg")


@dataclass(frozen=True)
class ProductConfig:
    product_id: str
    # RGB uint8 label crops supplied by the caller, selected from development.
    templates: tuple[np.ndarray, ...]
    position: PositionRules


@dataclass(frozen=True)
class DetectorConfig:
    config_version: str
    products: tuple[ProductConfig, ...]
    # No universal defaults for decision thresholds; tune on validation data.
    min_sharpness: float
    min_match_score: float
    min_match_margin: float
    background_distance: float
    max_background_spread: float
    label_contrast: float
    min_bottle_area: float
    label_width_range: tuple[float, float]
    label_height_range: tuple[float, float]
    max_image_pixels: int = 20_000_000
    max_total_pixels: int = 40_000_000
    max_views: int = 12
    match_size: tuple[int, int] = (96, 64)
    min_pattern_std: float = 1.0
    validated: bool = False
    validation_reference: str | None = None

    def validate(self):
        if not isinstance(self.config_version, str) or not self.config_version.strip():
            raise InspectionConfigError("config_version is required")
        # Validate limits before using them to validate template dimensions.
        for name in ("max_image_pixels", "max_total_pixels", "max_views"):
            if type(getattr(self, name)) is not int or getattr(self, name) < 1:
                raise InspectionConfigError(f"{name} must be a positive integer")
        if not isinstance(self.products, (tuple, list)) or not self.products:
            raise InspectionConfigError("a real catalog and templates must be supplied")
        identifiers = set()
        for product in self.products:
            if not isinstance(product, ProductConfig):
                raise InspectionConfigError("products must contain ProductConfig")
            if not isinstance(product.product_id, str) or not product.product_id.strip():
                raise InspectionConfigError("product_id is required")
            if product.product_id in identifiers:
                raise InspectionConfigError("duplicate product_id")
            identifiers.add(product.product_id)
            if not isinstance(product.position, PositionRules):
                raise InspectionConfigError("position must be PositionRules")
            product.position.validate()
            if not isinstance(product.templates, (tuple, list)) or not product.templates:
                raise InspectionConfigError(f"no templates for {product.product_id}")
            for template in product.templates:
                if (not isinstance(template, np.ndarray) or template.dtype != np.uint8
                        or template.ndim != 3 or template.shape[2] != 3
                        or min(template.shape[:2]) < 2
                        or template.shape[0] * template.shape[1] > self.max_image_pixels):
                    raise InspectionConfigError("templates must be RGB uint8 HxWx3 images within limits")
        for name in ("min_sharpness", "background_distance", "max_background_spread",
                     "label_contrast", "min_pattern_std"):
            _range(getattr(self, name), 0, 1_000_000, name)
        for name in ("min_match_score", "min_match_margin", "min_bottle_area"):
            _range(getattr(self, name), 0, 1, name)
        for name in ("label_width_range", "label_height_range"):
            values = getattr(self, name)
            if not isinstance(values, (tuple, list)) or len(values) != 2:
                raise InspectionConfigError(f"{name} needs min/max")
            for value in values:
                _range(value, 0, 1, name)
            if not 0 < values[0] < values[1] < 1:
                raise InspectionConfigError(f"{name} must satisfy 0 < min < max < 1")
        if (not isinstance(self.match_size, (tuple, list)) or len(self.match_size) != 2
                or any(type(v) is not int or v < 2 for v in self.match_size)):
            raise InspectionConfigError("match_size needs two integers >= 2")
        if self.match_size[0] * self.match_size[1] > self.max_image_pixels:
            raise InspectionConfigError("match_size exceeds pixel limit")
        for name in ("min_sharpness", "min_match_score", "min_bottle_area", "min_pattern_std"):
            if getattr(self, name) <= 0:
                raise InspectionConfigError(f"{name} must be greater than zero")
        if type(self.validated) is not bool:
            raise InspectionConfigError("validated must be boolean")
        if self.validated and (not isinstance(self.validation_reference, str)
                               or not self.validation_reference.strip()):
            raise InspectionConfigError("validated config needs a validation report reference")
