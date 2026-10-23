"""Locate a selected printed label in a cluttered live frame, including close-ups.

Feature geometry is checked before accepting a homography. Scores are measured
inlier ratios, not probabilities. No whole-bottle or placement claim is made.
"""
from functools import lru_cache

import cv2
import numpy as np

from .types import Box


@lru_cache(maxsize=8)
def template_features(shape, pixels):
    gray = np.frombuffer(pixels, np.uint8).reshape(shape)
    return cv2.SIFT_create(nfeatures=1200, contrastThreshold=0.02).detectAndCompute(gray, None)


def label_sharpness(gray):
    # Compare the same label resolution across locator thumbnails and full captures.
    normalized = cv2.resize(gray, (192, 128), interpolation=cv2.INTER_AREA)
    return float(cv2.Laplacian(normalized, cv2.CV_64F).var())


def find_live_label(rgb, templates, min_sharpness):
    height, width = rgb.shape[:2]
    ratio = min(1.0, 800 / max(height, width))
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    small = cv2.resize(gray, (round(width * ratio), round(height * ratio)), interpolation=cv2.INTER_AREA)
    sift = cv2.SIFT_create(nfeatures=1600, contrastThreshold=0.02)
    keypoints, descriptors = sift.detectAndCompute(small, None)
    if descriptors is None or len(keypoints) < 8:
        return None
    best = None
    for template in templates:
        reference = cv2.cvtColor(template, cv2.COLOR_RGB2GRAY)
        rh, rw = reference.shape
        ref_points, ref_descriptors = template_features(reference.shape, reference.tobytes())
        if ref_descriptors is None or len(ref_points) < 8:
            continue
        pairs = cv2.BFMatcher().knnMatch(ref_descriptors, descriptors, k=2)
        matches = [pair[0] for pair in pairs if len(pair) == 2 and pair[0].distance < 0.75 * pair[1].distance]
        # One target feature cannot count as multiple independent correspondences.
        unique = {}
        for match in sorted(matches, key=lambda m: m.distance):
            unique.setdefault(match.trainIdx, match)
        matches = list(unique.values())
        if len(matches) < 8:
            continue
        source = np.float32([ref_points[m.queryIdx].pt for m in matches])
        target = np.float32([keypoints[m.trainIdx].pt for m in matches])
        matrix, mask = cv2.findHomography(source, target, cv2.RANSAC, 3.0)
        if matrix is None or mask is None or not np.isfinite(matrix).all():
            continue
        inliers = mask.ravel().astype(bool)
        count, score = int(inliers.sum()), float(inliers.mean())
        if count < 8 or score < 0.5:
            continue
        # Features must cover the design rather than one repeated tiny mark.
        coverage = cv2.contourArea(cv2.convexHull(source[inliers])) / (rw * rh)
        if coverage < 0.12:
            continue
        corners = np.float32([[0, 0], [rw-1, 0], [rw-1, rh-1], [0, rh-1]])
        quad = cv2.perspectiveTransform(corners.reshape(-1, 1, 2), matrix).reshape(-1, 2)
        if not np.isfinite(quad).all() or not cv2.isContourConvex(quad):
            continue
        area = cv2.contourArea(quad)
        sh, sw = small.shape
        if not 0.002 * sw * sh <= area <= 0.85 * sw * sh:
            continue
        if (quad[:, 0].min() < 0 or quad[:, 1].min() < 0 or
                quad[:, 0].max() >= sw or quad[:, 1].max() >= sh):
            continue  # The entire label (but not the bottle) must be visible.
        top, right, bottom, left = [float(np.linalg.norm(quad[(i+1) % 4] - quad[i])) for i in range(4)]
        if min(top, right, bottom, left) < 12 or max(top/bottom, bottom/top, left/right, right/left) > 3:
            continue
        try:
            rectified = cv2.warpPerspective(small, np.linalg.inv(matrix), (rw, rh))
        except np.linalg.LinAlgError:
            continue
        sharp = label_sharpness(rectified)
        # Secondary appearance check rejects accidentally consistent background features.
        a = cv2.resize(reference, (96, 64), interpolation=cv2.INTER_AREA)
        b = cv2.resize(rectified, (96, 64), interpolation=cv2.INTER_AREA)
        correlation = float(cv2.matchTemplate(b, a, cv2.TM_CCOEFF_NORMED)[0, 0])
        if not np.isfinite(correlation) or correlation < 0.2:
            continue
        x0, y0 = np.floor(quad.min(axis=0) / ratio).astype(int)
        x1, y1 = np.ceil(quad.max(axis=0) / ratio).astype(int)
        x0, y0, x1, y1 = max(0, x0), max(0, y0), min(width, x1), min(height, y1)
        candidate = {'box': Box(int(x0), int(y0), int(x1-x0), int(y1-y0)), 'score': score,
                     'sharp': sharp >= min_sharpness, 'method': 'reference_sift_inlier_ratio_v1',
                     'diagnostics': {'inliers': count, 'matches': len(matches),
                                     'reference_coverage': coverage, 'pattern_correlation': correlation,
                                     'label_sharpness': sharp, 'position_assessed': False}}
        if best is None or count > best['diagnostics']['inliers']:
            best = candidate
    return best
