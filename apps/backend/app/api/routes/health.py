from fastapi import APIRouter
from app.core.config import settings
from app.models.schemas import HealthResponse
from app.services.inspection_adapter import InspectionAdapter

router = APIRouter(tags=["System"])


@router.get("/health", response_model=HealthResponse)
def get_health() -> HealthResponse:
    storage_ready = False
    try:
        storage_ready = settings.validate_storage_root()
    except Exception:
        storage_ready = False

    detector_ready = InspectionAdapter.is_detector_ready()
    if detector_ready:
        detector_status = "ready"
        active = InspectionAdapter.get_detector_config()
        reason = "Experimental user-reference matching; not independently validated" if getattr(active, "reference_mode", False) else None
    elif settings.ALLOW_DEMO_MODE:
        detector_status = "demo_ready"
        reason = "ยังไม่มีภาพอ้างอิงครบสองสินค้า กรุณาเปิดหน้าตั้งค่าภาพอ้างอิง"
    else:
        detector_status = "unavailable"
        reason = "Real detector templates and validation report are not yet configured"

    return HealthResponse(
        status="ok",
        config_version=settings.CONFIG_VERSION,
        timezone=settings.APP_TIMEZONE,
        storage_root_ready=storage_ready,
        detector_ready=detector_ready,
        detector_status=detector_status,
        readiness_reason=reason,
        detector_reason=reason,
    )
