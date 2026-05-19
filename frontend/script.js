// ════════════════════════════════════════════════════════
//  RAG Desktop Tool  —  script.js
// ════════════════════════════════════════════════════════

// ---------------------------
// Upload page elements
// ---------------------------
const dropArea = document.getElementById("drop-area");
const fileInput = document.getElementById("fileInput");
const fileName = document.getElementById("fileName");
const editBtn = document.getElementById("editBtn");
const saveBtn = document.getElementById("saveBtn");
const editMode = document.getElementById("editMode");
const chunkInput = document.getElementById("chunkInput");
const overlapInput = document.getElementById("overlapInput");
const overlay = document.getElementById("processingOverlay");
const progressBar = document.getElementById("progressBar");
const progressText = document.getElementById("progressText");
const cancelBtn = document.getElementById("cancelBtn");
const dbNameInput = document.getElementById("dbName");

let selectedFile = null;
let selectedFiles = [];
let chunkValue = 500;
let overlapValue = 50;

// ════════════════════════════════════════════════════════
//  FASSDB — Chat State
// ════════════════════════════════════════════════════════
let activeChatId = null;
let activeMsgs = [];
let pendingNewChat = false;

// ════════════════════════════════════════════════════════
//  ADVANCED MODE — global toggle
//  When true: question goes DIRECTLY to the LLM — no embedding,
//  no vector search, no RAG. The LLM answers from its own knowledge.
//  Works with every provider (cloud APIs + local).
// ════════════════════════════════════════════════════════
let advancedModeEnabled = false;

// ── greeting helper ───────────────────────────────────────
function getGreeting() {
    const h = new Date().getHours();
    if (h < 12) return "Good morning.";
    if (h < 17) return "Good afternoon.";
    if (h < 21) return "Good evening.";
    return "Good night.";
}

// ── show / hide the hero vs conversation view ─────────────
function showHero() {
    document.getElementById("chatPage").classList.add("hero-visible");
    document.getElementById("chatHero").style.display = "";
    document.getElementById("chatMessages").style.display = "none";
    document.getElementById("chatInputBar").style.display = "none";
    document.getElementById("heroGreeting").textContent = getGreeting();
    // sync placeholder
    document.getElementById("chatInput").placeholder =
        advancedModeEnabled ? "Ask anything" : "Ask anything";
}

function hideHero() {
    document.getElementById("chatPage").classList.remove("hero-visible");
    document.getElementById("chatHero").style.display = "none";
    document.getElementById("chatMessages").style.display = "";
    document.getElementById("chatInputBar").style.display = "";
    // focus bottom bar
    setTimeout(() => document.getElementById("chatInputBar_ta").focus(), 50);
}

// ── hero pill shortcut ────────────────────────────────────
function heroPrompt(text) {
    document.getElementById("chatInput").value = text;
    sendMessage();
}

// ── attach button ─────────────────────────────────────────
// Stores { file, dataUrl, base64, mimeType, name } objects
let _attachedFiles = [];

function triggerAttach() {
    document.getElementById("attachFileInput").click();
}

