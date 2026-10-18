import sqlite3
from pathlib import Path
from typing import Generator
from app.core.config import settings


def get_db_path() -> Path:
    """Return path to SQLite database inside STORAGE_ROOT."""
    return settings.STORAGE_ROOT / "inspections.sqlite3"


def get_connection() -> sqlite3.Connection:
    """Establish connection to SQLite with WAL mode and row factory."""
    db_path = get_db_path()
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(db_path), timeout=10.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode = WAL;")
    conn.execute("PRAGMA foreign_keys = ON;")
    return conn


def init_db() -> None:
    """Initialize SQLite database schema and indexes."""
    conn = get_connection()
    try:
        with conn:
            conn.execute("""
            CREATE TABLE IF NOT EXISTS inspections (
                inspection_id TEXT PRIMARY KEY,
                client_request_id TEXT UNIQUE NOT NULL,
                created_at TEXT NOT NULL,
                source_mode TEXT NOT NULL,
                expected_product TEXT NOT NULL,
                detected_product TEXT,
                result TEXT NOT NULL,
                reason TEXT NOT NULL,
                match_score REAL,
                score_method TEXT,
                bbox_x INTEGER,
                bbox_y INTEGER,
                bbox_width INTEGER,
                bbox_height INTEGER,
                expected_bbox_x INTEGER,
                expected_bbox_y INTEGER,
                expected_bbox_width INTEGER,
                expected_bbox_height INTEGER,
                image_width INTEGER NOT NULL,
                image_height INTEGER NOT NULL,
                orientation_deg REAL,
                config_version TEXT NOT NULL,
                storage_status TEXT NOT NULL DEFAULT 'pending',
                storage_error_code TEXT,
                storage_error_message TEXT,
                storage_error_retryable INTEGER DEFAULT 0,
                timing_orientation_ms REAL DEFAULT 0.0,
                timing_inspection_ms REAL DEFAULT 0.0,
                timing_storage_ms REAL DEFAULT 0.0,
                timing_total_ms REAL DEFAULT 0.0,
                folder_date TEXT NOT NULL,
                relative_folder_path TEXT,
                evidence_json TEXT,
                reviewed_result TEXT,
                reviewed_reason TEXT,
                reviewer TEXT,
                reviewed_at TEXT
            );
            """)

            conn.execute("CREATE INDEX IF NOT EXISTS idx_inspections_client_req ON inspections (client_request_id);")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_inspections_created_at ON inspections (created_at);")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_inspections_result ON inspections (result);")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_inspections_storage_status ON inspections (storage_status);")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_inspections_expected_product ON inspections (expected_product);")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_inspections_source_mode ON inspections (source_mode);")
    finally:
        conn.close()
