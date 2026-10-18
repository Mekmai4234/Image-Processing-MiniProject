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
    def retry_save_from_pending(
        cls,
        inspection_id: str,
    ) -> Tuple[bool, Optional[str], Optional[Dict[str, Any]]]:
        """
        Retry saving an inspection using files left in pending dir.
        If files in pending are lost, reports non-retryable source_unavailable error.
        """
        record = InspectionRepository.get_by_id(inspection_id)
        if not record:
            return False, None, {"code": "not_found", "message": "Inspection record not found", "retryable": False}

        pending_dir = cls.get_pending_dir(inspection_id)
        if not pending_dir.exists() or not (pending_dir / "original.jpg").is_file():
            # Source lost
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

        # Load pending bytes and snapshot
        with open(pending_dir / "original.jpg", "rb") as f:
            original_bytes = f.read()
        with open(pending_dir / "annotated.jpg", "rb") as f:
            annotated_bytes = f.read()
        with open(pending_dir / "result.json", "r", encoding="utf-8") as f:
            decision_snapshot = json.load(f)

        supporting_bytes = []
        sup_dir = pending_dir / "supporting"
        if sup_dir.is_dir():
            idx = 0
            while (sup_dir / f"{idx}.jpg").is_file():
                with open(sup_dir / f"{idx}.jpg", "rb") as f:
                    supporting_bytes.append(f.read())
                idx += 1

        return cls.save_inspection(
            inspection_id=inspection_id,
            folder_date=record["folder_date"],
            result=record["result"],
            original_bytes=original_bytes,
            annotated_bytes=annotated_bytes,
            decision_snapshot=decision_snapshot,
            supporting_images=supporting_bytes,
        )

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
        """
        unsettled = InspectionRepository.list_unsettled()
        reconciled = 0
        marked_failed = 0

        for r in unsettled:
            insp_id = r["inspection_id"]
            final_cand = cls.get_final_dir(r["folder_date"], r["result"], insp_id)
            if (final_cand / "original.jpg").is_file() and (final_cand / "result.json").is_file():
                # Files are actually in place
                rel_path = f"{r['folder_date']}/{r['result'].lower()}/{insp_id}"
                InspectionRepository.update_storage_success(insp_id, rel_path, timing_storage_ms=0.0)
                reconciled += 1
            else:
                # Check if pending files exist and retry save if possible
                pending_dir = cls.get_pending_dir(insp_id)
                if pending_dir.is_dir() and (pending_dir / "original.jpg").is_file():
                    ok, _, _ = cls.retry_save_from_pending(insp_id)
                    if ok:
                        reconciled += 1
                    else:
                        marked_failed += 1
                else:
                    # Source lost
                    InspectionRepository.update_storage_failure(
                        inspection_id=insp_id,
                        error_code="source_unavailable",
                        error_message="Capture files missing after restart. Please recapture.",
                        retryable=False,
                    )
                    marked_failed += 1

        return {"total_unsettled": len(unsettled), "reconciled": reconciled, "marked_failed": marked_failed}
