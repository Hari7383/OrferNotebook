const { app, BrowserWindow, ipcMain, dialog, globalShortcut } = require("electron");
const path = require("path");
const { spawn } = require("child_process");
const fs = require("fs");
const crypto = require("crypto");
const http = require("http");

const PYTHON_PATH = "E:/VS_Programs/NoteBookLM/.NBLM/Scripts/python.exe";
const DB_DIR = path.join(__dirname, "../storage/users/user_1");
const CONFIG_PATH = path.join(__dirname, "../storage/api_config.json");
const ALL_CONFIGS_PATH = path.join(__dirname, "../storage/api_all_configs.json");
const CHAT_DB_PATH = path.join(__dirname, "../storage/chats.json");

const MAX_CHATS = 100;
const SERVER_PORT = 5731;
const SERVER_URL = `http://127.0.0.1:${SERVER_PORT}`;

// ---------------------------
// Persistent Python Server
// ---------------------------
let _serverProcess = null;
let _serverReady = false;

function startPythonServer() {
    const serverScript = path.join(__dirname, "../python/server.py");
    _serverProcess = spawn(
        PYTHON_PATH,
        [serverScript, String(SERVER_PORT), CONFIG_PATH],
        { cwd: path.join(__dirname, "..") }
    );
    _serverProcess.stdout.on("data", d => {
        const msg = d.toString().trim();
        if (msg.includes("READY")) _serverReady = true;
        console.log("[RAG-Server]", msg);
    });
    _serverProcess.stderr.on("data", d => console.error("[RAG-Server]", d.toString().trim()));
    _serverProcess.on("close", code => {
        console.log("[RAG-Server] exited with code", code);
        _serverReady = false;
    });
}

function waitForServer(maxWaitMs = 60000) {
    return new Promise((resolve) => {
        const start = Date.now();
        const poll = () => {
            httpGet(`${SERVER_URL}/health`)
                .then(() => { _serverReady = true; resolve(true); })
                .catch(() => {
                    if (Date.now() - start < maxWaitMs) setTimeout(poll, 600);
                    else resolve(false);
                });
        };
        setTimeout(poll, 2000);
    });
}

app.on("before-quit", () => {
    if (_serverProcess) { _serverProcess.kill(); _serverProcess = null; }
});

// ---------------------------
// HTTP helpers
// ---------------------------
function httpGet(url) {
    return new Promise((resolve, reject) => {
        http.get(url, res => {
            let data = "";
            res.on("data", c => data += c);
            res.on("end", () => {
                try { resolve(JSON.parse(data)); }
                catch (e) { reject(e); }
            });
        }).on("error", reject);
    });
}

function httpPost(url, body) {
    return new Promise((resolve, reject) => {
        const payload = JSON.stringify(body);
        const opts = {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(payload, "utf8")
            }
        };
        const parsed = new URL(url);
        opts.hostname = parsed.hostname;
        opts.port = parsed.port;
        opts.path = parsed.pathname;

        const req = http.request(opts, res => {
            const chunks = [];
            res.on("data", c => chunks.push(c));
            res.on("end", () => {
                const data = Buffer.concat(chunks).toString("utf8");
                try { resolve(JSON.parse(data)); }
                catch (e) { reject(new Error("Bad JSON from server: " + data.slice(0, 200))); }
            });
        });
        req.setTimeout(180000, () => {
            req.destroy();
            reject(new Error("httpPost timeout — payload may be too large"));
        });
        req.on("error", reject);
        req.write(payload, "utf8");
        req.end();
    });
}

// ---------------------------
// Window
// ---------------------------
let mainWindow = null;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1100,
        height: 800,

        // ── CHANGES ──────────────────────────────────────────────────────────
        // frame: false  →  removes the entire native Windows chrome:
        //   - no "RAG Dashboard" title text
        //   - no File / Edit / View / Window / Help menu bar
        //   - no gray border
        // OS-level shortcuts (Win+R, Ctrl+Z, Ctrl+C, Alt+F4, Win+D …) still
        // work because they are handled by Windows, not Electron's menu.
        frame: false,
        backgroundColor: "#0d0d0f",   // match your app's dark bg (avoids white flash)
        // ─────────────────────────────────────────────────────────────────────

        webPreferences: {
            preload: path.join(__dirname, "preload.js"),
            contextIsolation: true
        }
    });

    // Belt-and-suspenders: nuke the app menu too
    mainWindow.setMenu(null);

    mainWindow.loadFile(path.join(__dirname, "../frontend/index.html"));
}

