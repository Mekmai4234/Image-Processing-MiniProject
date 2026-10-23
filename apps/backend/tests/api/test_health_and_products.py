import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.core.config import settings

client = TestClient(app)


def test_root_endpoint():
    response = client.get("/")
    assert response.status_code == 200
    data = response.json()
    assert data["version"] == settings.CONFIG_VERSION
    assert "/api/health" in data["health_url"]


def test_health_endpoint():
    response = client.get("/api/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert data["config_version"] == settings.CONFIG_VERSION
    assert data["timezone"] == "Asia/Bangkok"
    assert data["storage_root_ready"] is True


def test_products_endpoint():
    response = client.get("/api/products")
    assert response.status_code == 200
    data = response.json()
    assert data["config_version"] == settings.CONFIG_VERSION
    assert isinstance(data["products"], list)
    assert len(data["products"]) == 1

    # Check bottle_a & bottle_b exist
    product_ids = [p["product_id"] for p in data["products"]]
    assert "bottle_a" in product_ids
    assert "bottle_b" not in product_ids

    # Check simulation defaults
    assert "simulation_defaults" in data
    sim = data["simulation_defaults"]
    assert sim["max_rotation_deg"] == settings.MAX_ROTATION_DEG
    assert sim["rotation_step_deg"] == settings.ROTATION_STEP_DEG
