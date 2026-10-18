"""Pure detector orchestration, with conservative multi-view handling."""
from math import isfinite
from time import perf_counter

import numpy as np

from .classify import SCORE_METHOD, compare_templates
from .config import DetectorConfig
from .locate import analyze, locator_result
from .position import check_position, expected_box, label_geometry
from .preprocess import prepare_image
from .types import Decision, Evidence, InspectionInputError


def _angle(value):
    return value is None or (not isinstance(value, bool) and isinstance(value, (int, float))
                             and isfinite(value) and 0 <= value < 360)


def _validate_evidence(evidence, count, config, angle_deg):
    if not isinstance(evidence, Evidence):
        raise InspectionInputError("evidence must be Evidence, not trusted client flags")
    if not _angle(angle_deg):
        raise InspectionInputError("angle_deg must be null or finite in [0,360)")
    if evidence.kind not in ("single_view", "multi_view"):
        raise InspectionInputError("invalid evidence kind")
    if evidence.search_status not in ("not_requested", "usable_view_found", "exhausted", "timed_out"):
        raise InspectionInputError("invalid search_status")
    if (not isinstance(evidence.supporting_angles_deg, (tuple, list))
            or len(evidence.supporting_angles_deg) != count):
        raise InspectionInputError("supporting angles and images must align")
    if not all(_angle(angle) for angle in evidence.supporting_angles_deg):
        raise InspectionInputError("invalid supporting angle")
    if ((evidence.kind == "single_view" and count != 0)
            or (evidence.kind == "multi_view" and count == 0)):
        raise InspectionInputError("evidence kind and view count disagree")
    coverage = evidence.reported_coverage_deg
    if coverage is not None and (isinstance(coverage, bool) or not isinstance(coverage, (int, float))
                                 or not isfinite(coverage) or not 0 <= coverage <= 360):
        raise InspectionInputError("reported coverage must be null or finite in [0,360]")
    if count + 1 > config.max_views:
        raise InspectionInputError("too many inspection views")


def inspect_image(image: np.ndarray, expected_product: str, config: DetectorConfig, *,
                  color_order: str, source_mode: str = "simulation",
                  angle_deg: float | None = None,
                  supporting_images: tuple[np.ndarray, ...] = (),
                  evidence: Evidence | None = None) -> Decision:
    """Caller retains all originals; output boxes ALWAYS refer to the main image.

    Supporting evidence cannot override an insufficient main view in this baseline.
    A usable supporting view is reported for a new main-image selection by caller.
    No validated missing-label profile is shipped, so verified_coverage stays false.
    """
    config.validate()
    catalog = {p.product_id: p for p in config.products}
    if not isinstance(expected_product, str) or expected_product not in catalog:
        raise InspectionInputError("expected_product is not in catalog")
    if source_mode not in ("simulation", "webcam"):
        raise InspectionInputError("invalid source_mode")
    if not isinstance(supporting_images, (tuple, list)):
        raise InspectionInputError("supporting_images must be an ordered tuple/list")
    evidence = Evidence() if evidence is None else evidence
    _validate_evidence(evidence, len(supporting_images), config, angle_deg)
    # Bound aggregate decoded pixels before copying/processing all views.
    pixel_total = 0
    for view in (image, *supporting_images):
        if isinstance(view, np.ndarray) and view.ndim >= 2:
            pixel_total += view.shape[0] * view.shape[1]
    if pixel_total > config.max_total_pixels:
        raise InspectionInputError("inspection exceeds max_total_pixels")
    rgb = prepare_image(image, color_order=color_order, max_pixels=config.max_image_pixels)
    # Validate every supporting image before doing any inspection.
    supporting = tuple(prepare_image(view, color_order=color_order, max_pixels=config.max_image_pixels)
                       for view in supporting_images)
    start = perf_counter()
    supporting_results = [locator_result(analyze(view, config)).to_dict() for view in supporting]
    orientation_ms = (perf_counter() - start) * 1000 if supporting else 0.0
    start = perf_counter()
    analysis = analyze(rgb, config)
    location = locator_result(analysis)
    expected = expected_box(analysis.bottle, catalog[expected_product].position) if analysis.bottle else None
    assessment = {
        "kind": evidence.kind, "search_status": evidence.search_status,
        "supporting_angles_deg": list(evidence.supporting_angles_deg),
        "reported_coverage_deg": evidence.reported_coverage_deg,
        "verified_coverage": False, "required_view_profile": None,
        # Every supplied view must be persisted by 04, in this original order.
        "supporting_indices": list(range(len(supporting))),
        "usable_supporting_indices": [i for i, item in enumerate(supporting_results) if item["usable_view"]],
        "supporting_locator_results": supporting_results,
    }
    diagnostics = {"quality": location.quality, "blur_score": analysis.blur_score,
                   "candidate_count": len(analysis.candidates),
                   "locator_diagnostic": analysis.diagnostic,
                   "config_validated": config.validated}

    def finish(result, reason, match=None):
        score = match.score if match else None
        return Decision(result, reason, expected_product,
                        match.detected_product if match else None, score,
                        SCORE_METHOD if score is not None else None,
                        location.bbox, expected, rgb.shape[1], rgb.shape[0], angle_deg,
                        config.config_version, source_mode,
                        {"orientation": orientation_ms,
                         "inspection": (perf_counter() - start) * 1000}, assessment, diagnostics)

    if not location.usable_view:
        reason = location.reason
        # Exhaustion is not proof of absence. Keep actual blur as the main reason.
        if reason == "label_not_visible" and evidence.search_status in ("exhausted", "timed_out"):
            reason = "orientation_failed"
        return finish("REVIEW", reason)
    if len(analysis.candidates) != 1:
        diagnostics["limitation"] = "multiple_label_candidates"
        return finish("REVIEW", "ambiguous_match")
    geometry = label_geometry(rgb, location.bbox, analysis.bottle, config.label_contrast)
    if geometry is None:
        diagnostics["limitation"] = "label_outline_unavailable"
        return finish("REVIEW", "orientation_failed")
    label, label_width, label_height, tilt = geometry
    match = compare_templates(label, config)
    diagnostics["raw_scores"] = match.raw_scores
    if match.reason != "matched":
        return finish("REVIEW", match.reason)
    if not config.validated:
        diagnostics["limitation"] = "configuration_not_validated"
        return finish("REVIEW", "ambiguous_match", match)
    # Explicit precedence: sufficient quality -> known identity -> position.
    if match.detected_product != expected_product:
        return finish("FAIL", "wrong_label", match)
    position_ok, checks = check_position(location.bbox, analysis.bottle, catalog[expected_product].position,
                                         measured_width=label_width, measured_height=label_height,
                                         tilt_deg=tilt)
    diagnostics["position"] = checks
    return finish("PASS" if position_ok else "FAIL",
                  "good" if position_ok else "misplaced_label", match)
