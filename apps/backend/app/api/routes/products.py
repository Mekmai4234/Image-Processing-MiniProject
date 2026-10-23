from fastapi import APIRouter
from app.core.config import settings
from app.models.schemas import ProductsResponse, SimulationDefaults, ProductItem

router = APIRouter(tags=["Catalog"])


@router.get("/products", response_model=ProductsResponse)
def get_products() -> ProductsResponse:
    products = [ProductItem(**item) for item in settings.SUPPORTED_PRODUCTS[:1]]
    if products and not products[0].reference_paths:
        products[0].display_name = 'สินค้าอ้างอิง — ยังไม่ได้ตั้งค่า'
    defaults = SimulationDefaults(
        max_rotation_deg=settings.MAX_ROTATION_DEG,
        rotation_step_deg=settings.ROTATION_STEP_DEG,
    )
    return ProductsResponse(
        config_version=settings.CONFIG_VERSION,
        products=products,
        simulation_defaults=defaults,
    )
