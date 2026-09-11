import os
import io
import tempfile
from flask import Flask, request, jsonify, Response, send_file
from werkzeug.exceptions import RequestEntityTooLarge
from datetime import datetime
from database import (
    init_db, upsert_clipping, get_all_clippings, delete_clipping,
    delete_clippings_batch, update_clipping_star, get_books_with_notes, 
    save_book_note, get_full_export_data, backup_database, restore_database
)
from parser import parse_clippings_file

app = Flask(__name__)
app.config['MAX_CONTENT_LENGTH'] = 5 * 1024 * 1024 

init_db()

@app.errorhandler(RequestEntityTooLarge)
def handle_file_too_large(e):
    return jsonify({"error": "上傳檔案過大，請限制在 5MB 以內"}), 413

@app.after_request
def after_request(response):
    response.headers.add("Access-Control-Allow-Origin", "*")
    response.headers.add("Access-Control-Allow-Headers", "Content-Type,Authorization")
    response.headers.add("Access-Control-Allow-Methods", "GET,PUT,POST,PATCH,DELETE,OPTIONS")
    return response

@app.route("/api/upload", methods=["POST"])
def upload_clippings():
    if "file" not in request.files:
        return jsonify({"error": "未提供檔案"}), 400
    
    file = request.files["file"]
    if file.filename == "":
        return jsonify({"error": "未選取檔案"}), 400

    if not file.filename.lower().endswith('.txt'):
        return jsonify({"error": "僅支援上傳 .txt 格式檔案"}), 400

    try:
        file_content = file.read().decode("utf-8-sig")
    except UnicodeDecodeError:
        return jsonify({"error": "檔案編碼錯誤，請確保為 UTF-8 格式"}), 400

    items = parse_clippings_file(file_content)
    stats = {"inserted": 0, "updated": 0, "skipped": 0}
    for item in items:
        status = upsert_clipping(
            book_title=item["book_title"],
            author=item["author"],
            location=item["location"],
            clipping_type=item["clipping_type"],
            content=item["content"],
            clipped_at=item["clipped_at"]
        )
        if status == "INSERTED":
            stats["inserted"] += 1
        elif status == "UPDATED":
            stats["updated"] += 1
        elif status == "SKIPPED":
            stats["skipped"] += 1

    return jsonify({
        "message": "檔案解析完成",
        "total_parsed": len(items),
        "statistics": stats
    }), 200

@app.route("/api/clippings", methods=["GET"])
def get_clippings():
    data = get_all_clippings()
    return jsonify({"total": len(data), "data": data}), 200

@app.route("/api/clippings/<int:clipping_id>", methods=["DELETE"])
def remove_clipping(clipping_id):
    success = delete_clipping(clipping_id)
    if success:
        return jsonify({"message": "紀錄已成功刪除", "id": clipping_id}), 200
    return jsonify({"error": "找不到該筆資料"}), 404

@app.route("/api/clippings/batch-delete", methods=["POST"])
def batch_remove_clippings():
    payload = request.get_json()
    ids = payload.get("ids", []) if payload else []
    if not ids or not isinstance(ids, list):
        return jsonify({"error": "請提供欲刪除的 ID 陣列"}), 400

    deleted_count = delete_clippings_batch(ids)
    return jsonify({
        "message": f"已成功批次刪除 {deleted_count} 則紀錄",
        "deleted_count": deleted_count
    }), 200

@app.route("/api/clippings/<int:clipping_id>", methods=["PATCH"])
def patch_clipping_star(clipping_id):
    payload = request.get_json()
    if not payload or "is_starred" not in payload:
        return jsonify({"error": "未提供星號狀態"}), 400

    is_starred = payload.get("is_starred")
    success = update_clipping_star(clipping_id, is_starred=is_starred)
    if success:
        return jsonify({"message": "星號狀態已更新", "id": clipping_id}), 200
    return jsonify({"error": "更新失敗或紀錄不存在"}), 404

@app.route("/api/books", methods=["GET"])
def get_books():
    books = get_books_with_notes()
    return jsonify({"total": len(books), "data": books}), 200

@app.route("/api/books/note", methods=["POST"])
def update_book_note():
    payload = request.get_json()
    if not payload or "book_title" not in payload:
        return jsonify({"error": "書名為必填欄位"}), 400

    book_title = payload.get("book_title")
    author = payload.get("author", "Unknown")
    note = payload.get("note", "")

    save_book_note(book_title, author, note)
    return jsonify({"message": "書籍心得已儲存", "book_title": book_title}), 200

