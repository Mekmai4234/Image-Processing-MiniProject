"""Real 04 HTTP inspection -> real 03 functions, synthetic images/temp DB only.

    Does NOT replace the deployed 04 HTTP locator or annotation implementation.
    The locator/annotation bridge is tested directly until 04 adopts it.
"""
from contextlib import ExitStack
from dataclasses import replace
import hashlib
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
import uuid

import cv2
import numpy as np
from PIL import Image
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from test_detector import bottle_image, synthetic_config
from app.core.config import settings
from app.main import app
from app.services.inspection_adapter import InspectionAdapter
from app.inspection import (inspect_image, locate_label, annotate_fields,
                            format_match_text)


def png_bytes(rgb):
    buf = io.BytesIO()
    Image.fromarray(rgb).save(buf, format="PNG")
    return buf.getvalue()


class RealDetectorHTTPTests(unittest.TestCase):
    def setUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        folder = self.stack.enter_context(tempfile.TemporaryDirectory(prefix="inspection03-http-"))
        self.stack.enter_context(patch.object(settings, "_raw_storage_root", folder))
        self.stack.enter_context(patch.object(settings, "DEFAULT_TO_DEMO", False))
        self.stack.enter_context(patch.object(InspectionAdapter, "_detector_config", synthetic_config()))
        self.client = self.stack.enter_context(TestClient(app))

    def post(self, rgb, mode="simulation", **extra):
        data = {"expected_product": "bottle_a", "source_mode": mode,
                "client_request_id": str(uuid.uuid4()), "demo": "false", **extra}
        return self.client.post("/api/inspections", data=data,
                                files={"image": ("synthetic.png", png_bytes(rgb), "image/png")})

    def test_http_inspection_calls_real_detector_for_both_modes(self):
        cases = ((bottle_image(), "PASS", "good"),
                 (bottle_image("b"), "FAIL", "wrong_label"),
                 (bottle_image(label_y=220), "FAIL", "misplaced_label"),
                 (bottle_image(None), "REVIEW", "label_not_visible"),
                 (bottle_image("unknown"), "REVIEW", "unknown_product"),
                 (cv2.GaussianBlur(bottle_image(), (31, 31), 10), "REVIEW", "blurred_image"))
        for mode in ("simulation", "webcam"):
            for image, result, reason in cases:
                with self.subTest(mode=mode, result=result, reason=reason):
                    response = self.post(image, mode)
                    self.assertEqual(response.status_code, 200, response.text)
                    body = response.json()
                    direct = inspect_image(image, "bottle_a", InspectionAdapter.get_detector_config(),
                                           color_order="RGB", source_mode=mode)
                    self.assertEqual((body["result"], body["reason"]), ("FAIL" if result == "REVIEW" else result, reason))
                    self.assertEqual(body["result"], "FAIL" if direct.result == "REVIEW" else direct.result)
                    self.assertEqual(body["bbox"], direct.to_dict()["bbox"])
                    self.assertEqual(body["match_score"], direct.match_score)
                    self.assertEqual(body["config_version"], direct.config_version)
                    self.assertFalse(body["demo"])
                    self.assertEqual(body["storage_status"], "saved")
                    for kind in ("original", "annotated"):
                        saved = self.client.get(body["images"][kind])
                        self.assertEqual(saved.status_code, 200)
                        self.assertEqual(Image.open(io.BytesIO(saved.content)).size, (240, 360))

    def test_exif_is_normalized_once_for_real_http_and_03_bridge(self):
        original = bottle_image()
        # Orientation 6 rotates an encoded landscape image 90 degrees clockwise.
        encoded = Image.fromarray(np.rot90(original, 1).copy())
        exif = Image.Exif()
        exif[274] = 6
        buf = io.BytesIO()
        encoded.save(buf, format="PNG", exif=exif)
        bgr, normalized_bytes, width, height = InspectionAdapter.decode_and_normalize(buf.getvalue())
        self.assertEqual((width, height), (240, 360))
        np.testing.assert_array_equal(bgr[..., ::-1], original)
        locator = locate_label(bgr, "bottle_a", InspectionAdapter.get_detector_config(), color_order="BGR")
        response = self.client.post("/api/inspections", data={
            "expected_product": "bottle_a", "source_mode": "webcam", "client_request_id": str(uuid.uuid4())
        }, files={"image": ("exif.png", buf.getvalue(), "image/png")})
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual(body["bbox"], locator.to_dict()["bbox"])
        original_saved = self.client.get(body["images"]["original"]).content
        self.assertEqual(hashlib.sha256(original_saved).hexdigest(), hashlib.sha256(normalized_bytes).hexdigest())

    def test_unvalidated_config_fails_closed_at_binary_http_boundary(self):
        InspectionAdapter.set_detector_config(synthetic_config(validated=False))
        for kind in ("a", "b"):
            response = self.post(bottle_image(kind))
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(response.json()["result"], "FAIL")

    def test_unconfigured_backend_returns_503_without_history(self):
        InspectionAdapter.set_detector_config(None)
        response = self.post(bottle_image())
        self.assertEqual(response.status_code, 503)
        self.assertEqual(self.client.get("/api/inspections").json()["total"], 0)

    def test_multiple_views_are_saved_but_do_not_verify_missing_label(self):
        image = bottle_image(None)
        response = self.client.post("/api/inspections", data={
            "expected_product": "bottle_a", "source_mode": "simulation", "client_request_id": str(uuid.uuid4()),
            "evidence": json.dumps({"kind": "multi_view", "search_status": "exhausted",
                                    "supporting_angles_deg": [180], "reported_coverage_deg": 360})
        }, files=[("image", ("main.png", png_bytes(image), "image/png")),
                  ("supporting_images", ("side.png", png_bytes(image), "image/png"))])
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual((body["result"], body["reason"]), ("FAIL", "orientation_failed"))
        self.assertFalse(body["evidence"]["verified_coverage"])
        self.assertIsNone(body["bbox"])
        self.assertEqual(len(body["evidence"]["supporting_images"]), 1)
        self.assertEqual(self.client.get(body["evidence"]["supporting_images"][0]).status_code, 200)

    def test_shared_locator_and_annotation_bridge_use_same_pixels_and_score(self):
        for kind in (None, "a", "b"):
            bgr, _, _, _ = InspectionAdapter.decode_and_normalize(png_bytes(bottle_image(kind)))
            config = InspectionAdapter.get_detector_config()
            before = hashlib.sha256(bgr.tobytes()).hexdigest()
            locator = locate_label(bgr, "bottle_a", config, color_order="BGR")
            fields = InspectionAdapter.inspect(bgr, "bottle_a", "simulation", demo=False)
            if kind is None:
                self.assertFalse(locator.usable_view)
                self.assertIsNone(locator.bbox)
                self.assertEqual(fields["reason"], "label_not_visible")
            else:
                self.assertTrue(locator.usable_view)
                self.assertEqual(locator.to_dict()["bbox"], fields["bbox"])
            annotated = annotate_fields(bgr, result=fields["result"], reason=fields["reason"],
                                        bbox=fields["bbox"], expected_bbox=fields["expected_bbox"],
                                        match_score=fields["match_score"], color_order="BGR")
            self.assertEqual(annotated.shape, bgr.shape)
            self.assertEqual(before, hashlib.sha256(bgr.tobytes()).hexdigest())
            self.assertIn(fields["result"], format_match_text(fields["result"], fields["match_score"]))


if __name__ == "__main__":
    unittest.main()
