import os
import re
import sqlite3
from datetime import datetime
from difflib import SequenceMatcher

DB_NAME = "clippings.db"

def get_connection():
    conn = sqlite3.connect(DB_NAME, timeout=15.0)
    conn.row_factory = sqlite3.Row
    return conn

def parse_location_range(loc_str):
    """將位置字串解析為數值區間 (start, end)"""
    if not loc_str:
        return None
    nums = [int(n) for n in re.findall(r'\d+', str(loc_str))]
    if not nums:
        return None
    if len(nums) == 1:
        return nums[0], nums[0]
    return min(nums[0], nums[1]), max(nums[0], nums[1])

def is_location_overlapping(loc1, loc2):
    """檢查兩個位置區間是否有重疊"""
    r1 = parse_location_range(loc1)
    r2 = parse_location_range(loc2)
    if not r1 or not r2:
        return False
    return max(r1[0], r2[0]) <= min(r1[1], r2[1])

def is_duplicate_clipping(content1, loc1, content2, loc2):
    if loc1 == loc2:
        return True

    c1 = (content1 or "").strip()
    c2 = (content2 or "").strip()

    if c1 and c2:
        sm = SequenceMatcher(None, c1, c2)
        full_ratio = sm.ratio()

        matching_chars = sum(match.size for match in sm.get_matching_blocks())
        min_len = min(len(c1), len(c2))
        containment_ratio = (matching_chars / min_len) if min_len > 0 else 0.0

        loc_overlap = is_location_overlapping(loc1, loc2)

        if (full_ratio >= 0.80) or (containment_ratio >= 0.80 and (loc_overlap or min_len >= 20)):
            return True

    if not c1 and not c2 and is_location_overlapping(loc1, loc2):
        return True

    return False

def parse_iso_datetime(dt_val):
    if isinstance(dt_val, str):
        try:
            return datetime.fromisoformat(dt_val)
        except Exception:
            return datetime.min
    if isinstance(dt_val, datetime):
        return dt_val
    return datetime.min

def stitch_adjacent_fragments():
    continuation_punctuations = ("，", "、", "；", "：", "」", "』", "）", ")", "]", "}", "。")

    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT DISTINCT book_title, clipping_type FROM clippings")
        groups = cursor.fetchall()

        for g in groups:
            b_title = g["book_title"]
            c_type = g["clipping_type"]

            cursor.execute("""
                SELECT id, book_title, author, location, clipping_type, content, clipped_at, is_starred
                FROM clippings
                WHERE book_title = ? AND clipping_type = ?
            """, (b_title, c_type))
            rows = [dict(r) for r in cursor.fetchall()]

            valid_rows = []
            for r in rows:
                rng = parse_location_range(r["location"])
                if rng:
                    r["_start"], r["_end"] = rng
                    valid_rows.append(r)

            valid_rows.sort(key=lambda x: (x["_start"], x["_end"]))

            i = 0
            while i < len(valid_rows) - 1:
                curr_item = valid_rows[i]
                next_item = valid_rows[i + 1]

                next_content = (next_item["content"] or "").strip()
                curr_content = (curr_item["content"] or "").strip()

                starts_with_punct = next_content.startswith(continuation_punctuations)
                loc_gap = next_item["_start"] - curr_item["_end"]
                is_adjacent = 0 <= loc_gap <= 10

                if starts_with_punct and is_adjacent and curr_content:
                    clean_prev = re.sub(r'。$', '', curr_content)
                    merged_content = clean_prev + next_content
                    new_location = f"{curr_item['_start']}-{max(curr_item['_end'], next_item['_end'])}"

                    t1 = parse_iso_datetime(curr_item["clipped_at"])
                    t2 = parse_iso_datetime(next_item["clipped_at"])
                    latest_time = max(t1, t2).isoformat()
                    merged_star = 1 if (curr_item["is_starred"] == 1 or next_item["is_starred"] == 1) else 0

                    cursor.execute("""
                        UPDATE clippings 
                        SET content = ?, location = ?, clipped_at = ?, is_starred = ?
                        WHERE id = ?
                    """, (merged_content, new_location, latest_time, merged_star, curr_item["id"]))

                    cursor.execute("DELETE FROM clippings WHERE id = ?", (next_item["id"],))

                    curr_item["content"] = merged_content
                    curr_item["location"] = new_location
                    curr_item["_end"] = max(curr_item["_end"], next_item["_end"])
                    curr_item["clipped_at"] = latest_time
                    curr_item["is_starred"] = merged_star

                    valid_rows.pop(i + 1)
                else:
                    i += 1

        conn.commit()

