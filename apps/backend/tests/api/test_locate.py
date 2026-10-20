import io
import pytest
from fastapi.testclient import TestClient
from PIL import Image, ImageDraw
from app.main import app

client = TestClient(app)


def create_test_image_bytes(width=200, height=200, sharp=True) -> bytes:
    """Create a simple in-memory JPEG image."""
    img = Image.new("RGB", (width, height), color=(240, 240, 240))
    if sharp:
        draw = ImageDraw.Draw(img)
        draw.rectangle([int(width * 0.2), int(height * 0.2), int(width * 0.8), int(height * 0.8)], fill=(0, 0, 0))
    buf = io.BytesIO()
    img.save(buf, format="JPEG")
    return buf.getvalue()


def test_locate_label_success():
    img_bytes = create_test_image_bytes(300, 400, sharp=True)
    files = {"image": ("frame.jpg", img_bytes, "image/jpeg")}
    data = {"expected_product": "bottle_a"}

    response = client.post("/api/locate-label", files=files, data=data)
    assert response.status_code == 200
    res = response.json()

    assert res["usable_view"] is True
    assert res["quality"]["sharp_enough"] is True
    assert res["image_width"] == 300
    assert res["image_height"] == 400
    assert res["reason"] == "usable_view"
    assert res["bbox"] is not None


def test_locate_label_blurred_image():
    # Solid flat image produces variance 0, detecting blur
    img_bytes = create_test_image_bytes(300, 400, sharp=False)
    files = {"image": ("frame.jpg", img_bytes, "image/jpeg")}
    data = {"expected_product": "bottle_a"}

    response = client.post("/api/locate-label", files=files, data=data)
    assert response.status_code == 200
    res = response.json()

    assert res["usable_view"] is False
    assert res["quality"]["sharp_enough"] is False
    assert res["reason"] == "blurred_image"
    assert res["bbox"] is None


def test_locate_label_invalid_product():
    img_bytes = create_test_image_bytes(200, 200)
    files = {"image": ("frame.jpg", img_bytes, "image/jpeg")}
    data = {"expected_product": "invalid_bottle_xyz"}

    response = client.post("/api/locate-label", files=files, data=data)
    assert response.status_code == 400
    err = response.json()
    assert err["error"]["code"] == "invalid_product"


def test_locate_label_empty_file():
    files = {"image": ("empty.jpg", b"", "image/jpeg")}
    data = {"expected_product": "bottle_a"}

    response = client.post("/api/locate-label", files=files, data=data)
    assert response.status_code == 400
    err = response.json()
    assert err["error"]["code"] == "empty_file"


def test_locate_label_rejects_face_skin():
    # Simulate an image dominated by facial skin tones (HSV skin range)
    img = Image.new("RGB", (320, 320), color=(225, 180, 150))
    draw = ImageDraw.Draw(img)
    # Add facial features (eyes, mouth) to make it sharp
    draw.ellipse([100, 100, 130, 130], fill=(20, 20, 20))
    draw.ellipse([190, 100, 220, 130], fill=(20, 20, 20))
    draw.rectangle([120, 200, 200, 220], fill=(180, 50, 50))

    buf = io.BytesIO()
    img.save(buf, format="JPEG")

    files = {"image": ("face.jpg", buf.getvalue(), "image/jpeg")}
    data = {"expected_product": "bottle_a"}

    response = client.post("/api/locate-label", files=files, data=data)
    assert response.status_code == 200
    res = response.json()
    # Must NOT report usable_view or valid bottle for a human face
    assert res["usable_view"] is False
    assert res["quality"]["bottle_visible"] is False
    assert res["quality"]["label_visible"] is False
    assert res["reason"] == "label_not_visible"
    assert res["bbox"] is None

