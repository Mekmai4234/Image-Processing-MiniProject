"""Synthetic behavior tests only; fixtures do not establish real-bottle accuracy."""
from dataclasses import replace
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from app.inspection import (Box, DetectorConfig, Evidence, InspectionConfigError,
                            InspectionInputError, PositionRules, ProductConfig,
                            annotate_image, inspect_image, locate_label)
from app.inspection.classify import compare_templates
from app.inspection.position import check_position, expected_box


def label_image(kind="a"):
    label = np.full((75, 84, 3), 245, np.uint8)
    if kind == "a":
        cv2.rectangle(label, (9, 8), (20, 64), (25, 25, 25), -1)
        cv2.rectangle(label, (33, 8), (44, 64), (25, 25, 25), -1)
        cv2.rectangle(label, (57, 8), (68, 64), (25, 25, 25), -1)
    elif kind == "b":
        for x, y in ((20, 18), (61, 18), (40, 52)):
            cv2.circle(label, (x, y), 11, (25, 25, 25), -1)
    else:
        cv2.line(label, (4, 10), (77, 64), (20, 20, 20), 8)
        cv2.line(label, (4, 64), (77, 10), (20, 20, 20), 8)
    return label


def bottle_image(kind="a", *, label_y=145, offset_x=0, tilt=0):
    image = np.full((360, 240, 3), (235, 240, 245), np.uint8)
    image[30:330, 60 + offset_x:180 + offset_x] = (40, 110, 160)
    image[40:48, 85 + offset_x:155 + offset_x] = (10, 30, 60)
    if kind is not None:
        label = label_image(kind)
        if tilt:
            # Render a physically rotated label, not a rotated entire frame.
            surface = np.full((140, 140, 3), (40, 110, 160), np.uint8)
            surface[32:107, 28:112] = label
            matrix = cv2.getRotationMatrix2D((70, 70), tilt, 1)
            surface = cv2.warpAffine(surface, matrix, (140, 140), borderValue=(40, 110, 160))
            # Only copy pixels different from the bottle; keep original bottle bounds.
            patch_image = image[label_y - 32:label_y + 108, 50 + offset_x:190 + offset_x]
            mask = np.any(surface != (40, 110, 160), axis=2)
            patch_image[mask] = surface[mask]
        else:
            image[label_y:label_y + 75, 78 + offset_x:162 + offset_x] = label
    return image


def synthetic_config(*, validated=True):
    position = PositionRules((0.15, 115 / 300, 0.7, 0.25), (0.04, 0.04), (0.04, 0.04), 8)
    return DetectorConfig(
        config_version="synthetic-tests-only-v1",
        products=(ProductConfig("bottle_a", (label_image("a"),), position),
                  ProductConfig("bottle_b", (label_image("b"),), position)),
        min_sharpness=5, min_match_score=0.8, min_match_margin=0.08,
        background_distance=25, max_background_spread=15, label_contrast=40,
        min_bottle_area=0.08, label_width_range=(0.35, 0.95), label_height_range=(0.12, 0.5),
        validated=validated,
        validation_reference="synthetic fixture assertions only; NOT real validation" if validated else None)


