import { ACTIVITY_TYPES } from "../shared/types";
import type { ActivityConfig, RpcApi, RpcStatus, TimestampMode } from "../shared/types";

declare global {
  interface Window {
    rpcApi: RpcApi;
  }
}

const api = window.rpcApi;

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el as T;
}

const FIELD_IDS = [
  "clientId",
  "name",
  "streamUrl",
  "details",
  "detailsUrl",
  "state",
  "stateUrl",
  "startTime",
  "endTime",
  "largeImage",
  "largeText",
  "smallImage",
  "smallText",
  "partyCurrent",
  "partyMax",
  "button1Text",
  "button1Url",
  "button2Text",
  "button2Url",
] as const;

type FieldId = (typeof FIELD_IDS)[number];

import type { SelfUser } from "../shared/types";

const fields = Object.fromEntries(FIELD_IDS.map((id) => [id, byId<HTMLInputElement>(id)])) as Record<
  FieldId,
  HTMLInputElement
>;

const activityType = byId<HTMLSelectElement>("activityType");
const btnConnect = byId<HTMLButtonElement>("btnConnect");
const btnUpdate = byId<HTMLButtonElement>("btnUpdate");
const btnDisconnect = byId<HTMLButtonElement>("btnDisconnect");
const btnClear = byId<HTMLButtonElement>("btnClear");
const statusDot = byId("statusDot");
const statusText = byId("statusText");
const statusDetail = byId("statusDetail");
const toastEl = byId("toast");

const pv = {
  avatar: byId("pvAvatar"),
  avatarImg: byId<HTMLImageElement>("pvAvatarImg"),
  avatarInitial: byId("pvAvatarInitial"),
  user: byId("pvUser"),
  tag: byId("pvTag"),
  verb: byId("pvVerb"),
  large: byId<HTMLImageElement>("pvLarge"),
  fallback: byId("pvLargeFallback"),
  small: byId<HTMLImageElement>("pvSmall"),
  smallFallback: byId("pvSmallFallback"),
  name: byId("pvName"),
  details: byId("pvDetails"),
  state: byId("pvState"),
  party: byId("pvParty"),
  time: byId("pvTime"),
  buttons: byId("pvButtons"),
  foot: byId("pvFootText"),
};

const STORAGE_CONFIG = "customrpc.config";
const STORAGE_BETA = "customrpc.beta.dismissed";
const CLIENT_ID_RE = /^\d{17,20}$/;
const STREAM_HOSTS = ["twitch.tv", "youtube.com", "youtu.be"];
const typeLine = byId("typeLine");
const streamNote = byId("streamNote");

let connectedAt = 0;
let status: RpcStatus = { state: "disconnected", message: "Not connected", clientId: null };
let selfUser: SelfUser | null = null;
let busy = false;

/* ---------------------------------------------------------------- *
 * helpers
 * ---------------------------------------------------------------- */

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

/** Discord only accepts a Twitch or YouTube link on a streaming activity. */
function isStreamUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return false;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return false;
  const host = url.hostname.toLowerCase();
  return STREAM_HOSTS.some((known) => host === known || host.endsWith(`.${known}`));
}

/** Matches what the main process sends: own buttons first, then the stream link if a slot is left. */
function previewButtons(config: ActivityConfig): { text: string; url: string }[] {
  const buttons = [
    { text: config.button1Text.trim(), url: config.button1Url.trim() },
    { text: config.button2Text.trim(), url: config.button2Url.trim() },
  ].filter((b) => b.text && isHttpUrl(b.url));
  const stream = config.streamUrl.trim();
  if (config.type === 1 && isStreamUrl(stream) && buttons.length < 2) {
    buttons.push({ text: "Watch stream", url: stream });
  }
  return buttons;
}

/** The stream link is a field of the activity type, so it appears with it instead of taking its own row. */
function syncStreamRow(): void {
  const streaming = activityType.value === "1";
  typeLine.classList.toggle("has-stream", streaming);
  fields.streamUrl.hidden = !streaming;
  streamNote.hidden = !streaming;
}

function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(Math.abs(ms) / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}

let toastTimer: number | undefined;
function toast(message: string): void {
  toastEl.textContent = message;
  toastEl.hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toastEl.hidden = true;
  }, 5200);
}

