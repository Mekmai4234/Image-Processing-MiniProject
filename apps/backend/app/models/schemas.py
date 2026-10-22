import math
from typing import Any, Dict, List, Literal, Optional
from pydantic import BaseModel, Field, field_validator


class EvidenceInput(BaseModel):
    kind: Literal["single_view", "multi_view"] = "single_view"
    search_status: Literal["not_requested", "usable_view_found", "exhausted", "timed_out"] = "not_requested"
    supporting_angles_deg: List[Optional[float]] = Field(default_factory=list)
    reported_coverage_deg: Optional[float] = None

    @field_validator("reported_coverage_deg")
    @classmethod
    def validate_coverage(cls, v: Optional[float]) -> Optional[float]:
        if v is not None:
            if not math.isfinite(v) or v < 0.0 or v > 360.0:
                raise ValueError("reported_coverage_deg must be a finite number between 0 and 360")
        return v

    @field_validator("supporting_angles_deg")
    @classmethod
    def validate_angles(cls, angles: List[Optional[float]]) -> List[Optional[float]]:
        for idx, a in enumerate(angles):
            if a is not None:
                if not math.isfinite(a) or a < 0.0 or a >= 360.0:
                    raise ValueError(f"supporting angle at index {idx} must be a finite number in range 0 <= angle < 360")
        return angles


class HealthResponse(BaseModel):
    status: str = Field(..., description="Service health status", examples=["ok"])
    config_version: str = Field(..., description="Configuration and contract version", examples=["v0.2"])
    timezone: str = Field(..., description="Server configured application timezone", examples=["Asia/Bangkok"])
    storage_root_ready: bool = Field(..., description="Storage directory accessibility status", examples=[True])
    detector_ready: bool = Field(False, description="Detector operational readiness for real inspections", examples=[True])
    detector_status: str = Field("ready", description="Detector readiness category (ready, demo_only, unavailable)", examples=["ready"])
    readiness_reason: Optional[str] = Field(None, description="Explanation if detector is not fully ready for production")
    detector_reason: Optional[str] = Field(None, description="Explanation if detector is not fully ready for production (for UI readiness indicator)")


class ProductItem(BaseModel):
    product_id: str = Field(..., description="Unique product identifier (e.g. bottle_a)")
    display_name: str = Field(..., description="Display name for UI")
    brand: Optional[str] = Field(None, description="Brand name if confirmed")
    size_ml: Optional[int] = Field(None, description="Volume size in ml")
    reference_paths: List[str] = Field(default_factory=list, description="Reference asset paths")
    validated: bool = Field(False, description="Whether product profile has been validated")


class SimulationDefaults(BaseModel):
    max_rotation_deg: int = Field(360, description="Maximum rotation angle in degrees")
    rotation_step_deg: int = Field(30, description="Step angle per rotation tick")


class ProductsResponse(BaseModel):
    config_version: str = Field(..., description="Catalog version")
    products: List[ProductItem] = Field(..., description="List of supported products")
    simulation_defaults: SimulationDefaults = Field(..., description="Default rotation settings for simulation")


class BBox(BaseModel):
    x: int = Field(..., description="Top-left X coordinate in pixels")
    y: int = Field(..., description="Top-left Y coordinate in pixels")
    width: int = Field(..., description="Bounding box width in pixels")
    height: int = Field(..., description="Bounding box height in pixels")


class QualityInfo(BaseModel):
    sharp_enough: bool = Field(..., description="Laplacian blur variance check")
    label_visible: bool = Field(..., description="Label candidate detected")
    bottle_visible: bool = Field(..., description="Bottle silhouette detected")


class LocateResponse(BaseModel):
    usable_view: bool = Field(..., description="Whether this frame is clear and suitable for inspection")
    bbox: Optional[BBox] = Field(None, description="Detected label candidate bounding box")
    image_width: int = Field(..., description="Frame pixel width after EXIF normalization")
    image_height: int = Field(..., description="Frame pixel height after EXIF normalization")
    quality: QualityInfo = Field(..., description="Frame visual quality scores")
    reason: str = Field(..., description="Locator rationale (usable_view, blurred_image, etc.)")


class RadialProfilePoint(BaseModel):
    y_fraction: float = Field(..., description="Normalized position along bottle height: 0.0 at top, 1.0 at bottom")
    radius_over_height: float = Field(..., description="Half-width of silhouette at this row divided by bbox height")


class ShapeQuality(BaseModel):
    whole_bottle_visible: bool = Field(False, description="Whether whole upright bottle is visible within frame")
    center_drift: Optional[float] = Field(None, description="Max deviation of row centers from vertical axis divided by bbox width")
    axisymmetric_assumption: bool = Field(True, description="Whether axisymmetric revolution assumption is applied")


class BottleShapeResponse(BaseModel):
    schema_version: str = Field("bottle-silhouette-v1", description="Silhouette schema version")
    status: str = Field(..., description="ready or fallback")
    reason: str = Field(..., description="Reason code: usable_silhouette, bottle_not_isolated, truncated_or_not_upright, asymmetric_silhouette, etc.")
    image_width: int = Field(..., description="Normalized image width")
    image_height: int = Field(..., description="Normalized image height")
    bbox: Optional[BBox] = Field(None, description="Pixel bounding box of bottle silhouette in full image coordinates")
    normalized_width: Optional[float] = Field(None, description="bbox.width / image_width")
    normalized_height: Optional[float] = Field(None, description="bbox.height / image_height")
    aspect_ratio: Optional[float] = Field(None, description="bbox.width / bbox.height")
    contour: List[List[int]] = Field(default_factory=list, description="Contour pixel coordinates [[x, y], ...]")
    radial_profile: List[RadialProfilePoint] = Field(default_factory=list, description="Profile samples from top (0.0) to bottom (1.0)")
    quality: ShapeQuality = Field(..., description="Geometry and quality gates")