app.whenReady().then(() => {
    startPythonServer();
    createWindow();
    waitForServer().then(ready => {
        console.log(ready ? "[main] RAG server ready ✓" : "[main] Server timeout — falling back to spawn");
    });

    // ── Dev / window shortcuts lost when frame:false + menu:null ──────────
    // Ctrl+R  →  reload
    globalShortcut.register("CommandOrControl+R", () => {
        if (mainWindow) mainWindow.webContents.reload();
    });
    // Ctrl+Shift+R  →  force reload (bypasses cache)
    globalShortcut.register("CommandOrControl+Shift+R", () => {
        if (mainWindow) mainWindow.webContents.reloadIgnoringCache();
    });
    // F5  →  reload
    globalShortcut.register("F5", () => {
        if (mainWindow) mainWindow.webContents.reload();
    });
    // F12  →  toggle DevTools
    globalShortcut.register("F12", () => {
        if (mainWindow) mainWindow.webContents.toggleDevTools();
    });
    // Ctrl+Shift+I  →  toggle DevTools (alternative)
    globalShortcut.register("CommandOrControl+Shift+I", () => {
        if (mainWindow) mainWindow.webContents.toggleDevTools();
    });
    // ─────────────────────────────────────────────────────────────────────
});

// Unregister all shortcuts on quit (required by Electron best practice)
app.on("will-quit", () => {
    globalShortcut.unregisterAll();
});

// ---------------------------
// Window-control IPC
// Called by the three custom titlebar buttons in your frontend HTML.
// ---------------------------
ipcMain.on("win-minimize", () => {
    if (mainWindow) mainWindow.minimize();
});

ipcMain.on("win-maximize", () => {
    if (!mainWindow) return;
    mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
});

ipcMain.on("win-close", () => {
    if (mainWindow) mainWindow.close();
});

// Lets the renderer toggle the maximize icon correctly
ipcMain.handle("win-is-maximized", () => {
    return mainWindow ? mainWindow.isMaximized() : false;
});

// ---------------------------
// Helpers
// ---------------------------
function getPDFFiles(folderPath) {
    return fs.readdirSync(folderPath)
        .filter(f => f.toLowerCase().endsWith(".pdf"))
        .map(f => {
            const full = path.join(folderPath, f);
            return { path: full, size: fs.statSync(full).size };
        });
}

function getFolderSize(folderPath) {
    let total = 0;
    fs.readdirSync(folderPath).forEach(file => {
        const full = path.join(folderPath, file);
        const stat = fs.statSync(full);
        total += stat.isDirectory() ? getFolderSize(full) : stat.size;
    });
    return total;
}

function spawnPython(scriptPath, args) {
    return new Promise((resolve, reject) => {
        const py = spawn(PYTHON_PATH, [scriptPath, ...args], {
            cwd: path.join(__dirname, "..")
        });
        let result = "";
        py.stdout.on("data", d => result += d.toString());
        py.stderr.on("data", e => console.error("[Python]", e.toString()));
        py.on("close", () => {
            try {
                const jsonStart = result.indexOf("{");
                resolve(JSON.parse(result.substring(jsonStart)));
            } catch (e) {
                console.error("Raw output:", result);
                reject("Invalid JSON from Python: " + e.message);
            }
        });
    });
}

// ---------------------------
// FASSDB — Chat History Store
// ---------------------------
function readChatDB() {
    try {
        if (!fs.existsSync(CHAT_DB_PATH)) return { chats: [] };
        return JSON.parse(fs.readFileSync(CHAT_DB_PATH, "utf-8"));
    } catch (e) {
        console.error("[FassDB] Read error:", e.message);
        return { chats: [] };
    }
}

function writeChatDB(db) {
    try {
        const dir = path.dirname(CHAT_DB_PATH);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(CHAT_DB_PATH, JSON.stringify(db, null, 2), "utf-8");
        return true;
    } catch (e) {
        console.error("[FassDB] Write error:", e.message);
        return false;
    }
}

// CREATE CHAT
ipcMain.handle("create-chat", async (event, { title }) => {
    const db = readChatDB();
    if (db.chats.length >= MAX_CHATS) {
        return { error: "limit_reached", count: db.chats.length, oldest: db.chats[db.chats.length - 1] };
    }
    const id = crypto.randomUUID();
    const newChat = { id, title: title || "New Chat", createdAt: Date.now(), messages: [] };
    db.chats.unshift(newChat);
    writeChatDB(db);
    return { success: true, chat: newChat };
});

