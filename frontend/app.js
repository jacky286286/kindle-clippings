const API_BASE = "/api";

let state = {
    currentTab: "clippingsTab",
    allClippings: [],
    booksWithNotes: [],
    selectedBook: "ALL",
    searchKeyword: "",
    startDate: "",
    endDate: "",
    onlyStarred: false,
    hasNotesOnly: false, // 篩選有筆記之標註開關
    selectedClippingIds: new Set(),
    editingBookTitle: null,
    expandedNestedNoteIds: new Set()
};

// DOM 快取
const fileInput = document.getElementById("fileInput");
const dropZone = document.getElementById("dropZone");
const uploadStatus = document.getElementById("uploadStatus");
const bookListEl = document.getElementById("bookList");
const cardsContainer = document.getElementById("cardsContainer");
const searchInput = document.getElementById("searchInput");
const currentBookTitleEl = document.getElementById("currentBookTitle");
const clippingsCountEl = document.getElementById("clippingsCount");
const totalBooksCountEl = document.getElementById("totalBooksCount");
const exportMdBtn = document.getElementById("exportMdBtn");
const downloadAllMdBtn = document.getElementById("downloadAllMdBtn");

const startDateInput = document.getElementById("startDateInput");
const endDateInput = document.getElementById("endDateInput");
const starredOnlyCheckbox = document.getElementById("starredOnlyCheckbox");
const hasNotesOnlyCheckbox = document.getElementById("hasNotesOnlyCheckbox");
const clearFiltersBtn = document.getElementById("clearFiltersBtn");

const selectAllCheckbox = document.getElementById("selectAllCheckbox");
const selectedCountText = document.getElementById("selectedCountText");
const batchDeleteBtn = document.getElementById("batchDeleteBtn");

const bookNotesListEl = document.getElementById("bookNotesList");
const booksOverviewCountEl = document.getElementById("booksOverviewCount");

const backupDbBtn = document.getElementById("backupDbBtn");
const restoreDbFileInput = document.getElementById("restoreDbFileInput");
const backupRestoreStatus = document.getElementById("backupRestoreStatus");

document.addEventListener("DOMContentLoaded", () => {
    initApp();
});

function initApp() {
    setupTabEvents();
    setupUploadEvents();
    setupSearchEvents();
    setupExportEvent();
    setupFilterEvents();
    setupBatchEvents();
    setupBackupRestoreEvents();
    setupCardsEvents();
    setupBookNotesEvents();
    
    fetchClippings();
    fetchBooksWithNotes();
}

function parseLocationRange(locStr) {
    if (!locStr) return null;
    const nums = (String(locStr).match(/\d+/g) || []).map(Number);
    if (nums.length === 0) return null;
    if (nums.length === 1) return [nums[0], nums[0]];
    return [Math.min(nums[0], nums[1]), Math.max(nums[0], nums[1])];
}

// 1. 分頁切換
function setupTabEvents() {
    document.querySelectorAll(".tab-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            const targetTab = btn.dataset.tab;
            state.currentTab = targetTab;

            document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");

            document.querySelectorAll(".tab-content").forEach(content => {
                content.classList.toggle("active", content.id === targetTab);
            });

            if (targetTab === "booksTab") {
                fetchBooksWithNotes();
            } else {
                renderFilteredClippings();
            }
        });
    });
}

// 2. 標註資料撈取
async function fetchClippings() {
    try {
        const response = await fetch(`${API_BASE}/clippings`);
        if (!response.ok) throw new Error("無法連接後端伺服器");
        const resData = await response.json();
        
        state.allClippings = resData.data;
        state.selectedClippingIds.clear();
        updateBatchBar();
        renderSidebarBooks();
        renderFilteredClippings();
    } catch (error) {
        cardsContainer.innerHTML = `<p style="color: #E55039;">載入失敗：${escapeHTML(error.message)}</p>`;
    }
}

