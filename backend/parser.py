import re
from datetime import datetime
from dateutil import parser as date_parser

def clean_text(text):
    """移除包含 BOM (\ufeff) 與頭尾空白的乾淨字串處理"""
    if not text:
        return ""
    # 移除 UTF-8 BOM 與各類零寬字元
    return text.replace("\ufeff", "").replace("\u200b", "").strip()

def parse_metadata_line(meta_line):
    meta_line = clean_text(meta_line)
    
    clipping_type = "Highlight"
    if "筆記" in meta_line or "Note" in meta_line:
        clipping_type = "Note"
    elif "書籤" in meta_line or "Bookmark" in meta_line:
        clipping_type = "Bookmark"

    loc_match = re.search(r'(?:位置|Location|page|頁)\s*#?([0-9]+-?[0-9]*)', meta_line, re.IGNORECASE)
    location = loc_match.group(1) if loc_match else "0"

    time_part = meta_line.split("|")[-1].strip()
    time_cleaned = re.sub(r'^(?:新增於|Added on)\s*', '', time_part)
    time_cleaned = re.sub(r'[年月]', '-', time_cleaned)
    time_cleaned = re.sub(r'日', ' ', time_cleaned)
    time_cleaned = re.sub(r'星期[一二三四五六日天]', '', time_cleaned)

    try:
        if len(time_cleaned) > 100:
            raise ValueError("時間字串異常過長")
        clipped_at = date_parser.parse(time_cleaned, fuzzy=True)
    except Exception:
        clipped_at = datetime.now()

    return clipping_type, location, clipped_at

def parse_title_line(title_line):
    """
    解析第一行：萃取書名與作者，處理巢狀括號與不可見字元。
    """
    raw_title = clean_text(title_line)
    author = "Unknown"
    title = raw_title

    # 尋找最外層的括號作為作者邊界
    if raw_title.endswith(")"):
        first_open_paren = raw_title.rfind(" (")
        if first_open_paren != -1:
            title = clean_text(raw_title[:first_open_paren])
            author = clean_text(raw_title[first_open_paren + 2:-1])
        else:
            match = re.search(r'^(.*)\((.*)\)$', raw_title)
            if match:
                title = clean_text(match.group(1))
                author = clean_text(match.group(2))

    return title, author

def parse_clippings_file(file_content_str):
    raw_blocks = file_content_str.split("==========")
    parsed_items = []

    for block in raw_blocks:
        # 清理並過濾每行文字
        lines = [clean_text(line) for line in block.splitlines() if clean_text(line)]
        if len(lines) < 2:
            continue

        book_title, author = parse_title_line(lines[0])
        clipping_type, location, clipped_at = parse_metadata_line(lines[1])
        content = "\n".join(lines[2:]) if len(lines) >= 3 else ""

        parsed_items.append({
            "book_title": book_title,
            "author": author,
            "location": location,
            "clipping_type": clipping_type,
            "content": content,
            "clipped_at": clipped_at
        })

    return parsed_items