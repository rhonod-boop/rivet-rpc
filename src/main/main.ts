import { app, BrowserWindow, ipcMain, screen, shell } from "electron";
import fs from "node:fs";
import path from "node:path";
import { RpcManager } from "./rpc";
import { ACTIVITY_TYPE_VALUES } from "../shared/types";
import type { ActivityConfig, ActionResult, SelfUser } from "../shared/types";

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

app.setAppUserModelId("com.rivet.rpc");

// The last account Discord reported, so the preview shows you before connecting.
function profilePath(): string {
  return path.join(app.getPath("userData"), "profile.json");
}

function readProfile(): SelfUser | null {
  try {
    const stored = JSON.parse(fs.readFileSync(profilePath(), "utf8")) as Partial<SelfUser>;
    if (typeof stored?.id === "string" && typeof stored?.username === "string") {
      return {
        id: stored.id,
        username: stored.username,
        displayName: typeof stored.displayName === "string" && stored.displayName ? stored.displayName : stored.username,
        avatarUrl: typeof stored.avatarUrl === "string" ? stored.avatarUrl : "",
      };
    }
  } catch {
    /* no cached profile yet */
  }
  return null;
}

function writeProfile(user: SelfUser): void {
  try {
    fs.writeFileSync(profilePath(), JSON.stringify(user));
  } catch {
    /* caching the profile is best-effort */
  }
}

const manager = new RpcManager((status) => {
  if (status.user) writeProfile(status.user);
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send("rpc:status", status);
  }
});

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  // the form is laid out to fit without scrolling, so open as tall as the display allows
  const workArea = screen.getPrimaryDisplay().workAreaSize;
  mainWindow = new BrowserWindow({
    width: Math.max(1000, Math.min(1220, workArea.width - 80)),
    height: Math.max(760, Math.min(900, workArea.height - 40)),
    minWidth: 940,
    minHeight: 640,
    frame: false,
    show: false,
    backgroundColor: "#0b0b0a",
    title: "Rivet",
    icon: path.join(__dirname, "icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      // Caches compiled JS in userData so later launches skip parsing the renderer bundle.
      v8CacheOptions: "code",
    },
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
  mainWindow.once("ready-to-show", () => mainWindow?.show());

  mainWindow.on("maximize", () => mainWindow?.webContents.send("window:state", { maximized: true }));
  mainWindow.on("unmaximize", () => mainWindow?.webContents.send("window:state", { maximized: false }));
  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) void shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event) => event.preventDefault());
}

function normalizeConfig(input: unknown): ActivityConfig | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as Record<string, unknown>;
  const str = (key: keyof ActivityConfig): string => (typeof raw[key] === "string" ? (raw[key] as string) : "");
  const type = typeof raw.type === "number" && ACTIVITY_TYPE_VALUES.includes(raw.type) ? raw.type : 0;
  const mode = str("timestampMode");
  return {
    clientId: str("clientId"),
    type,
    name: str("name"),
    streamUrl: str("streamUrl"),
    details: str("details"),
    detailsUrl: str("detailsUrl"),
    state: str("state"),
    stateUrl: str("stateUrl"),
    timestampMode: mode === "since-connect" || mode === "custom" ? mode : "none",
    startTime: str("startTime"),
    endTime: str("endTime"),
    largeImage: str("largeImage"),
    largeText: str("largeText"),
    smallImage: str("smallImage"),
    smallText: str("smallText"),
    partyCurrent: str("partyCurrent"),
    partyMax: str("partyMax"),
    button1Text: str("button1Text"),
    button1Url: str("button1Url"),
    button2Text: str("button2Text"),
    button2Url: str("button2Url"),
  };
}

function withConfig(handler: (config: ActivityConfig) => Promise<ActionResult>) {
  return async (_event: unknown, input: unknown): Promise<ActionResult> => {
    const config = normalizeConfig(input);
    if (!config) {
      return { ok: false, status: manager.getStatus() };
    }
    return handler(config);
  };
}

ipcMain.handle("rpc:connect", withConfig((config) => manager.connect(config)));
ipcMain.handle("rpc:update", withConfig((config) => manager.update(config)));
ipcMain.handle("rpc:disconnect", () => manager.disconnect());
ipcMain.handle("rpc:clear", () => manager.clear());
ipcMain.handle("rpc:status", () => manager.getStatus());
ipcMain.handle("rpc:profile", () => manager.getSelf() ?? readProfile());

ipcMain.on("window:minimize", () => mainWindow?.minimize());
ipcMain.on("window:toggle-maximize", () => {
  if (!mainWindow) return;
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
});
ipcMain.on("window:close", () => mainWindow?.close());

ipcMain.handle("shell:open", async (_event, url: unknown) => {
  if (typeof url !== "string" || !url.startsWith("https://")) return false;
  await shell.openExternal(url);
  return true;
});

ipcMain.handle("app:version", () => app.getVersion());

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("second-instance", () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
});

app.on("window-all-closed", () => {
  app.quit();
});

app.on("before-quit", () => {
  void manager.dispose();
});
