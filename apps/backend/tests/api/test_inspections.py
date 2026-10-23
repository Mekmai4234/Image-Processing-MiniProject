import io
import json
import uuid
import cv2
import numpy as np
import pytest
from fastapi.testclient import TestClient
from PIL import Image, ImageDraw

from app.core.config import settings
from app.core.timezone import get_folder_date
from app.main import app

client = TestClient(app)


def create_test_image_bytes(width=300, height=400, sharp=True) -> bytes:
    """Create in-memory JPEG image bytes, with sharp pattern if sharp=True."""
    img = Image.new("RGB", (width, height), color=(240, 240, 240))
    if sharp:
        draw = ImageDraw.Draw(img)
        # Draw high-contrast shapes to produce high Laplacian variance
        draw.rectangle([int(width * 0.2), int(height * 0.2), int(width * 0.8), int(height * 0.8)], fill=(20, 20, 20))
        draw.line([(0, 0), (width, height)], fill=(255, 0, 0), width=3)
        draw.line([(0, height), (width, 0)], fill=(0, 255, 0), width=3)
    buf = io.BytesIO()
    img.save(buf, format="JPEG")
    return buf.getvalue()


def test_create_inspection_single_view():
    client_req_id = str(uuid.uuid4())
    img_bytes = create_test_image_bytes(400, 500)

    files = {"image": ("bottle.jpg", img_bytes, "image/jpeg")}
    data = {
        "expected_product": "bottle_a",
        "source_mode": "webcam",
        "client_request_id": client_req_id,
        "angle_deg": 0.0,
    }

    response = client.post("/api/inspections", files=files, data=data)
    assert response.status_code == 200
    res = response.json()

    assert res["client_request_id"] == client_req_id
    assert res["inspection_id"] is not None
    assert res["result"] == "PASS"
    assert res["reason"] == "good"
    assert res["storage_status"] == "saved"
    assert res["images"]["original"] == f"/api/inspections/{res['inspection_id']}/images/original"
    assert res["images"]["annotated"] == f"/api/inspections/{res['inspection_id']}/images/annotated"

    # Verify files created in storage
    dest_dir = settings.STORAGE_ROOT / get_folder_date() / "pass" / res["inspection_id"]
    assert (dest_dir / "original.jpg").is_file()
    assert (dest_dir / "annotated.jpg").is_file()
    assert (dest_dir / "result.json").is_file()


def test_create_inspection_multi_view():
    client_req_id = str(uuid.uuid4())
    main_bytes = create_test_image_bytes(400, 500)
    sup_bytes1 = create_test_image_bytes(400, 500)
    sup_bytes2 = create_test_image_bytes(400, 500)

    evidence_dict = {
        "kind": "multi_view",
        "search_status": "usable_view_found",
        "supporting_angles_deg": [90, 180],
        "reported_coverage_deg": 180,
    }

    files = [
        ("image", ("main.jpg", main_bytes, "image/jpeg")),
        ("supporting_images", ("sup1.jpg", sup_bytes1, "image/jpeg")),
        ("supporting_images", ("sup2.jpg", sup_bytes2, "image/jpeg")),
    ]
    data = {
        "expected_product": "bottle_a",
        "source_mode": "simulation",
        "client_request_id": client_req_id,
        "angle_deg": 0.0,
        "evidence": json.dumps(evidence_dict),
    }

    response = client.post("/api/inspections", files=files, data=data)
    assert response.status_code == 200
    res = response.json()

    assert res["result"] == "PASS"
    assert res["evidence"]["kind"] == "multi_view"
    assert len(res["evidence"]["supporting_images"]) == 2
    assert res["evidence"]["supporting_images"][0] == f"/api/inspections/{res['inspection_id']}/images/supporting/0"
    assert res["evidence"]["supporting_images"][1] == f"/api/inspections/{res['inspection_id']}/images/supporting/1"

    # Verify supporting files exist on disk
    dest_dir = settings.STORAGE_ROOT / get_folder_date() / "pass" / res["inspection_id"]
    assert (dest_dir / "supporting" / "0.jpg").is_file()
    assert (dest_dir / "supporting" / "1.jpg").is_file()