// 3. 書籍與心得清單撈取
async function fetchBooksWithNotes() {
    try {
        const response = await fetch(`${API_BASE}/books`);
        if (!response.ok) throw new Error("取得書籍資料失敗");
        const resData = await response.json();
        state.booksWithNotes = resData.data;
        renderBooksOverview();
    } catch (error) {
        bookNotesListEl.innerHTML = `<p style="color: #E55039;">載入失敗：${escapeHTML(error.message)}</p>`;
    }
}

// 4. 檔案上傳
function setupUploadEvents() {
    fileInput.addEventListener("change", (e) => {
        if (e.target.files.length > 0) uploadFile(e.target.files[0]);
    });

    dropZone.addEventListener("dragover", (e) => {
        e.preventDefault();
        dropZone.classList.add("dragover");
    });

    dropZone.addEventListener("dragleave", () => {
        dropZone.classList.remove("dragover");
    });

    dropZone.addEventListener("drop", (e) => {
        e.preventDefault();
        dropZone.classList.remove("dragover");
        if (e.dataTransfer.files.length > 0) {
            uploadFile(e.dataTransfer.files[0]);
        }
    });
}

async function uploadFile(file) {
    const formData = new FormData();
    formData.append("file", file);

    uploadStatus.style.color = "#4A90E2";
    uploadStatus.textContent = "檔案解析與同步中...";

    try {
        const response = await fetch(`${API_BASE}/upload`, {
            method: "POST",
            body: formData
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "上傳失敗");

        uploadStatus.style.color = "#2ED573";
        uploadStatus.textContent = `完成！新增: ${result.statistics.inserted}，更新: ${result.statistics.updated}，略過: ${result.statistics.skipped}`;
        
        await fetchClippings();
        await fetchBooksWithNotes();
    } catch (error) {
        uploadStatus.style.color = "#E55039";
        uploadStatus.textContent = `錯誤: ${error.message}`;
    } finally {
        fileInput.value = "";
    }
}

// 5. 搜尋與過濾條件
function setupSearchEvents() {
    searchInput.addEventListener("input", (e) => {
        state.searchKeyword = e.target.value.trim().toLowerCase();
        if (state.currentTab === "clippingsTab") {
            renderFilteredClippings();
        } else {
            renderBooksOverview();
        }
    });
}

function setupFilterEvents() {
    startDateInput.addEventListener("change", (e) => {
        state.startDate = e.target.value;
        renderFilteredClippings();
    });

    endDateInput.addEventListener("change", (e) => {
        state.endDate = e.target.value;
        renderFilteredClippings();
    });

    starredOnlyCheckbox.addEventListener("change", (e) => {
        state.onlyStarred = e.target.checked;
        renderFilteredClippings();
    });

    if (hasNotesOnlyCheckbox) {
        hasNotesOnlyCheckbox.addEventListener("change", (e) => {
            state.hasNotesOnly = e.target.checked;
            renderFilteredClippings();
        });
    }

    clearFiltersBtn.addEventListener("click", () => {
        state.startDate = "";
        state.endDate = "";
        state.onlyStarred = false;
        state.hasNotesOnly = false;
        startDateInput.value = "";
        endDateInput.value = "";
        starredOnlyCheckbox.checked = false;
        if (hasNotesOnlyCheckbox) hasNotesOnlyCheckbox.checked = false;
        renderFilteredClippings();
    });
}

// 6. 批次選取與刪除
function setupBatchEvents() {
    selectAllCheckbox.addEventListener("change", (e) => {
        const currentFiltered = getFilteredData();
        if (e.target.checked) {
            currentFiltered.forEach(item => state.selectedClippingIds.add(Number(item.id)));
        } else {
            currentFiltered.forEach(item => state.selectedClippingIds.delete(Number(item.id)));
        }
        updateBatchBar();
        renderFilteredClippings();
    });

    batchDeleteBtn.addEventListener("click", async () => {
        const idsToDelete = Array.from(state.selectedClippingIds);
        if (idsToDelete.length === 0) return;

        const confirmed = window.confirm(`確定要批次刪除選取的 ${idsToDelete.length} 則紀錄嗎？此動作無法復原。`);
        if (!confirmed) return;

        batchDeleteBtn.disabled = true;

        try {
            const response = await fetch(`${API_BASE}/clippings/batch-delete`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ids: idsToDelete })
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || "批次刪除失敗");

            state.allClippings = state.allClippings.filter(item => !state.selectedClippingIds.has(Number(item.id)));
            state.selectedClippingIds.clear();
            
            updateBatchBar();
            renderSidebarBooks();
            renderFilteredClippings();
            fetchBooksWithNotes();
        } catch (error) {
            alert(`批次刪除錯誤: ${error.message}`);
            updateBatchBar();
        }
    });
}

