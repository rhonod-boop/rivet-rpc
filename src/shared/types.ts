export const ACTIVITY_TYPES = [
  { value: 0, label: "Playing", verb: "Playing a game" },
  { value: 1, label: "Streaming", verb: "Streaming" },
  { value: 2, label: "Listening to", verb: "Listening to" },
  { value: 3, label: "Watching", verb: "Watching" },
  { value: 5, label: "Competing in", verb: "Competing in" },
] as const;

export const ACTIVITY_TYPE_VALUES: readonly number[] = ACTIVITY_TYPES.map((type) => type.value);

export type TimestampMode = "none" | "since-connect" | "custom";

export interface ActivityConfig {
  clientId: string;
  type: number;
  name: string;
  /** Twitch/YouTube link — Discord requires it for a streaming (type 1) activity. */
  streamUrl: string;
  details: string;
  detailsUrl: string;
  state: string;
  stateUrl: string;
  timestampMode: TimestampMode;
  startTime: string;
  endTime: string;
  largeImage: string;
  largeText: string;
  smallImage: string;
  smallText: string;
  partyCurrent: string;
  partyMax: string;
  button1Text: string;
  button1Url: string;
  button2Text: string;
  button2Url: string;
}

export type RpcState = "disconnected" | "connecting" | "connected" | "error";

/** The Discord account the presence is being set from, as reported on the RPC handshake. */
export interface SelfUser {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string;
}

export interface RpcStatus {
  state: RpcState;
  message: string;
  clientId: string | null;
  detail?: string;
  connectedAt?: number;
  updatedAt?: number;
  user?: SelfUser;
}

export interface ActionResult {
  ok: boolean;
  status: RpcStatus;
}

export interface WindowState {
  maximized: boolean;
}

export interface RpcApi {
  connect(config: ActivityConfig): Promise<ActionResult>;
  update(config: ActivityConfig): Promise<ActionResult>;
  disconnect(): Promise<ActionResult>;
  clear(): Promise<ActionResult>;
  getStatus(): Promise<RpcStatus>;
  getProfile(): Promise<SelfUser | null>;
  onStatus(listener: (status: RpcStatus) => void): () => void;
  minimizeWindow(): void;
  toggleMaximizeWindow(): void;
  closeWindow(): void;
  onWindowState(listener: (state: WindowState) => void): () => void;
  openExternal(url: string): Promise<boolean>;
  getVersion(): Promise<string>;
}
