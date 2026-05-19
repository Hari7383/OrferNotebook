const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {

    // ── PDF processing ──────────────────────────────────
    uploadPDF: (filePath, chunkSize, overlap, dbName) =>
        ipcRenderer.invoke("process-pdf", { filePath, chunkSize, overlap, dbName }),

    // ── Retrieval + LLM answer ───────────────────────────
    // dbName      = "__all__" → all collections  |  specific name → one collection
    // history     = [{role, content}] for context-aware chat
    // freeMode    = true → skip RAG, call LLM directly
    // attachments = [{ name, mimeType, base64 }] — images/files to send to LLM
    queryDB: (question, dbName, history = [], freeMode = false, attachments = []) =>
        ipcRenderer.invoke("query-db", { question, dbName, history, freeMode, attachments }),

    // ── File / folder pickers ────────────────────────────
    selectFolder: () => ipcRenderer.invoke("select-folder"),
    selectFiles: () => ipcRenderer.invoke("select-files"),

    // ── Local model file/dir pickers ─────────────────────
    selectModelFile: () => ipcRenderer.invoke("select-model-file"),
    selectModelDir: () => ipcRenderer.invoke("select-model-dir"),

    // ── Collection management ────────────────────────────
    getCollections: () => ipcRenderer.invoke("get-collections"),
    deleteCollection: (name) => ipcRenderer.invoke("delete-collection", name),
    deleteMultiple: (names) => ipcRenderer.invoke("delete-multiple", names),

    // ── API key configuration ────────────────────────────
    saveApiConfig: (config) => ipcRenderer.invoke("save-api-config", config),
    getApiConfig: () => ipcRenderer.invoke("get-api-config"),

    // ── FassDB — Chat History ────────────────────────────
    createChat: (title) => ipcRenderer.invoke("create-chat", { title }),
    getChats: () => ipcRenderer.invoke("get-chats"),
    loadChat: (chatId) => ipcRenderer.invoke("load-chat", chatId),
    saveMessage: (chatId, role, content, sources, title, attachments) =>
        ipcRenderer.invoke("save-message", { chatId, role, content, sources, title, attachments }),
    updateChatTitle: (chatId, title) =>
        ipcRenderer.invoke("update-chat-title", { chatId, title }),
    deleteChat: (chatId) => ipcRenderer.invoke("delete-chat", chatId),
    deleteOldestChat: () => ipcRenderer.invoke("delete-oldest-chat"),
    getChatCount: () => ipcRenderer.invoke("get-chat-count"),
    pinChat: (chatId) => ipcRenderer.invoke("pin-chat", chatId),
    unpinChat: (chatId) => ipcRenderer.invoke("unpin-chat", chatId),

    // ── Window controls ──────────────────────────────────
    winMinimize: () => ipcRenderer.send("win-minimize"),
    winMaximize: () => ipcRenderer.send("win-maximize"),
    winClose: () => ipcRenderer.send("win-close"),

    // ── Per-provider API config store ─────────────────────
    saveProviderConfig: (provider, config) =>
        ipcRenderer.invoke("save-provider-config", { provider, config }),
    getAllProviderConfigs: () => ipcRenderer.invoke("get-all-provider-configs"),
});