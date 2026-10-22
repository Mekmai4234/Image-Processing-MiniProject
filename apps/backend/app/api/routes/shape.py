from fastapi import APIRouter, File, UploadFile
from app.core.errors import APIError
from app.models.schemas import BottleShapeResponse
from app.services.inspection_adapter import InspectionAdapter

router = APIRouter(tags=["Shape"])


@router.post("/bottle-shape", response_model=BottleShapeResponse)
async def extract_bottle_shape(
    image: UploadFile = File(..., description="Multipart single camera frame to extract bottle silhouette"),
) -> BottleShapeResponse:
    """
    Extract bottle silhouette, bounding box, and radial profile (Module 02-D / bottle-silhouette-v1).
    Used for 3D bottle revolution mesh without persisting records to history.
    """
    image_bytes = await image.read()
    if not image_bytes:
        raise APIError(
            status_code=400,
            code="empty_file",
            message="Uploaded image file is empty",
        )

    # 1. Decode and normalize EXIF orientation
    cv_bgr, _, _, _ = InspectionAdapter.decode_and_normalize(image_bytes)

    # 2. Analyze shape using pure image processing (Module 03)
    result = InspectionAdapter.analyze_bottle_shape(cv_bgr)
    return BottleShapeResponse(**result)
