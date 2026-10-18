import io
import json
import uuid
import pytest
from fastapi.testclient import TestClient
from PIL import Image, ImageDraw

from app.main import app

client = TestClient(app)


def create_test_image(width=300, height=400) -> bytes:
    img = Image.new("RGB", (width, height), color=(240, 240, 240))
    draw = ImageDraw.Draw(img)
    draw.rectangle([60, 80, 240, 320], fill=(0, 0, 0))
    buf = io.BytesIO()
    img.save(buf, format="JPEG")
    return buf.getvalue()


@pytest.fixture
def created_inspection():
    """Create a sample saved inspection for testing retrieval, review, and export."""
    client_req_id = str(uuid.uuid4())
    img_bytes = create_test_image()
    sup_bytes = create_test_image()

    evidence_dict = {
        "kind": "multi_view",
        "search_status": "usable_view_found",
        "supporting_angles_deg": [90],
        "reported_coverage_deg": 90,
    }

    files = [
        ("image", ("bottle.jpg", img_bytes, "image/jpeg")),
        ("supporting_images", ("sup.jpg", sup_bytes, "image/jpeg")),
    ]
    data = {
        "expected_product": "bottle_a",
        "source_mode": "webcam",
        "client_request_id": client_req_id,
        "angle_deg": 0.0,
        "evidence": json.dumps(evidence_dict),
    }

    resp = client.post("/api/inspections", files=files, data=data)
    assert resp.status_code == 200
    return resp.json()


def test_list_inspections_pagination(created_inspection):
    response = client.get("/api/inspections?page=1&page_size=10")
    assert response.status_code == 200
    data = response.json()

    assert "items" in data
    assert "total" in data
    assert data["total"] >= 1
    assert data["page"] == 1
    assert data["page_size"] == 10
    assert len(data["items"]) >= 1


def test_list_inspections_filters(created_inspection):
    # Filter by result
    resp_pass = client.get("/api/inspections?result=PASS")
    assert resp_pass.status_code == 200
    data_pass = resp_pass.json()
    for item in data_pass["items"]:
        assert item["result"] == "PASS"

    # Filter by product_id
    resp_prod = client.get("/api/inspections?product_id=bottle_a")
    assert resp_prod.status_code == 200
    data_prod = resp_prod.json()
    for item in data_prod["items"]:
        assert item["expected_product"] == "bottle_a"

    # Filter by inverted date range (should error 400)
    resp_err = client.get("/api/inspections?date_from=2026-12-31&date_to=2026-01-01")
    assert resp_err.status_code == 400
    assert resp_err.json()["error"]["code"] == "invalid_date_range"


def test_get_inspection_detail(created_inspection):
    insp_id = created_inspection["inspection_id"]
    response = client.get(f"/api/inspections/{insp_id}")
    assert response.status_code == 200
    data = response.json()

    assert data["inspection_id"] == insp_id
    assert data["client_request_id"] == created_inspection["client_request_id"]
    assert data["result"] == "PASS"


def test_get_inspection_detail_not_found():
    random_id = str(uuid.uuid4())
    response = client.get(f"/api/inspections/{random_id}")
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "not_found"


def test_get_inspection_images(created_inspection):
    insp_id = created_inspection["inspection_id"]

    # 1. Original image
    resp_orig = client.get(f"/api/inspections/{insp_id}/images/original")
    assert resp_orig.status_code == 200
    assert resp_orig.headers["content-type"] == "image/jpeg"
    assert len(resp_orig.content) > 0

    # 2. Annotated image
    resp_annot = client.get(f"/api/inspections/{insp_id}/images/annotated")
    assert resp_annot.status_code == 200
    assert resp_annot.headers["content-type"] == "image/jpeg"
    assert len(resp_annot.content) > 0

    # 3. Supporting image
    resp_sup = client.get(f"/api/inspections/{insp_id}/images/supporting/0")
    assert resp_sup.status_code == 200
    assert resp_sup.headers["content-type"] == "image/jpeg"

    # 4. Non-existent supporting image
    resp_sup_none = client.get(f"/api/inspections/{insp_id}/images/supporting/99")
    assert resp_sup_none.status_code == 404

    # 5. Invalid kind
    resp_invalid = client.get(f"/api/inspections/{insp_id}/images/invalid_kind")
    assert resp_invalid.status_code == 400


def test_human_review(created_inspection):
    insp_id = created_inspection["inspection_id"]
    review_payload = {
        "reviewed_result": "REVIEW",
        "reviewed_reason": "Manually verified label alignment looks ambiguous",
        "reviewer": "Quality_Officer_01",
    }

    response = client.patch(f"/api/inspections/{insp_id}/review", json=review_payload)
    assert response.status_code == 200
    data = response.json()

    # Original model prediction remains PASS
    assert data["result"] == "PASS"
    # Review fields are updated
    assert data["reviewed_result"] == "REVIEW"
    assert data["reviewed_reason"] == "Manually verified label alignment looks ambiguous"
    assert data["reviewer"] == "Quality_Officer_01"
    assert data["reviewed_at"] is not None


def test_retry_save(created_inspection):
    insp_id = created_inspection["inspection_id"]
    response = client.post(f"/api/inspections/{insp_id}/retry-save")
    assert response.status_code == 200
    data = response.json()
    assert data["inspection_id"] == insp_id


def test_export_inspections_csv(created_inspection):
    response = client.get("/api/exports/inspections.csv?product_id=bottle_a")
    assert response.status_code == 200
    assert "text/csv" in response.headers["content-type"]
    content = response.text

    # Header verification
    assert "inspection_id,client_request_id,created_at" in content
    # Created inspection ID must appear in exported rows
    assert created_inspection["inspection_id"] in content
