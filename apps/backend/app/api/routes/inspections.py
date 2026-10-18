import hashlib
import json
import time
import uuid
from typing import Any, Dict, List, Optional
from uuid import UUID

from fastapi import APIRouter, File, Form, UploadFile, Query
from fastapi.responses import FileResponse
from app.core.config import settings
from app.core.errors import APIError
from app.core.timezone import get_folder_date, utc_now_iso
from app.db.repository import InspectionRepository
from app.models.schemas import InspectionResult, InspectionListResponse, ReviewRequest
from app.services.inspection_adapter import InspectionAdapter
from app.services.inspection_service import record_to_inspection_result
from app.services.storage import StorageManager

router = APIRouter(tags=["Inspections"])


def compute_payload_fingerprint(
    expected_product: str,
    source_mode: str,
    angle_deg: Optional[float],
    evidence: Dict[str, Any],
    main_image: bytes,
    supporting_images: List[bytes],
) -> str:
    """SHA-256 over everything that defines an inspection request (contract: 'payload เดิม')."""
    h = hashlib.sha256()
    meta = {
        "expected_product": expected_product,
        "source_mode": source_mode,
        "angle_deg": None if angle_deg is None else round(float(angle_deg), 2),
        "evidence": evidence,
        "supporting_count": len(supporting_images),
    }
    h.update(json.dumps(meta, sort_keys=True, ensure_ascii=False).encode("utf-8"))
    h.update(hashlib.sha256(main_image).digest())
    for sup in supporting_images:
        h.update(hashlib.sha256(sup).digest())
    return h.hexdigest()


def _payload_matches(
    existing: Dict[str, Any],
    fingerprint: str,
    expected_product: str,
    source_mode: str,
    angle_deg: Optional[float],
) -> bool:
    stored = existing.get("payload_fingerprint")
    if stored:
        return stored == fingerprint
    # Legacy rows created before fingerprints existed: compare the basic fields only
    stored_angle = existing.get("orientation_deg")
    angle_ok = (stored_angle is None and angle_deg is None) or (
        stored_angle is not None and angle_deg is not None and abs(stored_angle - angle_deg) < 0.01
    )
    return existing["expected_product"] == expected_product and existing["source_mode"] == source_mode and angle_ok


