"""Draw on a copy in memory; persistence remains the responsibility of 04."""
import cv2
import numpy as np
from math import isfinite

from .preprocess import prepare_image
from .types import Box, Decision, InspectionInputError

COLORS = {"PASS": (22, 163, 74), "FAIL": (220, 38, 38), "REVIEW": (234, 179, 8)}  # RGB

REASONS = {"PASS": {"good"}, "FAIL": {"wrong_label", "misplaced_label", "missing_label"},
           "REVIEW": {"blurred_image", "label_not_visible", "unknown_product",
                      "ambiguous_match", "orientation_failed"}}


def format_match_text(result, match_score):
    if not isinstance(result, str) or result not in COLORS:
        raise InspectionInputError("invalid decision result")
    if match_score is None:
        return f"{result} | MATCH --"
    if (isinstance(match_score, bool) or not isinstance(match_score, (float, int))
            or not isfinite(match_score) or not 0 <= match_score <= 1):
        raise InspectionInputError("match_score must be null or finite in [0,1]")
    return f"{result} | MATCH {match_score * 100:.0f}%"


def _box(value):
    if value is None or isinstance(value, Box):
        return value
    if not isinstance(value, dict) or set(value) != {"x", "y", "width", "height"}:
        raise InspectionInputError("bbox must contain x/y/width/height")
    return Box(**value)


def annotate_image(image: np.ndarray, decision: Decision, *, color_order: str) -> np.ndarray:
    if not isinstance(image, np.ndarray) or image.shape[:2] != (decision.image_height, decision.image_width):
        raise InspectionInputError("annotation image dimensions differ from decision")
    return annotate_fields(image, result=decision.result, reason=decision.reason,
                           bbox=decision.bbox, expected_bbox=decision.expected_bbox,
                           match_score=decision.match_score, color_order=color_order,
                           max_image_pixels=decision.image_width * decision.image_height)


def annotate_fields(image, *, result, reason, bbox=None, expected_bbox=None,
                    match_score=None, color_order, max_image_pixels=20_000_000):
    """03 bridge for 04's stored JPEG: accepts detector fields, returns RGB copy.

    The adapter still owns EXIF normalization and encoding/storage; callers must
    pass the actual score from the same inspection, not a UI/demo default.
    """
    header = format_match_text(result, match_score)
    if not isinstance(reason, str) or reason not in REASONS[result]:
        raise InspectionInputError("result/reason mismatch")
    rgb = prepare_image(image, color_order=color_order, max_pixels=max_image_pixels)
    color = COLORS[result]

    def draw(box, *, dashed):
        box = _box(box)
        if box is None:
            return
        if any(type(value) is not int for value in (box.x, box.y, box.width, box.height)):
            raise InspectionInputError("annotation bbox coordinates must be integers")
        if (box.x < 0 or box.y < 0 or box.width <= 0 or box.height <= 0
                or box.x + box.width > rgb.shape[1] or box.y + box.height > rgb.shape[0]):
            raise InspectionInputError("annotation bbox is outside image")
        left, top, right, bottom = box.x, box.y, box.x + box.width - 1, box.y + box.height - 1
        if dashed:
            for x in range(left, right + 1, 12):
                for y in (top, bottom):
                    cv2.line(rgb, (x, y), (min(x + 6, right), y), color, 2)
            for y in range(top, bottom + 1, 12):
                for x in (left, right):
                    cv2.line(rgb, (x, y), (x, min(y + 6, bottom)), color, 2)
        else:
            cv2.rectangle(rgb, (left, top), (right, bottom), color, 2)
    draw(expected_bbox, dashed=True)
    draw(bbox, dashed=False)
    # Fit two explicit lines instead of hiding the reason or clipping a long score.
    for index, text in enumerate((header, f"{reason} | similarity")):
        font = cv2.FONT_HERSHEY_SIMPLEX
        nominal_width = cv2.getTextSize(text, font, 0.45, 1)[0][0]
        scale = min(0.45, 0.45 * max(1, rgb.shape[1] - 16) / max(1, nominal_width))
        cv2.putText(rgb, text, (8, 16 + index * 16), font, scale, color, 1, cv2.LINE_AA)
    return rgb
