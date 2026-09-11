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
    selectedClippingIds: new Set(),
    editingBookTitle: null
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
    
    fetchClippings();
    fetchBooksWithNotes();
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
        fileInput.value = ""; // 清除選取狀態
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

    clearFiltersBtn.addEventListener("click", () => {
        state.startDate = "";
        state.endDate = "";
        state.onlyStarred = false;
        startDateInput.value = "";
        endDateInput.value = "";
        starredOnlyCheckbox.checked = false;
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

        // 防範重複點擊 (Race Condition)
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
            updateBatchBar(); // 失敗則恢復按鈕狀態
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

    bookListEl.innerHTML = ""; // 清空

    const allLi = document.createElement("li");
    allLi.className = state.selectedBook === 'ALL' ? 'active' : '';
    allLi.dataset.book = "ALL";
    allLi.textContent = `全部書籍 (${state.allClippings.length})`;
    allLi.addEventListener("click", () => handleBookSelection(allLi, "ALL", "全部書籍"));
    bookListEl.appendChild(allLi);

    bookTitles.forEach(title => {
        const li = document.createElement("li");
        li.textContent = `${title} (${bookMap[title]})`;
        li.dataset.book = title; // 已透過 DOM property 安全賦值
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

// 8. 取得篩選後資料
function getFilteredData() {
    return state.allClippings.filter(item => {
        if (state.selectedBook !== "ALL" && item.book_title !== state.selectedBook) {
            return false;
        }
        if (state.onlyStarred && !item.is_starred) {
            return false;
        }

        const itemDateStr = item.clipped_at.substring(0, 10);
        if (state.startDate && itemDateStr < state.startDate) {
            return false;
        }
        if (state.endDate && itemDateStr > state.endDate) {
            return false;
        }

        if (state.searchKeyword) {
            const kw = state.searchKeyword;
            const contentMatch = item.content && item.content.toLowerCase().includes(kw);
            const titleMatch = item.book_title && item.book_title.toLowerCase().includes(kw);
            const authorMatch = item.author && item.author.toLowerCase().includes(kw);
            if (!contentMatch && !titleMatch && !authorMatch) {
                return false;
            }
        }
        return true;
    });
}

// 9. 渲染標註卡片
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

        return `
            <article class="card ${typeClass}" id="card-${item.id}">
                <div class="card-header">
                    <div class="card-header-left">
                        <input type="checkbox" ${isChecked} onchange="toggleSelectClipping(${item.id})">
                        <button class="${starClass}" title="切換星號" onclick="toggleStar(${item.id}, ${!isStarred})">${starIcon}</button>
                        <span class="tag ${typeClass}">${typeLabel}</span>
                        <span>位置: ${escapeHTML(item.location)}</span>
                    </div>
                    <button class="btn-delete" onclick="handleDelete(${item.id})">刪除</button>
                </div>

                <div class="card-body">${escapeHTML(item.content)}</div>

                <div class="card-footer">
                    <span>${escapeHTML(item.book_title)} (${escapeHTML(item.author)})</span>
                    <span>記錄於: ${formattedDate}</span>
                </div>
            </article>
        `;
    }).join("");
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
            <div class="book-note-card">
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
                                <button class="btn-secondary" onclick="cancelEditBookNote()">取消</button>
                                <button class="btn-action" onclick="submitBookNote('${escapeAttr(b.book_title)}', '${escapeAttr(b.author)}', ${index})">儲存</button>
                            </div>
                        </div>
                    ` : `
                        <div class="note-display-view">
                            <div class="note-text ${!hasNote ? 'note-placeholder' : ''}">${hasNote ? escapeHTML(b.note) : '尚未填寫閱讀心得備註...'}</div>
                            <div class="note-actions">
                                <button class="btn-secondary" onclick="startEditBookNote('${escapeAttr(b.book_title)}')">
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

function startEditBookNote(bookTitle) {
    state.editingBookTitle = bookTitle;
    renderBooksOverview();
}

function cancelEditBookNote() {
    state.editingBookTitle = null;
    renderBooksOverview();
}

async function submitBookNote(bookTitle, author, inputIndex) {
    const textarea = document.getElementById(`note-input-${inputIndex}`);
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

// 13. 資料庫備份與還原事件處理
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

        // 防範重複觸發
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

function escapeAttr(str) {
    if (str == null) return "";
    return String(str)
        .replace(/'/g, "&#039;")
        .replace(/"/g, "&quot;");
}