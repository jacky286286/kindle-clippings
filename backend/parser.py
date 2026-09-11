import re
from datetime import datetime
from dateutil import parser as date_parser

def parse_metadata_line(meta_line):
    """
    解析第二行元資料：萃取類型、位置 (Location/Page) 與時間。
    範例格式：
    - 您在位置 #120-122 的標註 | 新增於 2024年3月15日 星期五 上午11:20:00
    - Your Highlight on Location 120-122 | Added on Friday, March 15, 2024 11:20:00 AM
    """
    clipping_type = "Highlight"
    if "筆記" in meta_line or "Note" in meta_line:
        clipping_type = "Note"
    elif "書籤" in meta_line or "Bookmark" in meta_line:
        clipping_type = "Bookmark"

    # 擷取位置數值 (例如: 120-122 或 55)
    loc_match = re.search(r'(?:位置|Location|page|頁)\s*#?([0-9]+-?[0-9]*)', meta_line, re.IGNORECASE)
    location = loc_match.group(1) if loc_match else "0"

    # 擷取時間字串（以分隔符號 | 切割）
    time_part = meta_line.split("|")[-1].strip()
    # 清理常見的時間前綴詞
    time_cleaned = re.sub(r'^(?:新增於|Added on)\s*', '', time_part)
    
    # 將中文字元（年/月/日/星期）標準化以利解析
    time_cleaned = re.sub(r'[年月]', '-', time_cleaned)
    time_cleaned = re.sub(r'日', ' ', time_cleaned)
    time_cleaned = re.sub(r'星期[一二三四五六日天]', '', time_cleaned)

    try:
        # [安全修正] 防止針對 fuzzy parser 的 DoS 攻擊：限制傳入字串長度
        # 一般合法時間字串不會超過 50 個字元，設 100 為絕對安全上限
        if len(time_cleaned) > 100:
            raise ValueError("Time string abnormally long, skipping fuzzy parse")
            
        clipped_at = date_parser.parse(time_cleaned, fuzzy=True)
    except Exception:
        clipped_at = datetime.now()

    return clipping_type, location, clipped_at

def parse_title_line(title_line):
    """
    解析第一行：萃取書名與作者。
    範例：原子習慣 (詹姆斯‧克利爾) -> 書名: 原子習慣, 作者: 詹姆斯‧克利爾
    """
    author = "Unknown"
    title = title_line.strip()
    
    # [安全修正] 移除 (.*?) 與 \s* 的組合，改用貪婪匹配 (.*) 配合後方 .strip()
    # 徹底消除正則表達式災難性回溯 (ReDoS) 的風險
    match = re.search(r'^(.*)\(([^()]+)\)$', title)
    if match:
        title = match.group(1).strip()
        author = match.group(2).strip()
        
    return title, author

def parse_clippings_file(file_content_str):
    """
    主解析流程：讀取整份文字檔字串，回傳結構化字典清單。
    """
    raw_blocks = file_content_str.split("==========")
    parsed_items = []

    for block in raw_blocks:
        # 去除頭尾多餘換行，過濾空白區塊
        lines = [line.strip() for line in block.strip().splitlines() if line.strip()]
        if len(lines) < 2:
            continue

        book_title, author = parse_title_line(lines[0])
        clipping_type, location, clipped_at = parse_metadata_line(lines[1])
        
        # 標註或筆記的內文（第 3 行開始到最後）
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