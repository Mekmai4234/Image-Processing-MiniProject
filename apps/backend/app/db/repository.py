import json
import sqlite3
from typing import Any, Dict, List, Optional, Tuple
from app.db.connection import get_connection


class InspectionRepository:
    @staticmethod
    def create_pending(data: Dict[str, Any]) -> Tuple[bool, Dict[str, Any]]:
        """
        Insert inspection with status='pending'.
        Returns (created: bool, record: dict).
        If client_request_id already exists, returns (False, existing_record).
        """
        data = {**data}
        data.setdefault("payload_fingerprint", None)
        conn = get_connection()
        try:
            with conn:
                conn.execute(
                    """
                    INSERT INTO inspections (
                        inspection_id, client_request_id, created_at, source_mode,
                        expected_product, detected_product, result, reason,
                        match_score, score_method,
                        bbox_x, bbox_y, bbox_width, bbox_height,
                        expected_bbox_x, expected_bbox_y, expected_bbox_width, expected_bbox_height,
                        image_width, image_height, orientation_deg, config_version,
                        storage_status, folder_date, relative_folder_path, evidence_json,
                        timing_orientation_ms, timing_inspection_ms, timing_storage_ms, timing_total_ms,
                        payload_fingerprint
                    ) VALUES (
                        :inspection_id, :client_request_id, :created_at, :source_mode,
                        :expected_product, :detected_product, :result, :reason,
                        :match_score, :score_method,
                        :bbox_x, :bbox_y, :bbox_width, :bbox_height,
                        :expected_bbox_x, :expected_bbox_y, :expected_bbox_width, :expected_bbox_height,
                        :image_width, :image_height, :orientation_deg, :config_version,
                        'pending', :folder_date, :relative_folder_path, :evidence_json,
                        :timing_orientation_ms, :timing_inspection_ms, :timing_storage_ms, :timing_total_ms,
                        :payload_fingerprint
                    );
                    """,
                    data,
                )
            result_record = dict(data)
            result_record.setdefault("storage_status", "pending")
            result_record.setdefault("storage_error_code", None)
            result_record.setdefault("storage_error_message", None)
            result_record.setdefault("storage_error_retryable", 0)
            return True, result_record
        except sqlite3.IntegrityError:
            # client_request_id or inspection_id duplicate
            existing = InspectionRepository.get_by_client_request_id(data["client_request_id"])
            if existing:
                return False, existing
            raise
        finally:
            conn.close()

    @staticmethod
    def get_by_id(inspection_id: str) -> Optional[Dict[str, Any]]:
        conn = get_connection()
        try:
            cur = conn.execute("SELECT * FROM inspections WHERE inspection_id = ?;", (inspection_id,))
            row = cur.fetchone()
            return dict(row) if row else None
        finally:
            conn.close()

    @staticmethod
    def get_by_client_request_id(client_request_id: str) -> Optional[Dict[str, Any]]:
        conn = get_connection()
        try:
            cur = conn.execute("SELECT * FROM inspections WHERE client_request_id = ?;", (client_request_id,))
            row = cur.fetchone()
            return dict(row) if row else None
        finally:
            conn.close()

    @staticmethod
    def update_storage_success(
        inspection_id: str,
        relative_folder_path: str,
        timing_storage_ms: float,
    ) -> bool:
        """Mark storage as saved and clear any error."""
        conn = get_connection()
        try:
            with conn:
                # Calculate total timing
                cur = conn.execute("SELECT timing_orientation_ms, timing_inspection_ms FROM inspections WHERE inspection_id = ?;", (inspection_id,))
                row = cur.fetchone()
                timing_total_ms = timing_storage_ms
                if row:
                    timing_total_ms += (row["timing_orientation_ms"] or 0.0) + (row["timing_inspection_ms"] or 0.0)

                conn.execute(
                    """
                    UPDATE inspections SET
                        storage_status = 'saved',
                        storage_error_code = NULL,
                        storage_error_message = NULL,
                        storage_error_retryable = 0,
                        relative_folder_path = ?,
                        timing_storage_ms = ?,
                        timing_total_ms = ?
                    WHERE inspection_id = ?;
                    """,
                    (relative_folder_path, timing_storage_ms, timing_total_ms, inspection_id),
                )
            return True
        finally:
            conn.close()

    @staticmethod
    def update_storage_failure(
        inspection_id: str,
        error_code: str,
        error_message: str,
        retryable: bool = True,
    ) -> bool:
        """Mark storage as failed with error details, keeping decision result intact."""
        conn = get_connection()
        try:
            with conn:
                conn.execute(
                    """
                    UPDATE inspections SET
                        storage_status = 'failed',
                        storage_error_code = ?,
                        storage_error_message = ?,
                        storage_error_retryable = ?
                    WHERE inspection_id = ?;
                    """,
                    (error_code, error_message, 1 if retryable else 0, inspection_id),
                )
            return True
        finally:
            conn.close()

    @staticmethod
    def update_review(
        inspection_id: str,
        reviewed_result: str,
        reviewed_reason: str,
        reviewer: str,
        reviewed_at: str,
    ) -> bool:
        """Update human review details without altering original prediction."""
        conn = get_connection()
        try:
            with conn:
                cur = conn.execute(
                    """
                    UPDATE inspections SET
                        reviewed_result = ?,
                        reviewed_reason = ?,
                        reviewer = ?,
                        reviewed_at = ?
                    WHERE inspection_id = ?;
                    """,
                    (reviewed_result, reviewed_reason, reviewer, reviewed_at, inspection_id),
                )
                return cur.rowcount > 0
        finally:
            conn.close()

    @staticmethod
    def list_unsettled() -> List[Dict[str, Any]]:
        """List records with status 'pending' or 'failed' for recovery checks."""
        conn = get_connection()
        try:
            cur = conn.execute("SELECT * FROM inspections WHERE storage_status != 'saved';")
            return [dict(r) for r in cur.fetchall()]
        finally:
            conn.close()

    @staticmethod
    def list_inspections(
        page: int = 1,
        page_size: int = 20,
        source_mode: Optional[str] = None,
        result: Optional[str] = None,
        product_id: Optional[str] = None,
        date_from: Optional[str] = None,
        date_to: Optional[str] = None,
    ) -> Tuple[List[Dict[str, Any]], int]:
        """
        Query inspections with filters and pagination.
        Sort by created_at DESC, inspection_id DESC for deterministic ordering.
        """
        conn = get_connection()
        try:
            conditions = []
            params = []

            if source_mode:
                conditions.append("source_mode = ?")
                params.append(source_mode)
            if result:
                conditions.append("result = ?")
                params.append(result)
            if product_id:
                conditions.append("expected_product = ?")
                params.append(product_id)
            if date_from:
                conditions.append("folder_date >= ?")
                params.append(date_from)
            if date_to:
                conditions.append("folder_date <= ?")
                params.append(date_to)

            where_clause = ""
            if conditions:
                where_clause = "WHERE " + " AND ".join(conditions)

            count_query = f"SELECT COUNT(*) FROM inspections {where_clause};"
            total = conn.execute(count_query, params).fetchone()[0]

            offset = (page - 1) * page_size
            data_query = f"""
                SELECT * FROM inspections
                {where_clause}
                ORDER BY created_at DESC, inspection_id DESC
                LIMIT ? OFFSET ?;
            """
            cur = conn.execute(data_query, params + [page_size, offset])
            items = [dict(r) for r in cur.fetchall()]
            return items, total
        finally:
            conn.close()

    @staticmethod
    def export_inspections(
        source_mode: Optional[str] = None,
        result: Optional[str] = None,
        product_id: Optional[str] = None,
        date_from: Optional[str] = None,
        date_to: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """Query all inspections matching filters without pagination for CSV export."""
        conn = get_connection()
        try:
            conditions = []
            params = []
            if source_mode:
                conditions.append("source_mode = ?")
                params.append(source_mode)
            if result:
                conditions.append("result = ?")
                params.append(result)
            if product_id:
                conditions.append("expected_product = ?")
                params.append(product_id)
            if date_from:
                conditions.append("folder_date >= ?")
                params.append(date_from)
            if date_to:
                conditions.append("folder_date <= ?")
                params.append(date_to)

            where_clause = ""
            if conditions:
                where_clause = "WHERE " + " AND ".join(conditions)

            data_query = f"""
                SELECT * FROM inspections
                {where_clause}
                ORDER BY created_at DESC, inspection_id DESC;
            """
            cur = conn.execute(data_query, params)
            return [dict(r) for r in cur.fetchall()]
        finally:
            conn.close()

