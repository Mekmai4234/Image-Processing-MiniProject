"""Separate, versioned silhouette/profile interface for 02; no inspection decision."""
from dataclasses import asdict, dataclass
from math import isfinite

import numpy as np

from .preprocess import prepare_image
from .segmentation import segment_foreground, whole_upright_bottle
from .types import Box, InspectionConfigError


@dataclass(frozen=True)
class ShapeConfig:
    background_distance: float
    max_background_spread: float
    min_bottle_area: float
    max_image_pixels: int = 20_000_000
    profile_samples: int = 32
    max_center_drift: float = 0.1

    @classmethod
    def from_detector(cls, config):
        config.validate()
        return cls(config.background_distance, config.max_background_spread,
                   config.min_bottle_area, config.max_image_pixels)

    def validate(self):
        for key, low, high in (("background_distance", 0, 1_000_000),
                               ("max_background_spread", 0, 1_000_000),
                               ("min_bottle_area", 0.000001, 1),
                               ("max_center_drift", 0, 0.5)):
            value = getattr(self, key)
            if isinstance(value, bool) or not isinstance(value, (float, int)) or not isfinite(value) or not low <= value <= high:
                raise InspectionConfigError(f"invalid shape setting: {key}")
        if type(self.max_image_pixels) is not int or self.max_image_pixels < 1:
            raise InspectionConfigError("max_image_pixels must be positive")
        if type(self.profile_samples) is not int or not 8 <= self.profile_samples <= 256:
            raise InspectionConfigError("profile_samples must be an integer in [8,256]")


@dataclass(frozen=True)
class ShapeResult:
    schema_version: str
    status: str
    reason: str
    image_width: int
    image_height: int
    bbox: Box | None
    normalized_width: float | None
    normalized_height: float | None
    aspect_ratio: float | None
    mask: np.ndarray | None
    contour: tuple[tuple[int, int], ...]
    radial_profile: tuple[dict, ...]
    quality: dict

    def to_dict(self, *, include_mask=False):
        # Copy only small metadata by default, not an entire multi-megapixel mask.
        data = {key: value for key, value in self.__dict__.items() if key != "mask"}
        data["bbox"] = asdict(self.bbox) if self.bbox is not None else None
        data["contour"] = [list(point) for point in self.contour]
        data["radial_profile"] = [dict(row) for row in self.radial_profile]
        data["quality"] = dict(self.quality)
        if include_mask:
            data["mask"] = self.mask.tolist() if self.mask is not None else None
        return data


def analyze_shape(image, config: ShapeConfig, *, color_order):
    config.validate()
    rgb = prepare_image(image, color_order=color_order, max_pixels=config.max_image_pixels)
    height, width = rgb.shape[:2]
    foreground = segment_foreground(rgb, background_distance=config.background_distance,
                                    max_background_spread=config.max_background_spread,
                                    min_area=config.min_bottle_area)

    def fallback(reason, whole_visible=False):
        return ShapeResult("bottle-silhouette-v1", "fallback", reason, width, height,
                           None, None, None, None, None, (), (),
                           {"whole_bottle_visible": whole_visible, "axisymmetric_assumption": True})

    if foreground.reason is not None:
        return fallback(foreground.reason)
    box, mask = foreground.box, foreground.mask
    if not whole_upright_bottle(box, width, height):
        return fallback("truncated_or_not_upright")
    rows = []
    centers = []
    for y in range(box.y, box.y + box.height):
        occupied = np.flatnonzero(mask[y])
        if not occupied.size:
            return fallback("incomplete_silhouette", whole_visible=True)
        # Reject concavities/occlusions with disjoint horizontal foreground spans.
        if occupied[-1] - occupied[0] + 1 != occupied.size:
            return fallback("incomplete_silhouette", whole_visible=True)
        centers.append((int(occupied[0]) + int(occupied[-1])) / 2)
        rows.append((int(occupied[-1]) - int(occupied[0]) + 1) / 2 / box.height)
    axis = float(np.median(centers))
    center_drift = float(np.max(np.abs(np.array(centers) - axis)) / box.width)
    if center_drift > config.max_center_drift:
        return fallback("asymmetric_silhouette", whole_visible=True)
    positions = np.linspace(0, 1, config.profile_samples)
    radii = np.interp(positions, np.linspace(0, 1, len(rows)), rows)
    profile = tuple({"y_fraction": float(y), "radius_over_height": float(r)}
                    for y, r in zip(positions, radii))
    contour = tuple((int(x), int(y)) for x, y in foreground.contour.reshape(-1, 2))
    mask.setflags(write=False)
    return ShapeResult("bottle-silhouette-v1", "ready", "usable_silhouette", width, height,
                       box, box.width / width, box.height / height, box.width / box.height,
                       mask, contour, profile,
                       {"whole_bottle_visible": True, "center_drift": center_drift,
                        "axisymmetric_assumption": True})