// Build a thumbnail card and add to the preview areas
function _addThumb(fileObj, idx) {
    const isImage = fileObj.mimeType.startsWith("image/");
    const areas = ["heroPreviewArea", "barPreviewArea"];

    areas.forEach(areaId => {
        const area = document.getElementById(areaId);
        if (!area) return;

        const thumb = document.createElement("div");
        thumb.className = "attach-thumb";
        thumb.dataset.idx = idx;

        if (isImage) {
            const img = document.createElement("img");
            img.src = fileObj.dataUrl;
            img.alt = fileObj.name;
            thumb.appendChild(img);
        } else {
            // Generic file icon
            const icon = document.createElement("div");
            icon.className = "attach-thumb-file";
            icon.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg><span>${fileObj.name.length > 12 ? fileObj.name.slice(0, 10) + "…" : fileObj.name}</span>`;
            thumb.appendChild(icon);
        }

        // Remove (×) button
        const rm = document.createElement("button");
        rm.className = "attach-thumb-remove";
        rm.textContent = "×";
        rm.title = "Remove";
        rm.onclick = () => _removeAttach(idx);
        thumb.appendChild(rm);

        area.appendChild(thumb);
    });
}

function _removeAttach(idx) {
    _attachedFiles = _attachedFiles.filter((_, i) => i !== idx);
    _rebuildPreviews();
}

function _rebuildPreviews() {
    ["heroPreviewArea", "barPreviewArea"].forEach(id => {
        const area = document.getElementById(id);
        if (area) area.innerHTML = "";
    });
    _attachedFiles.forEach((f, i) => _addThumb(f, i));
}

function _clearAttachments() {
    _attachedFiles = [];
    _rebuildPreviews();
    document.getElementById("attachFileInput").value = "";
}

// Read a File → { dataUrl, base64, mimeType }
function _readFile(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = e => {
            const dataUrl = e.target.result;               // data:mime;base64,XXXX
            const base64 = dataUrl.split(",")[1];         // just the XXXX part
            resolve({ dataUrl, base64, mimeType: file.type || "application/octet-stream" });
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("attachFileInput").addEventListener("change", async function () {
        if (!this.files.length) return;
        const startIdx = _attachedFiles.length;
        for (let i = 0; i < this.files.length; i++) {
            const file = this.files[i];
            try {
                const { dataUrl, base64, mimeType } = await _readFile(file);
                _attachedFiles.push({ file, dataUrl, base64, mimeType, name: file.name });
                _addThumb(_attachedFiles[_attachedFiles.length - 1], startIdx + i);
            } catch (e) {
                console.error("Failed to read file:", file.name, e);
            }
        }
        // reset so same file can be re-added if removed
        this.value = "";
    });

    // Set greeting on load
    document.getElementById("heroGreeting").textContent = getGreeting();

    // ── Clipboard paste → attach image ────────────────────────────────────────
    // Handles Ctrl+V in BOTH textareas (hero input + bottom bar).
    // If the clipboard contains an image, it's added as an attachment exactly
    // like a file picked via the attach button. Text paste works normally.
    async function _handlePaste(e) {
        const items = e.clipboardData && e.clipboardData.items;
        if (!items) return;

        let hasImage = false;
        for (const item of items) {
            if (!item.type.startsWith("image/")) continue;
            hasImage = true;
            e.preventDefault();   // stop browser from doing anything weird with the image

            const file = item.getAsFile();
            if (!file) continue;

            // Give the pasted image a readable name with a timestamp
            const ext = item.type.split("/")[1] || "png";
            const namedFile = new File([file], `pasted-image-${Date.now()}.${ext}`, { type: item.type });

            try {
                const { dataUrl, base64, mimeType } = await _readFile(namedFile);
                const idx = _attachedFiles.length;
                _attachedFiles.push({ file: namedFile, dataUrl, base64, mimeType, name: namedFile.name });
                _addThumb(_attachedFiles[idx], idx);
            } catch (err) {
                console.error("Clipboard image read failed:", err);
            }
        }
        // If no image was in the clipboard, let the default text-paste proceed
        if (!hasImage) return;
    }

    document.getElementById("chatInput").addEventListener("paste", _handlePaste);
    document.getElementById("chatInputBar_ta").addEventListener("paste", _handlePaste);
    // ─────────────────────────────────────────────────────────────────────────
});

function toggleAdvancedMode() {
    advancedModeEnabled = !advancedModeEnabled;
    const wrap = document.getElementById("advModeWrap");
    const stateEl = document.getElementById("advModeState");
    const selWrap = document.getElementById("dbSelectorWrap");
    const warnEl = document.getElementById("noDbWarn");
    const chatPage = document.getElementById("chatPage");

    if (advancedModeEnabled) {
        wrap.classList.add("active");
        stateEl.textContent = "ON";
        selWrap && selWrap.classList.add("disabled-wrap");
        document.getElementById("chatInput").placeholder = "Ask anything";
        document.getElementById("chatInputBar_ta").placeholder = "Ask anything";
        warnEl && warnEl.classList.add("hidden");
        document.getElementById("chatSendBtn").disabled = false;
        document.getElementById("chatSendBtn2").disabled = false;
        // show attach buttons
        chatPage.classList.add("adv-on");
    } else {
        wrap.classList.remove("active");
        stateEl.textContent = "OFF";
        selWrap && selWrap.classList.remove("disabled-wrap");
        document.getElementById("chatInput").placeholder = "Ask anything";
        document.getElementById("chatInputBar_ta").placeholder = "Ask a question about your documents";
        chatPage.classList.remove("adv-on");
        loadDbSelectorOptions();
    }
}

// ════════════════════════════════════════════════════════
//  PAGE ROUTING
// ════════════════════════════════════════════════════════
const SCROLL_PAGES = ["uploadPage", "collectionPage"];
const ALL_NAV_IDS = ["nav-upload", "nav-collection", "nav-chat", "nav-apis"];
const FULL_PAGES = ["chatPage", "apisPage"];

function showPage(pageId) {
    SCROLL_PAGES.forEach(id => document.getElementById(id).classList.add("hidden"));
    FULL_PAGES.forEach(id => document.getElementById(id).classList.add("hidden"));

    const mainScroll = document.getElementById("mainScroll");
    ALL_NAV_IDS.forEach(id => document.getElementById(id).classList.remove("active"));

    if (FULL_PAGES.includes(pageId)) {
        mainScroll.classList.add("hidden");
        document.getElementById(pageId).classList.remove("hidden");
    } else {
        mainScroll.classList.remove("hidden");
        document.getElementById(pageId).classList.remove("hidden");
    }

    const navMap = {
        uploadPage: "nav-upload",
        collectionPage: "nav-collection",
        chatPage: "nav-chat",
        apisPage: "nav-apis"
    };
    if (navMap[pageId]) document.getElementById(navMap[pageId]).classList.add("active");

    if (pageId === "collectionPage") loadCollections();
    if (pageId === "chatPage") {
        loadDbSelectorOptions();
        // Re-attach typing indicator if a query is still in-flight
        if (isThinking && !document.getElementById("typingIndicator")) {
            appendTypingIndicator();
        }
    }
    if (pageId === "apisPage") loadApiPage();
}

// ════════════════════════════════════════════════════════
//  UPLOAD LOGIC
// ════════════════════════════════════════════════════════
function triggerFileInput() { fileInput.click(); }

dropArea.addEventListener("dragover", e => { e.preventDefault(); dropArea.classList.add("drag-active"); });
dropArea.addEventListener("dragleave", () => dropArea.classList.remove("drag-active"));
dropArea.addEventListener("drop", e => {
    e.preventDefault(); dropArea.classList.remove("drag-active");
    const pdfs = Array.from(e.dataTransfer.files).filter(f => f.name.toLowerCase().endsWith(".pdf"));
    if (!pdfs.length) return alert("Only PDF files allowed");
    if (pdfs.length === 1) { selectedFile = pdfs[0]; selectedFiles = []; fileName.textContent = pdfs[0].name; }
    else { selectedFile = null; selectedFiles = pdfs.map(f => f.path); fileName.textContent = `${pdfs.slice(0, 2).map(f => f.name).join(", ")} +${pdfs.length - 2} more`; }
});

fileInput.addEventListener("change", () => {
    const files = Array.from(fileInput.files);
    if (files.length === 1) { selectedFile = files[0]; selectedFiles = []; fileName.textContent = files[0].name; }
    else { selectedFile = null; selectedFiles = files.map(f => f.path); fileName.textContent = `${files.slice(0, 2).map(f => f.name).join(", ")} +${files.length - 2} more`; }
});

async function selectFileOrFolder() {
    const res = await window.api.selectFolder();
    if (!res.canceled && res.pdfFiles.length > 0) {
        if (res.pdfFiles.length === 1) {
            selectedFile = { path: res.pdfFiles[0].path, name: res.pdfFiles[0].path.split("\\").pop() };
            selectedFiles = [];
            fileName.textContent = selectedFile.name;
        } else {
            selectedFile = null;
            selectedFiles = res.pdfFiles.map(f => f.path);
            fileName.textContent = `${selectedFiles.slice(0, 2).map(f => f.split("\\").pop()).join(", ")} +${selectedFiles.length - 2} more`;
        }
        recommendChunkSettings(res.pdfFiles);
    }
}

editBtn.onclick = () => { editMode.classList.toggle("hidden"); chunkInput.value = chunkValue; overlapInput.value = overlapValue; };
saveBtn.onclick = () => { chunkValue = chunkInput.value; overlapValue = overlapInput.value; editMode.classList.add("hidden"); };

const processingState = document.getElementById("processingState");
const successState = document.getElementById("successState");
const successMsg = document.getElementById("successMsg");
const closeOverlayBtn = document.getElementById("closeOverlayBtn");

document.getElementById("uploadBtn").onclick = async () => {
    if (!selectedFile && selectedFiles.length === 0) return alert("Select files first");
    let name = dbNameInput.value.trim();
    if (!name) name = selectedFile ? selectedFile.name.replace(/\.[^/.]+$/, "") : "folder_collection";
    name = name.replace(/\s+/g, "_").toLowerCase();

    overlay.classList.remove("hidden"); processingState.classList.remove("hidden"); successState.classList.add("hidden");
    progressBar.style.width = "0%"; progressText.textContent = "Processing…";
    let prog = 0;
    const ticker = setInterval(() => { prog = Math.min(prog + Math.random() * 8, 90); progressBar.style.width = prog + "%"; progressText.textContent = Math.floor(prog) + "%"; }, 400);
    try {
        const res = await window.api.uploadPDF(selectedFile ? selectedFile.path : selectedFiles, chunkInput.value, overlapInput.value, name);
        clearInterval(ticker); progressBar.style.width = "100%"; progressText.textContent = "100%";
        if (!res.error) { setTimeout(() => { processingState.classList.add("hidden"); successState.classList.remove("hidden"); successMsg.textContent = `Collection "${name}" created with ${res.files_processed || 1} file(s).`; }, 400); }
        else { alert("Error: " + res.error); overlay.classList.add("hidden"); }
    } catch (e) { clearInterval(ticker); overlay.classList.add("hidden"); alert("Failed to connect to Python."); }
};
closeOverlayBtn.onclick = () => overlay.classList.add("hidden");
cancelBtn.onclick = () => { overlay.classList.add("hidden"); alert("Cancelled (UI only)"); };

function recommendChunkSettings(files) {
    const mb = files.reduce((s, f) => s + f.size, 0) / (1024 * 1024);
    const tc = mb * 50 * files.length;
    let chunk = tc < 200 ? 400 : tc < 1000 ? 600 : tc < 5000 ? 800 : 1000 + Math.log(tc) * 100;
    chunk = Math.round(Math.min(Math.max(chunk + Math.sqrt(tc) * 5, 400), 1500));
    const overlap = Math.round(Math.min(Math.max(Math.floor(chunk * 0.2), 50), 300));
    chunkInput.value = chunk; overlapInput.value = overlap; chunkValue = chunk; overlapValue = overlap;
}

// ════════════════════════════════════════════════════════
//  COLLECTIONS
// ════════════════════════════════════════════════════════
function dbSVG(color = "#3b7bff") {
    const dark = adjustColor(color, -60);
    return `<svg viewBox="0 0 64 68" fill="none" xmlns="http://www.w3.org/2000/svg">
      <ellipse cx="32" cy="12" rx="26" ry="10" fill="${color}" opacity="0.9"/>
      <rect x="6" y="12" width="52" height="30" fill="url(#bg_${color.replace('#', '')})"/>
      <ellipse cx="32" cy="42" rx="26" ry="10" fill="${dark}" opacity="0.95"/>
      <ellipse cx="32" cy="27" rx="26" ry="10" fill="${adjustColor(color, -30)}" opacity="0.3"/>
      <ellipse cx="32" cy="52" rx="22" ry="8" fill="${dark}" opacity="0.6"/>
      <rect x="10" y="52" width="44" height="10" fill="${dark}" opacity="0.4"/>
      <ellipse cx="32" cy="62" rx="22" ry="8" fill="${adjustColor(color, -80)}" opacity="0.8"/>
      <ellipse cx="26" cy="10" rx="10" ry="3.5" fill="white" opacity="0.18"/>
      <defs><linearGradient id="bg_${color.replace('#', '')}" x1="6" y1="12" x2="58" y2="42" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stop-color="${color}" stop-opacity="0.8"/>
        <stop offset="100%" stop-color="${dark}" stop-opacity="0.9"/>
      </linearGradient></defs></svg>`;
}
function adjustColor(hex, amt) {
    const n = parseInt(hex.replace('#', ''), 16);
    const r = Math.min(255, Math.max(0, (n >> 16) + amt));
    const g = Math.min(255, Math.max(0, ((n >> 8) & 0xff) + amt));
    const b = Math.min(255, Math.max(0, (n & 0xff) + amt));
    return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
}
const CARD_COLORS = ["#3b7bff", "#00d68f", "#a855f7", "#f59e0b", "#06b6d4", "#ec4899"];
let colorIndex = 0;

async function loadCollections() {
    const list = document.getElementById("collectionList");
    list.innerHTML = `<div class="empty-state"><div class="spinner" style="margin:0 auto;"></div></div>`;
    const data = await window.api.getCollections();
    list.innerHTML = ""; colorIndex = 0;
    if (!data.length) { list.innerHTML = `<div class="empty-state"><div class="empty-icon">📭</div><p>No collections found.<br>Upload a PDF to get started.</p></div>`; return; }
    data.forEach(col => {
        const color = CARD_COLORS[colorIndex++ % CARD_COLORS.length];
        const card = document.createElement("div");
        card.className = "db-card"; card.dataset.name = col.name;
        card.innerHTML = `
            <input type="checkbox" class="db-card-checkbox col-checkbox" value="${col.name}"
                onclick="event.stopPropagation();updateSelectedCount();toggleCardSelected(this)">
            <div class="db-icon-wrap">${dbSVG(color)}</div>
            <div class="db-card-name">${col.name}</div>
            <div class="db-card-size">${col.size}</div>
            <button class="db-card-delete" onclick="event.stopPropagation();deleteOne('${col.name}')">🗑 Delete</button>`;
        list.appendChild(card);
    });
    updateSelectedCount();
}
function toggleCardSelected(cb) {
    const card = cb.closest(".db-card");
    cb.checked ? card.classList.add("selected") : (card.classList.remove("selected"), document.getElementById("selectAll").checked = false);
}
function updateSelectedCount() {
    const n = document.querySelectorAll(".col-checkbox:checked").length;
    const badge = document.getElementById("selectedCount");
    n > 0 ? (badge.classList.remove("hidden"), badge.textContent = n + " selected") : badge.classList.add("hidden");
}
function toggleSelectAll() {
    const checked = document.getElementById("selectAll").checked;
    document.querySelectorAll(".col-checkbox").forEach(cb => { cb.checked = checked; toggleCardSelected(cb); });
    updateSelectedCount();
}
async function deleteOne(name) { await window.api.deleteCollection(name); loadCollections(); }
async function deleteSelected() {
    const sel = Array.from(document.querySelectorAll(".col-checkbox:checked")).map(cb => cb.value);
    if (!sel.length) return alert("No collections selected");
    await window.api.deleteMultiple(sel); loadCollections();
}

// ════════════════════════════════════════════════════════
//  FASSDB — CHAT HISTORY SIDEBAR
// ════════════════════════════════════════════════════════
async function loadChatHistory() {
    const listEl = document.getElementById("chatHistoryList");
    const chats = await window.api.getChats();

    if (!chats || chats.length === 0) {
        listEl.innerHTML = `<div class="history-empty">No chats yet.<br>Start a new conversation!</div>`;
        return;
    }

    // Pinned chats float to the top; within each group keep original order
    const pinned = chats.filter(c => c.pinned);
    const unpinned = chats.filter(c => !c.pinned);
    const sorted = [...pinned, ...unpinned];

    listEl.innerHTML = "";

    sorted.forEach((chat, idx) => {

        const item = document.createElement("div");
        item.className = "chat-history-item"
            + (chat.id === activeChatId ? " active" : "")
            + (chat.pinned ? " pinned" : "");
        item.dataset.chatId = chat.id;
        item.dataset.pinned = chat.pinned ? "true" : "false";
        item.title = chat.title;

        item.innerHTML = `
            <div class="chat-dot"></div>
            <div class="chat-item-title">${escapeHtml(chat.title)}</div>
            ${chat.pinned ? `<span class="chat-pin-badge" title="Pinned">
                 <img src="https://cdn-icons-png.flaticon.com/512/2672/2672102.png" width="14" height="14"/>
                </span>` : ""}
            <button class="chat-menu-btn" title="Options"
                onclick="event.stopPropagation(); toggleChatMenu('${chat.id}', this)">···</button>`;
        item.onclick = () => openChat(chat.id);
        listEl.appendChild(item);
    });
}

async function openChat(chatId) {
    if (!document.getElementById("chatPage").classList.contains("main-full") ||
        document.getElementById("chatPage").classList.contains("hidden")) {
        showPage("chatPage");
    }

    activeChatId = chatId;
    const chat = await window.api.loadChat(chatId);
    if (!chat) return;

    activeMsgs = chat.messages.map(m => ({ role: m.role, content: m.content }));

    const messagesEl = document.getElementById("chatMessages");
    messagesEl.innerHTML = "";

    if (chat.messages.length === 0) {
        showHero();
    } else {
        hideHero();
        chat.messages.forEach(m => {
            // Re-build the image/file preview HTML from stored attachment data
            let restoredExtras = "";
            if (m.attachments && m.attachments.length > 0) {
                restoredExtras = m.attachments.map(a => {
                    if (a.mimeType && a.mimeType.startsWith("image/") && a.dataUrl) {
                        return `<img src="${a.dataUrl}" style="max-width:220px;max-height:180px;border-radius:8px;margin-top:6px;display:block;" alt="${a.name}">`;
                    }
                    return `<div style="margin-top:5px;font-size:11px;opacity:0.7;">📎 ${a.name}</div>`;
                }).join("");
            }
            _renderMessage(m.role, m.content, m.sources || [], restoredExtras);
        });
        messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    document.querySelectorAll(".chat-history-item").forEach(el => {
        el.classList.toggle("active", el.dataset.chatId === chatId);
    });
}

async function deleteChatItem(chatId) {
    await window.api.deleteChat(chatId);
    if (activeChatId === chatId) {
        activeChatId = null;
        activeMsgs = [];
        document.getElementById("chatMessages").innerHTML = "";
        showHero();
    }
    loadChatHistory();
}

// ════════════════════════════════════════════════════════
//  NEW CHAT — with 100-chat limit handling
// ════════════════════════════════════════════════════════
async function startNewChat() {
    showPage("chatPage");

    const info = await window.api.getChatCount();
    if (info.count >= info.limit) {
        const chats = await window.api.getChats();
        const oldest = chats[chats.length - 1];
        document.getElementById("oldestChatInfo").textContent =
            oldest ? `Oldest chat: "${oldest.title}"` : "";
        document.getElementById("chatLimitModal").classList.remove("hidden");
        pendingNewChat = true;
        return;
    }

    await _createAndOpenNewChat();
}

async function _createAndOpenNewChat() {
    const result = await window.api.createChat("New Chat");
    if (!result.success) return;

    activeChatId = result.chat.id;
    activeMsgs = [];

    document.getElementById("chatMessages").innerHTML = "";
    showHero();

    await loadChatHistory();

    document.querySelectorAll(".chat-history-item").forEach(el => {
        el.classList.toggle("active", el.dataset.chatId === activeChatId);
    });
}

async function confirmDeleteOldest() {
    document.getElementById("chatLimitModal").classList.add("hidden");
    await window.api.deleteOldestChat();
    pendingNewChat = false;
    await _createAndOpenNewChat();
}

function closeLimitModal() {
    document.getElementById("chatLimitModal").classList.add("hidden");
    pendingNewChat = false;
}

// ════════════════════════════════════════════════════════
//  CHAT MESSAGING
// ════════════════════════════════════════════════════════
let isThinking = false;

async function loadDbSelectorOptions() {
    const sel = document.getElementById("dbSelector");
    const warn = document.getElementById("noDbWarn");
    const btn = document.getElementById("chatSendBtn");
    const prev = sel.value;

    while (sel.options.length > 1) sel.remove(1);
    const data = await window.api.getCollections();

    // In advanced mode we don't need collections — suppress the warning
    if (!data.length) {
        if (!advancedModeEnabled) {
            warn.classList.remove("hidden");
            btn.disabled = true;
        }
        return;
    }
    warn.classList.add("hidden");
    btn.disabled = false;
    data.forEach(col => {
        const o = document.createElement("option");
        o.value = col.name;
        o.textContent = `⬡ ${col.name}  (${col.size})`;
        sel.appendChild(o);
    });
    if (prev && [...sel.options].some(o => o.value === prev)) sel.value = prev;
}

// Stores raw plain-text content per message element (for copy + edit)
const _msgRawContent = new WeakMap();

function _renderMessage(role, content, sources = [], extraHtml = "") {
    const messages = document.getElementById("chatMessages");
    const div = document.createElement("div");
    div.className = `msg ${role}`;

    // Store raw text so copy/edit can access it without parsing HTML
    _msgRawContent.set(div, content);

    const srcHtml = sources.length ? `
        <div class="msg-sources">
            <div class="sources-toggle" onclick="this.nextElementSibling.classList.toggle('hidden')">▸ Sources (${sources.length})</div>
            <div class="sources-list">${sources.map(s => `<span class="source-chip">📄 ${s}</span>`).join("")}</div>
        </div>` : "";

    // AI messages: render rich markdown. User messages: plain escaped text.
    const bodyHtml = role === "ai"
        ? renderMarkdown(content)
        : escapeHtml(content);

    // ── Action buttons (shown on hover, outside bubble) ──
    const copyBtn = `<button class="msg-action-btn" onclick="copyMsgContent(this)" title="Copy">
        <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor"><path d="M4 2a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V2zm2-1a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V2a1 1 0 0 0-1-1H6zM2 5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h7v-1H2V6H1z"/></svg>
        </button>`;
    const editBtn2 = role === "user"
        ? `<button class="msg-action-btn" onclick="editMsgContent(this)" title="Edit and resend">
        <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor"><path d="M12.146.146a.5.5 0 0 1 .708 0l3 3a.5.5 0 0 1 0 .708l-10 10a.5.5 0 0 1-.168.11l-5 2a.5.5 0 0 1-.65-.65l2-5a.5.5 0 0 1 .11-.168l10-10zM11.207 2.5 13.5 4.793 14.793 3.5 12.5 1.207 11.207 2.5zm1.586 3L10.5 3.207 4 9.707V10h.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.5h.293l6.5-6.5zm-9.761 5.175-.106.106-1.528 3.821 3.821-1.528.106-.106A.5.5 0 0 1 5 12.5V12h-.5a.5.5 0 0 1-.5-.5V11h-.5a.5.5 0 0 1-.468-.325z"/></svg>
        </button>`
        : "";

    const actionsHtml = `<div class="msg-actions">${copyBtn}${editBtn2}</div>`;

    // actions go OUTSIDE the bubble so they don't inflate its size
    div.innerHTML = `<div class="msg-bubble">${bodyHtml}${extraHtml}${srcHtml}</div>${actionsHtml}`;
    messages.appendChild(div);
    messages.scrollTop = messages.scrollHeight;
}

// ── Copy button handler ───────────────────────────────────
function copyMsgContent(btn) {
    const msgDiv = btn.closest(".msg");
    const text = _msgRawContent.get(msgDiv) || "";
    navigator.clipboard.writeText(text).then(() => {
        btn.classList.add("copied");
        btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor"><path d="M13.854 3.646a.5.5 0 0 1 0 .708l-7 7a.5.5 0 0 1-.708 0l-3.5-3.5a.5.5 0 1 1 .708-.708L6.5 10.293l6.646-6.647a.5.5 0 0 1 .708 0z"/></svg>`;
        setTimeout(() => {
            btn.classList.remove("copied");
            btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor"><path d="M4 2a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V2zm2-1a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V2a1 1 0 0 0-1-1H6zM2 5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h7v-1H2V6H1z"/></svg>`;
        }, 2000);
    });
}

// ── Edit button handler ───────────────────────────────────
function editMsgContent(btn) {
    const msgDiv = btn.closest(".msg");
    const rawText = _msgRawContent.get(msgDiv) || "";

    // Put the original question text back into the active input
    const heroVisible = document.getElementById("chatHero").style.display !== "none";
    const input = heroVisible
        ? document.getElementById("chatInput")
        : document.getElementById("chatInputBar_ta");

    input.value = rawText;
    input.focus();
    // Resize the textarea to fit the restored text
    input.style.height = "auto";
    const h = Math.min(input.scrollHeight, 120);
    input.style.height = h + "px";
}

async function appendMessage(role, content, sources = [], extraHtml = "", attachments = []) {
    _renderMessage(role, content, sources, extraHtml);

    activeMsgs.push({ role, content });
    if (activeMsgs.length > 6) activeMsgs = activeMsgs.slice(-6);

    if (activeChatId) {
        let titleUpdate = undefined;
        if (role === "user" && activeMsgs.filter(m => m.role === "user").length === 1) {
            titleUpdate = content.slice(0, 48) + (content.length > 48 ? "…" : "");
        }
        // Save display-only attachment info (dataUrl for images, name for files)
        // so they can be re-rendered when the chat is reopened.
        const attachData = attachments.map(f => ({
            name: f.name,
            mimeType: f.mimeType,
            dataUrl: f.dataUrl || null   // images only; files have no preview
        })).filter(a => a.name);
        await window.api.saveMessage(activeChatId, role, content, sources, titleUpdate,
            attachData.length > 0 ? attachData : undefined);

        if (titleUpdate) {
            const item = document.querySelector(`.chat-history-item[data-chat-id="${activeChatId}"] .chat-item-title`);
            if (item) item.textContent = titleUpdate;
        }
    }
}

function appendTypingIndicator() {
    const messages = document.getElementById("chatMessages");
    const div = document.createElement("div");
    div.className = "msg ai"; div.id = "typingIndicator";
    div.innerHTML = `<div class="msg-bubble"><div class="typing-dots"><span></span><span></span><span></span></div></div>`;
    messages.appendChild(div); messages.scrollTop = messages.scrollHeight;
}
function removeTypingIndicator() { const t = document.getElementById("typingIndicator"); if (t) t.remove(); }
function escapeHtml(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>"); }

// ════════════════════════════════════════════════════════
//  MARKDOWN RENDERER  — converts AI responses to rich HTML
//  Handles: # headers, **bold**, *italic*, `code`,
//           bullet lists, numbered lists, ---, line breaks
// ════════════════════════════════════════════════════════
function renderMarkdown(rawText) {
    const esc = s => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const inline = s => s
        .replace(/\*\*\*(.+?)\*\*\*/g, "<b><em>$1</em></b>")
        .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
        .replace(/\*(.+?)\*/g, "<em>$1</em>")
        .replace(/`([^`]+)`/g, '<code style="font-family:\'JetBrains Mono\',monospace;font-size:11.5px;background:var(--bg-deep);padding:1px 6px;border-radius:4px;color:var(--text-1)">$1</code>');

    const lines = rawText.split("\n");
    const out = [];
    let inUL = false, inOL = false;

    const closeAll = () => {
        if (inUL) { out.push("</ul>"); inUL = false; }
        if (inOL) { out.push("</ol>"); inOL = false; }
    };

    for (const raw of lines) {
        const t = raw.trimStart();

        // ── Headings ──────────────────────────────
        const hm = t.match(/^(#{1,4}) (.+)/);
        if (hm) {
            closeAll();
            const lvl = hm[1].length;
            const sz = ["1.2em", "1.08em", "0.97em", "0.9em"][lvl - 1];
            const mt = ["14px", "11px", "9px", "7px"][lvl - 1];
            const col = lvl <= 2 ? "var(--text-1)" : "var(--accent)";
            out.push(`<div style="font-size:${sz};font-weight:800;margin:${mt} 0 4px;line-height:1.3;color:${col}">${inline(esc(hm[2]))}</div>`);
            continue;
        }

        // ── Horizontal rule ───────────────────────
        if (/^---+$/.test(t)) {
            closeAll();
            out.push('<hr style="border:none;border-top:1px solid var(--border);margin:10px 0;">');
            continue;
        }

        // ── Unordered list ────────────────────────
        if (/^[-*] /.test(t)) {
            if (inOL) { out.push("</ol>"); inOL = false; }
            if (!inUL) { out.push('<ul style="padding-left:20px;margin:5px 0 7px;list-style:disc;">'); inUL = true; }
            out.push(`<li style="margin:3px 0;">${inline(esc(t.slice(2)))}</li>`);
            continue;
        }

        // ── Ordered list ──────────────────────────
        if (/^\d+\. /.test(t)) {
            if (inUL) { out.push("</ul>"); inUL = false; }
            if (!inOL) { out.push('<ol style="padding-left:20px;margin:5px 0 7px;">'); inOL = true; }
            out.push(`<li style="margin:3px 0;">${inline(esc(t.replace(/^\d+\. /, "").trim()))}</li>`);
            continue;
        }

        // ── Blank line ────────────────────────────
        if (t === "") {
            closeAll();
            out.push('<div style="height:5px;"></div>');
            continue;
        }

        // ── Normal paragraph ──────────────────────
        closeAll();
        out.push(`<div style="margin:1px 0;">${inline(esc(raw))}</div>`);
    }
    closeAll();
    return out.join("");
}

async function sendMessage() {
    if (isThinking) return;
    // Read from whichever input is visible (hero or bottom bar)
    const heroVisible = document.getElementById("chatHero").style.display !== "none";
    const input = heroVisible
        ? document.getElementById("chatInput")
        : document.getElementById("chatInputBar_ta");
    const question = input.value.trim();

    // Must have either text or attachments
    if (!question && _attachedFiles.length === 0) return;

    if (!advancedModeEnabled) {
        const warn = document.getElementById("noDbWarn");
        if (!warn.classList.contains("hidden")) {
            alert("No collections found. Upload PDFs first, or enable Advanced Mode to chat without a DB.");
            return;
        }
    }

    // Auto-create chat session if none active
    if (!activeChatId) {
        const info = await window.api.getChatCount();
        if (info.count >= info.limit) {
            await startNewChat();
            if (pendingNewChat) return;
        } else {
            await _createAndOpenNewChat();
        }
    }

    // Switch from hero to conversation view on first message
    if (heroVisible) hideHero();

    const dbName = document.getElementById("dbSelector").value;
    input.value = "";
    input.style.height = "auto";

    // Snapshot and clear attachments before async work
    const attachSnapshot = [..._attachedFiles];
    _clearAttachments();

    // Build the user bubble (text + image previews if any)
    const userBubbleExtras = attachSnapshot.map(f => {
        if (f.mimeType.startsWith("image/")) {
            return `<img src="${f.dataUrl}" style="max-width:220px;max-height:180px;border-radius:8px;margin-top:6px;display:block;" alt="${f.name}">`;
        }
        return `<div style="margin-top:5px;font-size:11px;opacity:0.7;">📎 ${f.name}</div>`;
    }).join("");

    const displayQuestion = question || "(attached files)";
    await appendMessage("user", displayQuestion, [], userBubbleExtras, attachSnapshot);
    appendTypingIndicator();
    isThinking = true;
    document.getElementById("chatSendBtn2").disabled = true;

    const historyForQuery = activeMsgs.slice(0, -1).map(m => ({
        role: m.role,
        content: m.content.slice(0, 300)
    }));

    // Build attachments payload for backend (base64 + mimeType)
    const attachPayload = attachSnapshot.map(f => ({
        name: f.name,
        mimeType: f.mimeType,
        base64: f.base64
    }));

    // Wrap the question with a light emoji instruction so the LLM
    // naturally adds contextual emojis — no hardcoded map needed.
    // The instruction is invisible to the user (they see displayQuestion).
    const EMOJI_INSTRUCTION =
        "\n\n[Response style: Use a small number of relevant emojis " +
        "naturally within your answer where they add clarity or context. " +
        "Do NOT overuse them — 2 to 5 total is ideal. Never add emojis " +
        "just for decoration.]";
    const queryText = (question || "Please analyze the attached files.") + EMOJI_INSTRUCTION;

    try {
        const res = await window.api.queryDB(
            queryText,
            dbName,
            historyForQuery,
            advancedModeEnabled,
            attachPayload          // ← new param
        );
        removeTypingIndicator();
        if (res.error) {
            await appendMessage("ai", "⚠ Error: " + res.error);
        } else {
            await appendMessage("ai", res.answer, res.sources || []);
        }
    } catch (e) {
        removeTypingIndicator();
        await appendMessage("ai", "⚠ Failed to reach the retrieval backend.");
    }

    isThinking = false;
    document.getElementById("chatSendBtn2").disabled = false;
    document.getElementById("chatInputBar_ta").focus();
}

// Bottom bar send (alias)
async function sendMessageBar() { await sendMessage(); }

function clearCurrentChat() {
    activeMsgs = [];
    document.getElementById("chatMessages").innerHTML = "";
    showHero();
}

// Hero textarea
document.getElementById("chatInput").addEventListener("keydown", e => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
});
document.getElementById("chatInput").addEventListener("input", function () {
    this.style.height = "22px";
    const h = Math.min(this.scrollHeight, 120);
    this.style.height = h + "px";
    this.style.overflowY = h >= 120 ? "auto" : "hidden";
});

// Bottom bar textarea
document.getElementById("chatInputBar_ta").addEventListener("keydown", e => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessageBar(); }
});
document.getElementById("chatInputBar_ta").addEventListener("input", function () {
    this.style.height = "22px";
    const h = Math.min(this.scrollHeight, 120);
    this.style.height = h + "px";
    this.style.overflowY = h >= 120 ? "auto" : "hidden";
});

// ════════════════════════════════════════════════════════
//  UTILITY
// ════════════════════════════════════════════════════════
function formatTimeAgo(timestamp) {
    const diff = Date.now() - timestamp;
    const mins = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    return new Date(timestamp).toLocaleDateString();
}

// ════════════════════════════════════════════════════════
//  API CONFIGURATION TAB
// ════════════════════════════════════════════════════════
const PROVIDERS = {
    openai: {
        name: "OpenAI",
        logo: `<img src="https://cdn-icons-png.flaticon.com/512/11865/11865326.png" alt="OpenAI" width="26" height="26">`,
        color: "#ffffff",
        desc: "GPT-4o, GPT-4-turbo, o1 — industry standard",
        models: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "gpt-3.5-turbo", "o1-mini"],
        keyLabel: "API Key", keyHint: "sk-...",
        docsUrl: "https://platform.openai.com/api-keys", type: "api_key"
    },
    anthropic: {
        name: "Anthropic",
        logo: `<svg width="24" height="20" viewBox="0 0 77 65" fill="none"><path d="M45.32 0h-13.7L0 65h15.83l6.28-15.65H54.9L61.18 65H77L45.32 0zm-17.9 36.33 9.44-23.53 9.43 23.53H27.42z" fill="#1a0f00"/></svg>`,
        color: "#ffffff",
        desc: "Claude 3.5 Sonnet, Haiku — excellent reasoning",
        models: ["claude-sonnet-4-5", "claude-3-5-sonnet-20241022", "claude-3-5-haiku-20241022", "claude-3-opus-20240229"],
        keyLabel: "API Key", keyHint: "sk-ant-...",
        docsUrl: "https://console.anthropic.com/", type: "api_key"
    },
    gemini: {
        name: "Google Gemini",
        logo: `<svg width="26" height="26" viewBox="0 0 28 28" fill="none"><path d="M14 28C14 26.0633 13.6267 24.2433 12.88 22.54C12.1567 20.8367 11.165 19.355 9.905 18.095C8.645 16.835 7.1633 15.8433 5.46 15.12C3.7567 14.3733 1.9367 14 0 14C1.9367 14 3.7567 13.6383 5.46 12.915C7.1633 12.1683 8.645 11.165 9.905 9.905C11.165 8.645 12.1567 7.1633 12.88 5.46C13.6267 3.7567 14 1.9367 14 0C14 1.9367 14.3617 3.7567 15.085 5.46C15.8317 7.1633 16.835 8.645 18.095 9.905C19.355 11.165 20.8367 12.1683 22.54 12.915C24.2433 13.6383 26.0633 14 28 14C26.0633 14 24.2433 14.3733 22.54 15.12C20.8367 15.8433 19.355 16.835 18.095 18.095C16.835 19.355 15.8317 20.8367 15.085 22.54C14.3617 24.2433 14 26.0633 14 28Z" fill="white"/></svg>`,
        color: "linear-gradient(135deg,#1a73e8,#8b45ff)",
        desc: "Gemini 1.5 Pro — long context, multimodal",
        models: ["gemini-1.5-pro", "gemini-1.5-flash", "gemini-2.0-flash"],
        keyLabel: "API Key", keyHint: "AIza...",
        docsUrl: "https://aistudio.google.com/app/apikey", type: "api_key"
    },
    cohere: {
        name: "Cohere",
        logo: `<svg width="26" height="26" viewBox="0 0 100 100" fill="none"><circle cx="50" cy="50" r="50" fill="#39bfa0"/><path d="M68 35.5C63.2 30.7 56.9 28 50 28C36.7 28 26 38.7 26 52C26 65.3 36.7 76 50 76C57.2 76 63.7 73.1 68.5 68.2L61 60.7C58.1 63.5 54.2 65.2 50 65.2C42.6 65.2 36.7 59.3 36.7 52C36.7 44.7 42.6 38.8 50 38.8C53.9 38.8 57.5 40.3 60.3 42.8L68 35.5Z" fill="white"/><circle cx="68.5" cy="34.5" r="7.5" fill="#d4ff44"/></svg>`,
        color: "#39bfa0",
        desc: "Command R+ — built for RAG pipelines",
        models: ["command-r-plus", "command-r", "command-light"],
        keyLabel: "API Key", keyHint: "co-...",
        docsUrl: "https://dashboard.cohere.com/api-keys", type: "api_key"
    },
    mistral: {
        name: "Mistral",
        logo: `<svg width="26" height="26" viewBox="0 0 148 148" fill="none"><rect x="4" y="4" width="36" height="36" fill="#f7d046"/><rect x="56" y="4" width="36" height="36" fill="#f7d046"/><rect x="108" y="4" width="36" height="36" fill="#f7d046"/><rect x="108" y="56" width="36" height="36" fill="#f2a73b"/><rect x="56" y="56" width="36" height="36" fill="#f2a73b"/><rect x="108" y="108" width="36" height="36" fill="#ee792f"/><rect x="56" y="108" width="36" height="36" fill="#ee792f"/><rect x="4" y="108" width="36" height="36" fill="#ee792f"/><rect x="4" y="56" width="36" height="36" fill="#f2a73b"/></svg>`,
        color: "#ff7000",
        desc: "Mistral Large — fast, European, open-weight",
        models: ["mistral-large-latest", "mistral-small-latest", "open-mixtral-8x7b"],
        keyLabel: "API Key", keyHint: "...",
        docsUrl: "https://console.mistral.ai/api-keys/", type: "api_key"
    },
    groq: {
        name: "Groq",
        logo: `<svg width="26" height="26" viewBox="0 0 24 24" fill="none"><path d="M13 2L3 14H11L9 22L21 9H13L13 2Z" fill="white"/></svg>`,
        color: "#f55036",
        desc: "llama3, Mixtral on Groq LPU — ultra-fast inference",
        models: ["llama3-70b-8192", "llama3-8b-8192", "mixtral-8x7b-32768", "gemma2-9b-it"],
        keyLabel: "API Key", keyHint: "gsk_...",
        docsUrl: "https://console.groq.com/keys", type: "api_key"
    },

    // ── NEW: Grok by xAI ──────────────────────────────────
    grok: {
        name: "Grok (xAI)",
        logo: `<svg width="26" height="26" viewBox="0 0 24 24" fill="none"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" fill="white"/></svg>`,
        color: "#000000",
        desc: "Grok-3, Grok-3-mini by xAI — real-time knowledge",
        models: ["grok-3", "grok-3-mini", "grok-2-1212", "grok-beta"],
        keyLabel: "API Key", keyHint: "xai-...",
        docsUrl: "https://console.x.ai/", type: "api_key"
    },

    // ── Cloud-hosted OpenAI-compatible servers ────────────
    custom: {
        name: "Custom / OSS (Cloud)",
        logo: `<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/><circle cx="6" cy="6" r="1.2" fill="white" stroke="none"/><circle cx="10" cy="6" r="1.2" fill="white" stroke="none"/><circle cx="6" cy="18" r="1.2" fill="white" stroke="none"/><circle cx="10" cy="18" r="1.2" fill="white" stroke="none"/><line x1="15" y1="6" x2="19" y2="6"/><line x1="15" y1="18" x2="19" y2="18"/></svg>`,
        color: "linear-gradient(135deg,#6e40c9,#9b59f5)",
        desc: "Any cloud-hosted OpenAI-compatible endpoint (vLLM, LM Studio, etc.)",
        models: [], keyLabel: "API Key (optional)", keyHint: "Leave empty if no auth required",
        docsUrl: "", type: "custom"
    },

    // ── NEW: Truly local models ───────────────────────────
    local: {
        name: "Local Model",
        logo: `<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>`,
        color: "linear-gradient(135deg,#1a7a4a,#00d68f)",
        desc: "Run models locally — Ollama, GGUF files, or HuggingFace paths. No internet needed.",
        models: [], keyLabel: "", keyHint: "",
        docsUrl: "", type: "local"
    }
};

