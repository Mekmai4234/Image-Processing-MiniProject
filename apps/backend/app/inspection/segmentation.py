"""Shared plain-background foreground extraction; no product classification."""
from dataclasses import dataclass

import cv2
import numpy as np

from .types import Box


@dataclass(frozen=True)
class Foreground:
    box: Box | None
    mask: np.ndarray | None
    contour: np.ndarray | None
    reason: str | None


def segment_foreground(rgb, *, background_distance, max_background_spread, min_area):
    height, width = rgb.shape[:2]
    lab = cv2.cvtColor(rgb, cv2.COLOR_RGB2LAB).astype(np.float32)
    border = np.concatenate((lab[0], lab[-1], lab[:, 0], lab[:, -1]))
    background = np.median(border, axis=0)
    spread = float(np.percentile(np.linalg.norm(border - background, axis=1), 90))
    if spread > max_background_spread:
        return Foreground(None, None, None, "background_not_uniform")
    mask = (np.linalg.norm(lab - background, axis=2) > background_distance).astype(np.uint8) * 255
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
    contours = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)[0]
    contours = [c for c in contours if cv2.contourArea(c) >= min_area * width * height]
    if len(contours) != 1:
        return Foreground(None, None, None, "bottle_not_isolated")
    contour = contours[0]
    box = Box(*cv2.boundingRect(contour))
    silhouette = np.zeros((height, width), np.uint8)
    cv2.drawContours(silhouette, [contour], -1, 1, cv2.FILLED)
    return Foreground(box, silhouette, contour, None)


def whole_upright_bottle(box, width, height):
    return (box is not None and box.x > 1 and box.y > 1
            and box.x + box.width < width - 1 and box.y + box.height < height - 1
            and box.height > box.width * 1.15)
