"""Synthetic shape/annotation behavior, not evidence of real bottle quality."""
from dataclasses import replace
import hashlib
import json
import unittest
from unittest.mock import patch

import cv2
import numpy as np

from test_detector import bottle_image, synthetic_config
from app.inspection import (ShapeConfig, analyze_shape, annotate_image, annotate_fields,
                            format_match_text, inspect_image, InspectionConfigError,
                            InspectionInputError, locate_label, Evidence)


def silhouette_image(kind):
    image = np.full((360, 240, 3), (235, 240, 245), np.uint8)
    points = {
        "straight": [(95, 30), (145, 30), (145, 80), (175, 110), (175, 320), (65, 320), (65, 110), (95, 80)],
        "tapered": [(100, 30), (140, 30), (140, 70), (160, 100), (178, 320), (62, 320), (80, 100), (100, 70)],
        "waist": [(100, 30), (140, 30), (140, 80), (175, 110), (155, 210), (175, 320),
                  (65, 320), (85, 210), (65, 110), (100, 80)],
    }[kind]
    cv2.fillPoly(image, [np.array(points, np.int32)], (40, 110, 160))
    return image


class ShapeTests(unittest.TestCase):
    def setUp(self):
        self.config = ShapeConfig.from_detector(synthetic_config())

    def test_multiple_silhouettes_return_distinct_versioned_profiles(self):
        profiles = []
        for kind in ("straight", "tapered", "waist"):
            result = analyze_shape(silhouette_image(kind), self.config, color_order="RGB")
            with self.subTest(kind=kind):
                self.assertEqual(result.status, "ready")
                self.assertEqual(result.schema_version, "bottle-silhouette-v1")
                self.assertEqual(len(result.radial_profile), 32)
                self.assertEqual(result.radial_profile[0]["y_fraction"], 0)
                self.assertEqual(result.radial_profile[-1]["y_fraction"], 1)
                self.assertTrue(result.contour)
                self.assertEqual(result.mask.shape, (360, 240))
                self.assertEqual(set(np.unique(result.mask)), {0, 1})
                self.assertFalse(result.mask.flags.writeable)
            profiles.append([round(row["radius_over_height"], 3) for row in result.radial_profile])
        self.assertNotEqual(profiles[0], profiles[1])
        self.assertNotEqual(profiles[0], profiles[2])

    def test_coordinates_are_pixels_and_radius_is_normalized_to_height(self):
        result = analyze_shape(bottle_image(), self.config, color_order="RGB")
        self.assertEqual(result.bbox.width, 120)
        self.assertEqual(result.bbox.height, 300)
        self.assertAlmostEqual(result.radial_profile[10]["radius_over_height"], 0.2)
        self.assertAlmostEqual(result.normalized_width, 0.5)
        self.assertAlmostEqual(result.normalized_height, 300 / 360)
        metadata = result.to_dict()
        self.assertNotIn("mask", metadata)
        self.assertNotIn("result", metadata)
        json.dumps(metadata, allow_nan=False)
        self.assertEqual(len(result.to_dict(include_mask=True)["mask"]), 360)

    def test_bgr_and_resized_source_preserve_normalized_shape(self):
        rgb = silhouette_image("waist")
        base = analyze_shape(rgb, self.config, color_order="RGB")
        bgr = analyze_shape(rgb[..., ::-1], self.config, color_order="BGR")
        bigger = analyze_shape(cv2.resize(rgb, None, fx=2, fy=2, interpolation=cv2.INTER_NEAREST), self.config, color_order="RGB")
        self.assertEqual(base.to_dict(), bgr.to_dict())
        for left, right in zip(base.radial_profile, bigger.radial_profile):
            self.assertAlmostEqual(left["radius_over_height"], right["radius_over_height"], delta=0.005)

    def test_failure_returns_fallback_without_fabricated_geometry(self):
        images = [np.full((360, 240, 3), 240, np.uint8), bottle_image()[:, 60:180]]
        busy = bottle_image()
        busy[0, ::2] = 0
        images.append(busy)
        for image in images:
            with self.subTest(shape=image.shape):
                result = analyze_shape(image, self.config, color_order="RGB")
                self.assertEqual(result.status, "fallback")
                self.assertIsNone(result.mask)
                self.assertIsNone(result.bbox)
                self.assertFalse(result.radial_profile)

    def test_asymmetric_or_leaning_object_falls_back(self):
        image = np.full((360, 240, 3), (235, 240, 245), np.uint8)
        cv2.fillPoly(image, [np.array([(50, 30), (100, 30), (190, 320), (140, 320)])], (40, 110, 160))
        result = analyze_shape(image, self.config, color_order="RGB")
        self.assertEqual((result.status, result.reason), ("fallback", "asymmetric_silhouette"))

    def test_shape_failure_does_not_modify_label_decision_or_source(self):
        image = bottle_image()
        before_hash = hashlib.sha256(image.tobytes()).hexdigest()
        detector = synthetic_config()
        before = inspect_image(image, "bottle_a", detector, color_order="RGB").to_dict()
        analyze_shape(image, self.config, color_order="RGB")
        after = inspect_image(image, "bottle_a", detector, color_order="RGB").to_dict()
        before.pop("timing_ms")
        after.pop("timing_ms")
        self.assertEqual(before, after)
        self.assertEqual(before_hash, hashlib.sha256(image.tobytes()).hexdigest())

    def test_bad_shape_config_and_image_are_operational_errors(self):
        with self.assertRaises(InspectionConfigError):
            analyze_shape(bottle_image(), replace(self.config, profile_samples=1), color_order="RGB")
        with self.assertRaises(InspectionInputError):
            analyze_shape(np.zeros((10, 10)), self.config, color_order="RGB")