function toggleSelectClipping(id) {
    const numId = Number(id);
    if (state.selectedClippingIds.has(numId)) {
        state.selectedClippingIds.delete(numId);
    } else {
        state.selectedClippingIds.add(numId);
    }
    updateBatchBar();
}

function updateBatchBar() {
    const selectedCount = state.selectedClippingIds.size;
    selectedCountText.textContent = `已選取 ${selectedCount} 則`;
    batchDeleteBtn.disabled = selectedCount === 0;

    const filtered = getFilteredData();
    if (filtered.length > 0) {
        selectAllCheckbox.checked = filtered.every(item => state.selectedClippingIds.has(Number(item.id)));
    } else {
        selectAllCheckbox.checked = false;
    }
}

// 7. 側邊欄書籍分類
function renderSidebarBooks() {
    const bookMap = {};
    state.allClippings.forEach(item => {
        bookMap[item.book_title] = (bookMap[item.book_title] || 0) + 1;
    });

    const bookTitles = Object.keys(bookMap);
    totalBooksCountEl.textContent = bookTitles.length;

    bookListEl.innerHTML = "";

    const allLi = document.createElement("li");
    allLi.className = state.selectedBook === 'ALL' ? 'active' : '';
    allLi.dataset.book = "ALL";
    allLi.textContent = `全部書籍 (${state.allClippings.length})`;
    allLi.addEventListener("click", () => handleBookSelection(allLi, "ALL", "全部書籍"));
    bookListEl.appendChild(allLi);

    bookTitles.forEach(title => {
        const li = document.createElement("li");
        li.textContent = `${title} (${bookMap[title]})`;
        li.dataset.book = title;
        if (state.selectedBook === title) li.classList.add("active");

        li.addEventListener("click", () => handleBookSelection(li, title, title));
        bookListEl.appendChild(li);
    });
}

function handleBookSelection(element, bookId, displayTitle) {
    document.querySelectorAll("#bookList li").forEach(el => el.classList.remove("active"));
    element.classList.add("active");
    state.selectedBook = bookId;
    currentBookTitleEl.textContent = displayTitle;
    renderFilteredClippings();
}

