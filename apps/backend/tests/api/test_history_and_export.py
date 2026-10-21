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
    assert "demo" in content.splitlines()[0].split(",")
    # Created inspection ID must appear in exported rows
    assert created_inspection["inspection_id"] in content


def test_demo_lifecycle_and_filters():
    """Verify demo field across POST -> Detail -> History list filter -> CSV export."""
    img_bytes = create_test_image()
    files = [("image", ("bottle_demo.jpg", img_bytes, "image/jpeg"))]
    data = {
        "expected_product": "bottle_a",
        "source_mode": "webcam",
        "demo": "true",
        "client_request_id": str(uuid.uuid4()),
    }

    resp = client.post("/api/inspections", files=files, data=data)
    assert resp.status_code == 200
    insp = resp.json()
    insp_id = insp["inspection_id"]

    # 1. POST response contains both demo and is_demo
    assert insp["demo"] is True
    assert insp["is_demo"] is True

    # 2. GET detail returns demo and is_demo
    detail_resp = client.get(f"/api/inspections/{insp_id}")
    assert detail_resp.status_code == 200
    detail = detail_resp.json()
    assert detail["demo"] is True
    assert detail["is_demo"] is True

    # 3. History filter ?demo=true includes insp_id
    history_true = client.get("/api/inspections?demo=true&page_size=50").json()
    found_true = [it for it in history_true["items"] if it["inspection_id"] == insp_id]
    assert len(found_true) == 1
    assert found_true[0]["demo"] is True
    assert found_true[0]["is_demo"] is True

    # History filter ?demo=false excludes insp_id
    history_false = client.get("/api/inspections?demo=false&page_size=50").json()
    found_false = [it for it in history_false["items"] if it["inspection_id"] == insp_id]
    assert len(found_false) == 0

    # 4. CSV export includes demo column and value is 'true'
    csv_resp = client.get("/api/exports/inspections.csv?demo=true")
    assert csv_resp.status_code == 200
    csv_text = csv_resp.text
    csv_lines = [line for line in csv_text.splitlines() if line.strip()]
    header = csv_lines[0].split(",")
    demo_idx = header.index("demo")

    matching_rows = [line.split(",") for line in csv_lines[1:] if line.startswith(insp_id)]
    assert len(matching_rows) == 1
    assert matching_rows[0][demo_idx] == "true"

    # CSV filter ?demo=false should not contain insp_id
    csv_false = client.get("/api/exports/inspections.csv?demo=false").text
    assert insp_id not in csv_false


def test_list_inspections_search_and_sorting(created_inspection):
    insp_id = created_inspection["inspection_id"]
    client_id = created_inspection["client_request_id"]

    # 1. Search by inspection_id
    resp = client.get(f"/api/inspections?q={insp_id}")
    assert resp.status_code == 200
    items = resp.json()["items"]
    assert any(it["inspection_id"] == insp_id for it in items)

    # 2. Search by client_request_id
    resp = client.get(f"/api/inspections?q={client_id}")
    assert resp.status_code == 200
    items = resp.json()["items"]
    assert any(it["client_request_id"] == client_id for it in items)

    # 3. Search with non-existent query
    resp = client.get(f"/api/inspections?q=completely_non_existent_token_xyz_999")
    assert resp.status_code == 200
    assert resp.json()["total"] == 0

    # 4. Sorting by created_at asc and desc
    resp_asc = client.get("/api/inspections?sort_by=created_at&sort_order=asc&page_size=5")
    assert resp_asc.status_code == 200
    resp_desc = client.get("/api/inspections?sort_by=created_at&sort_order=desc&page_size=5")
    assert resp_desc.status_code == 200

    # 5. Sorting by match_score
    resp_score = client.get("/api/inspections?sort_by=match_score&sort_order=desc&page_size=5")
    assert resp_score.status_code == 200

    # 6. CSV with q query
    csv_resp = client.get(f"/api/exports/inspections.csv?q={insp_id}")
    assert csv_resp.status_code == 200
    assert insp_id in csv_resp.text


def test_list_inspections_invalid_sort():
    resp_bad_field = client.get("/api/inspections?sort_by=illegal_column_injection")
    assert resp_bad_field.status_code == 400
    assert resp_bad_field.json()["error"]["code"] == "invalid_sort_field"

    resp_bad_order = client.get("/api/inspections?sort_order=sideways")
    assert resp_bad_order.status_code == 400
    assert resp_bad_order.json()["error"]["code"] == "invalid_sort_order"


def test_get_inspection_files_metadata(created_inspection):
    insp_id = created_inspection["inspection_id"]

    resp = client.get(f"/api/inspections/{insp_id}/files")
    assert resp.status_code == 200
    data = resp.json()

    assert data["inspection_id"] == insp_id
    assert data["storage_status"] in ("saved", "pending")
    assert "files" in data
    assert len(data["files"]) >= 3  # original, annotated, result.json

    filenames = [f["name"] for f in data["files"]]
    assert "original.jpg" in filenames
    assert "annotated.jpg" in filenames
    assert "result.json" in filenames

    # Check file availability and size
    for f in data["files"]:
        if f["available"]:
            assert f["size_bytes"] is not None
            assert f["size_bytes"] > 0
            assert f["download_url"] is not None

    if data["all_available"]:
        assert data["download_zip_url"] == f"/api/inspections/{insp_id}/download"


def test_download_inspection_zip_bundle(created_inspection):
    import zipfile
    insp_id = created_inspection["inspection_id"]

    resp = client.get(f"/api/inspections/{insp_id}/download")
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "application/zip"
    assert f'filename="inspection_{insp_id}.zip"' in resp.headers.get("content-disposition", "")

    # Inspect zip contents
    zip_bytes = io.BytesIO(resp.content)
    with zipfile.ZipFile(zip_bytes, "r") as zf:
        namelist = zf.namelist()
        assert "original.jpg" in namelist
        assert "annotated.jpg" in namelist
        assert "result.json" in namelist

        # Validate result.json inside zip
        result_content = json.loads(zf.read("result.json").decode("utf-8"))
        assert result_content["inspection_id"] == insp_id
        assert result_content["result"] == created_inspection["result"]


def test_health_readiness_fields():
    resp = client.get("/api/health")
    assert resp.status_code == 200
    data = resp.json()
    assert "detector_ready" in data
    assert "detector_status" in data
    assert data["detector_status"] in ("ready", "demo_ready", "unavailable")

