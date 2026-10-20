from fastapi import APIRouter
from app.core.config import settings
from app.models.schemas import ProductsResponse, SimulationDefaults, ProductItem

router = APIRouter(tags=["Catalog"])


@router.get("/products", response_model=ProductsResponse)
def get_products() -> ProductsResponse:
    products = [ProductItem(**item) for item in settings.SUPPORTED_PRODUCTS]
    defaults = SimulationDefaults(
        max_rotation_deg=settings.MAX_ROTATION_DEG,
        rotation_step_deg=settings.ROTATION_STEP_DEG,
    )
    return ProductsResponse(
        config_version=settings.CONFIG_VERSION,
        products=products,
        simulation_defaults=defaults,
    )