class AnnotationScoreTests(unittest.TestCase):
    def test_header_uses_actual_similarity_and_never_implies_accuracy(self):
        self.assertEqual(format_match_text("PASS", 0.937), "PASS | MATCH 94%")
        self.assertEqual(format_match_text("FAIL", 0.96), "FAIL | MATCH 96%")
        self.assertEqual(format_match_text("REVIEW", None), "REVIEW | MATCH --")
        for score in (-1, 2, float("nan"), True):
            with self.subTest(score=score), self.assertRaises(InspectionInputError):
                format_match_text("PASS", score)

    def test_annotation_draws_score_and_reason_with_null_and_nonnull_scores(self):
        image = bottle_image()
        decision = inspect_image(image, "bottle_a", synthetic_config(), color_order="RGB")
        real_put_text = cv2.putText
        with patch("app.inspection.annotate.cv2.putText", wraps=real_put_text) as drawing:
            annotate_image(image, decision, color_order="RGB")
        texts = [call.args[1] for call in drawing.call_args_list]
        self.assertEqual(texts[0], format_match_text(decision.result, decision.match_score))
        self.assertEqual(texts[1], "good | similarity")

    def test_adapter_bridge_has_same_pixels_and_preserves_original_hash(self):
        image = bottle_image("b")
        before = hashlib.sha256(image.tobytes()).hexdigest()
        decision = inspect_image(image, "bottle_a", synthetic_config(), color_order="RGB")
        fields = decision.to_inspection_fields()
        bridge = annotate_fields(image, result=fields["result"], reason=fields["reason"],
                                 bbox=fields["bbox"], expected_bbox=fields["expected_bbox"],
                                 match_score=fields["match_score"], color_order="RGB")
        np.testing.assert_array_equal(bridge, annotate_image(image, decision, color_order="RGB"))
        self.assertEqual(before, hashlib.sha256(image.tobytes()).hexdigest())

    def test_expected_roi_is_dashed_while_detected_label_is_solid(self):
        image = np.zeros((360, 240, 3), np.uint8)
        annotated = annotate_fields(image, result="REVIEW", reason="label_not_visible",
                                    expected_bbox={"x": 60, "y": 140, "width": 120, "height": 80},
                                    color_order="RGB")
        self.assertTrue(annotated[140, 60].any())
        self.assertFalse(annotated[140, 70].any())


class LocatorEdgeCaseTests(unittest.TestCase):
    def test_skin_toned_face_or_hand_without_label_is_not_usable(self):
        for kind in ("face", "hand"):
            image = np.full((360, 240, 3), (235, 240, 245), np.uint8)
            if kind == "face":
                cv2.ellipse(image, (120, 175), (70, 130), 0, 0, 360, (225, 180, 150), -1)
                cv2.circle(image, (95, 140), 7, (10, 10, 10), -1)
                cv2.circle(image, (145, 140), 7, (10, 10, 10), -1)
                cv2.line(image, (95, 220), (145, 220), (80, 40, 40), 4)
            else:
                cv2.rectangle(image, (70, 140), (170, 320), (225, 180, 150), -1)
                for x in (75, 100, 125, 150):
                    cv2.rectangle(image, (x, 50), (x + 14, 180), (225, 180, 150), -1)
            config = synthetic_config()
            locator = locate_label(image, "bottle_a", config, color_order="RGB")
            decision = inspect_image(image, "bottle_a", config, color_order="RGB")
            with self.subTest(kind=kind):
                self.assertFalse(locator.usable_view)
                self.assertEqual(decision.result, "REVIEW")

    def test_narrow_reflection_and_clear_outline_do_not_become_detected_labels(self):
        reflection = bottle_image(None)
        reflection[110:270, 110:118] = 255
        outline = np.full((360, 240, 3), (235, 240, 245), np.uint8)
        cv2.rectangle(outline, (60, 30), (179, 329), (160, 170, 180), 2)
        for kind, image in (("reflection", reflection), ("clear-outline", outline)):
            with self.subTest(kind=kind):
                locator = locate_label(image, "bottle_a", synthetic_config(), color_order="RGB")
                self.assertFalse(locator.usable_view)
                self.assertIsNone(locator.bbox)

    def test_hidden_primary_and_usable_supporting_remain_review_without_wrong_bbox(self):
        config = synthetic_config()
        for mode in ("simulation", "webcam"):
            decision = inspect_image(bottle_image(None), "bottle_a", config, color_order="RGB",
                                     source_mode=mode, supporting_images=(bottle_image(),),
                                     evidence=Evidence("multi_view", "exhausted", (None,), 360))
            self.assertEqual(decision.result, "REVIEW")
            self.assertIsNone(decision.bbox)
            self.assertFalse(decision.evidence_assessment["verified_coverage"])

    def test_locator_does_not_classify_identity_or_invent_similarity(self):
        locator = locate_label(bottle_image("b"), "bottle_a", synthetic_config(), color_order="RGB").to_dict()
        self.assertTrue(locator["usable_view"])
        for key in ("match_score", "detected_product", "result"):
            self.assertNotIn(key, locator)


if __name__ == "__main__":
    unittest.main()
