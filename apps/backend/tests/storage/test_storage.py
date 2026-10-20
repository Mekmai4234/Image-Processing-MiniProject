import json
import uuid
from pathlib import Path
import pytest
from app.core.config import settings
from app.core.timezone import get_folder_date, utc_now_iso
from app.db.connection import init_db
from app.db.repository import InspectionRepository
from app.services.storage import StorageManager


@pytest.fixture(autouse=True)
def setup_test_env():
    init_db()


def test_save_inspection_files():
    insp_id = str(uuid.uuid4())
    client_req_id = str(uuid.uuid4())
    folder_date = get_folder_date()
    result = "PASS"

    # Pre-insert pending DB record
    payload = {
        "inspection_id": insp_id,
        "client_request_id": client_req_id,
        "created_at": utc_now_iso(),
        "source_mode": "webcam",
        "expected_product": "bottle_a",
        "detected_product": "bottle_a",
        "result": result,
        "reason": "good",
        "match_score": 0.98,
        "score_method": "template_ccoeff_normed_clamped_v1",
        "bbox_x": 100,
        "bbox_y": 100,
        "bbox_width": 200,
        "bbox_height": 200,
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
        "timing_orientation_ms": 0.0,
        "timing_inspection_ms": 25.0,
        "timing_storage_ms": 0.0,
        "timing_total_ms": 25.0,
    }
    InspectionRepository.create_pending(payload)

    orig_bytes = b"FAKE_ORIGINAL_JPEG_CONTENT"
    annot_bytes = b"FAKE_ANNOTATED_JPEG_CONTENT"
    sup_bytes = [b"SUPPORTING_0", b"SUPPORTING_1"]
    decision = {
        "schema_version": "v0.2",
        "snapshot_type": "decision",
        "inspection_id": insp_id,
        "client_request_id": client_req_id,
        "result": result,
    }

    success, rel_path, error = StorageManager.save_inspection(
        inspection_id=insp_id,
        folder_date=folder_date,
        result=result,
        original_bytes=orig_bytes,
        annotated_bytes=annot_bytes,
        decision_snapshot=decision,
        supporting_images=sup_bytes,
    )

    assert success is True
    assert error is None
    assert rel_path == f"{folder_date}/pass/{insp_id}"

    # Verify files in final directory
    final_dir = settings.STORAGE_ROOT / rel_path
    assert (final_dir / "original.jpg").is_file()
    assert (final_dir / "annotated.jpg").is_file()
    assert (final_dir / "result.json").is_file()
    assert (final_dir / "supporting" / "0.jpg").is_file()
    assert (final_dir / "supporting" / "1.jpg").is_file()

    # Pending directory should be moved/gone
    assert not StorageManager.get_pending_dir(insp_id).exists()

    # DB status should now be saved
    rec = InspectionRepository.get_by_id(insp_id)
    assert rec["storage_status"] == "saved"
    assert rec["relative_folder_path"] == rel_path

    # Verify safe image lookup
    orig_path = StorageManager.get_image_path(insp_id, "original")
    assert orig_path is not None
    assert orig_path.is_file()

    annot_path = StorageManager.get_image_path(insp_id, "annotated")
    assert annot_path is not None
    assert annot_path.is_file()

    sup0_path = StorageManager.get_image_path(insp_id, "supporting", index=0)
    assert sup0_path is not None
    assert sup0_path.is_file()

    sup99_path = StorageManager.get_image_path(insp_id, "supporting", index=99)
    assert sup99_path is None


def test_retry_save_when_source_missing():
    insp_id = str(uuid.uuid4())
    client_req_id = str(uuid.uuid4())

    payload = {
        "inspection_id": insp_id,
        "client_request_id": client_req_id,
        "created_at": utc_now_iso(),
        "source_mode": "webcam",
        "expected_product": "bottle_a",
        "detected_product": None,
        "result": "FAIL",
        "reason": "missing_label",
        "match_score": 0.0,
        "score_method": "template_ccoeff_normed_clamped_v1",
        "bbox_x": None,
        "bbox_y": None,
        "bbox_width": None,
        "bbox_height": None,
        "expected_bbox_x": 100,
        "expected_bbox_y": 100,
        "expected_bbox_width": 200,
        "expected_bbox_height": 200,
        "image_width": 640,
        "image_height": 480,
        "orientation_deg": None,
        "config_version": "v0.2",
        "folder_date": get_folder_date(),
        "relative_folder_path": None,
        "evidence_json": None,
        "timing_orientation_ms": 0.0,
        "timing_inspection_ms": 20.0,
        "timing_storage_ms": 0.0,
        "timing_total_ms": 20.0,
    }
    InspectionRepository.create_pending(payload)

    # Attempt to retry save when pending dir has no files
    success, rel_path, error = StorageManager.retry_save_from_pending(insp_id)
    assert success is False
    assert error["code"] == "source_unavailable"
    assert error["retryable"] is False

    rec = InspectionRepository.get_by_id(insp_id)
    assert rec["storage_status"] == "failed"
    assert rec["storage_error_code"] == "source_unavailable"
    assert rec["storage_error_retryable"] == 0
