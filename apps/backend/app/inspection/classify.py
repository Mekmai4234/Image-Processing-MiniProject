"""Compare every known product using the agreed, clamped CCOEFF method."""
from math import isfinite

import cv2
import numpy as np

from .config import DetectorConfig
from .preprocess import normalized_pattern
from .types import Match

SCORE_METHOD = "template_ccoeff_normed_clamped_v1"


def compare_templates(label_rgb: np.ndarray, config: DetectorConfig) -> Match:
    candidate = normalized_pattern(label_rgb, config.match_size)
    raw_scores = {}
    invalid = float(candidate.std()) <= config.min_pattern_std
    for product in config.products:
        scores = []
        for template in product.templates:
            reference = normalized_pattern(template, config.match_size)
            if invalid or float(reference.std()) <= config.min_pattern_std:
                invalid = True
                continue
            raw = float(cv2.matchTemplate(candidate, reference, cv2.TM_CCOEFF_NORMED)[0, 0])
            if not isfinite(raw) or not -1 <= raw <= 1:
                invalid = True
                continue
            scores.append(raw)
        raw_scores[product.product_id] = max(scores) if scores else None
    # An unusable reference means the full catalog comparison is incomplete.
    if invalid or any(value is None for value in raw_scores.values()):
        return Match(None, None, "ambiguous_match", raw_scores)
    ranking = sorted(((max(0.0, raw), product) for product, raw in raw_scores.items()),
                     key=lambda item: (-item[0], item[1]))
    score, detected = ranking[0]
    if score < config.min_match_score:
        return Match(None, None, "unknown_product", raw_scores)
    if len(ranking) > 1 and score - ranking[1][0] <= config.min_match_margin:
        return Match(None, None, "ambiguous_match", raw_scores)
    return Match(detected, score, "matched", raw_scores)