let selectedProvider = null;
let selectedModel = null;
let currentConfig = null;
let allProviderConfigs = {};   // ← persisted per-provider configs (req #3)

async function loadApiPage() {
    currentConfig = await window.api.getApiConfig();
    allProviderConfigs = (await window.api.getAllProviderConfigs()) || {};
    renderActiveConfigBar(currentConfig);
    // Mark every card that has a saved config with the green dot
    document.querySelectorAll(".provider-card").forEach(c => {
        const key = c.dataset.provider;
        if (allProviderConfigs[key]) c.classList.add("saved-active");
        else c.classList.remove("saved-active");
    });
    if (currentConfig && currentConfig.provider) markProviderCardSaved(currentConfig.provider);
}

async function updateApiDot() {
    const cfg = await window.api.getApiConfig();
    const dot = document.getElementById("apiSavedDot");
    if (!dot) return;
    cfg && cfg.provider ? dot.classList.add("visible") : dot.classList.remove("visible");
}

function renderActiveConfigBar(cfg) {
    const bar = document.getElementById("activeConfigBar");
    const text = document.getElementById("activeConfigText");
    const btn = document.getElementById("clearConfigBtn");
    const dot = document.getElementById("apiSavedDot");

    if (cfg && cfg.provider) {
        const p = PROVIDERS[cfg.provider] || { name: cfg.provider };
        let label;
        if (cfg.provider === "custom") {
            label = `Custom — <strong>${cfg.custom_model || "no model"}</strong> @ <strong>${cfg.custom_url || "no URL"}</strong>`;
        } else if (cfg.provider === "local") {
            const localType = cfg.local_type || "ollama";
            const detail = localType === "ollama"
                ? `Ollama · <strong>${cfg.ollama_model || "?"}</strong>`
                : `${localType === "llama_cpp" ? "GGUF" : "HF"} · <strong>${(cfg.local_path || "").split(/[\\\/]/).pop() || "?"}</strong>`;
            label = `Local — ${detail}`;
        } else {
            label = `<strong>${p.name}</strong> · <strong>${cfg.model || "(default model)"}</strong>`;
        }
        bar.classList.add("has-config");
        text.innerHTML = `◉ Active LLM: ${label}`;
        btn.classList.remove("hidden");
        dot.classList.add("visible");
    } else {
        bar.classList.remove("has-config");
        text.innerHTML = "No LLM configured — using extractive (keyword) mode";
        btn.classList.add("hidden");
        dot.classList.remove("visible");
    }
}