def deduplicate_existing_clippings():
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT DISTINCT book_title, clipping_type FROM clippings")
        groups = cursor.fetchall()

        total_deleted = 0

        for g in groups:
            b_title = g["book_title"]
            c_type = g["clipping_type"]

            cursor.execute("""
                SELECT id, book_title, author, location, clipping_type, content, clipped_at, is_starred
                FROM clippings
                WHERE book_title = ? AND clipping_type = ?
                ORDER BY id ASC
            """, (b_title, c_type))
            rows = [dict(r) for r in cursor.fetchall()]

            if len(rows) <= 1:
                continue

            clusters = []
            for row in rows:
                matched_cluster = None
                for cluster in clusters:
                    for member in cluster:
                        if is_duplicate_clipping(row["content"], row["location"], member["content"], member["location"]):
                            matched_cluster = cluster
                            break
                    if matched_cluster:
                        break
                if matched_cluster:
                    matched_cluster.append(row)
                else:
                    clusters.append([row])

            for cluster in clusters:
                if len(cluster) > 1:
                    cluster.sort(key=lambda x: parse_iso_datetime(x["clipped_at"]), reverse=True)
                    keep_item = cluster[0]
                    delete_items = cluster[1:]

                    any_starred = any(x["is_starred"] == 1 for x in cluster)
                    if any_starred and keep_item["is_starred"] != 1:
                        cursor.execute("UPDATE clippings SET is_starred = 1 WHERE id = ?", (keep_item["id"],))

                    del_ids = [x["id"] for x in delete_items]
                    placeholders = ",".join("?" for _ in del_ids)
                    cursor.execute(f"DELETE FROM clippings WHERE id IN ({placeholders})", del_ids)
                    total_deleted += len(del_ids)

        conn.commit()
        return total_deleted

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

        # 建立已刪除紀錄表，用於比對防止重複匯入
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS deleted_clippings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                book_title TEXT NOT NULL,
                author TEXT,
                location TEXT NOT NULL,
                clipping_type TEXT NOT NULL,
                content TEXT,
                clipped_at TIMESTAMP NOT NULL,
                deleted_at TIMESTAMP NOT NULL
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

    deduplicate_existing_clippings()
    stitch_adjacent_fragments()

