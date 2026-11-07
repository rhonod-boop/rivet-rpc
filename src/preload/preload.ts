import { contextBridge, ipcRenderer } from "electron";
import type { ActivityConfig, ActionResult, RpcApi, RpcStatus, SelfUser, WindowState } from "../shared/types";

const api: RpcApi = {
  connect: (config: ActivityConfig) => ipcRenderer.invoke("rpc:connect", config) as Promise<ActionResult>,
  update: (config: ActivityConfig) => ipcRenderer.invoke("rpc:update", config) as Promise<ActionResult>,
  disconnect: () => ipcRenderer.invoke("rpc:disconnect") as Promise<ActionResult>,
  clear: () => ipcRenderer.invoke("rpc:clear") as Promise<ActionResult>,
  getStatus: () => ipcRenderer.invoke("rpc:status") as Promise<RpcStatus>,
  getProfile: () => ipcRenderer.invoke("rpc:profile") as Promise<SelfUser | null>,
  onStatus: (listener) => {
    const handler = (_event: unknown, status: RpcStatus) => listener(status);
    ipcRenderer.on("rpc:status", handler);
    return () => ipcRenderer.removeListener("rpc:status", handler);
  },
  minimizeWindow: () => ipcRenderer.send("window:minimize"),
  toggleMaximizeWindow: () => ipcRenderer.send("window:toggle-maximize"),
  closeWindow: () => ipcRenderer.send("window:close"),
  onWindowState: (listener) => {
    const handler = (_event: unknown, state: WindowState) => listener(state);
    ipcRenderer.on("window:state", handler);
    return () => ipcRenderer.removeListener("window:state", handler);
  },
  openExternal: (url: string) => ipcRenderer.invoke("shell:open", url) as Promise<boolean>,
  getVersion: () => ipcRenderer.invoke("app:version") as Promise<string>,
};

contextBridge.exposeInMainWorld("rpcApi", api);
