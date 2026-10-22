from fastapi import APIRouter
from app.api.routes import health, products, locate, shape, inspections, exports

api_router = APIRouter(prefix="/api")
api_router.include_router(health.router)
api_router.include_router(products.router)
api_router.include_router(locate.router)
api_router.include_router(shape.router)
api_router.include_router(exports.router)
api_router.include_router(inspections.router)

