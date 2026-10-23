import json
from typing import Any, Dict, List, Optional
from app.core.config import settings
from app.db.repository import InspectionRepository
from app.models.schemas import (
    BBox,
    EvidenceInfo,
    ImageURLs,
    InspectionResult,
    StorageErrorInfo,
    TimingInfo,
)


def record_to_inspection_result(record: Dict[str, Any]) -> InspectionResult:
    """
    Convert an SQLite inspection record into the API Contract v0.2 InspectionResult model.
    Combines immutable decision snapshot from result.json with latest SQLite status.
    """
    inspection_id = record["inspection_id"]
    storage_status = record.get("storage_status", "pending")

    # Images URLs (only available when storage_status == 'saved')
    if storage_status == "saved":
        images = ImageURLs(
            original=f"/api/inspections/{inspection_id}/images/original",
            annotated=f"/api/inspections/{inspection_id}/images/annotated",
        )
    else:
        images = ImageURLs(original=None, annotated=None)

    # Overlay immutable decision snapshot from result.json if saved on disk
    rel_path = record.get("relative_folder_path")
    evidence_data: Dict[str, Any] = {}
    if rel_path:
        snapshot_file = settings.STORAGE_ROOT / rel_path / "result.json"
        if snapshot_file.is_file():
            try:
                with open(snapshot_file, "r", encoding="utf-8") as f:
                    snapshot = json.load(f)
                    for k in (
                        "result",
                        "reason",
                        "match_score",
                        "score_method",
                        "detected_product",
                        "image_width",
                        "image_height",
                        "orientation_deg",
                        "config_version",
                    ):
                        if k in snapshot:
                            record[k] = snapshot[k]
                    if "bbox" in snapshot:
                        b = snapshot["bbox"]
                        record["bbox_x"] = b["x"] if b else None
                        record["bbox_y"] = b["y"] if b else None
                        record["bbox_width"] = b["width"] if b else None
                        record["bbox_height"] = b["height"] if b else None
                    if "expected_bbox" in snapshot:
                        eb = snapshot["expected_bbox"]
                        record["expected_bbox_x"] = eb["x"] if eb else None
                        record["expected_bbox_y"] = eb["y"] if eb else None
                        record["expected_bbox_width"] = eb["width"] if eb else None
                        record["expected_bbox_height"] = eb["height"] if eb else None
                    if "evidence" in snapshot and isinstance(snapshot["evidence"], dict):
                        evidence_data = snapshot["evidence"]
            except Exception:
                pass

    if not evidence_data:
        raw_evidence = record.get("evidence_json")
        if raw_evidence:
            try:
                evidence_data = json.loads(raw_evidence)
            except Exception:
                evidence_data = {}

    supporting_angles = evidence_data.get("supporting_angles_deg", [])
    if storage_status == "saved":
        sup_urls: List[Optional[str]] = [
            f"/api/inspections/{inspection_id}/images/supporting/{idx}"
            for idx in range(len(supporting_angles))
        ]
    else:
        sup_urls = [None for _ in range(len(supporting_angles))]

    evidence = EvidenceInfo(
        kind=evidence_data.get("kind", "single_view"),
        search_status=evidence_data.get("search_status", "not_requested"),
        supporting_angles_deg=supporting_angles,
        reported_coverage_deg=evidence_data.get("reported_coverage_deg"),
        verified_coverage=evidence_data.get("verified_coverage", False),
        required_view_profile=evidence_data.get("required_view_profile"),
        supporting_images=sup_urls,
    )

    # BBoxes
    bbox = None
    if record.get("bbox_x") is not None:
        bbox = BBox(
            x=record["bbox_x"],
            y=record["bbox_y"],
            width=record["bbox_width"],
            height=record["bbox_height"],
        )

    expected_bbox = None
    if record.get("expected_bbox_x") is not None:
        expected_bbox = BBox(
            x=record["expected_bbox_x"],
            y=record["expected_bbox_y"],
            width=record["expected_bbox_width"],
            height=record["expected_bbox_height"],
        )

    # Storage Error
    storage_error = None
    if record.get("storage_error_code"):
        storage_error = StorageErrorInfo(
            code=record["storage_error_code"],
            message=record.get("storage_error_message") or "",
            retryable=bool(record.get("storage_error_retryable", 0)),
        )

    # Timing
    timing_ms = TimingInfo(
        orientation=record.get("timing_orientation_ms") or 0.0,
        inspection=record.get("timing_inspection_ms") or 0.0,
        storage=record.get("timing_storage_ms") or 0.0,
        total=record.get("timing_total_ms") or 0.0,
    )

    return InspectionResult(
        inspection_id=inspection_id,
        client_request_id=record["client_request_id"],
        created_at=record["created_at"],
        source_mode=record["source_mode"],
        expected_product=record["expected_product"],
        detected_product=record.get("detected_product"),
        result='FAIL' if record['result'] == 'REVIEW' else record['result'],
        reason=record["reason"],
        match_score=record.get("match_score"),
        score_method=record.get("score_method"),
        bbox=bbox,
        expected_bbox=expected_bbox,
        image_width=record["image_width"],
        image_height=record["image_height"],
        orientation_deg=record.get("orientation_deg"),
        timing_ms=timing_ms,
        config_version=record["config_version"],
        storage_status=storage_status,
        storage_error=storage_error,
        images=images,
        evidence=evidence,
        reviewed_result=record.get("reviewed_result"),
        reviewed_reason=record.get("reviewed_reason"),
        reviewer=record.get("reviewer"),
        reviewed_at=record.get("reviewed_at"),
        demo=bool(record.get("is_demo", 0)),
        is_demo=bool(record.get("is_demo", 0)),
    )
