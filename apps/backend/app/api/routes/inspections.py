import hashlib
import json
import math
import time
import uuid
from typing import Any, Dict, List, Optional
from uuid import UUID

from fastapi import APIRouter, File, Form, UploadFile, Query
from fastapi.responses import FileResponse, Response
from pydantic import ValidationError

from app.core.config import settings
from app.core.errors import APIError
from app.core.timezone import get_folder_date, utc_now_iso
from app.db.repository import InspectionRepository
from app.models.schemas import (
    InspectionResult,
    InspectionListResponse,
    InspectionFilesResponse,
    ReviewRequest,
    EvidenceInput,
)
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
    is_demo: bool = False,
) -> str:
    """SHA-256 over everything that defines an inspection request (contract: 'payload เดิม')."""
    h = hashlib.sha256()
    meta = {
        "expected_product": expected_product,
        "source_mode": source_mode,
        "angle_deg": None if angle_deg is None else round(float(angle_deg), 2),
        "evidence": evidence,
        "supporting_count": len(supporting_images),
        "is_demo": is_demo,
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
    is_demo: bool = False,
) -> bool:
    stored = existing.get("payload_fingerprint")
    if stored:
        return stored == fingerprint
    # Legacy rows created before fingerprints existed: compare the basic fields only
    stored_angle = existing.get("orientation_deg")
    angle_ok = (stored_angle is None and angle_deg is None) or (
        stored_angle is not None and angle_deg is not None and abs(stored_angle - angle_deg) < 0.01
    )
    return (
        existing["expected_product"] == expected_product
        and existing["source_mode"] == source_mode
        and angle_ok
        and bool(existing.get("is_demo", 0)) == is_demo
    )