// 8. 整合筆記巢狀結構與多維度過濾
function getFilteredData() {
    // 先在全域資料集中完成筆記與標註的位置區間包含比對
    const items = state.allClippings.map(item => ({ ...item, nestedNotes: [] }));
    const notes = items.filter(i => i.clipping_type.toLowerCase() === "note");
    const highlights = items.filter(i => i.clipping_type.toLowerCase() !== "note");
    const nestedNoteIds = new Set();

    notes.forEach(note => {
        const noteRange = parseLocationRange(note.location);
        if (!noteRange) return;

        let matchedHl = null;
        let smallestSpan = Infinity;

        highlights.forEach(hl => {
            if (hl.book_title !== note.book_title) return;
            const hlRange = parseLocationRange(hl.location);
            if (!hlRange) return;

            if (hlRange[0] <= noteRange[0] && noteRange[1] <= hlRange[1]) {
                const span = hlRange[1] - hlRange[0];
                if (span < smallestSpan) {
                    smallestSpan = span;
                    matchedHl = hl;
                }
            }
        });

        if (matchedHl) {
            matchedHl.nestedNotes.push(note);
            nestedNoteIds.add(note.id);
        }
    });

    // 排除已被包含在標註下的獨立筆記，只處理頂層卡片
    const topLevelItems = items.filter(item => !nestedNoteIds.has(item.id));

    return topLevelItems.filter(item => {
        // 書籍選取過濾
        if (state.selectedBook !== "ALL" && item.book_title !== state.selectedBook) {
            return false;
        }

        // 「只看有筆記的標註」核心篩選：排除純筆記，且標註內必須包含至少 1 則關聯筆記
        if (state.hasNotesOnly) {
            const isHighlight = item.clipping_type.toLowerCase() !== "note";
            const hasNested = item.nestedNotes && item.nestedNotes.length > 0;
            if (!isHighlight || !hasNested) {
                return false;
            }
        }

        // 星號過濾
        if (state.onlyStarred && !item.is_starred) {
            return false;
        }

        // 日期過濾
        const itemDateStr = item.clipped_at.substring(0, 10);
        if (state.startDate && itemDateStr < state.startDate) {
            return false;
        }
        if (state.endDate && itemDateStr > state.endDate) {
            return false;
        }

        // 關鍵字過濾（支援標註內容、書名、作者、以及附加之筆記內容）
        if (state.searchKeyword) {
            const kw = state.searchKeyword;
            const contentMatch = item.content && item.content.toLowerCase().includes(kw);
            const titleMatch = item.book_title && item.book_title.toLowerCase().includes(kw);
            const authorMatch = item.author && item.author.toLowerCase().includes(kw);
            const nestedMatch = item.nestedNotes && item.nestedNotes.some(
                n => n.content && n.content.toLowerCase().includes(kw)
            );
            if (!contentMatch && !titleMatch && !authorMatch && !nestedMatch) {
                return false;
            }
        }

        return true;
    });
}

// 9. 渲染標註卡片（緊密連寫，消除模板空白與換行）
function renderFilteredClippings() {
    const filtered = getFilteredData();
    clippingsCountEl.textContent = `共 ${filtered.length} 則紀錄`;
    updateBatchBar();

    if (filtered.length === 0) {
        cardsContainer.innerHTML = `<p style="color: #8892B0; padding: 2rem 0;">無符合條件的標註或筆記。</p>`;
        return;
    }

    cardsContainer.innerHTML = filtered.map(item => {
        const isNote = item.clipping_type.toLowerCase() === "note";
        const typeClass = isNote ? "note" : "highlight";
        const typeLabel = isNote ? "筆記" : "標註";
        const formattedDate = new Date(item.clipped_at).toLocaleString("zh-TW", {
            year: "numeric", month: "2-digit", day: "2-digit",
            hour: "2-digit", minute: "2-digit"
        });

        const isStarred = item.is_starred === 1;
        const starIcon = isStarred ? "★" : "☆";
        const starClass = isStarred ? "btn-star starred" : "btn-star";
        const isChecked = state.selectedClippingIds.has(Number(item.id)) ? "checked" : "";

        // 巢狀筆記 HTML 組裝
        let nestedNotesHtml = "";
        if (item.nestedNotes && item.nestedNotes.length > 0) {
            const isExpanded = state.expandedNestedNoteIds.has(Number(item.id));
            const displayStyle = isExpanded ? "flex" : "none";
            const iconText = isExpanded ? "▼" : "▶";

            nestedNotesHtml = `<div class="nested-notes-wrapper"><button type="button" class="btn-toggle-nested" data-hl-id="${item.id}"><span class="toggle-icon">${iconText}</span><span>關聯筆記 (${item.nestedNotes.length})</span></button><div class="nested-notes-content" id="nested-notes-${item.id}" style="display: ${displayStyle};">${item.nestedNotes.map(n => {
                const nDate = new Date(n.clipped_at).toLocaleString("zh-TW", {
                    year: "numeric", month: "2-digit", day: "2-digit",
                    hour: "2-digit", minute: "2-digit"
                });
                const cleanNoteContent = escapeHTML((n.content || "").trim());
                return `<div class="nested-note-item" id="card-${n.id}"><div class="nested-note-header"><div class="nested-note-header-left"><span class="tag note">筆記</span><span>位置: ${escapeHTML(n.location)}</span><span>記錄於: ${nDate}</span></div><button class="btn-delete btn-delete-clipping" data-id="${n.id}">刪除筆記</button></div><div class="nested-note-body">${cleanNoteContent}</div></div>`;
            }).join("")}</div></div>`;
        }

        const cleanMainContent = escapeHTML((item.content || "").trim());

        return `<article class="card ${typeClass}" id="card-${item.id}"><div class="card-header"><div class="card-header-left"><input type="checkbox" class="clipping-checkbox" data-id="${item.id}" ${isChecked}><button class="${starClass} btn-toggle-star" data-id="${item.id}" data-starred="${!isStarred}" title="切換星號">${starIcon}</button><span class="tag ${typeClass}">${typeLabel}</span><span>位置: ${escapeHTML(item.location)}</span></div><button class="btn-delete btn-delete-clipping" data-id="${item.id}">刪除</button></div><div class="card-body">${cleanMainContent}${nestedNotesHtml}</div><div class="card-footer"><span>${escapeHTML(item.book_title)} (${escapeHTML(item.author)})</span><span>記錄於: ${formattedDate}</span></div></article>`;
    }).join("");
}