function timestampMode(): TimestampMode {
  const checked = document.querySelector<HTMLInputElement>('input[name="timestampMode"]:checked');
  const value = checked?.value;
  return value === "since-connect" || value === "custom" ? value : "none";
}

function readConfig(): ActivityConfig {
  return {
    clientId: fields.clientId.value.trim(),
    type: Number.parseInt(activityType.value, 10) || 0,
    name: fields.name.value,
    streamUrl: fields.streamUrl.value,
    details: fields.details.value,
    detailsUrl: fields.detailsUrl.value,
    state: fields.state.value,
    stateUrl: fields.stateUrl.value,
    timestampMode: timestampMode(),
    startTime: fields.startTime.value,
    endTime: fields.endTime.value,
    largeImage: fields.largeImage.value,
    largeText: fields.largeText.value,
    smallImage: fields.smallImage.value,
    smallText: fields.smallText.value,
    partyCurrent: fields.partyCurrent.value,
    partyMax: fields.partyMax.value,
    button1Text: fields.button1Text.value,
    button1Url: fields.button1Url.value,
    button2Text: fields.button2Text.value,
    button2Url: fields.button2Url.value,
  };
}

/* ---------------------------------------------------------------- *
 * validation
 * ---------------------------------------------------------------- */

interface Problem {
  message: string;
  field?: FieldId;
}

function validate(config: ActivityConfig): Problem | null {
  if (!config.clientId) {
    return { message: "Paste your Discord application ID first.", field: "clientId" };
  }
  if (!CLIENT_ID_RE.test(config.clientId)) {
    return {
      message: "A client ID is 17–20 digits. Copy it from your app in the developer portal.",
      field: "clientId",
    };
  }
  if (config.type === 1) {
    if (!config.streamUrl.trim()) {
      return { message: "A streaming activity needs the link to your stream.", field: "streamUrl" };
    }
    if (!isStreamUrl(config.streamUrl)) {
      return {
        message: "Use a twitch.tv or youtube.com link — Discord rejects any other URL for streaming.",
        field: "streamUrl",
      };
    }
  }
  for (const [n, text, url] of [
    [1, config.button1Text, config.button1Url],
    [2, config.button2Text, config.button2Url],
  ] as const) {
    if (url.trim() && !isHttpUrl(url)) {
      return { message: `Button ${n}'s URL must start with https://`, field: n === 1 ? "button1Url" : "button2Url" };
    }
    if (text.trim() && !url.trim()) {
      return { message: `Button ${n} needs a URL to work.`, field: n === 1 ? "button1Url" : "button2Url" };
    }
  }
  for (const [label, value] of [
    ["Details URL", config.detailsUrl],
    ["State URL", config.stateUrl],
  ] as const) {
    if (value.trim() && !isHttpUrl(value)) {
      return { message: `${label} must start with https://`, field: label === "Details URL" ? "detailsUrl" : "stateUrl" };
    }
  }
  if (config.timestampMode === "custom" && config.startTime && config.endTime) {
    const start = new Date(config.startTime).getTime();
    const end = new Date(config.endTime).getTime();
    if (Number.isFinite(start) && Number.isFinite(end) && end < start) {
      return { message: "The end time is before the start time.", field: "endTime" };
    }
  }
  return null;
}

function markInvalid(field?: FieldId): void {
  for (const id of FIELD_IDS) fields[id].classList.remove("invalid");
  if (!field) return;
  fields[field].classList.add("invalid");
  fields[field].focus();
  fields[field].select();
}

/* ---------------------------------------------------------------- *
 * preview
 * ---------------------------------------------------------------- */

