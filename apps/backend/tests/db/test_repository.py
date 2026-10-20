import uuid
import pytest
from app.db.connection import init_db
from app.db.repository import InspectionRepository
from app.core.timezone import utc_now_iso, get_folder_date


@pytest.fixture(autouse=True)
def setup_db():
    init_db()


def test_create_and_idempotency():
    client_req_id = str(uuid.uuid4())
    insp_id = str(uuid.uuid4())
    now_iso = utc_now_iso()
    folder_date = get_folder_date()

    payload = {
        "inspection_id": insp_id,
        "client_request_id": client_req_id,
        "created_at": now_iso,
        "source_mode": "webcam",
        "expected_product": "bottle_a",
        "detected_product": "bottle_a",
        "result": "PASS",
        "reason": "good",
        "match_score": 0.95,
        "score_method": "template_ccoeff_normed_clamped_v1",
        "bbox_x": 100,
        "bbox_y": 150,
        "bbox_width": 200,
        "bbox_height": 250,
        "expected_bbox_x": None,
        "expected_bbox_y": None,
        "expected_bbox_width": None,
        "expected_bbox_height": None,
        "image_width": 640,
        "image_height": 480,
        "orientation_deg": 0.0,
        "config_version": "v0.2",
        "folder_date": folder_date,
        "relative_folder_path": None,
        "evidence_json": "{}",
        "timing_orientation_ms": 10.0,
        "timing_inspection_ms": 50.0,
        "timing_storage_ms": 0.0,
        "timing_total_ms": 60.0,
    }

    # First insert: creates new record
    created, record = InspectionRepository.create_pending(payload)
    assert created is True
    assert record["inspection_id"] == insp_id
    assert record["storage_status"] == "pending"

    # Second insert with SAME client_request_id: returns existing record (Idempotent)
    created2, record2 = InspectionRepository.create_pending(payload)
    assert created2 is False
    assert record2["inspection_id"] == insp_id
    assert record2["client_request_id"] == client_req_id


def test_storage_lifecycle_updates():
    insp_id = str(uuid.uuid4())
    client_req_id = str(uuid.uuid4())

    payload = {
        "inspection_id": insp_id,
        "client_request_id": client_req_id,
        "created_at": utc_now_iso(),
        "source_mode": "simulation",
        "expected_product": "bottle_b",
        "detected_product": None,
        "result": "FAIL",
        "reason": "wrong_label",
        "match_score": 0.12,
        "score_method": "template_ccoeff_normed_clamped_v1",
        "bbox_x": None,
        "bbox_y": None,
        "bbox_width": None,
        "bbox_height": None,
        "expected_bbox_x": None,
        "expected_bbox_y": None,
        "expected_bbox_width": None,
        "expected_bbox_height": None,
        "image_width": 800,
        "image_height": 600,
        "orientation_deg": None,
        "config_version": "v0.2",
        "folder_date": get_folder_date(),
        "relative_folder_path": None,
        "evidence_json": None,
        "timing_orientation_ms": 0.0,
        "timing_inspection_ms": 40.0,
        "timing_storage_ms": 0.0,
        "timing_total_ms": 40.0,
    }

    InspectionRepository.create_pending(payload)

    # Simulate storage failure first
    InspectionRepository.update_storage_failure(
        inspection_id=insp_id,
        error_code="disk_error",
        error_message="Simulated disk full",
        retryable=True,
    )

    rec = InspectionRepository.get_by_id(insp_id)
    assert rec["storage_status"] == "failed"
    assert rec["storage_error_code"] == "disk_error"
    assert rec["result"] == "FAIL"  # Decision remains unchanged!

    # Simulate storage success
    rel_path = f"{get_folder_date()}/fail/{insp_id}"
    InspectionRepository.update_storage_success(insp_id, rel_path, timing_storage_ms=15.5)

    rec = InspectionRepository.get_by_id(insp_id)
    assert rec["storage_status"] == "saved"
    assert rec["storage_error_code"] is None
    assert rec["relative_folder_path"] == rel_path
    assert rec["timing_storage_ms"] == 15.5
    assert rec["timing_total_ms"] == 55.5


def test_human_review_preserves_prediction():
    insp_id = str(uuid.uuid4())
    client_req_id = str(uuid.uuid4())

    payload = {
        "inspection_id": insp_id,
        "client_request_id": client_req_id,
        "created_at": utc_now_iso(),
        "source_mode": "webcam",
        "expected_product": "bottle_a",
        "detected_product": None,
        "result": "REVIEW",
        "reason": "ambiguous_match",
        "match_score": 0.55,
        "score_method": "template_ccoeff_normed_clamped_v1",
        "bbox_x": None,
        "bbox_y": None,
        "bbox_width": None,
        "bbox_height": None,
        "expected_bbox_x": None,
        "expected_bbox_y": None,
        "expected_bbox_width": None,
        "expected_bbox_height": None,
        "image_width": 640,
        "image_height": 480,
        "orientation_deg": None,
        "config_version": "v0.2",
        "folder_date": get_folder_date(),
        "relative_folder_path": None,
        "evidence_json": None,
        "timing_orientation_ms": 0.0,
        "timing_inspection_ms": 30.0,
        "timing_storage_ms": 0.0,
        "timing_total_ms": 30.0,
    }

    InspectionRepository.create_pending(payload)

    # Human review overrides final interpretation without modifying original prediction
    InspectionRepository.update_review(
        inspection_id=insp_id,
        reviewed_result="PASS",
        reviewed_reason="Label is visibly good under human inspection",
        reviewer="Inspector_A",
        reviewed_at=utc_now_iso(),
    )

    rec = InspectionRepository.get_by_id(insp_id)
    # Original prediction preserved
    assert rec["result"] == "REVIEW"
    assert rec["reason"] == "ambiguous_match"
    # Review fields updated
    assert rec["reviewed_result"] == "PASS"
    assert rec["reviewer"] == "Inspector_A"
