"""Internal contracts for 03. The HTTP adapter adds IDs, URLs and storage data."""
from dataclasses import asdict, dataclass, field
from typing import Literal

import numpy as np


class InspectionInputError(ValueError):
    """Invalid pixels/metadata; adapter must handle this as an operational error."""


class InspectionConfigError(ValueError):
    """Missing or invalid detector configuration, not a product defect."""


@dataclass(frozen=True)
class Box:
    x: int
    y: int
    width: int
    height: int


@dataclass(frozen=True)
class LocatorResult:
    usable_view: bool
    bbox: Box | None
    image_width: int
    image_height: int
    quality: dict[str, bool]
    reason: str

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass(frozen=True)
class Evidence:
    """Client metadata is descriptive only; it never verifies pixel coverage."""

    kind: Literal["single_view", "multi_view"] = "single_view"
    search_status: str = "not_requested"
    supporting_angles_deg: tuple[float | None, ...] = ()
    reported_coverage_deg: float | None = None


@dataclass(frozen=True)
class Decision:
    result: str
    reason: str
    expected_product: str
    detected_product: str | None
    match_score: float | None
    score_method: str | None
    bbox: Box | None
    expected_bbox: Box | None
    image_width: int
    image_height: int
    orientation_deg: float | None
    config_version: str
    source_mode: str
    # No storage/total timings: these cannot be measured by a pure detector.
    timing_ms: dict[str, float]
    evidence_assessment: dict
    diagnostics: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass(frozen=True)
class Match:
    detected_product: str | None
    score: float | None
    reason: str
    raw_scores: dict[str, float | None]


@dataclass(frozen=True)
class Analysis:
    rgb: np.ndarray
    bottle: Box | None
    candidates: tuple[Box, ...]
    sharp_enough: bool
    blur_score: float
    bottle_visible: bool
    diagnostic: str | None = None
