"""Single-reference prototype: search the user's actual crop inside the bottle.

PASS means this visible image meets the selected reference/quality/position rules.
Uncertain images fail closed. This is not a calibrated confidence model.
"""
from time import perf_counter

import cv2
import numpy as np

from .position import expected_box
from .preprocess import crop, sharpness
from .segmentation import segment_foreground, whole_upright_bottle
from .types import Box, Decision, LocatorResult


def reference_analysis(rgb, product, config):
    foreground = segment_foreground(rgb, background_distance=config.background_distance,
                                    max_background_spread=config.max_background_spread,
                                    min_area=config.min_bottle_area)
    bottle = foreground.box
    visible = whole_upright_bottle(bottle, rgb.shape[1], rgb.shape[0])
    quality = {'bottle_visible': visible, 'label_visible': False, 'sharp_enough': False}
    if not visible:
        return None, None, None, 'orientation_failed', quality
    expected = expected_box(bottle, product.position)
    body = cv2.cvtColor(crop(rgb, bottle), cv2.COLOR_RGB2GRAY)
    best_score, best_box = -1.0, expected
    for template in product.templates:
        gray = cv2.cvtColor(template, cv2.COLOR_RGB2GRAY)
        for scale in (1.0, 0.85, 1.15):
            width, height = round(expected.width * scale), round(expected.height * scale)
            if min(width, height) < 12 or width > body.shape[1] or height > body.shape[0]:
                continue
            resized = cv2.resize(gray, (width, height), interpolation=cv2.INTER_AREA)
            if resized.std() <= config.min_pattern_std:
                continue
            score_map = cv2.matchTemplate(body, resized, cv2.TM_CCOEFF_NORMED)
            _, score, _, point = cv2.minMaxLoc(score_map)
            if np.isfinite(score) and score > best_score:
                best_score = float(score)
                best_box = Box(bottle.x + point[0], bottle.y + point[1], width, height)
    score = max(0.0, min(1.0, best_score))
    quality['sharp_enough'] = sharpness(crop(rgb, best_box)) >= config.min_sharpness
    quality['label_visible'] = score >= config.min_match_score
    if not quality['sharp_enough']:
        reason = 'blurred_image'
    elif not quality['label_visible']:
        reason = 'unknown_product'
    else:
        rules = product.position
        cx = abs((best_box.x + best_box.width / 2) - (expected.x + expected.width / 2)) / bottle.width
        cy = abs((best_box.y + best_box.height / 2) - (expected.y + expected.height / 2)) / bottle.height
        reason = 'good' if cx <= rules.center_tolerance[0] and cy <= rules.center_tolerance[1] else 'misplaced_label'
    return best_box, expected, score, reason, quality


def reference_locator(rgb, product, config):
    box, _, _, reason, quality = reference_analysis(rgb, product, config)
    usable = reason in ('good', 'misplaced_label')
    return LocatorResult(usable, box, rgb.shape[1], rgb.shape[0], quality,
                         'usable_view' if usable else 'label_not_visible' if reason == 'unknown_product' else reason)


def inspect_reference(rgb, expected_product, config, source_mode, angle_deg, evidence, supporting_count):
    started = perf_counter()
    product = next(p for p in config.products if p.product_id == expected_product)
    box, expected, score, reason, quality = reference_analysis(rgb, product, config)
    return Decision('PASS' if reason == 'good' else 'FAIL', reason, expected_product,
                    expected_product if quality['label_visible'] else None, score,
                    'reference_template_search_ccoeff_v1' if score is not None else None,
                    box, expected, rgb.shape[1], rgb.shape[0], angle_deg,
                    config.config_version, source_mode,
                    {'orientation': 0.0, 'inspection': (perf_counter() - started) * 1000},
                    {'kind': evidence.kind, 'search_status': evidence.search_status,
                     'supporting_angles_deg': list(evidence.supporting_angles_deg),
                     'reported_coverage_deg': evidence.reported_coverage_deg,
                     'verified_coverage': False, 'required_view_profile': None,
                     'supporting_indices': list(range(supporting_count))},
                    {'quality': quality, 'config_validated': False,
                     'limitation': 'single_reference_visible_view_only; tilt_not_measured'})
