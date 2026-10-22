import io
import cv2
import numpy as np
import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app.main import app

client = TestClient(app)


def create_bottle_silhouette_bytes(width=240, height=360) -> bytes:
    """Create a synthetic bottle silhouette on clean background."""
    img = np.full((height, width, 3), (235, 240, 245), np.uint8)
    points = [
        (95, 30), (145, 30), (145, 80), (175, 110),
        (175, 320), (65, 320), (65, 110), (95, 80)
    ]
    cv2.fillPoly(img, [np.array(points, np.int32)], (40, 110, 160))
    success, encoded = cv2.imencode(".jpg", img)
    assert success
    return encoded.tobytes()


def create_blank_image_bytes(width=240, height=360) -> bytes:
    """Create a blank background image without any bottle."""
    img = np.full((height, width, 3), (255, 255, 255), np.uint8)
    success, encoded = cv2.imencode(".jpg", img)
    assert success
    return encoded.tobytes()


def test_bottle_shape_success():
    """Verify ready silhouette response with 32 radial profile samples and no mask."""
    img_bytes = create_bottle_silhouette_bytes()
    files = {"image": ("bottle.jpg", img_bytes, "image/jpeg")}

    response = client.post("/api/bottle-shape", files=files)
    assert response.status_code == 200
    res = response.json()

    assert res["schema_version"] == "bottle-silhouette-v1"
    assert res["status"] == "ready"
    assert res["reason"] == "usable_silhouette"
    assert res["image_width"] == 240
    assert res["image_height"] == 360
    assert res["bbox"] is not None
    assert res["bbox"]["width"] > 0
    assert res["bbox"]["height"] > 0
    assert res["normalized_width"] is not None
    assert res["normalized_height"] is not None
    assert res["aspect_ratio"] is not None

    # Verify radial profile
    profile = res["radial_profile"]
    assert isinstance(profile, list)
    assert len(profile) == 32
    assert profile[0]["y_fraction"] == 0.0
    assert profile[-1]["y_fraction"] == 1.0
    for point in profile:
        assert "y_fraction" in point
        assert "radius_over_height" in point
        assert point["radius_over_height"] > 0

    # Verify quality and contour
    assert res["quality"]["whole_bottle_visible"] is True
    assert res["quality"]["axisymmetric_assumption"] is True
    assert len(res["contour"]) > 0

    # Ensure mask is NOT exposed
    assert "mask" not in res


def test_bottle_shape_fallback_on_empty_scene():
    """Verify fallback status when no bottle is detected in frame."""
    img_bytes = create_blank_image_bytes()
    files = {"image": ("empty.jpg", img_bytes, "image/jpeg")}

    response = client.post("/api/bottle-shape", files=files)
    assert response.status_code == 200
    res = response.json()

    assert res["schema_version"] == "bottle-silhouette-v1"
    assert res["status"] == "fallback"
    assert res["reason"] == "bottle_not_isolated"
    assert res["bbox"] is None
    assert res["normalized_width"] is None
    assert res["normalized_height"] is None
    assert res["aspect_ratio"] is None
    assert res["radial_profile"] == []
    assert res["quality"]["whole_bottle_visible"] is False
    assert res["quality"]["axisymmetric_assumption"] is True


def test_bottle_shape_empty_upload():
    """Upload of 0 bytes returns 400 empty_file."""
    files = {"image": ("empty.jpg", b"", "image/jpeg")}
    response = client.post("/api/bottle-shape", files=files)
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "empty_file"
