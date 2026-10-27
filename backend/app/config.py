import os
from pathlib import Path

DATA_DIR = Path(os.environ.get("SPEND_DATA_DIR", Path(__file__).resolve().parent.parent / "data"))
DATABASE_URL = os.environ.get("SPEND_DATABASE_URL", f"sqlite:///{DATA_DIR / 'spend.db'}")
CORS_ORIGINS = [o for o in os.environ.get("SPEND_CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000").split(",") if o]
MAX_UPLOAD_BYTES = int(os.environ.get("SPEND_MAX_UPLOAD_MB", "25")) * 1024 * 1024