function markProviderCardSaved(provider) {
    document.querySelectorAll(".provider-card").forEach(c => c.classList.remove("saved-active"));
    const card = document.querySelector(`.provider-card[data-provider="${provider}"]`);
    if (card) card.classList.add("saved-active");
}

function selectProvider(providerKey) {
    selectedProvider = providerKey; selectedModel = null;
    document.querySelectorAll(".provider-card").forEach(c => c.classList.remove("selected"));
    document.querySelector(`.provider-card[data-provider="${providerKey}"]`).classList.add("selected");
    renderConfigPanel(providerKey);
}

function renderConfigPanel(providerKey) {
    const panel = document.getElementById("apiConfigPanel");
    const p = PROVIDERS[providerKey];
    // Use the per-provider saved config if available, else fall back to active config
    const saved = allProviderConfigs[providerKey]
        || (currentConfig && currentConfig.provider === providerKey ? currentConfig : null);

    if (providerKey === "custom") panel.innerHTML = buildCustomPanel(p, saved);
    else if (providerKey === "local") panel.innerHTML = buildLocalPanel(p, saved);
    else panel.innerHTML = buildApiKeyPanel(providerKey, p, saved);
}

function buildApiKeyPanel(providerKey, p, saved) {
    const modelChips = p.models.map(m => {
        const isActive = saved && saved.model === m ? " active" : "";
        return `<span class="model-chip${isActive}" onclick="selectModel('${m}', this)">${m}</span>`;
    }).join("");
    return `
    <div class="api-config-panel">
        <div class="api-config-header">
            <div class="api-config-logo" style="background:${p.color}">${p.logo}</div>
            <div><div class="api-config-title">${p.name}</div><div class="api-config-sub">${p.desc}</div></div>
        </div>
        <div style="margin-bottom:18px;">
            <label class="form-label">${p.keyLabel}</label>
            <div class="api-key-wrap">
                <input type="password" id="apiKeyInput" class="form-input" placeholder="${p.keyHint}"
                    value="${saved && saved.api_key ? saved.api_key : ""}">
                <button class="api-key-toggle" onclick="toggleKeyVisibility()" title="Show/hide key">👁</button>
            </div>
            ${p.docsUrl ? `<div style="margin-top:6px; font-size:11px; color:var(--text-3);">Get your key → <a href="${p.docsUrl}" target="_blank" rel="noopener noreferrer" style="color:var(--accent); text-decoration:none;">Open API Keys</a></div>` : ""}
        </div>
        <div>
            <label class="form-label">Model</label>
            <div class="model-chips">${modelChips}</div>
            <div style="margin-top:10px;">
                <input type="text" id="customModelInput" class="form-input" placeholder="Or type a custom model name…"
                    value="${saved && saved.model && !p.models.includes(saved.model) ? saved.model : ""}">
            </div>
        </div>
        <div class="api-save-row">
            <button class="btn btn-green" onclick="saveApiConfig('${providerKey}')">Save Configuration</button>
            <button class="btn-cancel-api" onclick="cancelApiConfig()">Cancel</button>
            <div class="api-status-badge" id="apiStatusBadge"></div>
        </div>
    </div>`;
}