// 標註卡片與巢狀收合事件委派監聽器
function setupCardsEvents() {
    cardsContainer.addEventListener("click", (e) => {
        const toggleBtn = e.target.closest(".btn-toggle-nested");
        if (toggleBtn) {
            const hlId = Number(toggleBtn.dataset.hlId);
            const contentEl = document.getElementById(`nested-notes-${hlId}`);
            const iconEl = toggleBtn.querySelector(".toggle-icon");
            if (contentEl) {
                const isHidden = contentEl.style.display === "none";
                contentEl.style.display = isHidden ? "flex" : "none";
                if (iconEl) iconEl.textContent = isHidden ? "▼" : "▶";

                if (isHidden) {
                    state.expandedNestedNoteIds.add(hlId);
                } else {
                    state.expandedNestedNoteIds.delete(hlId);
                }
            }
            return;
        }

        const deleteBtn = e.target.closest(".btn-delete-clipping");
        if (deleteBtn) {
            handleDelete(Number(deleteBtn.dataset.id));
            return;
        }

        const starBtn = e.target.closest(".btn-toggle-star");
        if (starBtn) {
            const id = Number(starBtn.dataset.id);
            const nextStatus = starBtn.dataset.starred === "true";
            toggleStar(id, nextStatus);
            return;
        }
    });

    cardsContainer.addEventListener("change", (e) => {
        const checkbox = e.target.closest(".clipping-checkbox");
        if (checkbox) {
            toggleSelectClipping(Number(checkbox.dataset.id));
        }
    });
}

