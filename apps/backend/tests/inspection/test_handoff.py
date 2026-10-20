"""03-owned contract checks for the proposed 04/05 handoff, not a real API."""
from dataclasses import replace
import json
from pathlib import Path
import sys
import unittest

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from app.inspection import Evidence, InspectionConfigError, InspectionInputError, inspect_image
from test_detector import bottle_image, synthetic_config


class HandoffContractTests(unittest.TestCase):
    def setUp(self):
        self.config = synthetic_config()

    def inspect(self, image=None, **kwargs):
        return inspect_image(bottle_image() if image is None else image, "bottle_a",
                             self.config, color_order="RGB", **kwargs)

    def test_detector_fields_and_adapter_fields_cover_current_contract(self):
        repo = Path(__file__).resolve().parents[4]
        sample = json.loads((repo / "examples/inspection-pass.json").read_text(encoding="utf-8"))
        fields = self.inspect().to_inspection_fields()
        adapter_owned = {"inspection_id", "client_request_id", "created_at",
                         "storage_status", "storage_error", "images", "reviewed_result",
                         "reviewed_reason", "reviewer", "reviewed_at"}
        self.assertEqual(set(fields) | adapter_owned, set(sample) - {"demo"})
        self.assertFalse(set(fields) & adapter_owned)
        self.assertEqual(set(fields["evidence"]), set(sample["evidence"]))
        # 03 never invents persistence timings to make a complete API response.
        self.assertEqual(set(fields["timing_ms"]), {"orientation", "inspection"})

    def test_projection_is_finite_json_and_does_not_expose_internal_fields(self):
        fields = self.inspect().to_inspection_fields()
        json.dumps(fields, allow_nan=False)
        for key in ("diagnostics", "evidence_assessment", "product_id", "label_product"):
            self.assertNotIn(key, fields)
        self.assertNotIn("supporting_indices", fields["evidence"])
        self.assertNotIn("supporting_locator_results", fields["evidence"])

    def test_wrong_label_preserves_expected_and_detected_product(self):
        fields = self.inspect(bottle_image("b")).to_inspection_fields()
        self.assertEqual(fields["expected_product"], "bottle_a")
        self.assertEqual(fields["detected_product"], "bottle_b")
        self.assertEqual((fields["result"], fields["reason"]), ("FAIL", "wrong_label"))

    def test_wrong_label_precedence_is_preserved_for_05_comparison(self):
        fields = self.inspect(bottle_image("b", label_y=220)).to_inspection_fields()
        self.assertEqual(fields["reason"], "wrong_label")

    def test_misplaced_label_requires_visible_evidence(self):
        visible = self.inspect(bottle_image(label_y=220)).to_inspection_fields()
        hidden = self.inspect(bottle_image(None)).to_inspection_fields()
        self.assertEqual((visible["result"], visible["reason"]), ("FAIL", "misplaced_label"))
        self.assertIsNotNone(visible["bbox"])
        self.assertEqual(hidden["result"], "REVIEW")
        self.assertIsNone(hidden["bbox"])

    def test_pending_supporting_urls_keep_all_indexes_in_order(self):
        decision = self.inspect(
            supporting_images=(bottle_image(None), bottle_image("b")),
            evidence=Evidence("multi_view", "usable_view_found", (180, None), 360),
        )
        fields = decision.to_inspection_fields()
        self.assertEqual(fields["evidence"]["supporting_images"], [None, None])
        self.assertEqual(fields["evidence"]["supporting_angles_deg"], [180, None])
        self.assertFalse(fields["evidence"]["verified_coverage"])
        self.assertIsNone(fields["evidence"]["required_view_profile"])
        self.assertEqual(decision.evidence_assessment["supporting_indices"], [0, 1])

    def test_single_view_maps_to_empty_supporting_urls(self):
        fields = self.inspect().to_inspection_fields()
        self.assertEqual(fields["evidence"]["supporting_images"], [])
        self.assertEqual(fields["evidence"]["supporting_angles_deg"], [])

    def test_adapter_updates_do_not_mutate_decision_snapshot(self):
        decision = self.inspect(supporting_images=(bottle_image(None),),
                                evidence=Evidence("multi_view", "exhausted", (180,)))
        before = decision.to_dict()
        fields = decision.to_inspection_fields()
        fields["bbox"]["x"] = 0
        fields["timing_ms"]["storage"] = 25
        fields["evidence"]["supporting_angles_deg"][0] = 90
        fields["evidence"]["supporting_images"][0] = "/test-only-url"
        self.assertEqual(decision.to_dict(), before)

    def test_main_bbox_remains_null_when_supporting_view_is_usable(self):
        fields = self.inspect(bottle_image(None), supporting_images=(bottle_image(),),
                              evidence=Evidence("multi_view", "exhausted", (None,))).to_inspection_fields()
        self.assertEqual(fields["result"], "REVIEW")
        self.assertIsNone(fields["bbox"])

    def test_invalid_input_remains_exception_not_product_prediction(self):
        with self.assertRaises(InspectionInputError):
            self.inspect(np.zeros((20, 20), dtype=np.uint8))

    def test_invalid_config_remains_service_exception(self):
        self.config = replace(self.config, products=())
        with self.assertRaises(InspectionConfigError):
            self.inspect()

    def test_missing_validation_reference_is_rejected(self):
        self.config = replace(self.config, validation_reference=" ")
        with self.assertRaises(InspectionConfigError):
            self.inspect()

    def test_unvalidated_config_stays_review_in_api_projection(self):
        self.config = synthetic_config(validated=False)
        fields = self.inspect().to_inspection_fields()
        self.assertEqual(fields["result"], "REVIEW")


if __name__ == "__main__":
    unittest.main()
