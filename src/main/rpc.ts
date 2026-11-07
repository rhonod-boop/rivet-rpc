import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { Client } from "@xhayper/discord-rpc";
import type { ActionResult, ActivityConfig, RpcState, RpcStatus, SelfUser } from "../shared/types";

interface DiscordUser {
  id?: string;
  username?: string;
  globalName?: string | null;
  discriminator?: string;
  avatar?: string | null;
  avatarUrl?: string;
  setActivity(activity: unknown): Promise<unknown>;
  clearActivity?(): Promise<unknown>;
}

interface LooseClient {
  on(event: string, listener: (...args: unknown[]) => void): void;
  login(options?: { timeout?: number }): Promise<void>;
  destroy(): Promise<void> | void;
  user?: DiscordUser;
}

const CLIENT_ID_RE = /^\d{17,20}$/;
const CONNECT_TIMEOUT_MS = 15_000;
const MAX_RECONNECTS = 6;

function discordPipeAvailable(): boolean {
  if (process.platform !== "win32") return true;
  for (let i = 0; i < 10; i++) {
    try {
      if (fs.existsSync(`\\\\.\\pipe\\discord-ipc-${i}`)) return true;
    } catch {
      /* pipe probing is best-effort */
    }
  }
  return false;
}

function avatarUrlFor(user: DiscordUser): string {
  const id = String(user.id ?? "");
  if (typeof user.avatarUrl === "string" && user.avatarUrl) return user.avatarUrl;
  if (user.avatar) return `https://cdn.discordapp.com/avatars/${id}/${user.avatar}.png?size=128`;
  // Discord picks a default avatar from the legacy discriminator, or the user id for the new handle scheme.
  let index = 0;
  try {
    const discriminator = user.discriminator && user.discriminator !== "0" ? Number.parseInt(user.discriminator, 10) : Number.NaN;
    index = Number.isFinite(discriminator) ? discriminator % 5 : Number((BigInt(id) >> 22n) % 6n);
  } catch {
    index = 0;
  }
  return `https://cdn.discordapp.com/embed/avatars/${index}.png?size=128`;
}