function buildCustomPanel(p, saved) {
    return `
    <div class="api-config-panel">
        <div class="api-config-header">
            <div class="api-config-logo" style="background:${p.color}">${p.logo}</div>
            <div><div class="api-config-title">${p.name}</div><div class="api-config-sub">${p.desc}</div></div>
        </div>
        <div style="margin-bottom:18px;">
            <label class="form-label">Cloud / Server URL</label>
            <input type="text" id="customUrlInput" class="form-input"
                placeholder="e.g. http://182.178.22.305:1400"
                value="${saved && saved.custom_url ? saved.custom_url : ""}">
            <div style="margin-top:6px; font-size:11px; color:var(--text-3);">Base URL of your vLLM / LM Studio / cloud server (must have /v1/chat/completions)</div>
        </div>
        <div style="margin-bottom:18px;">
            <label class="form-label">Model Name</label>
            <input type="text" id="customModelNameInput" class="form-input"
                placeholder="e.g. openllm/Qwen3-VL-32B-Instruct-AWQ"
                value="${saved && saved.custom_model ? saved.custom_model : ""}">
        </div>
        <div style="margin-bottom:18px;">
            <label class="form-label">API Key (optional)</label>
            <div class="api-key-wrap">
                <input type="password" id="apiKeyInput" class="form-input"
                    placeholder="Leave empty if no auth required"
                    value="${saved && saved.api_key ? saved.api_key : ""}">
                <button class="api-key-toggle" onclick="toggleKeyVisibility()" title="Show/hide">👁</button>
            </div>
        </div>
        <div class="hint-box">
            <strong>How it works:</strong> Your server must expose <code>/v1/chat/completions</code>.<br><br>
            <strong>Example:</strong> URL: <code>http://182.178.22.305:1400</code> · Model: <code>openllm/Qwen3-VL-32B-Instruct-AWQ</code>
        </div>
        <div class="api-save-row">
            <button class="btn btn-green" onclick="saveApiConfig('custom')">Save Configuration</button>
            <button class="btn-cancel-api" onclick="cancelApiConfig()">Cancel</button>
            <div class="api-status-badge" id="apiStatusBadge"></div>
        </div>
    </div>`;
}