// GET ALL CHATS
ipcMain.handle("get-chats", async () => {
    const db = readChatDB();
    return db.chats.map(c => ({
        id: c.id, title: c.title, createdAt: c.createdAt,
        messageCount: c.messages.length, pinned: c.pinned || false
    }));
});

// LOAD SINGLE CHAT
ipcMain.handle("load-chat", async (event, chatId) => {
    const db = readChatDB();
    return db.chats.find(c => c.id === chatId) || null;
});

// SAVE MESSAGE
ipcMain.handle("save-message", async (event, { chatId, role, content, sources, title, attachments }) => {
    const db = readChatDB();
    const idx = db.chats.findIndex(c => c.id === chatId);
    if (idx === -1) return { error: "chat_not_found" };
    const msg = { role, content, sources: sources || [], timestamp: Date.now() };
    // Persist display attachments (dataUrl for images, name for files) so they
    // can be re-rendered when the chat is loaded again later.
    if (attachments && attachments.length > 0) msg.attachments = attachments;
    db.chats[idx].messages.push(msg);
    if (title) db.chats[idx].title = title;
    writeChatDB(db);
    return { success: true };
});

// UPDATE CHAT TITLE
ipcMain.handle("update-chat-title", async (event, { chatId, title }) => {
    const db = readChatDB();
    const idx = db.chats.findIndex(c => c.id === chatId);
    if (idx === -1) return { error: "chat_not_found" };
    db.chats[idx].title = title;
    writeChatDB(db);
    return { success: true };
});

// DELETE SINGLE CHAT
ipcMain.handle("delete-chat", async (event, chatId) => {
    const db = readChatDB();
    db.chats = db.chats.filter(c => c.id !== chatId);
    writeChatDB(db);
    return { success: true };
});

// DELETE OLDEST CHAT
ipcMain.handle("delete-oldest-chat", async () => {
    const db = readChatDB();
    if (db.chats.length === 0) return { success: true };
    const removed = db.chats.pop();
    writeChatDB(db);
    return { success: true, removed };
});

// GET CHAT COUNT
ipcMain.handle("get-chat-count", async () => {
    const db = readChatDB();
    return { count: db.chats.length, limit: MAX_CHATS };
});

// PIN CHAT
ipcMain.handle("pin-chat", async (event, chatId) => {
    const db = readChatDB();
    const idx = db.chats.findIndex(c => c.id === chatId);
    if (idx === -1) return { error: "chat_not_found" };
    db.chats[idx].pinned = true;
    writeChatDB(db);
    return { success: true };
});

// UNPIN CHAT
ipcMain.handle("unpin-chat", async (event, chatId) => {
    const db = readChatDB();
    const idx = db.chats.findIndex(c => c.id === chatId);
    if (idx === -1) return { error: "chat_not_found" };
    db.chats[idx].pinned = false;
    writeChatDB(db);
    return { success: true };
});

// ---------------------------
// FILE PICKERS
// ---------------------------
ipcMain.handle("select-files", async () => {
    const result = await dialog.showOpenDialog({
        properties: ["openFile", "multiSelections"],
        filters: [{ name: "PDF Files", extensions: ["pdf"] }]
    });
    return result.canceled ? { canceled: true } : { canceled: false, files: result.filePaths };
});

ipcMain.handle("select-folder", async () => {
    const result = await dialog.showOpenDialog({ properties: ["openDirectory"] });
    if (result.canceled) return { canceled: true };
    const folderPath = result.filePaths[0];
    return { canceled: false, folderPath, pdfFiles: getPDFFiles(folderPath) };
});

