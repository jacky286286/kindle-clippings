import os
import sqlite3
from datetime import datetime

DB_NAME = "clippings.db"

def get_connection():
    conn = sqlite3.connect(DB_NAME, timeout=15.0)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    with get_connection() as conn:
        cursor = conn.cursor()
        
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS clippings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                book_title TEXT NOT NULL,
                author TEXT,
                location TEXT NOT NULL,
                clipping_type TEXT NOT NULL,
                content TEXT,
                clipped_at TIMESTAMP NOT NULL,
                is_starred INTEGER DEFAULT 0,
                UNIQUE(book_title, location, clipping_type)
            )
        """)
        
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS book_notes (
                book_title TEXT PRIMARY KEY,
                author TEXT,
                note TEXT DEFAULT '',
                updated_at TIMESTAMP
            )
        """)

        cursor.execute("PRAGMA table_info(clippings)")
        columns = [row["name"] for row in cursor.fetchall()]
        if "is_starred" not in columns:
            cursor.execute("ALTER TABLE clippings ADD COLUMN is_starred INTEGER DEFAULT 0")
            
        cursor.execute("""
            UPDATE book_notes 
            SET note = '' 
            WHERE note LIKE '%hasNote%' OR note LIKE '%尚未填寫閱讀心得備註%'
        """)
        conn.commit()

def upsert_clipping(book_title, author, location, clipping_type, content, clipped_at):
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT id, clipped_at FROM clippings 
            WHERE book_title = ? AND location = ? AND clipping_type = ?
        """, (book_title, location, clipping_type))
        
        existing = cursor.fetchone()
        
        if existing is None:
            cursor.execute("""
                INSERT INTO clippings (book_title, author, location, clipping_type, content, clipped_at, is_starred)
                VALUES (?, ?, ?, ?, ?, ?, 0)
            """, (book_title, author, location, clipping_type, content, clipped_at.isoformat()))
            conn.commit()
            return "INSERTED"
        else:
            existing_time = datetime.fromisoformat(existing["clipped_at"])
            if clipped_at > existing_time:
                cursor.execute("""
                    UPDATE clippings 
                    SET content = ?, clipped_at = ?, author = ?
                    WHERE id = ?
                """, (content, clipped_at.isoformat(), author, existing["id"]))
                conn.commit()
                return "UPDATED"
            else:
                return "SKIPPED"

def get_all_clippings():
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT id, book_title, author, location, clipping_type, content, clipped_at, is_starred 
            FROM clippings 
            ORDER BY clipped_at DESC
        """)
        rows = cursor.fetchall()
        return [dict(row) for row in rows]

def delete_clipping(clipping_id):
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM clippings WHERE id = ?", (int(clipping_id),))
        conn.commit()
        return cursor.rowcount > 0

def delete_clippings_batch(clipping_ids):
    if not clipping_ids:
        return 0
    try:
        safe_ids = [int(cid) for cid in clipping_ids]
    except (ValueError, TypeError):
        raise ValueError("無效的 ID 格式，必須為整數")

    deleted_count = 0
    chunk_size = 900 

    with get_connection() as conn:
        cursor = conn.cursor()
        for i in range(0, len(safe_ids), chunk_size):
            chunk = safe_ids[i:i + chunk_size]
            placeholders = ",".join("?" for _ in chunk)
            cursor.execute(f"DELETE FROM clippings WHERE id IN ({placeholders})", chunk)
            deleted_count += cursor.rowcount
        conn.commit()
        
    return deleted_count

def update_clipping_star(clipping_id, is_starred):
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            UPDATE clippings 
            SET is_starred = ? 
            WHERE id = ?
        """, (1 if is_starred else 0, int(clipping_id)))
        conn.commit()
        return cursor.rowcount > 0

def get_books_with_notes():
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT 
                c.book_title, 
                c.author, 
                COUNT(c.id) as clipping_count,
                COALESCE(bn.note, '') as note,
                bn.updated_at
            FROM clippings c
            LEFT JOIN book_notes bn ON c.book_title = bn.book_title
            GROUP BY c.book_title
            ORDER BY c.book_title ASC
        """)
        return [dict(row) for row in cursor.fetchall()]

def save_book_note(book_title, author, note):
    if "hasNote" in note or "尚未填寫閱讀心得備註" in note:
        note = ""

    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO book_notes (book_title, author, note, updated_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(book_title) DO UPDATE SET
                author = excluded.author,
                note = excluded.note,
                updated_at = excluded.updated_at
        """, (book_title, author, note, datetime.now().isoformat()))
        conn.commit()
        return True

def get_full_export_data():
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT c.book_title, c.author, COALESCE(bn.note, '') as book_note
            FROM clippings c
            LEFT JOIN book_notes bn ON c.book_title = bn.book_title
            GROUP BY c.book_title
            ORDER BY c.book_title ASC
        """)
        books = [dict(row) for row in cursor.fetchall()]

        cursor.execute("""
            SELECT id, book_title, author, location, clipping_type, content, clipped_at, is_starred
            FROM clippings
            ORDER BY clipped_at ASC
        """)
        clippings = [dict(row) for row in cursor.fetchall()]

        return books, clippings

def backup_database(dest_path):
    safe_dest_path = os.path.abspath(dest_path)
    
    # [修正 WinError 32]：明確關閉 SQLite 連線
    src = get_connection()
    dest = sqlite3.connect(safe_dest_path, timeout=15.0)
    try:
        src.backup(dest)
    finally:
        # 強制釋放檔案控制權
        dest.close()
        src.close()

def restore_database(src_path):
    safe_src_path = os.path.abspath(src_path)
    
    if not os.path.exists(safe_src_path) or not os.path.isfile(safe_src_path):
        raise ValueError("無效的備份檔案路徑")

    try:
        # [修正 WinError 32]：驗證階段完畢後強制關閉
        test_conn = sqlite3.connect(safe_src_path, timeout=5.0)
        try:
            cursor = test_conn.cursor()
            cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='clippings'")
            if not cursor.fetchone():
                raise ValueError("無效的備份檔案：缺少 clippings 資料表結構")
        finally:
            test_conn.close()
    except sqlite3.DatabaseError:
        raise ValueError("檔案毀損或非有效的 SQLite 資料庫檔案")

    # [修正 WinError 32]：備份還原階段明確關閉連線
    dest = get_connection()
    src = sqlite3.connect(safe_src_path, timeout=15.0)
    try:
        src.backup(dest)
    finally:
        src.close()
        dest.close()

    init_db()