// ── NEW: Local Model Panel ────────────────────────────────────────────────────
function buildLocalPanel(p, saved) {
    const localType = (saved && saved.local_type) || "ollama";
    return `
    <div class="api-config-panel">
        <div class="api-config-header">
            <div class="api-config-logo" style="background:${p.color}">${p.logo}</div>
            <div><div class="api-config-title">${p.name}</div><div class="api-config-sub">${p.desc}</div></div>
        </div>
        <div style="margin-bottom:18px;">
            <label class="form-label">Backend Type</label>
            <div class="local-type-row">
                <label class="local-type-pill ${localType === 'ollama' ? 'active' : ''}">
                    <input type="radio" name="localType" value="ollama"
                        ${localType === 'ollama' ? 'checked' : ''}
                        onchange="switchLocalType('ollama')">
                    🦙 Ollama
                </label>
                <label class="local-type-pill ${localType === 'llama_cpp' ? 'active' : ''}">
                    <input type="radio" name="localType" value="llama_cpp"
                        ${localType === 'llama_cpp' ? 'checked' : ''}
                        onchange="switchLocalType('llama_cpp')">
                    📦 GGUF File
                </label>
                <label class="local-type-pill ${localType === 'transformers' ? 'active' : ''}">
                    <input type="radio" name="localType" value="transformers"
                        ${localType === 'transformers' ? 'checked' : ''}
                        onchange="switchLocalType('transformers')">
                    🤗 HF Model Dir
                </label>
            </div>
        </div>
        <div id="localTypePanel">
            ${buildLocalTypeSection(localType, saved)}
        </div>
        <div class="api-save-row">
            <button class="btn btn-green" onclick="saveApiConfig('local')">Save Configuration</button>
            <button class="btn-cancel-api" onclick="cancelApiConfig()">Cancel</button>
            <div class="api-status-badge" id="apiStatusBadge"></div>
        </div>
    </div>`;
}

