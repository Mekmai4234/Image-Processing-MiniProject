from typing import Any, List, Optional
from pydantic import BaseModel, Field


class HealthResponse(BaseModel):
    status: str = Field(..., description="Service health status", examples=["ok"])
    config_version: str = Field(..., description="Configuration and contract version", examples=["v0.2"])
    timezone: str = Field(..., description="Server configured application timezone", examples=["Asia/Bangkok"])
    storage_root_ready: bool = Field(..., description="Storage directory accessibility status", examples=[True])


class ProductItem(BaseModel):
    product_id: str = Field(..., description="Unique product identifier (e.g. bottle_a)")
    display_name: str = Field(..., description="Display name for UI")
    brand: Optional[str] = Field(None, description="Brand name if confirmed")
    size_ml: Optional[int] = Field(None, description="Volume size in ml")
    reference_paths: List[str] = Field(default_factory=list, description="Reference asset paths")
    validated: bool = Field(False, description="Whether product profile has been validated")


class SimulationDefaults(BaseModel):
    max_rotation_deg: int = Field(360, description="Maximum rotation angle in degrees")
    rotation_step_deg: int = Field(30, description="Step angle per rotation tick")


class ProductsResponse(BaseModel):
    config_version: str = Field(..., description="Catalog version")
    products: List[ProductItem] = Field(..., description="List of supported products")
    simulation_defaults: SimulationDefaults = Field(..., description="Default rotation settings for simulation")
