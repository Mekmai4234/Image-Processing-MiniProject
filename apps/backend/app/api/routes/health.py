from fastapi import APIRouter
from app.core.config import settings
from app.models.schemas import HealthResponse

router = APIRouter(tags=["System"])


@router.get("/health", response_model=HealthResponse)
def get_health() -> HealthResponse:
    storage_ready = False
    try:
        storage_ready = settings.validate_storage_root()
    except Exception:
        storage_ready = False

    return HealthResponse(
        status="ok",
        config_version=settings.CONFIG_VERSION,
        timezone=settings.APP_TIMEZONE,
        storage_root_ready=storage_ready,
    )