@router.post("/inspections", response_model=InspectionResult)
async def create_inspection(
    image: UploadFile = File(..., description="Primary image for inspection"),
    expected_product: str = Form(..., description="Target product ID in catalog"),
    source_mode: str = Form(..., description="simulation or webcam"),
    client_request_id: str = Form(..., description="Unique idempotency UUID per inspection request"),
    angle_deg: Optional[float] = Form(None, description="Angle of primary image (0 to <360)"),
    supporting_images: List[UploadFile] = File(default=[], description="Optional additional evidence images"),
    evidence: Optional[str] = Form(None, description="Optional evidence JSON string"),
) -> InspectionResult:
    # 1. Validate client_request_id as UUID
    try:
        UUID(client_request_id)
    except Exception:
        raise APIError(
            status_code=400,
            code="invalid_request_id",
            message=f"client_request_id '{client_request_id}' is not a valid UUID",
            request_id=client_request_id,
        )

    # 2. (Idempotency check happens after the payload is read, see step 6b)

    # 3. Validate product
    valid_products = [p["product_id"] for p in settings.SUPPORTED_PRODUCTS]
    if expected_product not in valid_products:
        raise APIError(
            status_code=400,
            code="invalid_product",
            message=f"Product '{expected_product}' not recognized in catalog. Valid options: {valid_products}",
            request_id=client_request_id,
        )

    # 4. Validate source_mode
    if source_mode not in ("simulation", "webcam"):
        raise APIError(
            status_code=400,
            code="invalid_source_mode",
            message=f"source_mode must be 'simulation' or 'webcam', got '{source_mode}'",
            request_id=client_request_id,
        )

    # 5. Read image bytes and validate total request limits
    main_image_bytes = await image.read()
    if not main_image_bytes:
        raise APIError(
            status_code=400,
            code="empty_file",
            message="Primary inspection image file is empty",
            request_id=client_request_id,
        )

    supporting_raw_list: List[bytes] = []
    for sup in supporting_images:
        if sup.filename:
            content = await sup.read()
            if content:
                supporting_raw_list.append(content)

    total_views = 1 + len(supporting_raw_list)
    if total_views > settings.MAX_INSPECTION_VIEWS:
        raise APIError(
            status_code=413,
            code="too_many_views",
            message=f"Total views ({total_views}) exceeds MAX_INSPECTION_VIEWS ({settings.MAX_INSPECTION_VIEWS})",
            request_id=client_request_id,
        )

    total_bytes = len(main_image_bytes) + sum(len(b) for b in supporting_raw_list)
    if total_bytes > settings.MAX_REQUEST_MB * 1_000_000:
        raise APIError(
            status_code=413,
            code="request_too_large",
            message=f"Total request size ({total_bytes} bytes) exceeds limit of {settings.MAX_REQUEST_MB} MB",
            request_id=client_request_id,
        )

    # 6. Parse evidence
    evidence_dict: Dict[str, Any] = {
        "kind": "multi_view" if supporting_raw_list else "single_view",
        "search_status": "not_requested",
        "supporting_angles_deg": [],
        "reported_coverage_deg": None,
        "verified_coverage": False,
        "required_view_profile": None,
    }
    if evidence:
        try:
            parsed_ev = json.loads(evidence)
            if isinstance(parsed_ev, dict):
                evidence_dict.update(parsed_ev)
            else:
                raise ValueError("evidence must be a JSON object")
        except Exception as e:
            raise APIError(
                status_code=400,
                code="invalid_evidence",
                message=f"Invalid evidence JSON: {str(e)}",
                request_id=client_request_id,
            )

    # 6b. Idempotency: same client_request_id + identical payload -> original record,
    #     different payload -> 409 (never a silent re-inspection)
    fingerprint = compute_payload_fingerprint(
        expected_product=expected_product,
        source_mode=source_mode,
        angle_deg=angle_deg,
        evidence=evidence_dict,
        main_image=main_image_bytes,
        supporting_images=supporting_raw_list,
    )
    existing = InspectionRepository.get_by_client_request_id(client_request_id)
    if existing:
        if not _payload_matches(existing, fingerprint, expected_product, source_mode, angle_deg):
            raise APIError(
                status_code=409,
                code="idempotency_conflict",
                message=f"client_request_id '{client_request_id}' was already submitted with different parameters",
                request_id=client_request_id,
            )
        return record_to_inspection_result(existing)

    # 7. Decode & normalize main and supporting images
    cv_main, norm_main_bytes, w, h = InspectionAdapter.decode_and_normalize(main_image_bytes)
    supporting_cv_list = []
    norm_sup_bytes_list = []
    for sup_bytes in supporting_raw_list:
        cv_sup, norm_sup_b, _, _ = InspectionAdapter.decode_and_normalize(sup_bytes)
        supporting_cv_list.append(cv_sup)
        norm_sup_bytes_list.append(norm_sup_b)

    # 8. Run inspection
    t_start = time.perf_counter()
    inspect_output = InspectionAdapter.inspect(
        cv_bgr=cv_main,
        expected_product=expected_product,
        source_mode=source_mode,
        angle_deg=angle_deg,
        evidence=evidence_dict,
        supporting_cv_images=supporting_cv_list,
    )
    timing_inspection_ms = round((time.perf_counter() - t_start) * 1000, 2)

    # 9. Create annotated visual image
    annotated_bytes = InspectionAdapter.create_annotated_image(
        cv_bgr=cv_main,
        result=inspect_output["result"],
        reason=inspect_output["reason"],
        bbox=inspect_output.get("bbox"),
        expected_bbox=inspect_output.get("expected_bbox"),
    )

    # 10. Record pending state in SQLite
    insp_id = str(uuid.uuid4())
    created_at = utc_now_iso()
    folder_date = get_folder_date()

    db_payload = {
        "inspection_id": insp_id,
        "client_request_id": client_request_id,
        "created_at": created_at,
        "source_mode": source_mode,
        "expected_product": expected_product,
        "detected_product": inspect_output.get("detected_product"),
        "result": inspect_output["result"],
        "reason": inspect_output["reason"],
        "match_score": inspect_output.get("match_score"),
        "score_method": inspect_output.get("score_method"),
        "bbox_x": inspect_output["bbox"]["x"] if inspect_output.get("bbox") else None,
        "bbox_y": inspect_output["bbox"]["y"] if inspect_output.get("bbox") else None,
        "bbox_width": inspect_output["bbox"]["width"] if inspect_output.get("bbox") else None,
        "bbox_height": inspect_output["bbox"]["height"] if inspect_output.get("bbox") else None,
        "expected_bbox_x": inspect_output["expected_bbox"]["x"] if inspect_output.get("expected_bbox") else None,
        "expected_bbox_y": inspect_output["expected_bbox"]["y"] if inspect_output.get("expected_bbox") else None,
        "expected_bbox_width": inspect_output["expected_bbox"]["width"] if inspect_output.get("expected_bbox") else None,
        "expected_bbox_height": inspect_output["expected_bbox"]["height"] if inspect_output.get("expected_bbox") else None,
        "image_width": w,
        "image_height": h,
        "orientation_deg": angle_deg,
        "config_version": settings.CONFIG_VERSION,
        "folder_date": folder_date,
        "relative_folder_path": None,
        "evidence_json": json.dumps(evidence_dict, ensure_ascii=False),
        "timing_orientation_ms": 0.0,
        "timing_inspection_ms": timing_inspection_ms,
        "timing_storage_ms": 0.0,
        "timing_total_ms": timing_inspection_ms,
        "payload_fingerprint": fingerprint,
    }

    created, initial_record = InspectionRepository.create_pending(db_payload)
    if not created:
        # Race condition: someone already created client_request_id
        if not _payload_matches(initial_record, fingerprint, expected_product, source_mode, angle_deg):
            raise APIError(
                status_code=409,
                code="idempotency_conflict",
                message=f"client_request_id '{client_request_id}' was already submitted with different parameters",
                request_id=client_request_id,
            )
        return record_to_inspection_result(initial_record)

    # 11. Write files and transition storage state
    decision_snapshot = {
        "schema_version": settings.CONFIG_VERSION,
        "snapshot_type": "decision",
        "inspection_id": insp_id,
        "client_request_id": client_request_id,
        "created_at": created_at,
        "source_mode": source_mode,
        "expected_product": expected_product,
        "detected_product": inspect_output.get("detected_product"),
        "result": inspect_output["result"],
        "reason": inspect_output["reason"],
        "match_score": inspect_output.get("match_score"),
        "score_method": inspect_output.get("score_method"),
        "bbox": inspect_output.get("bbox"),
        "expected_bbox": inspect_output.get("expected_bbox"),
        "image_width": w,
        "image_height": h,
        "orientation_deg": angle_deg,
        "config_version": settings.CONFIG_VERSION,
        "evidence": evidence_dict,
    }

    StorageManager.save_inspection(
        inspection_id=insp_id,
        folder_date=folder_date,
        result=inspect_output["result"],
        original_bytes=norm_main_bytes,
        annotated_bytes=annotated_bytes,
        decision_snapshot=decision_snapshot,
        supporting_images=norm_sup_bytes_list,
    )

    # 12. Fetch final state and return
    final_record = InspectionRepository.get_by_id(insp_id)
    return record_to_inspection_result(final_record or initial_record)


