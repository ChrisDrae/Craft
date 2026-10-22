/**
 * Introductions for multiplayer (WebRTC signaling): a guest leaves an offer for the host of a world (by
 * its code), the host leaves an answer, and the two connect directly; game traffic never comes here.
 * Messages wait in mailboxes for a few minutes. Shared by the Vercel functions next to this file (with
 * Upstash Redis, so every instance sees the same mailboxes) and the Vite dev server (in memory).
 * Files starting with "_" aren't functions of their own on Vercel.
 */

declare const process: { env: Record<string, string | undefined> };

/** Where mailboxes are kept. */
export interface SignalStore {
  /** Adds a message to a mailbox, which disappears `ttl` seconds after the last one. */
  push(key: string, value: string, ttl: number): Promise<void>;
  /** Takes up to `max` messages out of a mailbox, oldest first. */
  take(key: string, max: number): Promise<string[]>;
  /** Sets a flag that disappears after `ttl` seconds unless set again. */
  mark(key: string, ttl: number): Promise<void>;
  has(key: string): Promise<boolean>;
}

/** Mailboxes in memory: for the dev server, or a single long-running server. */
export class MemoryStore implements SignalStore {
  private readonly lists: Map<string, { values: string[]; until: number }> = new Map();
  private readonly flags: Map<string, number> = new Map();

  constructor(private readonly now: () => number = () => Date.now()) {}

  async push(key: string, value: string, ttl: number): Promise<void> {
    const list = this.live(key) ?? { values: [], until: 0 };
    list.values.push(value);
    list.until = this.now() + ttl * 1000;
    this.lists.set(key, list);
  }

  async take(key: string, max: number): Promise<string[]> {
    const list = this.live(key);
    return list ? list.values.splice(0, max) : [];
  }

  async mark(key: string, ttl: number): Promise<void> {
    this.flags.set(key, this.now() + ttl * 1000);
  }

  async has(key: string): Promise<boolean> {
    return (this.flags.get(key) ?? 0) > this.now();
  }

  private live(key: string): { values: string[]; until: number } | undefined {
    const list = this.lists.get(key);
    if (list && list.until <= this.now()) {
      this.lists.delete(key);
      return undefined;
    }
    return list;
  }
}

/** Mailboxes in Upstash Redis, through its REST API (what Vercel's Upstash integration sets up). */
export class UpstashStore implements SignalStore {
  constructor(
    private readonly url: string,
    private readonly token: string,
  ) {}

  private async run(commands: Array<Array<string | number>>): Promise<Array<{ result?: unknown; error?: string }>> {
    const response = await fetch(`${this.url.replace(/\/$/, "")}/pipeline`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(commands),
    });
    if (!response.ok) throw new Error(`Upstash answered ${response.status}`);
    return (await response.json()) as Array<{ result?: unknown; error?: string }>;
  }

  async push(key: string, value: string, ttl: number): Promise<void> {
    await this.run([
      ["RPUSH", key, value],
      ["EXPIRE", key, ttl],
    ]);
  }

  async take(key: string, max: number): Promise<string[]> {
    const [range] = await this.run([
      ["LRANGE", key, 0, max - 1],
      ["LTRIM", key, max, -1],
    ]);
    return (range.result as string[] | undefined) ?? [];
  }

  async mark(key: string, ttl: number): Promise<void> {
    await this.run([["SET", key, "1", "EX", ttl]]);
  }

  async has(key: string): Promise<boolean> {
    const [exists] = await this.run([["EXISTS", key]]);
    return exists.result === 1;
  }
}

/** Upstash where it is set up (either way Vercel names it), memory otherwise. */
export function storeFromEnv(env: Record<string, string | undefined> = process.env): SignalStore {
  const url = env.UPSTASH_REDIS_REST_URL ?? env.KV_REST_API_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN ?? env.KV_REST_API_TOKEN;
  return url && token ? new UpstashStore(url, token) : new MemoryStore();
}

/** Seconds a host's world stays open after its last poll, and messages wait. */
const ROOM_TTL = 30;
const MAIL_TTL = 120;
const ROOM = /^[A-Z0-9]{6}$/;
const PEER = /^(host|[a-z0-9-]{4,40})$/;
const KINDS = ["offer", "answer"];
/** Largest message accepted: an SDP description with its candidates fits easily. */
const MAX_BODY = 32 * 1024;

const json = (body: unknown, status: number = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

/**
 * The signaling endpoint:
 * - GET ?room=CODE&peer=ID takes the messages waiting for a peer ("host" for the world's host, whose
 *   polling also keeps the world open);
 * - POST {room, from, to, kind, data} leaves one (an "offer" or an "answer"); to a host only while its
 *   world is open.
 */
export async function handleSignal(request: Request, store: SignalStore): Promise<Response> {
  const prefix = "craft:signal:";
  if (request.method === "GET") {
    const params = new URL(request.url).searchParams;
    const room = params.get("room") ?? "";
    const peer = params.get("peer") ?? "";
    if (!ROOM.test(room) || !PEER.test(peer)) return json({ error: "Bad room or peer." }, 400);
    if (peer === "host") await store.mark(`${prefix}${room}`, ROOM_TTL);
    const messages = (await store.take(`${prefix}${room}:${peer}`, 20)).map((m) => JSON.parse(m) as unknown);
    return json({ messages });
  }
  if (request.method === "POST") {
    const text = await request.text();
    if (text.length > MAX_BODY) return json({ error: "Too large." }, 413);
    let msg: { room?: unknown; from?: unknown; to?: unknown; kind?: unknown; data?: unknown };
    try {
      msg = JSON.parse(text);
    } catch {
      return json({ error: "Not JSON." }, 400);
    }
    const { room, from, to, kind, data } = msg;
    if (typeof room !== "string" || !ROOM.test(room) || typeof from !== "string" || !PEER.test(from) || typeof to !== "string" || !PEER.test(to)) return json({ error: "Bad room or peer." }, 400);
    if (typeof kind !== "string" || !KINDS.includes(kind) || typeof data !== "string") return json({ error: "Bad message." }, 400);
    if (to === "host" && !(await store.has(`${prefix}${room}`))) return json({ error: "No world is open under that code." }, 404);
    await store.push(`${prefix}${room}:${to}`, JSON.stringify({ from, kind, data }), MAIL_TTL);
    return json({ ok: true });
  }
  return json({ error: "GET or POST." }, 405);
}

/** STUN servers find the way through most home routers; they are free and need no account. */
const STUN: RTCIceServer[] = [{ urls: ["stun:stun.cloudflare.com:3478", "stun:stun.l.google.com:19302"] }];

/**
 * The ICE servers for a new connection: STUN, and Cloudflare's TURN relay (for networks that block direct
 * connections) when a TURN key is set up, with credentials made for a day.
 */
export async function handleIce(env: Record<string, string | undefined> = process.env): Promise<Response> {
  const id = env.CLOUDFLARE_TURN_KEY_ID;
  const token = env.CLOUDFLARE_TURN_KEY_API_TOKEN;
  if (!id || !token) return json({ iceServers: STUN });
  try {
    const response = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${id}/credentials/generate-ice-servers`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ttl: 86400 }),
    });
    if (!response.ok) throw new Error(`Cloudflare answered ${response.status}`);
    const body = (await response.json()) as { iceServers?: RTCIceServer[] | RTCIceServer };
    const servers = Array.isArray(body.iceServers) ? body.iceServers : body.iceServers ? [body.iceServers] : [];
    return json({ iceServers: [...STUN, ...servers] });
  } catch (e) {
    console.error("TURN credentials failed:", e);
    return json({ iceServers: STUN });
  }
}