function setArtwork(
  img: HTMLImageElement,
  fallback: HTMLElement,
  value: string,
  emptyText: string,
): void {
  const asset = value.trim();
  if (!asset) {
    img.hidden = true;
    img.removeAttribute("src");
    fallback.hidden = !emptyText;
    if (emptyText) fallback.textContent = emptyText;
    return;
  }
  if (/^https?:\/\//i.test(asset)) {
    if (img.dataset.failedSrc === asset) {
      showArtworkFallback(img, fallback);
      return;
    }
    img.onerror = () => {
      img.dataset.failedSrc = asset;
      showArtworkFallback(img, fallback);
    };
    if (img.getAttribute("src") !== asset) {
      delete img.dataset.failedSrc;
      img.src = asset;
    }
    img.hidden = false;
    fallback.hidden = true;
    return;
  }
  // An asset key lives in the Discord app, so show a labelled placeholder instead.
  img.hidden = true;
  img.removeAttribute("src");
  fallback.hidden = false;
  fallback.textContent = asset.replace(/[^a-z0-9]/gi, "").slice(0, 3).toUpperCase() || "IMG";
}

function showArtworkFallback(img: HTMLImageElement, fallback: HTMLElement): void {
  img.hidden = true;
  img.removeAttribute("src");
  fallback.hidden = false;
  fallback.textContent = "IMG";
}

function setThumb(img: HTMLImageElement, value: string): void {
  const asset = value.trim();
  if (/^https?:\/\//i.test(asset) && img.dataset.failedSrc !== asset) {
    img.onerror = () => {
      img.dataset.failedSrc = asset;
      img.hidden = true;
      img.removeAttribute("src");
    };
    if (img.getAttribute("src") !== asset) {
      delete img.dataset.failedSrc;
      img.src = asset;
    }
    img.hidden = false;
  } else {
    img.hidden = true;
    img.removeAttribute("src");
  }
}

/** Who the presence is set from — read off Discord, not guessed from the app name. */
function renderSelf(): void {
  const name = selfUser?.displayName ?? "your profile";
  pv.user.textContent = name;
  // A handle only adds information when it differs from the display name.
  const tag = selfUser ? `@${selfUser.username}` : "no account linked";
  pv.tag.textContent = tag;
  pv.tag.hidden = !!selfUser && selfUser.displayName === selfUser.username;

  const source = (selfUser?.displayName ?? readConfig().name).replace(/[^a-z0-9]/gi, "");
  pv.avatarInitial.textContent = source.charAt(0).toUpperCase() || "R";

  const url = selfUser?.avatarUrl ?? "";
  if (url) {
    pv.avatarImg.onerror = () => {
      pv.avatarImg.hidden = true;
      pv.avatarInitial.hidden = false;
    };
    if (pv.avatarImg.getAttribute("src") !== url) pv.avatarImg.src = url;
    pv.avatarImg.hidden = false;
  } else {
    pv.avatarImg.hidden = true;
    pv.avatarImg.removeAttribute("src");
  }
  // the initial is only a stand-in for a missing avatar, so it must not show through one
  pv.avatarInitial.hidden = !!url;
}

function renderPreview(): void {
  const config = readConfig();
  // Discord's client refuses the streaming type, so that presence really arrives as Playing.
  const verb =
    config.type === 1
      ? "Playing a game"
      : (ACTIVITY_TYPES.find((t) => t.value === config.type)?.verb ?? "Playing a game");
  pv.verb.textContent = verb;

  const name = config.name.trim();
  pv.name.textContent = name || "Your app name";
  pv.name.classList.toggle("is-empty", !name);
  pv.name.style.opacity = name ? "1" : "0.45";
  renderSelf();

  const details = config.details.trim();
  pv.details.textContent = details;
  pv.details.hidden = !details;

  const state = config.state.trim();
  pv.state.textContent = state;
  pv.state.hidden = !state;

  const current = Number.parseInt(config.partyCurrent, 10);
  const max = Number.parseInt(config.partyMax, 10);
  const showParty = Number.isFinite(current) && Number.isFinite(max) && max > 0;
  pv.party.hidden = !showParty;
  pv.party.textContent = showParty ? `(${Math.min(Math.max(current, 1), max)} of ${max})` : "";

  setArtwork(pv.large, pv.fallback, config.largeImage, "RPC");
  setArtwork(pv.small, pv.smallFallback, config.smallImage, "");

  const buttons = previewButtons(config);

  pv.buttons.replaceChildren(
    ...buttons.map((b) => {
      const el = document.createElement("div");
      el.className = "act-btn";
      el.textContent = b.text;
      el.title = b.url;
      return el;
    }),
  );
  pv.buttons.hidden = buttons.length === 0;

  setThumb(byId<HTMLImageElement>("largeThumb"), config.largeImage);
  setThumb(byId<HTMLImageElement>("smallThumb"), config.smallImage);

  const custom = byId("customTimes");
  const isCustom = config.timestampMode === "custom";
  custom.setAttribute("aria-disabled", String(!isCustom));

  renderTime();

  pv.foot.textContent =
    status.state === "connected"
      ? "Presence is live — check your Discord profile"
      : status.state === "connecting"
        ? "Talking to your Discord client…"
        : status.state === "error"
          ? "Last attempt failed — see the status bar"
          : config.clientId
            ? "Ready to connect"
            : "Waiting for an application ID";
}

