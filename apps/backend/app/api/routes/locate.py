from fastapi import APIRouter, File, Form, UploadFile
from app.core.config import settings
from app.core.errors import APIError
from app.models.schemas import LocateResponse
from app.services.inspection_adapter import InspectionAdapter

router = APIRouter(tags=["Locator"])


@router.post("/locate-label", response_model=LocateResponse)
async def locate_label(
    image: UploadFile = File(..., description="Multipart single camera frame to locate label candidate"),
    expected_product: str = Form(..., description="Product ID being searched"),
) -> LocateResponse:
    # 1. Validate product
    valid_products = [p["product_id"] for p in settings.SUPPORTED_PRODUCTS]
    if expected_product not in valid_products:
        raise APIError(
            status_code=400,
            code="invalid_product",
            message=f"Product '{expected_product}' not recognized in catalog. Valid options: {valid_products}",
        )

    # 2. Read bytes
    image_bytes = await image.read()
    if not image_bytes:
        raise APIError(
            status_code=400,
            code="empty_file",
            message="Uploaded image file is empty",
        )

    # 3. Decode & normalize EXIF
    cv_bgr, _, _, _ = InspectionAdapter.decode_and_normalize(image_bytes)

    # 4. Run locator (pure inspection candidate, does not persist to DB or Disk)
    result = InspectionAdapter.locate_label(cv_bgr, expected_product)
    return LocateResponse(**result)