function buildLocalTypeSection(localType, saved) {
    if (localType === "ollama") {
        return `
        <div style="margin-bottom:16px;">
            <label class="form-label">Ollama Server URL</label>
            <input type="text" id="ollamaUrlInput" class="form-input"
                placeholder="http://localhost:11434"
                value="${saved && saved.ollama_url ? saved.ollama_url : 'http://localhost:11434'}">
            <div style="margin-top:6px; font-size:11px; color:var(--text-3);">Ollama must be running. Default: http://localhost:11434</div>
        </div>
        <div style="margin-bottom:16px;">
            <label class="form-label">Model Name</label>
            <input type="text" id="ollamaModelInput" class="form-input"
                placeholder="e.g. deepseek-r1:8b, llama3.2, mistral, phi4"
                value="${saved && saved.ollama_model ? saved.ollama_model : ''}">
            <div style="margin-top:6px; font-size:11px; color:var(--text-3);">Run <code style="background:var(--bg-deep);padding:1px 5px;border-radius:3px;">ollama list</code> to see downloaded models</div>
        </div>
        <div class="hint-box">
            <strong>Install Ollama:</strong> <a href="https://ollama.com" target="_blank" style="color:var(--accent);">ollama.com</a><br>
            <strong>Pull a model:</strong> <code>ollama pull deepseek-r1:8b</code><br>
            Supports DeepSeek, LLaMA3, Mistral, Phi, Gemma, Qwen and more.
        </div>`;
    }

    if (localType === "llama_cpp") {
        return `
        <div style="margin-bottom:16px;">
            <label class="form-label">GGUF Model File Path</label>
            <div style="display:flex; gap:8px; align-items:center;">
                <input type="text" id="localPathInput" class="form-input" style="flex:1;"
                    placeholder="C:\\Models\\deepseek-r1-8b-q4_k_m.gguf"
                    value="${saved && saved.local_path ? saved.local_path : ''}">
                <button class="btn btn-ghost" style="padding:8px 14px; font-size:12px; white-space:nowrap; flex-shrink:0;"
                    onclick="browseModelFile()">📂 Browse</button>
            </div>
            <div style="margin-top:6px; font-size:11px; color:var(--text-3);">Requires: <code style="background:var(--bg-deep);padding:1px 5px;border-radius:3px;">pip install llama-cpp-python</code></div>
        </div>
        <div class="hint-box">
            <strong>Get GGUF models:</strong> <a href="https://huggingface.co/TheBloke" target="_blank" style="color:var(--accent);">TheBloke on HuggingFace</a> or search "GGUF" on HF.<br>
            <strong>Recommended:</strong> Q4_K_M quantization balances quality and speed.<br>
            <strong>GPU support:</strong> Install with <code>CMAKE_ARGS="-DGGML_CUDA=on" pip install llama-cpp-python</code>
        </div>`;
    }

    if (localType === "transformers") {
        return `
        <div style="margin-bottom:16px;">
            <label class="form-label">HuggingFace Model Directory</label>
            <div style="display:flex; gap:8px; align-items:center;">
                <input type="text" id="localPathInput" class="form-input" style="flex:1;"
                    placeholder="C:\\Models\\deepseek-r1-8b"
                    value="${saved && saved.local_path ? saved.local_path : ''}">
                <button class="btn btn-ghost" style="padding:8px 14px; font-size:12px; white-space:nowrap; flex-shrink:0;"
                    onclick="browseModelDir()">📂 Browse</button>
            </div>
            <div style="margin-top:6px; font-size:11px; color:var(--text-3);">Folder must contain config.json + model weights. Requires: <code style="background:var(--bg-deep);padding:1px 5px;border-radius:3px;">pip install transformers torch</code></div>
        </div>
        <div class="hint-box">
            <strong>Download model:</strong><br>
            <code>huggingface-cli download deepseek-ai/DeepSeek-R1-Distill-Llama-8B --local-dir C:\\Models\\deepseek-r1-8b</code><br><br>
            Large models require significant RAM/VRAM. Use quantized (GGUF) versions for better performance.
        </div>`;
    }
    return "";
}

function switchLocalType(type) {
    const saved = currentConfig && currentConfig.provider === "local" ? currentConfig : null;
    document.getElementById("localTypePanel").innerHTML = buildLocalTypeSection(type, saved);
    document.querySelectorAll(".local-type-pill").forEach(el => {
        const radio = el.querySelector("input[type='radio']");
        el.classList.toggle("active", radio && radio.value === type);
    });
}

async function browseModelFile() {
    const filePath = await window.api.selectModelFile();
    if (filePath) {
        const input = document.getElementById("localPathInput");
        if (input) input.value = filePath;
    }
}

async function browseModelDir() {
    const dirPath = await window.api.selectModelDir();
    if (dirPath) {
        const input = document.getElementById("localPathInput");
        if (input) input.value = dirPath;
    }
}

function selectModel(modelName, el) {
    selectedModel = modelName;
    document.querySelectorAll(".model-chip").forEach(c => c.classList.remove("active"));
    el.classList.add("active");
    const ci = document.getElementById("customModelInput");
    if (ci) ci.value = "";
}

function toggleKeyVisibility() {
    const input = document.getElementById("apiKeyInput");
    if (!input) return;
    input.type = input.type === "password" ? "text" : "password";
}