function renderTime(): void {
  const config = readConfig();
  const now = Date.now();
  let text = "";

  if (config.timestampMode === "since-connect") {
    const start = connectedAt || (status.state === "connected" ? now : 0);
    text = start ? `${formatDuration(now - start)} elapsed` : "00:00 elapsed";
  } else if (config.timestampMode === "custom") {
    const start = config.startTime ? new Date(config.startTime).getTime() : Number.NaN;
    const end = config.endTime ? new Date(config.endTime).getTime() : Number.NaN;
    if (Number.isFinite(start) && start > now) text = `Starts in ${formatDuration(start - now)}`;
    else if (Number.isFinite(start)) text = `${formatDuration(now - start)} elapsed`;
    else if (Number.isFinite(end) && end > now) text = `${formatDuration(end - now)} left`;
    else if (Number.isFinite(end)) text = "Ended";
  }

  pv.time.hidden = !text;
  pv.time.textContent = text;
}

/* ---------------------------------------------------------------- *
 * connection state
 * ---------------------------------------------------------------- */

function applyStatus(next: RpcStatus): void {
  status = next;
  if (next.user) {
    selfUser = next.user;
    renderSelf();
  }
  if (next.connectedAt) connectedAt = next.connectedAt;
  if (next.state === "disconnected" || next.state === "error") connectedAt = 0;

  statusDot.className = `dot ${next.state}`;
  statusText.textContent = next.message;
  statusDetail.textContent = next.detail ?? "";
  statusDetail.title = next.detail ?? "";

  btnConnect.disabled = busy || next.state === "connected" || next.state === "connecting";
  btnUpdate.disabled = busy || next.state !== "connected";
  btnDisconnect.disabled = next.state === "disconnected";
  btnClear.disabled = busy || next.state !== "connected";

  renderPreview();
}

function setBusy(value: boolean): void {
  busy = value;
  btnConnect.disabled = value || status.state === "connected" || status.state === "connecting";
  btnUpdate.disabled = value || status.state !== "connected";
  btnClear.disabled = value || status.state !== "connected";
}

async function run(action: () => Promise<{ ok: boolean; status: RpcStatus }>): Promise<void> {
  if (busy) return;
  setBusy(true);
  try {
    const result = await action();
    applyStatus(result.status);
    if (!result.ok && result.status.detail) toast(result.status.detail);
  } catch (error) {
    toast(error instanceof Error ? error.message : "Something went wrong talking to the main process.");
  } finally {
    setBusy(false);
  }
}

function startConnect(): void {
  const config = readConfig();
  const problem = validate(config);
  if (problem) {
    markInvalid(problem.field);
    toast(problem.message);
    return;
  }
  markInvalid();
  saveConfig(config);
  void run(() => api.connect(config));
}

/* ---------------------------------------------------------------- *
 * persistence
 * ---------------------------------------------------------------- */

function saveConfig(config: ActivityConfig): void {
  try {
    localStorage.setItem(
      STORAGE_CONFIG,
      JSON.stringify({ ...config, timestampMode: config.timestampMode }),
    );
  } catch {
    /* storage is optional */
  }
}