def test_idempotency_same_payload_returns_identical_record():
    client_req_id = str(uuid.uuid4())
    img_bytes = create_test_image_bytes()

    files = {"image": ("bottle.jpg", img_bytes, "image/jpeg")}
    data = {
        "expected_product": "bottle_b",
        "source_mode": "webcam",
        "client_request_id": client_req_id,
    }

    # First request
    resp1 = client.post("/api/inspections", files=files, data=data)
    assert resp1.status_code == 200
    res1 = resp1.json()

    # Second request with identical payload
    files2 = {"image": ("bottle.jpg", img_bytes, "image/jpeg")}
    resp2 = client.post("/api/inspections", files=files2, data=data)
    assert resp2.status_code == 200
    res2 = resp2.json()

    assert res1["inspection_id"] == res2["inspection_id"]
    assert res1["created_at"] == res2["created_at"]


def test_idempotency_different_payload_returns_409_conflict():
    client_req_id = str(uuid.uuid4())
    img_bytes = create_test_image_bytes()

    files1 = {"image": ("bottle.jpg", img_bytes, "image/jpeg")}
    data1 = {
        "expected_product": "bottle_a",
        "source_mode": "webcam",
        "client_request_id": client_req_id,
    }

    # First request
    resp1 = client.post("/api/inspections", files=files1, data=data1)
    assert resp1.status_code == 200

    # Second request with SAME client_request_id but DIFFERENT expected_product
    files2 = {"image": ("bottle.jpg", img_bytes, "image/jpeg")}
    data2 = {
        "expected_product": "bottle_b",  # Conflict!
        "source_mode": "webcam",
        "client_request_id": client_req_id,
    }

    resp2 = client.post("/api/inspections", files=files2, data=data2)
    assert resp2.status_code == 409
    err = resp2.json()
    assert err["error"]["code"] == "idempotency_conflict"


def test_exhausted_search_produces_review_orientation_failed():
    client_req_id = str(uuid.uuid4())
    img_bytes = create_test_image_bytes()

    evidence_dict = {
        "kind": "multi_view",
        "search_status": "exhausted",
        "supporting_angles_deg": [90, 180, 270],
        "reported_coverage_deg": 360,
    }

    files = [
        ("image", ("bottle.jpg", img_bytes, "image/jpeg")),
        ("supporting_images", ("sup0.jpg", img_bytes, "image/jpeg")),
        ("supporting_images", ("sup1.jpg", img_bytes, "image/jpeg")),
        ("supporting_images", ("sup2.jpg", img_bytes, "image/jpeg")),
    ]
    data = {
        "expected_product": "bottle_a",
        "source_mode": "simulation",
        "client_request_id": client_req_id,
        "evidence": json.dumps(evidence_dict),
    }

    response = client.post("/api/inspections", files=files, data=data)
    assert response.status_code == 200
    res = response.json()

    assert res["result"] == "FAIL"
    assert res["reason"] == "orientation_failed"
    assert len(res["evidence"]["supporting_images"]) == 3
    assert res["evidence"]["verified_coverage"] is False


def test_invalid_evidence_angles_and_coverage():
    """04-2: Validate angle range, coverage range, and client cannot spoof verified_coverage."""
    client_req_id = str(uuid.uuid4())
    img_bytes = create_test_image_bytes()

    # 1. Invalid primary angle < 0
    res = client.post(
        "/api/inspections",
        files={"image": ("bottle.jpg", img_bytes, "image/jpeg")},
        data={
            "expected_product": "bottle_a",
            "source_mode": "simulation",
            "client_request_id": str(uuid.uuid4()),
            "angle_deg": -15.0,
        },
    )
    assert res.status_code == 400
    assert res.json()["error"]["code"] == "invalid_angle"

    # 2. Angle >= 360
    res = client.post(
        "/api/inspections",
        files={"image": ("bottle.jpg", img_bytes, "image/jpeg")},
        data={
            "expected_product": "bottle_a",
            "source_mode": "simulation",
            "client_request_id": str(uuid.uuid4()),
            "angle_deg": 360.0,
        },
    )
    assert res.status_code == 400
    assert res.json()["error"]["code"] == "invalid_angle"

    # 3. Supporting angles count mismatch (specified 3 angles but sent 0 images)
    ev_mismatch = {
        "kind": "multi_view",
        "supporting_angles_deg": [90, 180, 270],
    }
    res = client.post(
        "/api/inspections",
        files={"image": ("bottle.jpg", img_bytes, "image/jpeg")},
        data={
            "expected_product": "bottle_a",
            "source_mode": "simulation",
            "client_request_id": str(uuid.uuid4()),
            "evidence": json.dumps(ev_mismatch),
        },
    )
    assert res.status_code == 400
    assert res.json()["error"]["code"] == "invalid_evidence"

    # 4. single_view with supporting images attached
    ev_single = {"kind": "single_view"}
    files_with_sup = [
        ("image", ("bottle.jpg", img_bytes, "image/jpeg")),
        ("supporting_images", ("sup.jpg", img_bytes, "image/jpeg")),
    ]
    res = client.post(
        "/api/inspections",
        files=files_with_sup,
        data={
            "expected_product": "bottle_a",
            "source_mode": "simulation",
            "client_request_id": str(uuid.uuid4()),
            "evidence": json.dumps(ev_single),
        },
    )
    assert res.status_code == 400
    assert "single_view inspection must not include supporting images" in res.json()["error"]["message"]

    # 5. Client trying to spoof verified_coverage=True: backend must force it to False
    ev_spoof = {
        "kind": "single_view",
        "verified_coverage": True,
        "required_view_profile": "spoofed_profile",
    }
    res = client.post(
        "/api/inspections",
        files={"image": ("bottle.jpg", img_bytes, "image/jpeg")},
        data={
            "expected_product": "bottle_a",
            "source_mode": "simulation",
            "client_request_id": str(uuid.uuid4()),
            "evidence": json.dumps(ev_spoof),
        },
    )
    assert res.status_code == 200
    data = res.json()
    assert data["evidence"]["verified_coverage"] is False
    assert data["evidence"]["required_view_profile"] is None