// 10. 星號與刪除
async function toggleStar(id, newStatus) {
    try {
        const response = await fetch(`${API_BASE}/clippings/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ is_starred: newStatus })
        });
        if (!response.ok) throw new Error("更新星號狀態失敗");

        const target = state.allClippings.find(item => item.id === id);
        if (target) target.is_starred = newStatus ? 1 : 0;
        renderFilteredClippings();
    } catch (err) {
        alert(err.message);
    }
}

async function handleDelete(id) {
    const confirmed = window.confirm("確定要刪除此則紀錄嗎？");
    if (!confirmed) return;

    try {
        const response = await fetch(`${API_BASE}/clippings/${id}`, { method: "DELETE" });
        if (!response.ok) throw new Error("刪除失敗");

        state.allClippings = state.allClippings.filter(item => item.id !== id);
        state.selectedClippingIds.delete(Number(id));
        
        renderSidebarBooks();
        renderFilteredClippings();
        fetchBooksWithNotes();
    } catch (error) {
        alert(`刪除失敗：${error.message}`);
    }
}

// 11. 書籍心得清單渲染
function renderBooksOverview() {
    let books = state.booksWithNotes;

    if (state.searchKeyword) {
        const kw = state.searchKeyword;
        books = books.filter(b => 
            b.book_title.toLowerCase().includes(kw) || 
            b.author.toLowerCase().includes(kw) ||
            (b.note && b.note.toLowerCase().includes(kw))
        );
    }

    booksOverviewCountEl.textContent = `共 ${books.length} 本書籍`;

    if (books.length === 0) {
        bookNotesListEl.innerHTML = `<p style="color: #8892B0; padding: 2rem 0;">目前無符合書籍。</p>`;
        return;
    }

    bookNotesListEl.innerHTML = books.map((b, index) => {
        const isEditing = state.editingBookTitle === b.book_title;
        const hasNote = b.note && b.note.trim().length > 0;

        return `
            <div class="book-note-card" data-book-title="${escapeHTML(b.book_title)}">
                <div class="book-info-col">
                    <h3>${escapeHTML(b.book_title)}</h3>
                    <span class="author">${escapeHTML(b.author)}</span>
                    <span class="clipping-stat">包含 ${b.clipping_count} 則標註與筆記</span>
                </div>

                <div class="book-note-col">
                    ${isEditing ? `
                        <div class="note-edit-view">
                            <textarea id="note-input-${index}" placeholder="輸入您對《${escapeHTML(b.book_title)}》的心得備註...">${escapeHTML(b.note)}</textarea>
                            <div class="note-actions">
                                <button class="btn-secondary btn-cancel-note" type="button">取消</button>
                                <button class="btn-action btn-save-note" type="button" data-index="${index}" data-book-title="${escapeHTML(b.book_title)}" data-author="${escapeHTML(b.author)}">儲存</button>
                            </div>
                        </div>
                    ` : `
                        <div class="note-display-view">
                            <div class="note-text ${!hasNote ? 'note-placeholder' : ''}">${hasNote ? escapeHTML(b.note) : '尚未填寫閱讀心得備註...'}</div>
                            <div class="note-actions">
                                <button class="btn-secondary btn-edit-note" type="button" data-book-title="${escapeHTML(b.book_title)}">
                                    ${hasNote ? '修改心得' : '新增心得'}
                                </button>
                            </div>
                        </div>
                    `}
                </div>
            </div>
        `;
    }).join("");
}

function setupBookNotesEvents() {
    bookNotesListEl.addEventListener("click", (e) => {
        const editBtn = e.target.closest(".btn-edit-note");
        if (editBtn) {
            startEditBookNote(editBtn.dataset.bookTitle);
            return;
        }

        if (e.target.closest(".btn-cancel-note")) {
            cancelEditBookNote();
            return;
        }

        const saveBtn = e.target.closest(".btn-save-note");
        if (saveBtn) {
            const title = saveBtn.dataset.bookTitle;
            const author = saveBtn.dataset.author;
            const index = saveBtn.dataset.index;
            submitBookNote(title, author, index);
            return;
        }
    });
}

function startEditBookNote(bookTitle) {
    state.editingBookTitle = bookTitle;
    renderBooksOverview();

    const activeTextarea = document.querySelector(".note-edit-view textarea");
    if (activeTextarea) {
        activeTextarea.focus();
        const len = activeTextarea.value.length;
        activeTextarea.setSelectionRange(len, len);
    }
}

function cancelEditBookNote() {
    state.editingBookTitle = null;
    renderBooksOverview();
}

async function submitBookNote(bookTitle, author, inputIndex) {
    const textarea = document.getElementById(`note-input-${inputIndex}`);
    if (!textarea) return;
    const noteText = textarea.value.trim();

    try {
        const response = await fetch(`${API_BASE}/books/note`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                book_title: bookTitle,
                author: author,
                note: noteText
            })
        });
        if (!response.ok) throw new Error("儲存心得失敗");

        const targetBook = state.booksWithNotes.find(b => b.book_title === bookTitle);
        if (targetBook) targetBook.note = noteText;

        state.editingBookTitle = null;
        renderBooksOverview();
    } catch (error) {
        alert(`儲存失敗: ${error.message}`);
    }
}

// 12. Markdown 匯出
function setupExportEvent() {
    exportMdBtn.addEventListener("click", async () => {
        const items = getFilteredData();
        if (items.length === 0) {
            alert("目前篩選條件下沒有可匯出的內容。");
            return;
        }

        const booksGroup = {};
        items.forEach(item => {
            if (!booksGroup[item.book_title]) {
                booksGroup[item.book_title] = {
                    author: item.author,
                    items: []
                };
            }
            booksGroup[item.book_title].items.push(item);
        });

        let mdContent = `# Kindle 筆記與標註匯出\n\n`;
        mdContent += `> 匯出時間：${new Date().toLocaleString("zh-TW")}\n\n---\n\n`;

        for (const [title, bookData] of Object.entries(booksGroup)) {
            mdContent += `## 《${title}》\n`;
            mdContent += `**作者**：${bookData.author}\n\n`;

            bookData.items.forEach(item => {
                const isNote = item.clipping_type.toLowerCase() === "note";
                const dateStr = new Date(item.clipped_at).toLocaleDateString("zh-TW");
                const starPrefix = item.is_starred ? "★ " : "";

                if (isNote) {
                    mdContent += `> 💡 ${starPrefix}**筆記** (位置: ${item.location} | ${dateStr})\n>\n`;
                    mdContent += `> ${item.content.replace(/\n/g, "\n> ")}\n\n`;
                } else {
                    mdContent += `> 📌 ${starPrefix}**標註** (位置: ${item.location} | ${dateStr})\n>\n`;
                    mdContent += `> ${item.content.replace(/\n/g, "\n> ")}\n\n`;

                    if (item.nestedNotes && item.nestedNotes.length > 0) {
                        item.nestedNotes.forEach(n => {
                            const nDate = new Date(n.clipped_at).toLocaleDateString("zh-TW");
                            mdContent += `>> 💡 **附註筆記** (位置: ${n.location} | ${nDate})\n>>\n`;
                            mdContent += `>> ${n.content.replace(/\n/g, "\n>> ")}\n\n`;
                        });
                    }
                }
            });
            mdContent += `---\n\n`;
        }

        try {
            await navigator.clipboard.writeText(mdContent);
            const originalText = exportMdBtn.textContent;
            exportMdBtn.textContent = "已複製至剪貼簿！";
            exportMdBtn.classList.add("copied");

            setTimeout(() => {
                exportMdBtn.textContent = originalText;
                exportMdBtn.classList.remove("copied");
            }, 2000);
        } catch (err) {
            alert("寫入剪貼簿失敗，請檢查瀏覽器授權。");
        }
    });

    downloadAllMdBtn.addEventListener("click", () => {
        window.location.href = `${API_BASE}/export/markdown`;
    });
}

