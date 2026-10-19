import json
import os
import shutil
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from app.core.config import settings
from app.db.repository import InspectionRepository


class StorageManager:
    @staticmethod
    def get_pending_dir(inspection_id: str) -> Path:
        """Directory for temporary staging during write."""
        return settings.STORAGE_ROOT / "pending" / inspection_id

    @staticmethod
    def get_final_dir(folder_date: str, result: str, inspection_id: str) -> Path:
        """Permanent directory path: STORAGE_ROOT/<folder_date>/<result_lower>/<inspection_id>."""
        return settings.STORAGE_ROOT / folder_date / result.lower() / inspection_id

    @classmethod
    def save_inspection(
        cls,
        inspection_id: str,
        folder_date: str,
        result: str,
        original_bytes: bytes,
        annotated_bytes: bytes,
        decision_snapshot: Dict[str, Any],
        supporting_images: Optional[List[bytes]] = None,
    ) -> Tuple[bool, Optional[str], Optional[Dict[str, Any]]]:
        """
        Stage files in pending/, verify, then move to final directory.
        Updates SQLite record to 'saved' or 'failed'.
        Returns (success: bool, relative_folder_path: Optional[str], storage_error: Optional[dict]).
        """
        start_time = time.perf_counter()
        pending_dir = cls.get_pending_dir(inspection_id)
        final_dir = cls.get_final_dir(folder_date, result, inspection_id)
        relative_path = f"{folder_date}/{result.lower()}/{inspection_id}"

        supporting_images = supporting_images or []

        try:
            # 1. Stage in pending dir
            if pending_dir.exists():
                shutil.rmtree(pending_dir)
            pending_dir.mkdir(parents=True, exist_ok=True)

            # Write original.jpg
            with open(pending_dir / "original.jpg", "wb") as f:
                f.write(original_bytes)

            # Write annotated.jpg
            with open(pending_dir / "annotated.jpg", "wb") as f:
                f.write(annotated_bytes)

            # Write supporting images if any
            if supporting_images:
                sup_dir = pending_dir / "supporting"
                sup_dir.mkdir(parents=True, exist_ok=True)
                for idx, sup_bytes in enumerate(supporting_images):
                    with open(sup_dir / f"{idx}.jpg", "wb") as f:
                        f.write(sup_bytes)

            # Write decision snapshot result.json (immutable record)
            with open(pending_dir / "result.json", "w", encoding="utf-8") as f:
                json.dump(decision_snapshot, f, ensure_ascii=False, indent=2)

            # 2. Ensure final destination parent directory exists
            final_dir.parent.mkdir(parents=True, exist_ok=True)

            # 3. Move/rename pending to final
            if final_dir.exists():
                shutil.rmtree(final_dir)
            shutil.move(str(pending_dir), str(final_dir))

            # 4. Verify all files exist in final directory
            required_files = [final_dir / "original.jpg", final_dir / "annotated.jpg", final_dir / "result.json"]
            for idx in range(len(supporting_images)):
                required_files.append(final_dir / "supporting" / f"{idx}.jpg")

            for rf in required_files:
                if not rf.is_file():
                    raise FileNotFoundError(f"Missing expected output file after write: {rf}")

            # 5. Mark DB as saved
            timing_storage_ms = round((time.perf_counter() - start_time) * 1000, 2)
            InspectionRepository.update_storage_success(
                inspection_id=inspection_id,
                relative_folder_path=relative_path,
                timing_storage_ms=timing_storage_ms,
            )
            return True, relative_path, None

        except Exception as e:
            # Mark DB as failed with error details, preserve decision result
            error_dict = {
                "code": "storage_write_error",
                "message": str(e),
                "retryable": True,
            }
            InspectionRepository.update_storage_failure(
                inspection_id=inspection_id,
                error_code=error_dict["code"],
                error_message=error_dict["message"],
                retryable=True,
            )
            return False, None, error_dict

    @classmethod
    def _verify_directory_files_intact(
        cls,
        target_dir: Path,
        record: Dict[str, Any],
    ) -> Tuple[bool, Optional[str]]:
        """
        Verify that a directory (final or pending) contains all necessary files:
        1. original.jpg (non-empty)
        2. annotated.jpg (non-empty)
        3. result.json (valid JSON, matches inspection_id)
        4. all supporting images 0..N-1 if declared in evidence
        """
        if not target_dir.is_dir():
            return False, "directory_not_found"

        orig_file = target_dir / "original.jpg"
        if not orig_file.is_file() or orig_file.stat().st_size == 0:
            return False, "missing_original_image"

        annot_file = target_dir / "annotated.jpg"
        if not annot_file.is_file() or annot_file.stat().st_size == 0:
            return False, "missing_annotated_image"

        result_file = target_dir / "result.json"
        if not result_file.is_file() or result_file.stat().st_size == 0:
            return False, "missing_result_json"

        try:
            with open(result_file, "r", encoding="utf-8") as f:
                snapshot = json.load(f)
        except Exception as e:
            return False, f"invalid_result_json: {e}"

        insp_id = record.get("inspection_id")
        if insp_id and snapshot.get("inspection_id") != insp_id:
            return False, "mismatched_inspection_id"

        # Check supporting images from snapshot evidence
        evidence = snapshot.get("evidence") or {}
        supporting_angles = evidence.get("supporting_angles_deg")
        if supporting_angles is None and record.get("evidence_json"):
            try:
                ev_db = json.loads(record["evidence_json"])
                supporting_angles = ev_db.get("supporting_angles_deg")
            except Exception:
                pass

        if supporting_angles:
            sup_count = len(supporting_angles)
            sup_dir = target_dir / "supporting"
            if not sup_dir.is_dir():
                return False, "missing_supporting_dir"
            for idx in range(sup_count):
                sup_img = sup_dir / f"{idx}.jpg"
                if not sup_img.is_file() or sup_img.stat().st_size == 0:
                    return False, f"missing_supporting_image_{idx}"

        return True, None

    @classmethod
    def retry_save_from_pending(
        cls,
        inspection_id: str,
    ) -> Tuple[bool, Optional[str], Optional[Dict[str, Any]]]:
        """
        Retry saving an inspection.
        1. If already saved and final files intact -> idempotent success.
        2. If final directory already has all intact files -> update DB saved and return success.
        3. If pending files are complete -> re-run save_inspection.
        4. If pending files are missing or incomplete -> update DB failed (source_unavailable, retryable=False).
        """
        record = InspectionRepository.get_by_id(inspection_id)
        if not record:
            return False, None, {"code": "not_found", "message": "Inspection record not found", "retryable": False}

        # 1. Idempotent check: if already marked saved and final files intact
        if record.get("storage_status") == "saved" and record.get("relative_folder_path"):
            final_dir = (settings.STORAGE_ROOT / record["relative_folder_path"]).resolve()
            is_intact, _ = cls._verify_directory_files_intact(final_dir, record)
            if is_intact:
                return True, record["relative_folder_path"], None

        # 2. Check if final directory already exists and is intact (even if status was pending/failed)
        final_cand = cls.get_final_dir(record["folder_date"], record["result"], inspection_id)
        is_final_intact, _ = cls._verify_directory_files_intact(final_cand, record)
        if is_final_intact:
            rel_path = f"{record['folder_date']}/{record['result'].lower()}/{inspection_id}"
            InspectionRepository.update_storage_success(
                inspection_id=inspection_id,
                relative_folder_path=rel_path,
                timing_storage_ms=0.0,
            )
            return True, rel_path, None

        # 3. Check pending directory
        pending_dir = cls.get_pending_dir(inspection_id)
        if not pending_dir.is_dir():
            error = {
                "code": "source_unavailable",
                "message": "Original capture sources are missing in pending storage. Please recapture.",
                "retryable": False,
            }
            InspectionRepository.update_storage_failure(
                inspection_id=inspection_id,
                error_code=error["code"],
                error_message=error["message"],
                retryable=False,
            )
            return False, None, error

        # 4. Check that pending files are complete and uncorrupted
        is_pending_intact, reason = cls._verify_directory_files_intact(pending_dir, record)
        if not is_pending_intact:
            error = {
                "code": "source_unavailable",
                "message": f"Pending files are incomplete ({reason}). Please recapture.",
                "retryable": False,
            }
            InspectionRepository.update_storage_failure(
                inspection_id=inspection_id,
                error_code=error["code"],
                error_message=error["message"],
                retryable=False,
            )
            return False, None, error

        # 5. Load intact pending files safely
        try:
            with open(pending_dir / "original.jpg", "rb") as f:
                original_bytes = f.read()
            with open(pending_dir / "annotated.jpg", "rb") as f:
                annotated_bytes = f.read()
            with open(pending_dir / "result.json", "r", encoding="utf-8") as f:
                decision_snapshot = json.load(f)

            supporting_bytes = []
            sup_dir = pending_dir / "supporting"
            if sup_dir.is_dir():
                evidence = decision_snapshot.get("evidence") or {}
                sup_count = len(evidence.get("supporting_angles_deg") or [])
                for idx in range(sup_count):
                    with open(sup_dir / f"{idx}.jpg", "rb") as f:
                        supporting_bytes.append(f.read())

            return cls.save_inspection(
                inspection_id=inspection_id,
                folder_date=record["folder_date"],
                result=record["result"],
                original_bytes=original_bytes,
                annotated_bytes=annotated_bytes,
                decision_snapshot=decision_snapshot,
                supporting_images=supporting_bytes,
            )
        except Exception as e:
            error = {
                "code": "storage_write_error",
                "message": f"Failed reading pending files for retry: {e}",
                "retryable": True,
            }
            InspectionRepository.update_storage_failure(
                inspection_id=inspection_id,
                error_code=error["code"],
                error_message=error["message"],
                retryable=True,
            )
            return False, None, error

    @classmethod
    def get_image_path(
        cls,
        inspection_id: str,
        kind: str,
        index: Optional[int] = None,
    ) -> Optional[Path]:
        """
        Safely resolve file path for an image kind ('original', 'annotated', 'supporting').
        Guarantees returned path is strictly within STORAGE_ROOT.
        """
        record = InspectionRepository.get_by_id(inspection_id)
        if not record:
            return None

        # Determine directory (saved or pending)
        target_dir: Optional[Path] = None
        if record["relative_folder_path"]:
            candidate = (settings.STORAGE_ROOT / record["relative_folder_path"]).resolve()
            if candidate.is_dir():
                target_dir = candidate

        if not target_dir:
            pending_cand = cls.get_pending_dir(inspection_id).resolve()
            if pending_cand.is_dir():
                target_dir = pending_cand

        if not target_dir:
            return None

        # Resolve image filename
        if kind == "original":
            img_path = target_dir / "original.jpg"
        elif kind == "annotated":
            img_path = target_dir / "annotated.jpg"
        elif kind == "supporting" and index is not None:
            img_path = target_dir / "supporting" / f"{index}.jpg"
        else:
            return None

        # Ensure path traversal security
        img_resolved = img_path.resolve()
        storage_root_resolved = settings.STORAGE_ROOT.resolve()
        if not str(img_resolved).startswith(str(storage_root_resolved)):
            return None

        return img_resolved if img_resolved.is_file() else None

    @classmethod
    def reconcile_on_startup(cls) -> Dict[str, int]:
        """
        Scan pending/failed records on backend startup and reconcile with disk.
        Isolates errors per record so one corrupted record never halts startup.
        """
        unsettled = InspectionRepository.list_unsettled()
        reconciled = 0
        marked_failed = 0

        for r in unsettled:
            insp_id = r["inspection_id"]
            try:
                final_cand = cls.get_final_dir(r["folder_date"], r["result"], insp_id)
                is_intact, _ = cls._verify_directory_files_intact(final_cand, r)
                if is_intact:
                    # Files are fully in place on disk
                    rel_path = f"{r['folder_date']}/{r['result'].lower()}/{insp_id}"
                    InspectionRepository.update_storage_success(insp_id, rel_path, timing_storage_ms=0.0)
                    reconciled += 1
                else:
                    # Check if pending files exist and can be completed
                    pending_dir = cls.get_pending_dir(insp_id)
                    if pending_dir.is_dir() and (pending_dir / "original.jpg").is_file():
                        ok, _, _ = cls.retry_save_from_pending(insp_id)
                        if ok:
                            reconciled += 1
                        else:
                            marked_failed += 1
                    else:
                        # Source lost or never written
                        InspectionRepository.update_storage_failure(
                            inspection_id=insp_id,
                            error_code="source_unavailable",
                            error_message="Capture files missing after restart. Please recapture.",
                            retryable=False,
                        )
                        marked_failed += 1
            except Exception as e:
                # Per-record isolation
                InspectionRepository.update_storage_failure(
                    inspection_id=insp_id,
                    error_code="storage_reconciliation_error",
                    error_message=f"Reconciliation error on startup: {e}",
                    retryable=False,
                )
                marked_failed += 1

        return {"total_unsettled": len(unsettled), "reconciled": reconciled, "marked_failed": marked_failed}