class TimingInfo(BaseModel):
    orientation: float = Field(0.0, description="Orientation evidence evaluation time in ms")
    inspection: float = Field(..., description="Algorithm inspection processing time in ms")
    storage: float = Field(0.0, description="Persistence storage write time in ms")
    total: float = Field(..., description="Total pipeline latency in ms")


class ImageURLs(BaseModel):
    original: Optional[str] = Field(None, description="API URL to retrieve original normalized image")
    annotated: Optional[str] = Field(None, description="API URL to retrieve annotated image with bboxes")


class EvidenceInfo(BaseModel):
    kind: str = Field("single_view", description="single_view or multi_view")
    search_status: str = Field("not_requested", description="not_requested, usable_view_found, exhausted, timed_out")
    supporting_angles_deg: List[Optional[float]] = Field(default_factory=list, description="Angles of supporting images")
    reported_coverage_deg: Optional[float] = Field(None, description="Reported angle coverage reported by client")
    verified_coverage: bool = Field(False, description="Whether coverage is verified by backend profile")
    required_view_profile: Optional[str] = Field(None, description="Profile used to verify coverage")
    supporting_images: List[Optional[str]] = Field(default_factory=list, description="API URLs of supporting images")


class StorageErrorInfo(BaseModel):
    code: str = Field(..., description="Storage error code")
    message: str = Field(..., description="Storage error message")
    retryable: bool = Field(True, description="Whether storage can be retried without recapture")


class InspectionResult(BaseModel):
    inspection_id: str = Field(..., description="Unique inspection UUID")
    client_request_id: str = Field(..., description="Client idempotency UUID")
    created_at: str = Field(..., description="UTC ISO-8601 timestamp")
    source_mode: str = Field(..., description="simulation or webcam")
    expected_product: str = Field(..., description="Product ID expected")
    detected_product: Optional[str] = Field(None, description="Product ID detected by model")
    result: str = Field(..., description="Decision verdict: PASS, FAIL, or REVIEW")
    reason: str = Field(..., description="Decision rationale")
    match_score: Optional[float] = Field(None, description="Template match similarity score [0..1]")
    score_method: Optional[str] = Field(None, description="Scoring method used")
    bbox: Optional[BBox] = Field(None, description="Detected label bbox")
    expected_bbox: Optional[BBox] = Field(None, description="Expected label bbox")
    image_width: int = Field(..., description="Image pixel width")
    image_height: int = Field(..., description="Image pixel height")
    orientation_deg: Optional[float] = Field(None, description="Bottle orientation angle in degrees")
    timing_ms: TimingInfo = Field(..., description="Timing breakdown in ms")
    config_version: str = Field(..., description="Config/contract version")
    storage_status: str = Field(..., description="pending, saved, or failed")
    storage_error: Optional[StorageErrorInfo] = Field(None, description="Details if storage write failed")
    images: ImageURLs = Field(..., description="Image retrieval URLs")
    evidence: EvidenceInfo = Field(..., description="Multi-view inspection evidence")
    reviewed_result: Optional[str] = Field(None, description="Human reviewer result")
    reviewed_reason: Optional[str] = Field(None, description="Human reviewer reason")
    reviewer: Optional[str] = Field(None, description="Human reviewer name")
    reviewed_at: Optional[str] = Field(None, description="Human review timestamp")
    demo: bool = Field(False, description="Whether this inspection was executed in DEMO mode")
    is_demo: bool = Field(False, description="Alias for demo mode flag")


class InspectionListResponse(BaseModel):
    items: List[InspectionResult] = Field(..., description="List of inspection records")
    total: int = Field(..., description="Total matching records count")
    page: int = Field(..., description="Current page number")
    page_size: int = Field(..., description="Items per page")


class ReviewRequest(BaseModel):
    reviewed_result: str = Field(..., description="Review outcome: PASS, FAIL, or REVIEW")
    reviewed_reason: str = Field(..., description="Human review rationale")
    reviewer: str = Field(..., description="Reviewer name or identifier")


class InspectionFileItem(BaseModel):
    name: str = Field(..., description="File name (e.g. original.jpg, annotated.jpg, result.json, 0.jpg)")
    kind: str = Field(..., description="Logical kind: original, annotated, result_json, or supporting")
    available: bool = Field(..., description="Whether file physically exists on disk")
    size_bytes: Optional[int] = Field(None, description="File size in bytes if available")
    download_url: Optional[str] = Field(None, description="Backend API URL to retrieve this file")


class InspectionFilesResponse(BaseModel):
    inspection_id: str = Field(..., description="Inspection UUID")
    storage_status: str = Field(..., description="Storage status from database (pending, saved, failed)")
    all_available: bool = Field(..., description="True if all required files are intact and available")
    files: List[InspectionFileItem] = Field(default_factory=list, description="List of files belonging to this inspection")
    download_zip_url: Optional[str] = Field(None, description="API URL to download full inspection ZIP bundle")
