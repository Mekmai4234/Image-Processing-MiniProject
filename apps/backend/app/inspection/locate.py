"""Controlled, plain-background baseline; no expectation-based product filtering."""
import cv2
import numpy as np

from .config import DetectorConfig
from .preprocess import crop, prepare_image, sharpness
from .segmentation import segment_foreground, whole_upright_bottle
from .types import Analysis, Box, LocatorResult, InspectionInputError


def _contours(mask):
    return cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)[0]


def analyze(rgb: np.ndarray, config: DetectorConfig) -> Analysis:
    height, width = rgb.shape[:2]
    foreground = segment_foreground(rgb, background_distance=config.background_distance,
                                    max_background_spread=config.max_background_spread,
                                    min_area=config.min_bottle_area)
    if foreground.reason is not None:
        return Analysis(rgb, None, (), False, 0.0, False, foreground.reason)
    kernel = np.ones((3, 3), np.uint8)
    bottle = foreground.box
    x, y, w, h = bottle.x, bottle.y, bottle.width, bottle.height
    # Reject cut-off objects and broad label-only crops; position needs a whole bottle.
    visible = whole_upright_bottle(bottle, width, height)
    bottle_crop = crop(rgb, bottle)
    bottle_lab = cv2.cvtColor(bottle_crop, cv2.COLOR_RGB2LAB).astype(np.float32)
    body_color = np.median(bottle_lab.reshape(-1, 3), axis=0)
    contrast = (np.linalg.norm(bottle_lab - body_color, axis=2) > config.label_contrast).astype(np.uint8) * 255
    # Only keep pixels inside the actual foreground contour.
    silhouette = foreground.mask * 255
    contrast = cv2.bitwise_and(contrast, crop(silhouette, bottle))
    contrast = cv2.morphologyEx(contrast, cv2.MORPH_CLOSE, kernel)
    # Edges recover printed labels whose mean color resembles the bottle body.
    edges = cv2.Canny(cv2.cvtColor(bottle_crop, cv2.COLOR_RGB2GRAY), 50, 150)
    edges = cv2.morphologyEx(edges, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
    candidates = []
    for candidate_mask in (contrast, edges):
        for contour in _contours(candidate_mask):
            lx, ly, lw, lh = cv2.boundingRect(contour)
            if (config.label_width_range[0] <= lw / w <= config.label_width_range[1]
                    and config.label_height_range[0] <= lh / h <= config.label_height_range[1]
                    and lx > 0 and ly > 0 and lx + lw < w and ly + lh < h
                    and cv2.contourArea(contour) / (lw * lh) > 0.5):
                box = Box(x + lx, y + ly, lw, lh)
                # Contrast/edge candidates covering the same patch are one candidate.
                duplicate = False
                for old in candidates:
                    ix = max(0, min(old.x + old.width, box.x + box.width) - max(old.x, box.x))
                    iy = max(0, min(old.y + old.height, box.y + box.height) - max(old.y, box.y))
                    intersection = ix * iy
                    union = old.width * old.height + box.width * box.height - intersection
                    if intersection / union > 0.75:
                        duplicate = True
                if not duplicate:
                    candidates.append(box)
    candidates.sort(key=lambda b: (-b.width * b.height, b.y, b.x))
    # Measure the candidate, not sharp background edges around a blurry label.
    region = crop(rgb, candidates[0]) if candidates else bottle_crop
    blur = sharpness(region)
    return Analysis(rgb, bottle, tuple(candidates), blur >= config.min_sharpness,
                    blur, visible)


def locator_result(analysis: Analysis) -> LocatorResult:
    bbox = analysis.candidates[0] if analysis.candidates else None
    quality = {"sharp_enough": analysis.sharp_enough, "label_visible": bbox is not None,
               "bottle_visible": analysis.bottle_visible}
    if not analysis.bottle_visible:
        reason = "orientation_failed"
    elif not analysis.sharp_enough:
        reason = "blurred_image"
    elif bbox is None:
        reason = "label_not_visible"
    else:
        reason = "usable_view"
    return LocatorResult(reason == "usable_view", bbox, analysis.rgb.shape[1],
                         analysis.rgb.shape[0], quality, reason)


def locate_label(image: np.ndarray, expected_product: str, config: DetectorConfig,
                 *, color_order: str) -> LocatorResult:
    config.validate()
    if not isinstance(expected_product, str) or expected_product not in {p.product_id for p in config.products}:
        raise InspectionInputError("expected_product is not in catalog")
    rgb = prepare_image(image, color_order=color_order, max_pixels=config.max_image_pixels)
    return locator_result(analyze(rgb, config))
