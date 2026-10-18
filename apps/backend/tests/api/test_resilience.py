"""
Phase 6.1 — end-to-end failure/recovery tests:
  * idempotency (same payload / different image / different evidence / concurrent)
  * disk full / write failure -> result kept, storage failed, retry-save recovers
  * backend restart -> History persists, pending reconciled, lost source not "saved"
"""
import errno
import io
import json
import threading
import uuid
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from PIL import Image, ImageDraw

from app.core.config import settings
from app.db.repository import InspectionRepository
from app.main import app
from app.services.storage import StorageManager


def make_image(width=300, height=400, seed=0) -> bytes:
    img = Image.new("RGB", (width, height), color=(240, 240, 240))
    d = ImageDraw.Draw(img)
    d.rectangle([60 + seed, 80, 240, 320], fill=(20, 20, 20))
    d.line([(0, 0), (width, height)], fill=(255, 0, 0), width=3)
    d.line([(0, height), (width, 0)], fill=(0, 255, 0), width=3)
    buf = io.BytesIO()
    img.save(buf, format="JPEG")
    return buf.getvalue()


def post_inspection(client, request_id=None, image=None, product="bottle_a", evidence=None):
    data = {
        "expected_product": product,
        "source_mode": "webcam",
        "client_request_id": request_id or str(uuid.uuid4()),
    }
    if evidence is not None:
        data["evidence"] = json.dumps(evidence)
    return client.post(
        "/api/inspections",
        files={"image": ("c.jpg", image or make_image(), "image/jpeg")},
        data=data,
    )


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c


# ---------------------------------------------------------------- idempotency


def test_same_request_id_different_image_is_conflict(client):
    rid = str(uuid.uuid4())
    assert post_inspection(client, rid, make_image(seed=0)).status_code == 200
    resp = post_inspection(client, rid, make_image(seed=15))
    assert resp.status_code == 409
    assert resp.json()["error"]["code"] == "idempotency_conflict"


def test_same_request_id_different_evidence_is_conflict(client):
    rid = str(uuid.uuid4())
    img = make_image()
    assert post_inspection(client, rid, img).status_code == 200
    ev = {"kind": "single_view", "search_status": "usable_view_found"}
    assert post_inspection(client, rid, img, evidence=ev).status_code == 409