def upsert_clipping(book_title, author, location, clipping_type, content, clipped_at):
    clean_content = (content or "").strip()

    with get_connection() as conn:
        cursor = conn.cursor()
        
        # 1. 優先檢查是否在「已刪除紀錄」中
        cursor.execute("""
            SELECT id, location, content, clipped_at 
            FROM deleted_clippings 
            WHERE book_title = ? AND clipping_type = ?
        """, (book_title, clipping_type))
        del_candidates = [dict(r) for r in cursor.fetchall()]

        for del_cand in del_candidates:
            if is_duplicate_clipping(clean_content, location, del_cand["content"], del_cand["location"]):
                del_time = parse_iso_datetime(del_cand["clipped_at"])
                # 規則：時間相同或更舊 -> 略過匯入
                if clipped_at <= del_time:
                    return "SKIPPED"
                else:
                    # 時間較新 -> 移除已刪除紀錄，允許重新匯入
                    cursor.execute("DELETE FROM deleted_clippings WHERE id = ?", (del_cand["id"],))
                    break

        # 2. 與既有 active 標註比對去重
        cursor.execute("""
            SELECT id, location, content, clipped_at, author, is_starred 
            FROM clippings 
            WHERE book_title = ? AND clipping_type = ?
        """, (book_title, clipping_type))
        candidates = [dict(r) for r in cursor.fetchall()]
        
        matched_candidates = []
        for cand in candidates:
            if is_duplicate_clipping(clean_content, location, cand["content"], cand["location"]):
                matched_candidates.append(cand)

        if not matched_candidates:
            cursor.execute("""
                INSERT INTO clippings (book_title, author, location, clipping_type, content, clipped_at, is_starred)
                VALUES (?, ?, ?, ?, ?, ?, 0)
            """, (book_title, author, location, clipping_type, content, clipped_at.isoformat()))
            conn.commit()
            status = "INSERTED"
        else:
            matched_candidates.sort(key=lambda x: parse_iso_datetime(x["clipped_at"]), reverse=True)
            newest_cand = matched_candidates[0]
            newest_cand_time = parse_iso_datetime(newest_cand["clipped_at"])
            any_starred = any(c["is_starred"] == 1 for c in matched_candidates)

            if clipped_at > newest_cand_time:
                target_id = newest_cand["id"]
                target_starred = 1 if any_starred else 0

                try:
                    cursor.execute("""
                        UPDATE clippings 
                        SET content = ?, clipped_at = ?, location = ?, author = ?, is_starred = ?
                        WHERE id = ?
                    """, (content, clipped_at.isoformat(), location, author, target_starred, target_id))
                except sqlite3.IntegrityError:
                    cursor.execute("""
                        UPDATE clippings 
                        SET content = ?, clipped_at = ?, author = ?, is_starred = ?
                        WHERE id = ?
                    """, (content, clipped_at.isoformat(), author, target_starred, target_id))

                del_ids = [c["id"] for c in matched_candidates if c["id"] != target_id]
                if del_ids:
                    placeholders = ",".join("?" for _ in del_ids)
                    cursor.execute(f"DELETE FROM clippings WHERE id IN ({placeholders})", del_ids)

                conn.commit()
                status = "UPDATED"
            else:
                target_id = newest_cand["id"]
                target_starred = 1 if any_starred else newest_cand["is_starred"]

                if target_starred != newest_cand["is_starred"]:
                    cursor.execute("UPDATE clippings SET is_starred = ? WHERE id = ?", (target_starred, target_id))

                del_ids = [c["id"] for c in matched_candidates if c["id"] != target_id]
                if del_ids:
                    placeholders = ",".join("?" for _ in del_ids)
                    cursor.execute(f"DELETE FROM clippings WHERE id IN ({placeholders})", del_ids)

                conn.commit()
                status = "SKIPPED"

    stitch_adjacent_fragments()
    return status

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
    """刪除單筆紀錄，刪除前先寫入 deleted_clippings"""
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT book_title, author, location, clipping_type, content, clipped_at 
            FROM clippings WHERE id = ?
        """, (int(clipping_id),))
        row = cursor.fetchone()
        if not row:
            return False

        cursor.execute("""
            INSERT INTO deleted_clippings (book_title, author, location, clipping_type, content, clipped_at, deleted_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        """, (row["book_title"], row["author"], row["location"], row["clipping_type"],
               row["content"], row["clipped_at"], datetime.now().isoformat()))

        cursor.execute("DELETE FROM clippings WHERE id = ?", (int(clipping_id),))
        conn.commit()
        return True

def delete_clippings_batch(clipping_ids):
    """批次刪除紀錄，刪除前先批次寫入 deleted_clippings"""
    if not clipping_ids:
        return 0
    try:
        safe_ids = [int(cid) for cid in clipping_ids]
    except (ValueError, TypeError):
        raise ValueError("無效的 ID 格式，必須為整數")

    deleted_count = 0
    chunk_size = 900 
    now_str = datetime.now().isoformat()

    with get_connection() as conn:
        cursor = conn.cursor()
        for i in range(0, len(safe_ids), chunk_size):
            chunk = safe_ids[i:i + chunk_size]
            placeholders = ",".join("?" for _ in chunk)

            cursor.execute(f"""
                SELECT book_title, author, location, clipping_type, content, clipped_at 
                FROM clippings WHERE id IN ({placeholders})
            """, chunk)
            rows = cursor.fetchall()

            for row in rows:
                cursor.execute("""
                    INSERT INTO deleted_clippings (book_title, author, location, clipping_type, content, clipped_at, deleted_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                """, (row["book_title"], row["author"], row["location"], row["clipping_type"],
                       row["content"], row["clipped_at"], now_str))

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
    src = get_connection()
    dest = sqlite3.connect(safe_dest_path, timeout=15.0)
    try:
        src.backup(dest)
    finally:
        dest.close()
        src.close()

def restore_database(src_path):
    safe_src_path = os.path.abspath(src_path)
    if not os.path.exists(safe_src_path) or not os.path.isfile(safe_src_path):
        raise ValueError("無效的備份檔案路徑")

    try:
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

    dest = get_connection()
    src = sqlite3.connect(safe_src_path, timeout=15.0)
    try:
        src.backup(dest)
    finally:
        src.close()
        dest.close()

    init_db()