ipcMain.handle("select-model-file", async () => {
    const result = await dialog.showOpenDialog({
        title: "Select GGUF Model File",
        properties: ["openFile"],
        filters: [
            { name: "GGUF Models", extensions: ["gguf"] },
            { name: "Binary Models", extensions: ["bin"] },
            { name: "All Files", extensions: ["*"] }
        ]
    });
    return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle("select-model-dir", async () => {
    const result = await dialog.showOpenDialog({
        title: "Select HuggingFace Model Directory",
        properties: ["openDirectory"]
    });
    return result.canceled ? null : result.filePaths[0];
});

// ---------------------------
// PROCESS PDF  (HTTP → spawn fallback)
// ---------------------------
ipcMain.handle("process-pdf", async (event, args) => {
    const filePaths = Array.isArray(args.filePath) ? args.filePath : [args.filePath];
    if (_serverReady) {
        try {
            return await httpPost(`${SERVER_URL}/process`, {
                file_paths: filePaths,
                chunk_size: Number(args.chunkSize),
                overlap: Number(args.overlap),
                dataset_name: args.dbName
            });
        } catch (e) {
            console.error("[process-pdf] HTTP failed, falling back to spawn:", e.message);
        }
    }
    return spawnPython(
        path.join(__dirname, "../python/processor_runner.py"),
        [JSON.stringify(filePaths), String(args.chunkSize), String(args.overlap), args.dbName]
    );
});

// ---------------------------
// QUERY DB  (HTTP → spawn fallback)
// ---------------------------
ipcMain.handle("query-db", async (event, args) => {
    let question = args.question;
    if (args.history && args.history.length > 0) {
        const historyText = args.history
            .map(m => `${m.role === "user" ? "User" : "AI"}: ${m.content}`)
            .join("\n");
        question = `[Conversation so far:\n${historyText}\n]\n\nCurrent question: ${args.question}`;
    }
    const freeMode = args.freeMode === true;
    const attachments = Array.isArray(args.attachments) ? args.attachments : [];
    if (_serverReady) {
        try {
            return await httpPost(`${SERVER_URL}/query`, {
                question, db_name: args.dbName, free_mode: freeMode, attachments
            });
        } catch (e) {
            console.error("[query-db] HTTP failed, falling back to spawn:", e.message);
        }
    }
    return spawnPython(
        path.join(__dirname, "../python/retriever_runner.py"),
        [question, args.dbName, CONFIG_PATH, freeMode ? "true" : "false"]
    );
});

// ---------------------------
// SAVE API CONFIG
// ---------------------------
ipcMain.handle("save-api-config", async (event, config) => {
    const storageDir = path.dirname(CONFIG_PATH);
    if (!fs.existsSync(storageDir)) fs.mkdirSync(storageDir, { recursive: true });
    if (config === null) {
        if (fs.existsSync(CONFIG_PATH)) fs.unlinkSync(CONFIG_PATH);
    } else {
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), "utf-8");
    }
    return { success: true };
});

// ---------------------------
// GET API CONFIG
// ---------------------------
ipcMain.handle("get-api-config", async () => {
    if (!fs.existsSync(CONFIG_PATH)) return null;
    try { return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8")); }
    catch (e) { return null; }
});

// ---------------------------
// GET COLLECTIONS
// ---------------------------
ipcMain.handle("get-collections", async () => {
    if (!fs.existsSync(DB_DIR)) return [];
    return fs.readdirSync(DB_DIR, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .map(d => {
            const full = path.join(DB_DIR, d.name);
            const size = getFolderSize(full);
            return { name: d.name, size: (size / (1024 * 1024)).toFixed(2) + " MB" };
        });
});

// ---------------------------
// DELETE SINGLE
// ---------------------------
ipcMain.handle("delete-collection", async (event, name) => {
    const target = path.join(DB_DIR, name);
    if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });
    return { success: true };
});

// ---------------------------
// DELETE MULTIPLE
// ---------------------------
ipcMain.handle("delete-multiple", async (event, names) => {
    names.forEach(name => {
        const target = path.join(DB_DIR, name);
        if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });
    });
    return { success: true };
});

// ---------------------------
// SAVE PER-PROVIDER CONFIG
// ---------------------------
ipcMain.handle("save-provider-config", async (event, { provider, config }) => {
    const storageDir = path.dirname(ALL_CONFIGS_PATH);
    if (!fs.existsSync(storageDir)) fs.mkdirSync(storageDir, { recursive: true });
    let all = {};
    if (fs.existsSync(ALL_CONFIGS_PATH)) {
        try { all = JSON.parse(fs.readFileSync(ALL_CONFIGS_PATH, "utf-8")); } catch (e) { }
    }
    if (config === null) { delete all[provider]; }
    else { all[provider] = config; }
    fs.writeFileSync(ALL_CONFIGS_PATH, JSON.stringify(all, null, 2), "utf-8");
    return { success: true };
});

// ---------------------------
// GET ALL PROVIDER CONFIGS
// ---------------------------
ipcMain.handle("get-all-provider-configs", async () => {
    if (!fs.existsSync(ALL_CONFIGS_PATH)) return {};
    try { return JSON.parse(fs.readFileSync(ALL_CONFIGS_PATH, "utf-8")); }
    catch (e) { return {}; }
});