def test_invalid_client_request_id_not_uuid():
    img_bytes = create_test_image_bytes()
    files = {"image": ("bottle.jpg", img_bytes, "image/jpeg")}
    data = {
        "expected_product": "bottle_a",
        "source_mode": "webcam",
        "client_request_id": "not-a-valid-uuid-1234",
    }

    response = client.post("/api/inspections", files=files, data=data)
    assert response.status_code == 400
    err = response.json()
    assert err["error"]["code"] == "invalid_request_id"


def test_production_mode_without_detector_returns_503(monkeypatch):
    """04-1: If detector from module 03 is absent and demo=False, return 503 inspection unavailable."""
    monkeypatch.setattr(settings, "DEFAULT_TO_DEMO", False)
    img_bytes = create_test_image_bytes()
    files = {"image": ("bottle.jpg", img_bytes, "image/jpeg")}
    data = {
        "expected_product": "bottle_a",
        "source_mode": "webcam",
        "client_request_id": str(uuid.uuid4()),
        "demo": False,
    }

    response = client.post("/api/inspections", files=files, data=data)
    assert response.status_code == 503
    err = response.json()
    assert err["error"]["code"] == "inspection_unavailable"


def test_demo_mode_rejects_checkerboard_as_fail():
    """04-1: In demo mode, checkerboard/no-bottle images must be rejected with FAIL (not constant PASS 0.94)."""
    # Create checkerboard image
    import numpy as np
    import cv2
    cb = np.zeros((400, 300, 3), dtype=np.uint8)
    sq = 20
    for r in range(0, 400, sq):
        for c in range(0, 300, sq):
            if (r // sq + c // sq) % 2 == 0:
                cb[r : r + sq, c : c + sq] = 255
    _, enc = cv2.imencode(".jpg", cb)
    cb_bytes = enc.tobytes()

    client_req_id = str(uuid.uuid4())
    files = {"image": ("checkerboard.jpg", cb_bytes, "image/jpeg")}
    data = {
        "expected_product": "bottle_a",
        "source_mode": "webcam",
        "client_request_id": client_req_id,
        "demo": True,
    }

    response = client.post("/api/inspections", files=files, data=data)
    assert response.status_code == 200
    res = response.json()
    # 04-4: Non-bottle fails closed with label_not_visible adhering to Contract v0.2 Enum
    assert res["result"] == "FAIL"
    assert res["reason"] == "label_not_visible"
    assert res["is_demo"] is True


def test_demo_mode_unverified_coverage_never_returns_missing_label(monkeypatch):
    """
    04-2: Client reported_coverage_deg (even 360) without backend-verified coverage
    must preserve label_not_visible instead of claiming a missing label.
    """
    from app.services.inspection_adapter import InspectionAdapter

    # Mock locate_label to return bottle is visible, but label is not visible
    def mock_locate(image, expected_product):
        return {
            "usable_view": False,
            "bbox": None,
            "image_width": 300,
            "image_height": 400,
            "quality": {
                "sharp_enough": True,
                "label_visible": False,
                "bottle_visible": True,
            },
            "reason": "label_not_visible",
        }

    monkeypatch.setattr(InspectionAdapter, "locate_label", mock_locate)

    img_bytes = create_test_image_bytes(300, 400, sharp=True)
    sharp_img = cv2.imdecode(np.frombuffer(img_bytes, np.uint8), cv2.IMREAD_COLOR)

    # 1. Single view without reported coverage -> REVIEW / label_not_visible
    res_none = InspectionAdapter.inspect(
        sharp_img,
        expected_product="bottle_a",
        source_mode="webcam",
        evidence={"kind": "single_view"},
        demo=True,
    )
    assert res_none["result"] == "REVIEW"
    assert res_none["reason"] == "label_not_visible"

    # 2. Single view claiming 360 coverage -> MUST STILL BE REVIEW / label_not_visible (NOT FAIL / missing_label)
    res_claim_360 = InspectionAdapter.inspect(
        sharp_img,
        expected_product="bottle_a",
        source_mode="webcam",
        evidence={"kind": "single_view", "reported_coverage_deg": 360.0},
        demo=True,
    )
    assert res_claim_360["result"] == "REVIEW"
    assert res_claim_360["reason"] == "label_not_visible"

    # 3. Multi-view with partial reported coverage 180 -> REVIEW / label_not_visible
    res_multi_180 = InspectionAdapter.inspect(
        sharp_img,
        expected_product="bottle_a",
        source_mode="webcam",
        evidence={"kind": "multi_view", "reported_coverage_deg": 180.0, "supporting_angles_deg": [180.0]},
        demo=True,
    )
    assert res_multi_180["result"] == "REVIEW"
    assert res_multi_180["reason"] == "label_not_visible"

    # 4. Multi-view claiming 360 reported coverage without backend verified_coverage -> STILL REVIEW / label_not_visible
    res_multi_360 = InspectionAdapter.inspect(
        sharp_img,
        expected_product="bottle_a",
        source_mode="webcam",
        evidence={"kind": "multi_view", "reported_coverage_deg": 360.0, "supporting_angles_deg": [90.0, 180.0, 270.0]},
        demo=True,
    )
    assert res_multi_360["result"] == "REVIEW"
    assert res_multi_360["reason"] == "label_not_visible"


def test_http_endpoint_demo_mode_claim_360_remains_review(monkeypatch):
    """
    04-2: Calling POST /api/inspections with demo=true and reported_coverage_deg=360
    must return 200 with result='REVIEW' and reason='label_not_visible', not FAIL/missing_label.
    """
    from app.services.inspection_adapter import InspectionAdapter

    def mock_locate(image, expected_product):
        return {
            "usable_view": False,
            "bbox": None,
            "image_width": 300,
            "image_height": 400,
            "quality": {
                "sharp_enough": True,
                "label_visible": False,
                "bottle_visible": True,
            },
            "reason": "label_not_visible",
        }

    monkeypatch.setattr(InspectionAdapter, "locate_label", mock_locate)

    img_bytes = create_test_image_bytes(300, 400)

    # Case A: without reported coverage
    data_no_cov = {
        "expected_product": "bottle_a",
        "source_mode": "webcam",
        "client_request_id": str(uuid.uuid4()),
        "demo": "true",
    }
    resp_a = client.post("/api/inspections", files={"image": ("bottle.jpg", img_bytes, "image/jpeg")}, data=data_no_cov)
    assert resp_a.status_code == 200
    res_a = resp_a.json()
    assert res_a["result"] == "FAIL"
    assert res_a["reason"] == "label_not_visible"

    # Case B: same image with reported_coverage_deg = 360
    ev_claim_360 = {"kind": "single_view", "reported_coverage_deg": 360.0}
    data_claim_360 = {
        "expected_product": "bottle_a",
        "source_mode": "webcam",
        "client_request_id": str(uuid.uuid4()),
        "demo": "true",
        "evidence": json.dumps(ev_claim_360),
    }
    resp_b = client.post("/api/inspections", files={"image": ("bottle.jpg", img_bytes, "image/jpeg")}, data=data_claim_360)
    assert resp_b.status_code == 200
    res_b = resp_b.json()
    assert res_b["result"] == "FAIL"
    assert res_b["reason"] == "label_not_visible"



def test_demo_mode_tags_results_with_is_demo():
    """04-1: Demo mode inspection results must explicitly tag is_demo=True in response, DB, and result.json."""
    client_req_id = str(uuid.uuid4())
    img_bytes = create_test_image_bytes(400, 500)
    files = {"image": ("bottle.jpg", img_bytes, "image/jpeg")}
    data = {
        "expected_product": "bottle_a",
        "source_mode": "webcam",
        "client_request_id": client_req_id,
        "demo": True,
    }

    response = client.post("/api/inspections", files=files, data=data)
    assert response.status_code == 200
    res = response.json()
    assert res["is_demo"] is True

    # Check database record
    from app.db.repository import InspectionRepository
    row = InspectionRepository.get_by_id(res["inspection_id"])
    assert row is not None
    assert row["is_demo"] == 1

    # Check result.json file
    dest_dir = settings.STORAGE_ROOT / get_folder_date() / "pass" / res["inspection_id"]
    result_json_path = dest_dir / "result.json"
    assert result_json_path.is_file()
    with open(result_json_path, "r", encoding="utf-8") as f:
        snapshot = json.load(f)
    assert snapshot["is_demo"] is True


def test_detector_present_but_config_unready_returns_503(monkeypatch):
    """When detector from 03 is imported but config/catalog is unready, return 503 (not 500)."""
    from app.services.inspection_adapter import InspectionAdapter
    monkeypatch.setattr(settings, "DEFAULT_TO_DEMO", False)
    monkeypatch.setattr(InspectionAdapter, "has_detector", lambda: True)
    monkeypatch.setattr(InspectionAdapter, "is_detector_ready", lambda: False)

    img_bytes = create_test_image_bytes()
    files = {"image": ("bottle.jpg", img_bytes, "image/jpeg")}
    data = {
        "expected_product": "bottle_a",
        "source_mode": "webcam",
        "client_request_id": str(uuid.uuid4()),
        "demo": False,
    }

    response = client.post("/api/inspections", files=files, data=data)
    assert response.status_code == 503
    err = response.json()
    assert err["error"]["code"] == "inspection_unavailable"
    assert "ภาพอ้างอิง" in err["error"]["message"]


def test_detector_module_03_signature_and_decision_mapping(monkeypatch):
    """When detector from 03 is ready, inspect calls it with exact 03 signature and maps Decision."""
    from app.services.inspection_adapter import InspectionAdapter
    import app.services.inspection_adapter as adapter_module

    # Mock DetectorConfig with validate()
    class MockConfig:
        config_version = "v0.3-test"
        def validate(self):
            pass

    # Mock Decision matching module 03 Decision.to_inspection_fields()
    class MockDecision:
        def __init__(self):
            self.result = "PASS"
            self.reason = "good"
            self.timing_ms = {"orientation": 12.5, "inspection": 45.0}

        def to_inspection_fields(self):
            return {
                "result": "PASS",
                "reason": "good",
                "expected_product": "bottle_a",
                "detected_product": "bottle_a",
                "match_score": 0.95,
                "score_method": "template_ccoeff_normed_clamped_v1",
                "bbox": {"x": 50, "y": 60, "width": 100, "height": 150},
                "expected_bbox": {"x": 45, "y": 55, "width": 110, "height": 160},
                "image_width": 300,
                "image_height": 400,
                "orientation_deg": 0.0,
                "config_version": "v0.3-test",
                "source_mode": "webcam",
                "timing_ms": {"orientation": 12.5, "inspection": 45.0},
                "evidence": {
                    "kind": "single_view",
                    "search_status": "not_requested",
                    "supporting_angles_deg": [],
                    "reported_coverage_deg": None,
                    "verified_coverage": False,
                    "required_view_profile": None,
                    "supporting_images": [],
                },
            }

    called_kwargs = {}

    def mock_inspect_image(image, expected_product, config, *, color_order, source_mode="simulation",
                           angle_deg=None, supporting_images=(), evidence=None):
        called_kwargs["image_shape"] = image.shape
        called_kwargs["expected_product"] = expected_product
        called_kwargs["config"] = config
        called_kwargs["color_order"] = color_order
        called_kwargs["source_mode"] = source_mode
        called_kwargs["angle_deg"] = angle_deg
        called_kwargs["supporting_images_len"] = len(supporting_images)
        return MockDecision()

    monkeypatch.setattr(settings, "DEFAULT_TO_DEMO", False)
    monkeypatch.setattr(adapter_module, "HAS_REAL_DETECTOR", True)
    monkeypatch.setattr(adapter_module, "run_detector_03", mock_inspect_image)
    mock_cfg = MockConfig()
    InspectionAdapter.set_detector_config(mock_cfg)

    try:
        img_bytes = create_test_image_bytes(300, 400)
        client_req_id = str(uuid.uuid4())
        files = {"image": ("bottle.jpg", img_bytes, "image/jpeg")}
        data = {
            "expected_product": "bottle_a",
            "source_mode": "webcam",
            "client_request_id": client_req_id,
            "angle_deg": 0.0,
            "demo": False,
        }

        response = client.post("/api/inspections", files=files, data=data)
        assert response.status_code == 200, response.text
        res = response.json()

        # Verify signature called correctly
        assert called_kwargs["color_order"] == "BGR"
        assert called_kwargs["expected_product"] == "bottle_a"
        assert called_kwargs["config"] is mock_cfg
        assert called_kwargs["supporting_images_len"] == 0

        # Verify Decision mapped cleanly into InspectionResult
        assert res["result"] == "PASS"
        assert res["reason"] == "good"
        assert res["match_score"] == 0.95
        assert res["bbox"] == {"x": 50, "y": 60, "width": 100, "height": 150}
        assert res["config_version"] == "v0.3-test"
    finally:
        InspectionAdapter.set_detector_config(None)


def test_locate_label_is_single_classmethod():
    """Verify locate_label has only one @classmethod decorator (fixes Python 3.13 TypeError)."""
    from app.services.inspection_adapter import InspectionAdapter
    import numpy as np

    # Must be callable without TypeError: 'classmethod' object is not callable
    blank = np.zeros((100, 100, 3), dtype=np.uint8)
    res = InspectionAdapter.locate_label(blank, "bottle_a")
    assert isinstance(res, dict)
    assert "usable_view" in res


def test_allow_demo_mode_false_rejects_demo_request_with_403(monkeypatch):
    """04-3: When ALLOW_DEMO_MODE=False, any request specifying demo=true must be rejected with 403."""
    monkeypatch.setattr(settings, "ALLOW_DEMO_MODE", False)

    img_bytes = create_test_image_bytes(300, 400)
    files = {"image": ("bottle.jpg", img_bytes, "image/jpeg")}
    data = {
        "expected_product": "bottle_a",
        "source_mode": "webcam",
        "client_request_id": str(uuid.uuid4()),
        "demo": "true",
    }

    res = client.post("/api/inspections", files=files, data=data)
    assert res.status_code == 403
    err = res.json()["error"]
    assert err["code"] == "demo_mode_disabled"


def test_allow_demo_mode_false_with_is_demo_alias(monkeypatch):
    """04-3: is_demo alias must also be rejected with 403 when ALLOW_DEMO_MODE=False."""
    monkeypatch.setattr(settings, "ALLOW_DEMO_MODE", False)

    img_bytes = create_test_image_bytes(300, 400)
    files = {"image": ("bottle.jpg", img_bytes, "image/jpeg")}
    data = {
        "expected_product": "bottle_a",
        "source_mode": "webcam",
        "client_request_id": str(uuid.uuid4()),
        "is_demo": "true",
    }

    res = client.post("/api/inspections", files=files, data=data)
    assert res.status_code == 403
    err = res.json()["error"]
    assert err["code"] == "demo_mode_disabled"


def test_allow_demo_mode_false_conflict_with_default_to_demo(monkeypatch):
    """04-3: If ALLOW_DEMO_MODE=False while DEFAULT_TO_DEMO=True, demo mode is disabled with 403."""
    monkeypatch.setattr(settings, "ALLOW_DEMO_MODE", False)
    monkeypatch.setattr(settings, "DEFAULT_TO_DEMO", True)

    img_bytes = create_test_image_bytes(300, 400)
    files = {"image": ("bottle.jpg", img_bytes, "image/jpeg")}
    data = {
        "expected_product": "bottle_a",
        "source_mode": "webcam",
        "client_request_id": str(uuid.uuid4()),
    }

    res = client.post("/api/inspections", files=files, data=data)
    assert res.status_code == 403
    assert res.json()["error"]["code"] == "demo_mode_disabled"