@app.route("/api/export/markdown", methods=["GET"])
def export_database_markdown():
    books, clippings = get_full_export_data()

    clippings_by_book = {}
    for clip in clippings:
        title = clip["book_title"]
        if title not in clippings_by_book:
            clippings_by_book[title] = []
        clippings_by_book[title].append(clip)

    now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    lines = [
        "# Kindle 完整閱讀筆記與標註匯出",
        "",
        f"> 匯出時間：{now_str}",
        f"> 資料庫總計：{len(books)} 本書籍，{len(clippings)} 則標註與筆記",
        "",
        "---",
        ""
    ]

    for b in books:
        title = b["book_title"]
        author = b["author"]
        book_note = b.get("book_note", "").strip()
        book_clippings = clippings_by_book.get(title, [])

        lines.append(f"## 《{title}》")
        lines.append(f"**作者**：{author}")
        lines.append("")

        is_invalid_note = "hasNote" in book_note or "尚未填寫閱讀心得備註" in book_note
        if book_note and not is_invalid_note:
            lines.append("### 📖 閱讀心得備註")
            lines.append(f"> {book_note.replace(chr(10), chr(10) + '> ')}")
            lines.append("")

        lines.append(f"### 標註與筆記清單 (共 {len(book_clippings)} 則)")
        lines.append("")

        if not book_clippings:
            lines.append("*此書目前無標註紀錄*")
            lines.append("")
        else:
            for item in book_clippings:
                is_note = item["clipping_type"].lower() == "note"
                star = "★ " if item["is_starred"] else ""
                type_name = "筆記" if is_note else "標註"
                icon = "💡" if is_note else "📌"
                date_str = item["clipped_at"][:10]

                lines.append(f"> {icon} {star}**{type_name}** (位置: {item['location']} | {date_str})")
                lines.append(">")
                clean_content = item["content"].replace("\n", "\n> ")
                lines.append(f"> {clean_content}")
                lines.append("")

        lines.append("---")
        lines.append("")

    full_markdown_text = "\n".join(lines)
    return Response(
        full_markdown_text,
        mimetype="text/markdown; charset=utf-8",
        headers={"Content-Disposition": "attachment; filename=kindle_clippings_all.md"}
    )

@app.route("/api/backup", methods=["GET"])
def download_db_backup():
    # 建立隨機檔名並【立即關閉】，釋放 Windows 檔案鎖，讓後續 SQLite 可寫入
    temp_file = tempfile.NamedTemporaryFile(delete=False, suffix=".db")
    temp_path = temp_file.name
    temp_file.close()

    try:
        backup_database(temp_path)
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        backup_filename = f"kindle_backup_{timestamp}.db"

        # 讀入記憶體
        with open(temp_path, 'rb') as f:
            db_content = f.read()

        return send_file(
            io.BytesIO(db_content),
            as_attachment=True,
            download_name=backup_filename,
            mimetype="application/x-sqlite3"
        )
    except Exception as e:
        return jsonify({"error": "備份資料庫時發生錯誤"}), 500
    finally:
        if os.path.exists(temp_path):
            os.remove(temp_path)

@app.route("/api/restore", methods=["POST"])
def restore_db_backup():
    if "backup_file" not in request.files:
        return jsonify({"error": "未提供備份檔案"}), 400

    file = request.files["backup_file"]
    if file.filename == "":
        return jsonify({"error": "未選取檔案"}), 400

    if not file.filename.lower().endswith(('.db', '.sqlite')):
        return jsonify({"error": "僅支援上傳 .db 格式檔案"}), 400

    # 建立隨機檔名並【立即關閉】，釋放 Windows 檔案鎖，讓 Flask file.save 可寫入
    temp_file = tempfile.NamedTemporaryFile(delete=False, suffix=".db")
    temp_path = temp_file.name
    temp_file.close()

    file.save(temp_path)

    try:
        restore_database(temp_path)
        return jsonify({"message": "資料庫已成功還原"}), 200
    except ValueError as ve:
        return jsonify({"error": str(ve)}), 400
    except Exception as e:
        return jsonify({"error": "還原失敗：檔案格式異常或資料毀損"}), 500
    finally:
        if os.path.exists(temp_path):
            os.remove(temp_path)

if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=True)