"""Draw on a copy in memory; persistence remains the responsibility of 04."""
import cv2
import numpy as np

from .preprocess import prepare_image
from .types import Decision, InspectionInputError

COLORS = {"PASS": (22, 163, 74), "FAIL": (220, 38, 38), "REVIEW": (234, 179, 8)}  # RGB


def annotate_image(image: np.ndarray, decision: Decision, *, color_order: str) -> np.ndarray:
    rgb = prepare_image(image, color_order=color_order,
                        max_pixels=decision.image_width * decision.image_height)
    if rgb.shape[:2] != (decision.image_height, decision.image_width):
        raise InspectionInputError("annotation image dimensions differ from decision")
    if decision.result not in COLORS:
        raise InspectionInputError("invalid decision result")
    color = COLORS[decision.result]
    box = decision.bbox
    dashed = box is None and decision.reason == "missing_label"
    if dashed:
        box = decision.expected_bbox
    if box is not None:
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
    cv2.putText(rgb, f"{decision.result}: {decision.reason}", (8, 20),
                cv2.FONT_HERSHEY_SIMPLEX, 0.45, color, 1, cv2.LINE_AA)
    return rgb
