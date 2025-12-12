# src/feedback_store.py
import os, shutil, sqlite3, json, uuid
from pathlib import Path
from datetime import datetime
from typing import Optional, Dict, Tuple

class FeedbackStore:
    def __init__(self, db_path: Path, reality_root: Path, stash_root: Optional[Path] = None):
        self.db_path = Path(db_path)
        self.reality_root = Path(reality_root)
        self.reality_root.mkdir(parents=True, exist_ok=True)
        self.stash_root = Path(stash_root) if stash_root else None
        if self.stash_root:
            self.stash_root.mkdir(parents=True, exist_ok=True)
        self._init_db()

    def _connect(self):
        return sqlite3.connect(str(self.db_path))

    def _init_db(self):
        with self._connect() as conn:
            c = conn.cursor()
            c.execute("""
                CREATE TABLE IF NOT EXISTS images (
                    id TEXT PRIMARY KEY,
                    original_path TEXT NOT NULL,
                    saved_path TEXT,
                    uploaded_at TEXT NOT NULL,
                    plant_pred TEXT,
                    disease_pred TEXT,
                    confidence REAL,
                    meta_json TEXT
                );
            """)
            c.execute("""
                CREATE TABLE IF NOT EXISTS feedback (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    image_id TEXT NOT NULL,
                    correct_plant TEXT,
                    correct_disease TEXT,
                    user_note TEXT,
                    created_at TEXT NOT NULL,
                    source_ip TEXT,
                    accepted INTEGER DEFAULT 1,
                    FOREIGN KEY(image_id) REFERENCES images(id)
                );
            """)
            conn.commit()

    def save_image_record(self, src_image_path: Path, plant_pred, disease_pred, confidence, meta: Optional[Dict]=None) -> str:
        image_id = str(uuid.uuid4())
        saved_path = None
        if self.stash_root:
            ext = Path(src_image_path).suffix.lower() or ".jpg"
            dst_dir = self.stash_root / image_id[:2] / image_id[2:4]
            dst_dir.mkdir(parents=True, exist_ok=True)
            saved_path = str(dst_dir / f"{image_id}{ext}")
            shutil.copy2(src_image_path, saved_path)

        with self._connect() as conn:
            c = conn.cursor()
            c.execute(
                "INSERT OR REPLACE INTO images (id, original_path, saved_path, uploaded_at, plant_pred, disease_pred, confidence, meta_json) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (image_id, str(src_image_path), saved_path, datetime.utcnow().isoformat(),
                 plant_pred, disease_pred, float(confidence) if confidence is not None else None,
                 json.dumps(meta or {}, ensure_ascii=False)),
            )
            conn.commit()
        return image_id

    def save_feedback(self, image_id: str, correct_plant: Optional[str], correct_disease: Optional[str],
                      user_note: Optional[str], source_ip: Optional[str]=None) -> Tuple[int, Optional[str]]:
        with self._connect() as conn:
            c = conn.cursor()
            c.execute(
                "INSERT INTO feedback (image_id, correct_plant, correct_disease, user_note, created_at, source_ip, accepted) "
                "VALUES (?, ?, ?, ?, ?, ?, 1)",
                (image_id, correct_plant, correct_disease, user_note, datetime.utcnow().isoformat(), source_ip),
            )
            fb_id = c.lastrowid
            row = c.execute("SELECT original_path FROM images WHERE id=?", (image_id,)).fetchone()
            conn.commit()

        copied_to = None
        if row and correct_plant and correct_disease:
            src = Path(row[0])
            dst_dir = self.reality_root / correct_plant / correct_disease
            dst_dir.mkdir(parents=True, exist_ok=True)
            ext = src.suffix.lower() or ".jpg"
            outp = dst_dir / f"{image_id}{ext}"
            try:
                shutil.copy2(src, outp)
                copied_to = str(outp)
            except Exception:
                copied_to = None
        return fb_id, copied_to
