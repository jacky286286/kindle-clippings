import re
from datetime import datetime
from dateutil import parser as date_parser

def clean_text(text):
    """移除 UTF-8 BOM (\ufeff)、零寬字元與首尾空白"""
    if not text:
        return ""
    return text.replace("\ufeff", "").replace("\u200b", "").strip()

def parse_datetime(time_part):
    time_cleaned = re.sub(r'^(?:新增於|添加于|Added on)\s*', '', time_part, flags=re.IGNORECASE)
    time_cleaned = re.sub(r'[年月]', '-', time_cleaned)
    time_cleaned = re.sub(r'日', ' ', time_cleaned)
    time_cleaned = re.sub(r'星期[一二三四五六日天]', '', time_cleaned)

    try:
        if len(time_cleaned) > 100:
            raise ValueError("時間字串異常過長")
        return date_parser.parse(time_cleaned, fuzzy=True)
    except Exception:
        return datetime.now()

def parse_title_line(title_line):
    """解析第一行書名與作者"""
    raw_title = clean_text(title_line)
    author = "Unknown"
    title = raw_title

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

def parse_metadata_legacy(meta_line):
    """舊版解析器 (AZW3 / MOBI)：標準單一位置/頁碼正則比對"""
    meta_line = clean_text(meta_line)
    
    clipping_type = "Highlight"
    if "筆記" in meta_line or "笔记" in meta_line or "Note" in meta_line:
        clipping_type = "Note"
    elif "書籤" in meta_line or "书签" in meta_line or "Bookmark" in meta_line:
        clipping_type = "Bookmark"

    loc_match = re.search(r'(?:位置|Location|page|頁)\s*#?([0-9]+-?[0-9]*)', meta_line, re.IGNORECASE)
    location = loc_match.group(1) if loc_match else "0"

    time_part = meta_line.split("|")[-1].strip()
    clipped_at = parse_datetime(time_part)

    return clipping_type, location, clipped_at

def parse_metadata_kfx(meta_line):
    """新版解析器 (KFX)：優先鎖定 Location 區間，避免受 page 干擾"""
    meta_line = clean_text(meta_line)
    
    clipping_type = "Highlight"
    if "筆記" in meta_line or "笔记" in meta_line or "Note" in meta_line:
        clipping_type = "Note"
    elif "書籤" in meta_line or "书签" in meta_line or "Bookmark" in meta_line:
        clipping_type = "Bookmark"

    loc_match = re.search(r'(?:位置|Location)\s*#?\s*([0-9]+(?:-[0-9]+)?)', meta_line, re.IGNORECASE)
    if not loc_match:
        loc_match = re.search(r'(?:page|頁|页)\s*#?\s*([0-9]+(?:-[0-9]+)?)', meta_line, re.IGNORECASE)
    
    location = loc_match.group(1) if loc_match else "0"

    time_part = meta_line.split("|")[-1].strip()
    clipped_at = parse_datetime(time_part)

    return clipping_type, location, clipped_at

def parse_clippings_file(file_content_str, mode="kfx"):
    """
    依據選擇之 mode 切換解析模式：
    - 'legacy': AZW3 / MOBI 格式
    - 'kfx': KFX 格式
    """
    raw_blocks = file_content_str.split("==========")
    parsed_items = []
    meta_parser = parse_metadata_legacy if mode == "legacy" else parse_metadata_kfx

    for block in raw_blocks:
        lines = [clean_text(line) for line in block.splitlines() if clean_text(line)]
        if len(lines) < 2:
            continue

        book_title, author = parse_title_line(lines[0])
        clipping_type, location, clipped_at = meta_parser(lines[1])
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