@router.get("/inspections", response_model=InspectionListResponse)
def list_inspections(
    page: int = Query(1, ge=1, description="Page number starting at 1"),
    page_size: int = Query(20, ge=1, le=100, description="Items per page (max 100)"),
    source_mode: Optional[str] = Query(None, description="Filter by simulation or webcam"),
    result: Optional[str] = Query(None, description="Filter by PASS, FAIL, or REVIEW"),
    product_id: Optional[str] = Query(None, description="Filter by expected product ID"),
    date_from: Optional[str] = Query(None, description="Filter from YYYY-MM-DD (Asia/Bangkok)"),
    date_to: Optional[str] = Query(None, description="Filter to YYYY-MM-DD (Asia/Bangkok)"),
) -> InspectionListResponse:
    # Validate date range
    if date_from and date_to and date_from > date_to:
        raise APIError(
            status_code=400,
            code="invalid_date_range",
            message=f"date_from ({date_from}) cannot be after date_to ({date_to})",
        )

    rows, total = InspectionRepository.list_inspections(
        page=page,
        page_size=page_size,
        source_mode=source_mode,
        result=result,
        product_id=product_id,
        date_from=date_from,
        date_to=date_to,
    )

    items = [record_to_inspection_result(r) for r in rows]
    return InspectionListResponse(
        items=items,
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get("/inspections/{inspection_id}", response_model=InspectionResult)
def get_inspection_detail(inspection_id: str) -> InspectionResult:
    record = InspectionRepository.get_by_id(inspection_id)
    if not record:
        raise APIError(
            status_code=404,
            code="not_found",
            message=f"Inspection '{inspection_id}' not found",
            request_id=inspection_id,
        )
    return record_to_inspection_result(record)


@router.get("/inspections/{inspection_id}/images/{kind}")
def get_inspection_image(inspection_id: str, kind: str):
    if kind not in ("original", "annotated"):
        raise APIError(
            status_code=400,
            code="invalid_image_kind",
            message=f"kind must be 'original' or 'annotated', got '{kind}'",
            request_id=inspection_id,
        )

    img_path = StorageManager.get_image_path(inspection_id, kind)
    if not img_path:
        raise APIError(
            status_code=404,
            code="image_not_found",
            message=f"Image '{kind}' for inspection '{inspection_id}' not found or not yet saved",
            request_id=inspection_id,
        )

    return FileResponse(str(img_path), media_type="image/jpeg")


@router.get("/inspections/{inspection_id}/images/supporting/{index}")
def get_supporting_image(inspection_id: str, index: int):
    if index < 0:
        raise APIError(
            status_code=400,
            code="invalid_index",
            message=f"supporting image index must be >= 0, got {index}",
            request_id=inspection_id,
        )

    img_path = StorageManager.get_image_path(inspection_id, "supporting", index)
    if not img_path:
        raise APIError(
            status_code=404,
            code="image_not_found",
            message=f"Supporting image at index {index} for inspection '{inspection_id}' not found or not yet saved",
            request_id=inspection_id,
        )

    return FileResponse(str(img_path), media_type="image/jpeg")


@router.patch("/inspections/{inspection_id}/review", response_model=InspectionResult)
def review_inspection(inspection_id: str, review: ReviewRequest) -> InspectionResult:
    valid_results = ("PASS", "FAIL", "REVIEW")
    if review.reviewed_result not in valid_results:
        raise APIError(
            status_code=400,
            code="invalid_reviewed_result",
            message=f"reviewed_result must be one of {valid_results}, got '{review.reviewed_result}'",
            request_id=inspection_id,
        )

    record = InspectionRepository.get_by_id(inspection_id)
    if not record:
        raise APIError(
            status_code=404,
            code="not_found",
            message=f"Inspection '{inspection_id}' not found",
            request_id=inspection_id,
        )

    now_iso = utc_now_iso()
    InspectionRepository.update_review(
        inspection_id=inspection_id,
        reviewed_result=review.reviewed_result,
        reviewed_reason=review.reviewed_reason,
        reviewer=review.reviewer,
        reviewed_at=now_iso,
    )

    updated = InspectionRepository.get_by_id(inspection_id)
    return record_to_inspection_result(updated or record)


@router.post("/inspections/{inspection_id}/retry-save", response_model=InspectionResult)
def retry_save_inspection(inspection_id: str) -> InspectionResult:
    record = InspectionRepository.get_by_id(inspection_id)
    if not record:
        raise APIError(
            status_code=404,
            code="not_found",
            message=f"Inspection '{inspection_id}' not found",
            request_id=inspection_id,
        )

    StorageManager.retry_save_from_pending(inspection_id)
    updated = InspectionRepository.get_by_id(inspection_id)
    return record_to_inspection_result(updated or record)

