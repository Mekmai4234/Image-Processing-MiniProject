import sys
from pathlib import Path
import pytest

# Ensure apps/backend is in sys.path
backend_root = Path(__file__).resolve().parent.parent
if str(backend_root) not in sys.path:
    sys.path.insert(0, str(backend_root))


@pytest.fixture(autouse=True)
def isolated_storage(tmp_path, monkeypatch):
    """
    Every test gets its own temporary STORAGE_ROOT + fresh SQLite database so the
    suite never touches (or depends on) the developer's real storage/ captures.
    """
    from app.core.config import settings
    from app.db.connection import init_db

    monkeypatch.setattr(settings, "_raw_storage_root", str(tmp_path / "storage"))
    monkeypatch.setattr(settings, "DEFAULT_TO_DEMO", True)
    settings.validate_storage_root()
    init_db()
    yield
