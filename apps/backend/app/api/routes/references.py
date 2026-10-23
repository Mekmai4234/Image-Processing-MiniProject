import json
from fastapi import APIRouter, File, Form, UploadFile
from fastapi.responses import FileResponse
from app.core.config import settings
from app.core.errors import APIError
from app.services import reference_profile

router = APIRouter(tags=["Reference setup"])


@router.get("/reference-profile")
def get_profile():
    return reference_profile.public_profile()


@router.post("/reference-profile")
async def configure_reference(product_id: str = Form(...), name: str = Form(...),
                              crop: str = Form(...), acknowledge_experimental: bool = Form(False),
                              image: UploadFile = File(...)):
    if not acknowledge_experimental:
        raise APIError(400, "acknowledgement_required", "Reference matching is experimental, not independently validated")
    limit = settings.MAX_UPLOAD_MB * 1_000_000
    payload = await image.read(limit+1)
    if len(payload) > limit:
        raise APIError(413, "upload_too_large", "Reference exceeds upload limit")
    try:
        rectangle = json.loads(crop)
    except (ValueError, TypeError):
        raise APIError(400, "invalid_crop", "Crop must be a JSON array")
    return reference_profile.save_reference(product_id, name, payload, rectangle)


@router.get("/reference-profile/images/{product_id}")
def get_reference_image(product_id: str):
    item = reference_profile.read_profile()["products"].get(product_id)
    if item is None:
        raise APIError(404, "not_found", "Reference not configured")
    path = reference_profile.image_path(item)
    if not path.is_file():
        raise APIError(404, "not_found", "Reference image unavailable")
    return FileResponse(path, media_type="image/jpeg")