def test_concurrent_same_request_creates_single_record(client):
    rid = str(uuid.uuid4())
    img = make_image()
    codes, ids = [], []

    def worker():
        r = post_inspection(client, rid, img)
        codes.append(r.status_code)
        if r.status_code == 200:
            ids.append(r.json()["inspection_id"])

    threads = [threading.Thread(target=worker) for _ in range(4)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert all(c == 200 for c in codes), codes
    assert len(set(ids)) == 1
    listing = client.get("/api/inspections").json()
    assert listing["total"] == 1


# ------------------------------------------------------------ disk full / IO


def test_disk_full_keeps_result_and_marks_failed_then_retry_recovers(client, monkeypatch):
    def disk_full(*args, **kwargs):
        raise OSError(errno.ENOSPC, "No space left on device")

    with monkeypatch.context() as m:
        m.setattr("app.services.storage.shutil.move", disk_full)
        resp = post_inspection(client)

    assert resp.status_code == 200  # inspection result still returned
    body = resp.json()
    insp_id = body["inspection_id"]
    assert body["result"] == "PASS"  # decision NOT changed by the write failure
    assert body["storage_status"] == "failed"
    assert body["storage_error"]["retryable"] is True
    assert body["images"]["original"] is None and body["images"]["annotated"] is None

    # Staged files survive in pending/ so the save can be retried
    assert (StorageManager.get_pending_dir(insp_id) / "original.jpg").is_file()

    # Disk is OK again -> retry-save on the SAME inspection
    retry = client.post(f"/api/inspections/{insp_id}/retry-save")
    assert retry.status_code == 200
    rb = retry.json()
    assert rb["inspection_id"] == insp_id
    assert rb["storage_status"] == "saved"
    assert rb["storage_error"] is None
    assert rb["result"] == "PASS"
    assert client.get(rb["images"]["original"]).status_code == 200
    assert client.get("/api/inspections").json()["total"] == 1  # no duplicate record


def test_write_failure_midway_never_reports_saved(client, monkeypatch):
    real_open = open

    def flaky_open(file, mode="r", *a, **kw):
        if "w" in mode and str(file).endswith("annotated.jpg"):
            raise OSError(errno.ENOSPC, "No space left on device")
        return real_open(file, mode, *a, **kw)

    with monkeypatch.context() as m:
        m.setattr("builtins.open", flaky_open)
        resp = post_inspection(client)

    body = resp.json()
    assert resp.status_code == 200
    assert body["storage_status"] == "failed"
    final_candidates = list(Path(settings.STORAGE_ROOT).glob("*/pass/*"))
    assert final_candidates == []  # nothing half-published in a result folder


def test_retry_save_after_pending_lost_reports_source_unavailable(client, monkeypatch):
    import shutil

    def disk_full(*a, **kw):
        raise OSError(errno.ENOSPC, "No space left on device")

    with monkeypatch.context() as m:
        m.setattr("app.services.storage.shutil.move", disk_full)
        insp_id = post_inspection(client).json()["inspection_id"]

    shutil.rmtree(StorageManager.get_pending_dir(insp_id))  # staged capture lost
    body = client.post(f"/api/inspections/{insp_id}/retry-save").json()
    assert body["storage_status"] == "failed"
    assert body["storage_error"]["code"] == "source_unavailable"
    assert body["storage_error"]["retryable"] is False


# ---------------------------------------------------------------- restart


def test_restart_keeps_saved_history_and_images():
    with TestClient(app) as first:
        created = post_inspection(first).json()
        insp_id = created["inspection_id"]
        assert created["storage_status"] == "saved"

    # "restart": brand new app lifespan (init_db + reconcile) against same storage
    with TestClient(app) as second:
        detail = second.get(f"/api/inspections/{insp_id}")
        assert detail.status_code == 200
        assert detail.json()["storage_status"] == "saved"
        assert second.get(f"/api/inspections/{insp_id}/images/original").status_code == 200
        assert second.get(f"/api/inspections/{insp_id}/images/annotated").status_code == 200
        assert second.get("/api/inspections").json()["total"] == 1


def test_restart_completes_pending_save_when_files_survive(monkeypatch):
    def disk_full(*a, **kw):
        raise OSError(errno.ENOSPC, "No space left on device")

    with TestClient(app) as first:
        with monkeypatch.context() as m:
            m.setattr("app.services.storage.shutil.move", disk_full)
            insp_id = post_inspection(first).json()["inspection_id"]
        assert InspectionRepository.get_by_id(insp_id)["storage_status"] == "failed"

    with TestClient(app) as second:
        body = second.get(f"/api/inspections/{insp_id}").json()
        assert body["storage_status"] == "saved"
        assert body["storage_error"] is None
        assert second.get(f"/api/inspections/{insp_id}/images/original").status_code == 200


def test_restart_does_not_mark_saved_when_source_missing():
    with TestClient(app) as first:
        insp_id = post_inspection(first).json()["inspection_id"]
        # Simulate an orphan: row says pending, but no files anywhere
        rec = InspectionRepository.get_by_id(insp_id)
        import shutil

        shutil.rmtree(settings.STORAGE_ROOT / rec["relative_folder_path"])
        from app.db.connection import get_connection

        conn = get_connection()
        with conn:
            conn.execute(
                "UPDATE inspections SET storage_status='pending', relative_folder_path=NULL WHERE inspection_id=?",
                (insp_id,),
            )
        conn.close()

    with TestClient(app) as second:
        body = second.get(f"/api/inspections/{insp_id}").json()
        assert body["storage_status"] == "failed"
        assert body["storage_error"]["code"] == "source_unavailable"
        assert body["storage_error"]["retryable"] is False
        assert body["images"]["original"] is None
