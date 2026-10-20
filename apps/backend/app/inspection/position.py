"""Position relative to bottle ROI; measured label outline supplies tilt/crop."""
import cv2
import numpy as np

from .config import PositionRules
from .preprocess import crop
from .types import Box


def expected_box(bottle: Box, rules: PositionRules) -> Box:
    x, y, w, h = rules.expected_roi
    left = min(bottle.x + bottle.width - 1, bottle.x + round(x * bottle.width))
    top = min(bottle.y + bottle.height - 1, bottle.y + round(y * bottle.height))
    right = min(bottle.x + bottle.width, bottle.x + round((x + w) * bottle.width))
    bottom = min(bottle.y + bottle.height, bottle.y + round((y + h) * bottle.height))
    return Box(left, top, max(1, right - left), max(1, bottom - top))


def label_geometry(rgb: np.ndarray, label: Box, bottle: Box, contrast: float):
    """Return rectified label pixels, size, absolute tilt; None if no outline."""
    body = cv2.cvtColor(crop(rgb, bottle), cv2.COLOR_RGB2LAB).astype(np.float32)
    body_color = np.median(body.reshape(-1, 3), axis=0)
    label_rgb = crop(rgb, label)
    patch = cv2.cvtColor(label_rgb, cv2.COLOR_RGB2LAB).astype(np.float32)
    mask = (np.linalg.norm(patch - body_color, axis=2) > contrast).astype(np.uint8) * 255
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
    contours = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)[0]
    if not contours:
        return None
    outline = max(contours, key=cv2.contourArea)
    if cv2.contourArea(outline) < label.width * label.height * 0.5:
        return None
    rectangle = cv2.minAreaRect(outline)
    vertices = cv2.boxPoints(rectangle)
    # Order TL/TR/BR/BL for a modestly tilted, predominantly horizontal label.
    ordered = vertices[np.argsort(vertices[:, 1])]
    top = ordered[:2][np.argsort(ordered[:2, 0])]
    bottom = ordered[2:][np.argsort(ordered[2:, 0])]
    tl, tr, br, bl = top[0], top[1], bottom[1], bottom[0]
    edge = tr - tl
    tilt = abs(float(np.degrees(np.arctan2(edge[1], edge[0]))))
    actual_w = float(np.linalg.norm(edge)) + 1
    actual_h = float(np.linalg.norm(bl - tl)) + 1
    w, h = max(2, round(actual_w)), max(2, round(actual_h))
    source = np.array([tl, tr, br, bl], dtype=np.float32)
    target = np.array([[0, 0], [w - 1, 0], [w - 1, h - 1], [0, h - 1]], dtype=np.float32)
    rectified = cv2.warpPerspective(label_rgb, cv2.getPerspectiveTransform(source, target), (w, h))
    return rectified, actual_w, actual_h, tilt


def check_position(label: Box, bottle: Box, rules: PositionRules, *,
                   measured_width: float, measured_height: float, tilt_deg: float):
    x, y, w, h = rules.expected_roi
    center_x = (label.x + label.width / 2 - bottle.x) / bottle.width
    center_y = (label.y + label.height / 2 - bottle.y) / bottle.height
    checks = {
        "center_x_ok": abs(center_x - (x + w / 2)) <= rules.center_tolerance[0],
        "center_y_ok": abs(center_y - (y + h / 2)) <= rules.center_tolerance[1],
        "width_ok": abs(measured_width / bottle.width - w) <= rules.size_tolerance[0],
        "height_ok": abs(measured_height / bottle.height - h) <= rules.size_tolerance[1],
        "tilt_ok": tilt_deg <= rules.max_tilt_deg,
    }
    return all(checks.values()), {**checks, "tilt_deg": tilt_deg,
                                 "normalized_center": [center_x, center_y]}