/** The handshake hands us the signed-in account; that is what the preview should show. */
function toSelfUser(user: DiscordUser | undefined): SelfUser | null {
  const id = typeof user?.id === "string" ? user.id : "";
  if (!id) return null;
  const username = typeof user?.username === "string" && user.username ? user.username : "discord user";
  const globalName = typeof user?.globalName === "string" ? user.globalName.trim() : "";
  return {
    id,
    username,
    displayName: globalName || username,
    avatarUrl: avatarUrlFor(user as DiscordUser),
  };
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

const STREAM_HOSTS = ["twitch.tv", "youtube.com", "youtu.be"];

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

function toTimestamp(value: string): number | undefined {
  if (!value.trim()) return undefined;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : undefined;
}

interface BuiltActivity {
  activity: Record<string, unknown>;
  note: string;
}

/**
 * Translate the UI config into the RPC activity payload Discord expects.
 */
function buildActivity(config: ActivityConfig, connectedAt: number): BuiltActivity {
  // Discord's client rejects the streaming type ("type" must be one of [0, 2, 3, 5]),
  // so a streaming selection still goes out as Playing — see the button below.
  const activity: Record<string, unknown> = { type: config.type === 1 ? 0 : config.type };

  const name = config.name.trim();
  if (name) activity.name = name;

  const details = config.details.trim();
  const state = config.state.trim();
  if (details) {
    activity.details = details;
    if (isHttpUrl(config.detailsUrl)) activity.detailsUrl = config.detailsUrl.trim();
  }
  if (state) {
    activity.state = state;
    if (isHttpUrl(config.stateUrl)) activity.stateUrl = config.stateUrl.trim();
  }

  if (config.timestampMode === "since-connect") {
    activity.startTimestamp = connectedAt;
  } else if (config.timestampMode === "custom") {
    const start = toTimestamp(config.startTime);
    const end = toTimestamp(config.endTime);
    if (start) activity.startTimestamp = start;
    if (end) activity.endTimestamp = end;
  }

  const largeImage = config.largeImage.trim();
  if (largeImage) {
    activity.largeImageKey = largeImage;
    if (config.largeText.trim()) activity.largeImageText = config.largeText.trim();
  }
  const smallImage = config.smallImage.trim();
  if (smallImage) {
    activity.smallImageKey = smallImage;
    if (config.smallText.trim()) activity.smallImageText = config.smallText.trim();
  }

  const current = Number.parseInt(config.partyCurrent, 10);
  const max = Number.parseInt(config.partyMax, 10);
  if (Number.isFinite(current) && Number.isFinite(max) && max > 0) {
    activity.partyId = `customrpc-${randomUUID()}`;
    activity.partySizeCurrent = Math.max(1, Math.min(current, max));
    activity.partySizeMax = max;
  }

  const buttons = [
    { label: config.button1Text.trim(), url: config.button1Url.trim() },
    { label: config.button2Text.trim(), url: config.button2Url.trim() },
  ].filter((b) => b.label && isHttpUrl(b.url));

  // A stream link can't be a real streaming activity, so it becomes a clickable button instead.
  const streamUrl = config.streamUrl.trim();
  const wantsStream = config.type === 1 && isStreamUrl(streamUrl);
  if (wantsStream && buttons.length < 2) buttons.push({ label: "Watch stream", url: streamUrl });
  if (buttons.length) activity.buttons = buttons;

  let note = "Presence updated";
  if (config.type === 1) {
    note = !wantsStream
      ? "Streaming sent as Playing — add a stream link for a Watch stream button"
      : buttons.some((button) => button.label === "Watch stream")
        ? "Streaming sent as Playing, with a Watch stream button"
        : "Streaming sent as Playing — no free button slot for the stream link";
  }

  return { activity, note };
}

export class RpcManager {
  private client: LooseClient | null = null;
  private config: ActivityConfig | null = null;
  private connectedAt = 0;
  private reconnectTimers: NodeJS.Timeout[] = [];
  private disposed = false;
  /** True only once a handshake has fully completed, so a refused login isn't treated as a dropped session. */
  private wasReady = false;
  private self: SelfUser | null = null;
  private status: RpcStatus = {
    state: "disconnected",
    message: "Not connected",
    clientId: null,
  };

  constructor(private readonly onChange: (status: RpcStatus) => void) {}

  getStatus(): RpcStatus {
    return { ...this.status };
  }

  getSelf(): SelfUser | null {
    return this.self ? { ...this.self } : null;
  }

  private publish(patch: Partial<RpcStatus> & { state: RpcState; message: string }): RpcStatus {
    this.status = { ...this.status, updatedAt: Date.now(), ...(this.self ? { user: this.self } : {}), ...patch };
    this.onChange(this.getStatus());
    return this.getStatus();
  }

  private fail(message: string, detail?: string): ActionResult {
    return { ok: false, status: this.publish({ state: "error", message, detail }) };
  }

  private clearReconnectTimers(): void {
    for (const timer of this.reconnectTimers) clearTimeout(timer);
    this.reconnectTimers = [];
  }

  async connect(config: ActivityConfig): Promise<ActionResult> {
    const clientId = config.clientId.trim();
    if (!CLIENT_ID_RE.test(clientId)) {
      return this.fail(
        "Invalid application ID",
        "Discord application IDs are 17–20 digits. Create a free application at discord.com/developers/applications.",
      );
    }

    await this.teardown();
    this.config = { ...config, clientId };
    this.wasReady = false;

    if (!discordPipeAvailable()) {
      return this.fail(
        "Discord isn't running",
        "Open the Discord desktop app and sign in, then try again. The web version and mobile app can't host Rich Presence.",
      );
    }

    this.publish({ state: "connecting", message: "Connecting to Discord…", clientId });

    const client = new Client({ clientId }) as unknown as LooseClient;
    this.client = client;

    const ready = new Promise<"ready" | "failed">((resolve) => {
      const timer = setTimeout(() => resolve("failed"), CONNECT_TIMEOUT_MS);
      let settled = false;
      const settle = (value: "ready" | "failed") => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      };

      client.on("ready", () => settle("ready"));
      client.on("disconnected", () => {
        // A disconnect before the handshake finishes is a failed login, not a dropped session.
        settle("failed");
        if (this.disposed) return;
        this.handleDisconnect();
      });
      client.on("error", () => settle("failed"));
    });

    try {
      await client.login({ timeout: CONNECT_TIMEOUT_MS });
    } catch {
      /* the ready promise reports the outcome */
    }

    const outcome = await ready;
    if (outcome !== "ready") {
      await this.teardown();
      return this.fail(
        "Couldn't connect to Discord",
        "Check that Discord is fully open and signed in, and that your application ID belongs to an app you own. If Discord just updated, restart it once.",
      );
    }

    this.wasReady = true;
    this.self = toSelfUser(client.user) ?? this.self;
    this.connectedAt = Date.now();
    const applied = await this.pushActivity();
    if (!applied.ok) return applied;

    return {
      ok: true,
      status: this.publish({
        state: "connected",
        message: `Connected as ${clientId}`,
        clientId,
        detail: undefined,
        connectedAt: this.connectedAt,
      }),
    };
  }

  async update(config: ActivityConfig): Promise<ActionResult> {
    if (!this.client || this.status.state !== "connected") {
      return this.fail("Not connected", "Press Connect first — the presence can only update while Discord is linked.");
    }
    this.config = { ...config, clientId: config.clientId.trim() };
    return this.pushActivity();
  }

  async clear(): Promise<ActionResult> {
    if (!this.client?.user) {
      return this.fail("Not connected", "There is no presence to clear.");
    }
    try {
      await this.client.user.clearActivity?.();
      return { ok: true, status: this.publish({ state: "connected", message: "Presence cleared" }) };
    } catch {
      return this.fail("Couldn't clear the presence", "Discord rejected the request. Try disconnecting and reconnecting.");
    }
  }

  private async pushActivity(): Promise<ActionResult> {
    if (!this.client?.user || !this.config) {
      return this.fail("Not connected", "Discord link is gone. Press Connect again.");
    }
    try {
      const { activity, note } = buildActivity(this.config, this.connectedAt);
      await this.client.user.setActivity(activity);
      return {
        ok: true,
        status: this.publish({
          state: "connected",
          message: note,
          clientId: this.config.clientId.trim(),
          detail: undefined,
          connectedAt: this.connectedAt,
        }),
      };
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return this.fail("Discord rejected the update", `Usually this is malformed text, a broken image URL or an empty activity. (${detail})`);
    }
  }

  async disconnect(): Promise<ActionResult> {
    await this.teardown();
    return {
      ok: true,
      status: this.publish({
        state: "disconnected",
        message: "Disconnected — presence removed",
        clientId: null,
        detail: undefined,
        connectedAt: undefined,
      }),
    };
  }

  private handleDisconnect(): void {
    if (this.disposed || !this.wasReady) return;
    this.wasReady = false;
    this.client = null;
    this.publish({
      state: "connecting",
      message: "Lost the Discord connection — reconnecting…",
      connectedAt: undefined,
    });
    this.scheduleReconnect(1);
  }

  private scheduleReconnect(attempt: number): void {
    if (this.disposed || !this.config) return;
    if (attempt > MAX_RECONNECTS) {
      this.fail("Discord connection lost", "Open Discord and press Connect again.");
      return;
    }
    const delay = Math.min(2000 * attempt, 10_000);
    const timer = setTimeout(async () => {
      if (this.disposed || !this.config) return;
      const result = await this.connect(this.config);
      if (!result.ok) this.scheduleReconnect(attempt + 1);
    }, delay);
    this.reconnectTimers.push(timer);
  }

  private async teardown(): Promise<void> {
    this.clearReconnectTimers();
    const client = this.client;
    this.client = null;
    this.wasReady = false;
    this.connectedAt = 0;
    if (client) {
      try {
        await client.destroy();
      } catch {
        /* already gone */
      }
    }
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    await this.teardown();
  }
}