class DetectorTests(unittest.TestCase):
    def setUp(self):
        self.config = synthetic_config()

    def inspect(self, image=None, expected="bottle_a", **kwargs):
        return inspect_image(bottle_image() if image is None else image, expected,
                             self.config, color_order="RGB", **kwargs)

    def test_both_known_products_pass_with_test_configuration(self):
        for product in ("a", "b"):
            with self.subTest(product=product):
                result = self.inspect(bottle_image(product), "bottle_" + product)
                self.assertEqual((result.result, result.reason), ("PASS", "good"))
                self.assertGreater(result.match_score, 0.99)
                self.assertEqual(result.bbox, Box(78, 145, 84, 75))

    def test_wrong_label_is_usable_and_fails_even_with_high_score(self):
        image = bottle_image("b")
        locator = locate_label(image, "bottle_a", self.config, color_order="RGB")
        self.assertTrue(locator.usable_view)
        result = self.inspect(image)
        self.assertEqual((result.result, result.reason, result.detected_product),
                         ("FAIL", "wrong_label", "bottle_b"))
        self.assertGreater(result.match_score, 0.99)

    def test_displaced_label_fails_relative_to_bottle(self):
        result = self.inspect(bottle_image(label_y=220))
        self.assertEqual((result.result, result.reason), ("FAIL", "misplaced_label"))
        self.assertFalse(result.diagnostics["position"]["center_y_ok"])

    def test_moving_bottle_in_frame_does_not_change_position_decision(self):
        result = self.inspect(bottle_image(offset_x=25))
        self.assertEqual(result.result, "PASS")
        self.assertEqual(result.bbox.x, 103)
        self.assertEqual(result.expected_bbox.x, 103)

    def test_wrong_identity_precedes_displacement(self):
        self.assertEqual(self.inspect(bottle_image("b", label_y=220)).reason, "wrong_label")

    def test_unknown_label_has_no_invented_score(self):
        result = self.inspect(bottle_image("unknown"))
        self.assertEqual((result.result, result.reason), ("REVIEW", "unknown_product"))
        self.assertIsNone(result.match_score)
        self.assertIsNone(result.score_method)

    def test_blurred_label_is_review(self):
        blurred = cv2.GaussianBlur(bottle_image(), (31, 31), 10)
        result = self.inspect(blurred)
        self.assertEqual(result.result, "REVIEW")
        self.assertEqual(result.reason, "blurred_image")

    def test_no_label_is_never_missing_label_fail(self):
        result = self.inspect(bottle_image(None))
        self.assertEqual((result.result, result.reason), ("REVIEW", "label_not_visible"))
        self.assertIsNone(result.bbox)
        self.assertIsNone(result.match_score)

    def test_exhausted_search_and_claimed_360_cannot_verify_absence(self):
        result = self.inspect(bottle_image(None), supporting_images=(bottle_image(None),) * 3,
                              evidence=Evidence("multi_view", "exhausted", (90, 180, 270), 360))
        self.assertEqual((result.result, result.reason), ("REVIEW", "orientation_failed"))
        self.assertFalse(result.evidence_assessment["verified_coverage"])
        self.assertIsNone(result.evidence_assessment["required_view_profile"])
        self.assertEqual(result.evidence_assessment["supporting_indices"], [0, 1, 2])

    def test_supporting_image_never_supplies_bbox_for_main_image(self):
        result = self.inspect(bottle_image(None), supporting_images=(bottle_image(),),
                              evidence=Evidence("multi_view", "exhausted", (None,), None))
        self.assertEqual(result.result, "REVIEW")
        self.assertIsNone(result.bbox)
        self.assertEqual(result.evidence_assessment["usable_supporting_indices"], [0])

    def test_exhaustion_does_not_override_sufficient_main_pixels(self):
        result = self.inspect(supporting_images=(bottle_image(None),),
                              evidence=Evidence("multi_view", "timed_out", (180,), 360))
        self.assertEqual(result.result, "PASS")

    def test_single_view_reported_coverage_is_unverified(self):
        result = self.inspect(evidence=Evidence(reported_coverage_deg=360))
        self.assertFalse(result.evidence_assessment["verified_coverage"])

    def test_unvalidated_configuration_cannot_pass_or_fail(self):
        self.config = synthetic_config(validated=False)
        for kind in ("a", "b"):
            result = self.inspect(bottle_image(kind))
            self.assertEqual((result.result, result.reason), ("REVIEW", "ambiguous_match"))
            self.assertEqual(result.diagnostics["limitation"], "configuration_not_validated")

    def test_tied_products_are_ambiguous(self):
        products = (self.config.products[0], replace(self.config.products[1], templates=(label_image(),)))
        self.config = replace(self.config, products=products)
        result = self.inspect()
        self.assertEqual(result.reason, "ambiguous_match")
        self.assertIsNone(result.match_score)

    def test_flat_template_returns_null_instead_of_opencv_perfect_score(self):
        products = (replace(self.config.products[0], templates=(np.full((75, 84, 3), 128, np.uint8),)),
                    self.config.products[1])
        self.config = replace(self.config, products=products)
        result = self.inspect()
        self.assertEqual(result.reason, "ambiguous_match")
        self.assertIsNone(result.match_score)

    def test_flat_candidate_returns_null(self):
        result = compare_templates(np.full((75, 84, 3), 128, np.uint8), self.config)
        self.assertEqual(result.reason, "ambiguous_match")
        self.assertIsNone(result.score)

    def test_invalid_raw_scores_are_not_clamped_into_valid_predictions(self):
        for raw in (float("nan"), float("inf"), 1.1, -1.1):
            with self.subTest(raw=raw), patch("app.inspection.classify.cv2.matchTemplate",
                                              return_value=np.array([[raw]])):
                result = compare_templates(label_image(), self.config)
                self.assertEqual(result.reason, "ambiguous_match")
                self.assertIsNone(result.score)

    def test_finite_negative_raw_score_is_clamped_to_zero(self):
        with patch("app.inspection.classify.cv2.matchTemplate", return_value=np.array([[-0.5]])):
            result = compare_templates(label_image(), self.config)
        self.assertEqual(result.reason, "unknown_product")
        self.assertEqual(set(result.raw_scores.values()), {-0.5})

    def test_bgr_and_rgb_decisions_agree(self):
        rgb = bottle_image()
        bgr = rgb[..., ::-1].copy()
        before = bgr.copy()
        result = inspect_image(bgr, "bottle_a", self.config, color_order="BGR")
        self.assertEqual(result.result, self.inspect(rgb).result)
        np.testing.assert_array_equal(before, bgr)

    def test_no_bottle_and_cutoff_or_label_only_crop_are_review(self):
        for image in (np.full((360, 240, 3), 240, np.uint8),
                      bottle_image()[:, 60:180], label_image()):
            with self.subTest(shape=image.shape):
                result = self.inspect(image)
                self.assertEqual(result.result, "REVIEW")
                self.assertEqual(result.reason, "orientation_failed")

    def test_annotation_preserves_input_and_uses_rgb_color(self):
        image = bottle_image()
        before = image.copy()
        result = self.inspect(image)
        annotated = annotate_image(image, result, color_order="RGB")
        np.testing.assert_array_equal(image, before)
        np.testing.assert_array_equal(annotated[145, 78], (22, 163, 74))
        self.assertFalse(np.shares_memory(image, annotated))

    def test_annotation_rejects_wrong_image_dimensions(self):
        with self.assertRaises(InspectionInputError):
            annotate_image(bottle_image()[:300], self.inspect(), color_order="RGB")

    def test_dashed_missing_expected_roi_does_not_change_null_detected_bbox(self):
        image = bottle_image(None)
        decision = replace(self.inspect(image), result="FAIL", reason="missing_label")
        annotated = annotate_image(image, decision, color_order="RGB")
        self.assertIsNone(decision.bbox)
        x, y = decision.expected_bbox.x, decision.expected_bbox.y
        np.testing.assert_array_equal(annotated[y, x], (220, 38, 38))

    def test_decisions_repeat_and_serialization_is_finite_json(self):
        left, right = self.inspect().to_dict(), self.inspect().to_dict()
        for value in (left, right):
            timing = value.pop("timing_ms")
            self.assertEqual(set(timing), {"orientation", "inspection"})
            self.assertTrue(all(v >= 0 for v in timing.values()))
        self.assertEqual(left, right)
        json.dumps(left, allow_nan=False)

    def test_invalid_pixels_are_operational_errors(self):
        for image in (None, np.zeros((10, 10), np.uint8), np.zeros((20, 20, 4), np.uint8),
                      np.zeros((10, 10, 3), np.float32), np.zeros((2, 2, 3), np.uint8)):
            with self.subTest(shape=getattr(image, "shape", None)), self.assertRaises(InspectionInputError):
                self.inspect(image) if image is not None else inspect_image(
                    None, "bottle_a", self.config, color_order="RGB")
        with self.assertRaises(InspectionInputError):
            inspect_image(bottle_image(), "bottle_a", self.config, color_order="RGBA")
        with self.assertRaises(InspectionInputError):
            self.inspect(expected="unknown")
        with self.assertRaises(InspectionInputError):
            self.inspect(source_mode="file")

    def test_image_and_view_limits_are_enforced(self):
        self.config = replace(self.config, max_image_pixels=10_000)
        with self.assertRaises(InspectionInputError):
            self.inspect()
        self.config = replace(synthetic_config(), max_views=1)
        with self.assertRaises(InspectionInputError):
            self.inspect(supporting_images=(bottle_image(),), evidence=Evidence("multi_view", "exhausted", (90,)))

    def test_invalid_evidence_is_rejected(self):
        for evidence in (Evidence("multi_view"), Evidence(search_status="found"),
                         Evidence(reported_coverage_deg=True), Evidence(reported_coverage_deg=float("nan")),
                         Evidence(supporting_angles_deg=(90,)), {"verified_coverage": True}):
            with self.subTest(evidence=evidence), self.assertRaises(InspectionInputError):
                self.inspect(evidence=evidence)
        for angle in (360, -1, True, float("nan")):
            with self.subTest(angle=angle), self.assertRaises(InspectionInputError):
                self.inspect(angle_deg=angle)

    def test_invalid_supporting_pixels_are_not_ignored(self):
        with self.assertRaises(InspectionInputError):
            self.inspect(supporting_images=(None,), evidence=Evidence("multi_view", "exhausted", (None,)))

    def test_invalid_configuration_is_not_product_fail(self):
        for changes in ({"min_match_score": float("nan")}, {"min_match_margin": True},
                        {"products": ()}, {"max_views": 0}, {"validation_reference": None},
                        {"label_height_range": (0.6, 0.2)}):
            with self.subTest(changes=changes), self.assertRaises(InspectionConfigError):
                replace(self.config, **changes).validate()

    def test_position_checks_size_and_tilt(self):
        bottle = Box(60, 30, 120, 300)
        label = Box(78, 145, 84, 75)
        rules = self.config.products[0].position
        ok, checks = check_position(label, bottle, rules, measured_width=84, measured_height=75, tilt_deg=15)
        self.assertFalse(ok)
        self.assertFalse(checks["tilt_ok"])
        ok, checks = check_position(label, bottle, rules, measured_width=110, measured_height=75, tilt_deg=0)
        self.assertFalse(ok)
        self.assertFalse(checks["width_ok"])

    def test_rotated_label_is_measured_and_rejected_for_tilt(self):
        result = self.inspect(bottle_image(tilt=15))
        self.assertEqual((result.result, result.reason), ("FAIL", "misplaced_label"))
        self.assertGreater(result.diagnostics["position"]["tilt_deg"], 10)

    def test_small_tilt_is_rectified_and_can_pass(self):
        for angle in (-5, 5):
            with self.subTest(angle=angle):
                result = self.inspect(bottle_image(tilt=angle))
                self.assertEqual(result.result, "PASS")

    def test_locator_contract_has_only_canonical_fields(self):
        data = locate_label(bottle_image(), "bottle_a", self.config, color_order="RGB").to_dict()
        self.assertEqual(set(data), {"usable_view", "bbox", "image_width", "image_height", "quality", "reason"})
        self.assertEqual(set(data["quality"]), {"sharp_enough", "label_visible", "bottle_visible"})
        self.assertTrue(all(type(v) is bool for v in data["quality"].values()))

    def test_pixel_coordinates_scale_back_to_full_input(self):
        image = cv2.resize(bottle_image(), None, fx=2, fy=2, interpolation=cv2.INTER_NEAREST)
        result = self.inspect(image)
        self.assertEqual(result.result, "PASS")
        self.assertEqual((result.image_width, result.image_height), (480, 720))
        self.assertEqual(result.bbox, Box(156, 290, 168, 150))

    def test_multiple_label_candidates_are_ambiguous(self):
        image = bottle_image(label_y=110)
        image[220:295, 78:162] = label_image("b")
        result = self.inspect(image)
        self.assertEqual(result.result, "REVIEW")
        self.assertEqual(result.reason, "ambiguous_match")

    def test_multiple_bottles_are_not_treated_as_one(self):
        image = np.full((360, 500, 3), (235, 240, 245), np.uint8)
        image[:, :240] = bottle_image()
        image[:, 260:] = bottle_image("b")
        self.assertEqual(self.inspect(image).reason, "orientation_failed")

    def test_busy_background_is_review(self):
        image = bottle_image()
        image[:10, ::2] = (0, 0, 0)
        result = self.inspect(image)
        self.assertEqual(result.result, "REVIEW")
        self.assertEqual(result.diagnostics["locator_diagnostic"], "background_not_uniform")

    def test_blur_remains_reason_even_after_search_exhaustion(self):
        image = cv2.GaussianBlur(bottle_image(), (31, 31), 10)
        result = self.inspect(image, supporting_images=(bottle_image(None),),
                              evidence=Evidence("multi_view", "exhausted", (None,)))
        self.assertEqual(result.reason, "blurred_image")

    def test_decoded_total_pixel_limit_applies_to_all_views(self):
        self.config = replace(self.config, max_total_pixels=100_000)
        with self.assertRaises(InspectionInputError):
            self.inspect(supporting_images=(bottle_image(),),
                         evidence=Evidence("multi_view", "exhausted", (90,)))

    def test_malformed_metadata_has_declared_error_type(self):
        for changes in ({"supporting_images": None}, {"evidence": Evidence(supporting_angles_deg=None)}):
            with self.subTest(changes=changes), self.assertRaises(InspectionInputError):
                self.inspect(**changes)
        with self.assertRaises(InspectionInputError):
            self.inspect(expected=[])

    def test_config_containers_and_disabled_quality_gates_are_rejected(self):
        for changes in ({"products": None}, {"match_size": None}, {"label_width_range": None},
                        {"min_match_score": 0}, {"min_sharpness": 0}, {"max_image_pixels": None}):
            with self.subTest(changes=changes), self.assertRaises(InspectionConfigError):
                replace(self.config, **changes).validate()

    def test_tiny_normalized_expected_roi_stays_in_bottle_bounds(self):
        rules = PositionRules((0.999, 0.999, 0.001, 0.001), (0, 0), (0, 0), 0)
        rules.validate()
        box = expected_box(Box(60, 30, 120, 300), rules)
        self.assertEqual(box, Box(179, 329, 1, 1))

    def test_webcam_uses_same_detector_with_unknown_angle(self):
        result = self.inspect(source_mode="webcam")
        self.assertEqual(result.result, "PASS")
        self.assertEqual(result.source_mode, "webcam")
        self.assertIsNone(result.orientation_deg)


if __name__ == "__main__":
    unittest.main()