async function saveApiConfig(providerKey) {
    const badge = document.getElementById("apiStatusBadge");
    badge.className = "api-status-badge";
    let config = { provider: providerKey };

    // ── Custom (cloud-hosted) ─────────────────────────────────────────────────
    if (providerKey === "custom") {
        const url = document.getElementById("customUrlInput").value.trim();
        const model = document.getElementById("customModelNameInput").value.trim();
        const key = document.getElementById("apiKeyInput").value.trim();
        if (!url) return showBadge(badge, "error", "⚠ Cloud URL is required");
        if (!model) return showBadge(badge, "error", "⚠ Model name is required");
        config.custom_url = url; config.custom_model = model;
        config.api_key = key; config.model = model;

        // ── Local model ───────────────────────────────────────────────────────────
    } else if (providerKey === "local") {
        const localType = document.querySelector('input[name="localType"]:checked')?.value || "ollama";
        config.local_type = localType;

        if (localType === "ollama") {
            const url = (document.getElementById("ollamaUrlInput")?.value || "").trim() || "http://localhost:11434";
            const mdl = (document.getElementById("ollamaModelInput")?.value || "").trim();
            if (!mdl) return showBadge(badge, "error", "⚠ Model name is required");
            config.ollama_url = url;
            config.ollama_model = mdl;
            config.model = mdl;
        } else {
            const localPath = (document.getElementById("localPathInput")?.value || "").trim();
            if (!localPath) return showBadge(badge, "error", "⚠ Model path is required");
            config.local_path = localPath;
            config.model = localPath.split(/[\\\/]/).pop() || localPath;
        }

        // ── Standard API key providers ────────────────────────────────────────────
    } else {
        const key = document.getElementById("apiKeyInput").value.trim();
        if (!key) return showBadge(badge, "error", "⚠ API key is required");
        const customInput = document.getElementById("customModelInput");
        const model = selectedModel || (customInput && customInput.value.trim()) || PROVIDERS[providerKey].models[0] || "";
        config.api_key = key; config.model = model;
    }

    try {
        // Save as ACTIVE config (used by Python retrieval backend)
        await window.api.saveApiConfig(config);
        // Save per-provider (so switching providers never loses keys)
        await window.api.saveProviderConfig(providerKey, config);

        currentConfig = config;
        allProviderConfigs[providerKey] = config;

        showBadge(badge, "success", "✓ Saved — API active!");
        renderActiveConfigBar(config);
        markProviderCardSaved(providerKey);

        // Update ALL provider card dots
        document.querySelectorAll(".provider-card").forEach(c => {
            const key = c.dataset.provider;
            if (allProviderConfigs[key]) c.classList.add("saved-active");
        });

        // Close the config panel after a short delay so user sees ✓ feedback
        setTimeout(() => cancelApiConfig(), 1400);
    } catch (e) {
        showBadge(badge, "error", "⚠ Save failed");
    }
}

// ── Cancel / close the config panel without saving ───────────────────────────
function cancelApiConfig() {
    document.getElementById("apiConfigPanel").innerHTML = "";
    document.querySelectorAll(".provider-card").forEach(c => c.classList.remove("selected"));
    selectedProvider = null;
    selectedModel = null;
}

function showBadge(badge, type, text) {
    badge.className = "api-status-badge " + type;
    badge.textContent = text;
    if (type === "success") setTimeout(() => { badge.className = "api-status-badge"; }, 3000);
}

async function clearApiConfig() {
    if (currentConfig && currentConfig.provider) {
        // Remove from per-provider store so key is gone from JSON
        await window.api.saveProviderConfig(currentConfig.provider, null);
        delete allProviderConfigs[currentConfig.provider];
        // Refresh the saved-active dot on that card
        const card = document.querySelector(`.provider-card[data-provider="${currentConfig.provider}"]`);
        if (card) card.classList.remove("saved-active");
    }
    await window.api.saveApiConfig(null);
    currentConfig = null; selectedProvider = null;
    document.querySelectorAll(".provider-card").forEach(c => { c.classList.remove("selected", "saved-active"); });
    document.getElementById("apiConfigPanel").innerHTML = "";
    renderActiveConfigBar(null);
}

// ── Three-dot context menu for chat history ───────────────────────────────────
let _activeMenuDropdown = null;
let _activeMenuChatId = null;

function closeChatMenu() {
    if (_activeMenuDropdown) {
        _activeMenuDropdown.remove();
        _activeMenuDropdown = null;
        _activeMenuChatId = null;
        document.querySelectorAll(".chat-history-item").forEach(el => el.classList.remove("menu-open"));
    }
}

function toggleChatMenu(chatId, btn) {
    if (_activeMenuChatId === chatId) { closeChatMenu(); return; }
    closeChatMenu();
    _activeMenuChatId = chatId;
    const chatItem = btn.closest(".chat-history-item");
    chatItem.classList.add("menu-open");
    const isPinned = chatItem.dataset.pinned === "true";

    const rect = btn.getBoundingClientRect();
    const drop = document.createElement("div");
    drop.className = "chat-menu-dropdown";
    drop.innerHTML = `
        <button class="chat-menu-item" onclick="renameChatItem('${chatId}'); closeChatMenu();">
            <span class="menu-icon">
            <img src="https://cdn-icons-png.flaticon.com/512/1159/1159633.png" width="14" height="14">
            </span> Rename
        </button>
        <button class="chat-menu-item" onclick="${isPinned ? `unpinChatItem` : `pinChatItem`}('${chatId}'); closeChatMenu();">
            <span class="menu-icon">${isPinned
            ? `<img src="https://cdn-icons-png.flaticon.com/512/10940/10940990.png" width="14" height="14">`
            : `<img src="https://cdn-icons-png.flaticon.com/512/2672/2672101.png" width="14" height="14">`
        }</span> ${isPinned ? "Unpin chat" : "Pin chat"}
        </button>
        <div class="chat-menu-divider"></div>
        <button class="chat-menu-item danger" onclick="deleteChatItem('${chatId}'); closeChatMenu();">
            <span class="menu-icon">
            <img src="https://cdn-icons-png.flaticon.com/512/1214/1214428.png" width="14" height="14">
            </span> Delete
        </button>`;

    const left = Math.min(rect.right - 152, window.innerWidth - 160);
    drop.style.left = left + "px";
    drop.style.top = (rect.bottom + 4) + "px";
    document.body.appendChild(drop);
    _activeMenuDropdown = drop;
}

document.addEventListener("click", e => {
    if (_activeMenuDropdown && !_activeMenuDropdown.contains(e.target)) closeChatMenu();
}, true);

async function renameChatItem(chatId) {
    const titleEl = document.querySelector(`.chat-history-item[data-chat-id="${chatId}"] .chat-item-title`);
    if (!titleEl) return;
    const currentTitle = titleEl.textContent;
    const input = document.createElement("input");
    input.className = "chat-rename-input";
    input.value = currentTitle;
    input.maxLength = 80;
    input.onclick = e => e.stopPropagation();
    titleEl.replaceWith(input);
    input.focus(); input.select();
    const commit = async () => {
        const newTitle = input.value.trim() || currentTitle;
        await window.api.updateChatTitle(chatId, newTitle);
        const newEl = document.createElement("div");
        newEl.className = "chat-item-title";
        newEl.textContent = newTitle;
        input.replaceWith(newEl);
        // (topbar title removed — sidebar item already updated above)
    };
    input.addEventListener("blur", commit);
    input.addEventListener("keydown", e => {
        if (e.key === "Enter") { e.preventDefault(); input.blur(); }
        if (e.key === "Escape") { input.value = currentTitle; input.blur(); }
    });
}

async function pinChatItem(chatId) {
    await window.api.pinChat(chatId);
    await loadChatHistory();
}

async function unpinChatItem(chatId) {
    await window.api.unpinChat(chatId);
    await loadChatHistory();
}

// ════════════════════════════════════════════════════════
//  VISIBILITY GUARD — keep typing indicator alive when
//  OS-level tab / window switching hides the document
// ════════════════════════════════════════════════════════
document.addEventListener("visibilitychange", () => {
    if (document.hidden || !isThinking) return;
    const existing = document.getElementById("typingIndicator");
    if (!existing) {
        // Indicator was nuked by the browser while hidden — re-add it
        appendTypingIndicator();
    } else {
        // Force-restart the CSS animation (some browsers pause it)
        existing.querySelectorAll(".typing-dots span").forEach(dot => {
            dot.style.animation = "none";
            // eslint-disable-next-line no-unused-expressions
            dot.offsetHeight; // trigger reflow
            dot.style.animation = "";
        });
    }
});

// ════════════════════════════════════════════════════════
//  BOOT
// ════════════════════════════════════════════════════════
(async function boot() {
    showPage("chatPage");
    await loadChatHistory();
    await updateApiDot();
})();