@router.post("/inspections", response_model=InspectionResult)
async def create_inspection(
    image: UploadFile = File(..., description="Primary image for inspection"),
    expected_product: str = Form(..., description="Target product ID in catalog"),
    source_mode: str = Form(..., description="simulation or webcam"),
    client_request_id: str = Form(..., description="Unique idempotency UUID per inspection request"),
    angle_deg: Optional[float] = Form(None, description="Angle of primary image (0 to <360)"),
    supporting_images: List[UploadFile] = File(default=[], description="Optional additional evidence images"),
    evidence: Optional[str] = Form(None, description="Optional evidence JSON string"),
    demo: bool = Form(False, description="Enable development demo/mock mode"),
    is_demo: Optional[bool] = Form(None, description="Backward-compatible alias for demo"),
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

    # 2. Check demo mode allowance & detector availability (04-1, 04-3)
    requested_demo = demo or bool(is_demo)
    allow_demo = getattr(settings, "ALLOW_DEMO_MODE", True)

    if (requested_demo or getattr(settings, "DEFAULT_TO_DEMO", False)) and not allow_demo:
        raise APIError(
            status_code=403,
            code="demo_mode_disabled",
            message="Demo mode is disabled on this server. Real inspection module is required.",
            request_id=client_request_id,
        )

    # ALLOW_DEMO_MODE has top priority over DEFAULT_TO_DEMO
    is_demo = bool(allow_demo and (requested_demo or getattr(settings, "DEFAULT_TO_DEMO", False)))
    if not is_demo:
        if not InspectionAdapter.has_detector():
            raise APIError(
                status_code=503,
                code="inspection_unavailable",
                message="Inspection algorithm from module 03 is not installed or available on this backend. For development, specify demo=true.",
                request_id=client_request_id,
            )
        if not InspectionAdapter.is_detector_ready():
            raise APIError(
                status_code=503,
                code="inspection_unavailable",
                message="ยังไม่มีภาพอ้างอิงสินค้า กรุณาบันทึกอย่างน้อยหนึ่งสินค้าในหน้าตั้งค่าภาพอ้างอิงก่อนตรวจ",
                request_id=client_request_id,
            )

    # 3. Validate product
    active_config = InspectionAdapter.get_detector_config()
    if not is_demo and active_config and getattr(active_config, "reference_mode", False):
        if expected_product not in {product.product_id for product in active_config.products}:
            raise APIError(400, "reference_not_configured",
                           "สินค้าที่เลือกยังไม่มีภาพอ้างอิง กรุณาเลือกสินค้าที่บันทึกแล้ว หรือเพิ่มภาพในหน้าตั้งค่า",
                           request_id=client_request_id)
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

    # 4b. Validate primary angle_deg (0 <= angle < 360, must be finite)
    if angle_deg is not None:
        if not math.isfinite(angle_deg) or angle_deg < 0.0 or angle_deg >= 360.0:
            raise APIError(
                status_code=400,
                code="invalid_angle",
                message=f"angle_deg must be a finite number in range 0 <= angle_deg < 360, got {angle_deg}",
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
    for idx, sup in enumerate(supporting_images):
        if sup.filename:
            content = await sup.read()
            if not content:
                raise APIError(
                    status_code=400,
                    code="empty_file",
                    message=f"Supporting image at index {idx} ({sup.filename}) is empty",
                    request_id=client_request_id,
                )
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

    # 6. Parse and strictly validate evidence schema & supporting images consistency
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
            if not isinstance(parsed_ev, dict):
                raise ValueError("evidence must be a JSON object")
        except Exception as e:
            raise APIError(
                status_code=400,
                code="invalid_evidence",
                message=f"Invalid evidence JSON: {str(e)}",
                request_id=client_request_id,
            )

        try:
            validated_ev = EvidenceInput.model_validate(parsed_ev)
        except ValidationError as ve:
            raise APIError(
                status_code=422,
                code="invalid_evidence",
                message=f"Invalid evidence schema: {ve.errors()[0]['msg']}",
                request_id=client_request_id,
            )

        kind = validated_ev.kind
        if kind == "single_view" and len(supporting_raw_list) > 0:
            raise APIError(
                status_code=400,
                code="invalid_evidence",
                message="single_view inspection must not include supporting images",
                request_id=client_request_id,
            )
        if kind == "multi_view" and len(supporting_raw_list) == 0:
            raise APIError(
                status_code=400,
                code="invalid_evidence",
                message="multi_view inspection must include at least one supporting image",
                request_id=client_request_id,
            )

        sup_angles = validated_ev.supporting_angles_deg
        if len(sup_angles) != len(supporting_raw_list):
            raise APIError(
                status_code=400,
                code="invalid_evidence",
                message=f"Count of supporting_angles_deg ({len(sup_angles)}) does not match count of supporting_images ({len(supporting_raw_list)})",
                request_id=client_request_id,
            )

        evidence_dict["kind"] = kind
        evidence_dict["search_status"] = validated_ev.search_status
        evidence_dict["supporting_angles_deg"] = sup_angles
        evidence_dict["reported_coverage_deg"] = validated_ev.reported_coverage_deg
        # Backend owns coverage evaluation; client claims are never echoed blindly
        evidence_dict["verified_coverage"] = False
        evidence_dict["required_view_profile"] = None
    else:
        if supporting_raw_list:
            evidence_dict["kind"] = "multi_view"
            evidence_dict["supporting_angles_deg"] = [None for _ in supporting_raw_list]
        else:
            evidence_dict["kind"] = "single_view"
            evidence_dict["supporting_angles_deg"] = []

    # 6b. Idempotency: same client_request_id + identical payload -> original record,
    #     different payload -> 409 (never a silent re-inspection)
    fingerprint = compute_payload_fingerprint(
        expected_product=expected_product,
        source_mode=source_mode,
        angle_deg=angle_deg,
        evidence=evidence_dict,
        main_image=main_image_bytes,
        supporting_images=supporting_raw_list,
        is_demo=is_demo,
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
        demo=is_demo,
    )
    timing_inspection_ms = round((time.perf_counter() - t_start) * 1000, 2)

    # Binary acceptance policy: uncertainty is rejected with its original reason.
    if inspect_output['result'] == 'REVIEW':
        inspect_output['result'] = 'FAIL'

    # 9. Create annotated visual image
    annotated_bytes = InspectionAdapter.create_annotated_image(
        cv_bgr=cv_main,
        result=inspect_output["result"],
        reason=inspect_output["reason"],
        bbox=inspect_output.get("bbox"),
        expected_bbox=inspect_output.get("expected_bbox"),
        match_score=inspect_output.get("match_score"),
    )

    # 10. Record pending state in SQLite
    insp_id = str(uuid.uuid4())
    created_at = utc_now_iso()
    folder_date = get_folder_date()

    timing_dict = inspect_output.get("timing_ms") or {}
    timing_orientation_ms = float(timing_dict.get("orientation", 0.0))
    timing_inspection_ms = float(timing_dict.get("inspection", timing_inspection_ms))
    effective_config_version = inspect_output.get("config_version") or settings.CONFIG_VERSION

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
        "config_version": effective_config_version,
        "folder_date": folder_date,
        "relative_folder_path": None,
        "evidence_json": json.dumps(evidence_dict, ensure_ascii=False),
        "timing_orientation_ms": timing_orientation_ms,
        "timing_inspection_ms": timing_inspection_ms,
        "timing_storage_ms": 0.0,
        "timing_total_ms": timing_orientation_ms + timing_inspection_ms,
        "payload_fingerprint": fingerprint,
        "is_demo": 1 if is_demo else 0,
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
        "config_version": effective_config_version,
        "evidence": evidence_dict,
        "demo": is_demo,
        "is_demo": is_demo,
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
    demo: Optional[bool] = Query(None, description="Filter by demo mode (true/false)"),
    q: Optional[str] = Query(None, description="Search keyword matching IDs, products, or reason"),
    sort_by: Optional[str] = Query("created_at", description="Field to sort by: created_at, expected_product, result, match_score"),
    sort_order: Optional[str] = Query("desc", description="Sort order: asc or desc"),
) -> InspectionListResponse:
    # Validate date range
    if date_from and date_to and date_from > date_to:
        raise APIError(
            status_code=400,
            code="invalid_date_range",
            message=f"date_from ({date_from}) cannot be after date_to ({date_to})",
        )

    # Validate sort field against allowlist
    if sort_by and sort_by not in InspectionRepository.ALLOWED_SORT_FIELDS:
        allowed = list(InspectionRepository.ALLOWED_SORT_FIELDS.keys())
        raise APIError(
            status_code=400,
            code="invalid_sort_field",
            message=f"sort_by must be one of {allowed}, got '{sort_by}'",
        )

    # Validate sort order
    if sort_order and sort_order.lower() not in ("asc", "desc"):
        raise APIError(
            status_code=400,
            code="invalid_sort_order",
            message=f"sort_order must be 'asc' or 'desc', got '{sort_order}'",
        )

    rows, total = InspectionRepository.list_inspections(
        page=page,
        page_size=page_size,
        source_mode=source_mode,
        result=result,
        product_id=product_id,
        date_from=date_from,
        date_to=date_to,
        demo=demo,
        q=q,
        sort_by=sort_by,
        sort_order=sort_order,
    )

    items = [record_to_inspection_result(r) for r in rows]
    return InspectionListResponse(
        items=items,
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get("/inspections/{inspection_id}/files", response_model=InspectionFilesResponse)
def get_inspection_files(inspection_id: str) -> InspectionFilesResponse:
    """Check physical status of files on disk for inspection_id."""
    res = StorageManager.get_inspection_files(inspection_id)
    if not res:
        raise APIError(
            status_code=404,
            code="not_found",
            message=f"Inspection '{inspection_id}' not found",
            request_id=inspection_id,
        )
    return InspectionFilesResponse(**res)


@router.get("/inspections/{inspection_id}/download")
def download_inspection_bundle(inspection_id: str):
    """Download ZIP bundle containing original, annotated, result.json, and supporting files."""
    record = InspectionRepository.get_by_id(inspection_id)
    if not record:
        raise APIError(
            status_code=404,
            code="not_found",
            message=f"Inspection '{inspection_id}' not found",
            request_id=inspection_id,
        )

    files_info = StorageManager.get_inspection_files(inspection_id)
    if not files_info or not files_info.get("all_available"):
        missing = [f["name"] for f in (files_info["files"] if files_info else []) if not f.get("available")]
        missing_msg = f" ({', '.join(missing)})" if missing else ""
        raise APIError(
            status_code=409,
            code="files_incomplete",
            message=f"Inspection files are incomplete{missing_msg}. Bundle download is unavailable.",
            request_id=inspection_id,
        )

    zip_buf = StorageManager.create_inspection_zip(inspection_id)
    if not zip_buf:
        raise APIError(
            status_code=404,
            code="files_not_available",
            message=f"No stored files available for inspection '{inspection_id}' to download",
            request_id=inspection_id,
        )

    filename = f"inspection_{inspection_id}.zip"
    return Response(
        content=zip_buf.getvalue(),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/inspections/{inspection_id}/result.json")
def get_inspection_result_json(inspection_id: str):
    """Directly download or view the immutable decision snapshot result.json."""
    target_dir = StorageManager.get_inspection_dir(inspection_id)
    if not target_dir:
        raise APIError(
            status_code=404,
            code="not_found",
            message=f"Inspection '{inspection_id}' not found",
            request_id=inspection_id,
        )
    json_path = target_dir / "result.json"
    if not json_path.is_file():
        raise APIError(
            status_code=404,
            code="result_json_not_found",
            message=f"result.json for inspection '{inspection_id}' not found",
            request_id=inspection_id,
        )
    return FileResponse(str(json_path), media_type="application/json")


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
    valid_results = ("PASS", "FAIL")
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