// 13. 資料庫備份與還原
function setupBackupRestoreEvents() {
    backupDbBtn.addEventListener("click", () => {
        window.location.href = `${API_BASE}/backup`;
    });

    restoreDbFileInput.addEventListener("change", async (e) => {
        if (e.target.files.length === 0) return;
        const file = e.target.files[0];

        const confirmed = window.confirm(
            "警告：還原資料庫將會完全覆蓋現有的所有標註、筆記與心得資料！確定要繼續嗎？"
        );
        if (!confirmed) {
            restoreDbFileInput.value = "";
            return;
        }

        restoreDbFileInput.disabled = true;

        const formData = new FormData();
        formData.append("backup_file", file);

        backupRestoreStatus.style.color = "#4A90E2";
        backupRestoreStatus.textContent = "資料庫還原中...";

        try {
            const response = await fetch(`${API_BASE}/restore`, {
                method: "POST",
                body: formData
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || "還原失敗");

            backupRestoreStatus.style.color = "#2ED573";
            backupRestoreStatus.textContent = "資料庫還原成功！";

            await fetchClippings();
            await fetchBooksWithNotes();
        } catch (error) {
            backupRestoreStatus.style.color = "#E55039";
            backupRestoreStatus.textContent = `錯誤：${error.message}`;
        } finally {
            restoreDbFileInput.value = "";
            restoreDbFileInput.disabled = false;
        }
    });
}

function escapeHTML(str) {
    if (str == null) return "";
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}