function restoreConfig(): void {
  let stored: Partial<ActivityConfig> | null = null;
  try {
    const raw = localStorage.getItem(STORAGE_CONFIG);
    stored = raw ? (JSON.parse(raw) as Partial<ActivityConfig>) : null;
  } catch {
    stored = null;
  }
  if (!stored) {
    fields.startTime.value = "";
    return;
  }

  for (const id of FIELD_IDS) {
    const value = stored[id];
    if (typeof value === "string") fields[id].value = value;
  }
  if (typeof stored.type === "number") {
    activityType.value = String([0, 1, 2, 3, 5].includes(stored.type) ? stored.type : 0);
  }
  const mode = stored.timestampMode === "since-connect" || stored.timestampMode === "custom" ? stored.timestampMode : "none";
  const radio = document.querySelector<HTMLInputElement>(`input[name="timestampMode"][value="${mode}"]`);
  if (radio) radio.checked = true;
}

/* ---------------------------------------------------------------- *
 * beta warning
 * ---------------------------------------------------------------- */

const betaModal = byId("betaModal");

function showBeta(): void {
  betaModal.hidden = false;
  byId("betaAccept").focus();
}

function hideBeta(): void {
  betaModal.hidden = true;
}

function initBeta(): void {
  let dismissed = false;
  try {
    dismissed = localStorage.getItem(STORAGE_BETA) === "1";
  } catch {
    dismissed = false;
  }
  if (!dismissed) showBeta();

  byId("betaChip").addEventListener("click", showBeta);
  byId("betaAccept").addEventListener("click", () => {
    const remember = byId<HTMLInputElement>("betaDismiss").checked;
    try {
      if (remember) localStorage.setItem(STORAGE_BETA, "1");
    } catch {
      /* ignore */
    }
    hideBeta();
  });
  betaModal.addEventListener("click", (event) => {
    if (event.target === betaModal) hideBeta();
  });
}

/* ---------------------------------------------------------------- *
 * wiring
 * ---------------------------------------------------------------- */

function init(): void {
  restoreConfig();
  syncStreamRow();
  initBeta();

  for (const id of FIELD_IDS) {
    fields[id].addEventListener("input", () => {
      fields[id].classList.remove("invalid");
      renderPreview();
      saveConfig(readConfig());
    });
  }

  activityType.addEventListener("change", () => {
    syncStreamRow();
    if (activityType.value === "1" && !fields.streamUrl.value.trim()) fields.streamUrl.focus();
    renderPreview();
    saveConfig(readConfig());
  });

  for (const radio of document.querySelectorAll<HTMLInputElement>('input[name="timestampMode"]')) {
    radio.addEventListener("change", () => {
      renderPreview();
      saveConfig(readConfig());
    });
  }

  btnConnect.addEventListener("click", startConnect);
  btnUpdate.addEventListener("click", () => {
    const config = readConfig();
    const problem = validate(config);
    if (problem) {
      markInvalid(problem.field);
      toast(problem.message);
      return;
    }
    markInvalid();
    saveConfig(config);
    void run(() => api.update(config));
  });
  btnDisconnect.addEventListener("click", () => void run(() => api.disconnect()));
  btnClear.addEventListener("click", () => void run(() => api.clear()));

  byId("openDevPortal").addEventListener("click", () => {
    void api.openExternal("https://discord.com/developers/applications");
  });

  // The community link shows up in the titlebar, the beta card, the sidebar and the modal.
  for (const el of document.querySelectorAll<HTMLElement>("[data-invite]")) {
    el.addEventListener("click", () => void api.openExternal("https://discord.gg/dkDhWNYY4Z"));
  }
  for (const el of document.querySelectorAll<HTMLElement>("[data-portal]")) {
    el.addEventListener("click", () => void api.openExternal("https://discord.com/developers/applications"));
  }

  byId("winMin").addEventListener("click", () => api.minimizeWindow());
  byId("winMax").addEventListener("click", () => api.toggleMaximizeWindow());
  byId("winClose").addEventListener("click", () => api.closeWindow());

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !betaModal.hidden) {
      hideBeta();
      return;
    }
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      if (status.state === "connected") btnUpdate.click();
      else startConnect();
    }
  });

  api.onStatus(applyStatus);
  void api.getStatus().then(applyStatus);

  void api.getProfile().then((profile) => {
    if (!profile) return;
    selfUser = profile;
    renderSelf();
  });

  void api.getVersion().then((version) => {
    byId("statusMeta").textContent = `v${version}`;
  });

  window.setInterval(renderTime, 1000);
  renderPreview();
}

init();
