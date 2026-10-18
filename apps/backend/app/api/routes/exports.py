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
):
    if date_from and date_to and date_from > date_to:
        raise APIError(
            status_code=400,
            code="invalid_date_range",
            message=f"date_from ({date_from}) cannot be after date_to ({date_to})",
        )

    rows = InspectionRepository.export_inspections(
        source_mode=source_mode,
        result=result,
        product_id=product_id,
        date_from=date_from,
        date_to=date_to,
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
        "reviewed_result",
        "reviewed_reason",
        "reviewer",
        "reviewed_at",
    ]

    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=fieldnames, extrasaction="ignore")
    writer.writeheader()
    for row in rows:
        writer.writerow(row)

    csv_content = output.getvalue()
    return Response(
        content=csv_content,
        media_type="text/csv",
        headers={
            "Content-Disposition": 'attachment; filename="inspections.csv"',
        },
    )
