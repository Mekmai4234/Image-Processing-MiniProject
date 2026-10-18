import logging
from contextlib import asynccontextmanager
from typing import AsyncGenerator
from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.router import api_router
from app.core.config import settings
from app.core.errors import APIError, format_error_response
from app.db.connection import init_db
from app.services.storage import StorageManager

logger = logging.getLogger("uvicorn.error")


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    # Startup validation
    logger.info(f"Starting Vending Vision Backend (version {settings.CONFIG_VERSION})...")
    logger.info(f"Repository Root: {settings.REPO_ROOT}")
    logger.info(f"Storage Root: {settings.STORAGE_ROOT}")
    try:
        settings.validate_storage_root()
        logger.info(f"Storage directory validated and ready at: {settings.STORAGE_ROOT}")
        init_db()
        logger.info("SQLite database schema initialized.")
        reconcile_info = StorageManager.reconcile_on_startup()
        logger.info(f"Startup storage reconciliation completed: {reconcile_info}")
    except Exception as e:
        logger.error(f"Config error validating STORAGE_ROOT or initializing DB: {e}")
        raise e
    yield
    logger.info("Shutting down Vending Vision Backend...")


app = FastAPI(
    title="Vending Vision Backend",
    version=settings.CONFIG_VERSION,
    description="Inspection, Webcam, and Persistence API for Vending Vision",
    lifespan=lifespan,
)

# CORS Middleware
origins = [
    origin.strip()
    for origin in settings.WEB_ORIGIN.split(",")
    if origin.strip()
]
# Fallback to default vite origin if not empty
if not origins:
    origins = ["http://localhost:5173"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(APIError)
async def api_error_handler(request: Request, exc: APIError):
    return format_error_response(
        code=exc.code,
        message=exc.message,
        request_id=exc.request_id,
        status_code=exc.status_code,
    )


@app.exception_handler(RequestValidationError)
async def validation_error_handler(request: Request, exc: RequestValidationError):
    return format_error_response(
        code="validation_error",
        message=str(exc),
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
    )


# Include API Router
app.include_router(api_router)


@app.get("/")
def root():
    return {
        "name": "Vending Vision Backend API",
        "version": settings.CONFIG_VERSION,
        "docs_url": "/docs",
        "health_url": "/api/health",
        "products_url": "/api/products",
    }
