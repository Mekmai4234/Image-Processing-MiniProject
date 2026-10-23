import csv
import io
from typing import Optional
from fastapi import APIRouter, Query, Response

from app.core.errors import APIError
from app.db.repository import InspectionRepository

router = APIRouter(prefix="/exports", tags=["Exports"])


@router.get("/inspections.csv")
def export_inspections_csv(
    source_mode: Optional[str] = Query(None, description="Filter by source_mode"),
    result: Optional[str] = Query(None, description="Filter by result (PASS, FAIL, REVIEW)"),
    product_id: Optional[str] = Query(None, description="Filter by expected product ID"),
    date_from: Optional[str] = Query(None, description="Filter from YYYY-MM-DD"),
    date_to: Optional[str] = Query(None, description="Filter to YYYY-MM-DD"),
    demo: Optional[bool] = Query(None, description="Filter by demo mode (true/false)"),
    q: Optional[str] = Query(None, description="Search keyword matching IDs, products, or reason"),
    sort_by: Optional[str] = Query("created_at", description="Field to sort by"),
    sort_order: Optional[str] = Query("desc", description="Sort order: asc or desc"),
):
    if date_from and date_to and date_from > date_to:
        raise APIError(
            status_code=400,
            code="invalid_date_range",
            message=f"date_from ({date_from}) cannot be after date_to ({date_to})",
        )

    if sort_by and sort_by not in InspectionRepository.ALLOWED_SORT_FIELDS:
        allowed = list(InspectionRepository.ALLOWED_SORT_FIELDS.keys())
        raise APIError(
            status_code=400,
            code="invalid_sort_field",
            message=f"sort_by must be one of {allowed}, got '{sort_by}'",
        )

    if sort_order and sort_order.lower() not in ("asc", "desc"):
        raise APIError(
            status_code=400,
            code="invalid_sort_order",
            message=f"sort_order must be 'asc' or 'desc', got '{sort_order}'",
        )

    rows = InspectionRepository.export_inspections(
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

    fieldnames = [
        "inspection_id",
        "client_request_id",
        "created_at",
        "source_mode",
        "expected_product",
        "detected_product",
        "result",
        "reason",
        "match_score",
        "score_method",
        "bbox_x",
        "bbox_y",
        "bbox_width",
        "bbox_height",
        "image_width",
        "image_height",
        "orientation_deg",
        "storage_status",
        "demo",
        "reviewed_result",
        "reviewed_reason",
        "reviewer",
        "reviewed_at",
    ]

    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=fieldnames, extrasaction="ignore")
    writer.writeheader()
    for row in rows:
        row_dict = dict(row)
        if row_dict.get('result') == 'REVIEW':
            row_dict['result'] = 'FAIL'
        row_dict["demo"] = "true" if row_dict.get("is_demo") else "false"
        writer.writerow(row_dict)

    csv_content = output.getvalue()
    return Response(
        content=csv_content,
        media_type="text/csv",
        headers={
            "Content-Disposition": 'attachment; filename="inspections.csv"',
        },
    )
