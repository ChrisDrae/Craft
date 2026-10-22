import { ChannelConnection, type Connection } from "./connection.js";

/**
 * Connecting host and guests directly, browser to browser, over WebRTC data channels. They are introduced
 * by the signaling endpoint next to the game (api/signal): the guest leaves an offer for the world's code,
 * the host answers. Each side gathers all its network candidates before sending its description, so one
 * offer and one answer are all that pass through it.
 */

const SIGNAL = "/api/signal";
const ICE = "/api/ice";
/** How often the host looks for guests knocking, and a guest for the host's answer, in milliseconds. */
const HOST_POLL = 1500;
const GUEST_POLL = 700;
/** How long a guest waits for the host's answer, and for the channel to open. */
const ANSWER_WAIT = 30_000;
const OPEN_WAIT = 20_000;
/** How long gathering network candidates may take before the description goes with what it has. */
const GATHER_WAIT = 5000;

/** Letters for world codes: none that look alike (0 and O, 1 and I). */
const LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function newCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, (b) => LETTERS[b % LETTERS.length]).join("");
}

/** A code from what someone pasted: the code itself, or an invite link with ?join=. */
export function codeFrom(text: string): string | null {
  const match = /(?:join=)?([A-Za-z0-9]{6})\s*$/.exec(text.trim());
  return match ? match[1].toUpperCase() : null;
}

interface Mail {
  from: string;
  kind: "offer" | "answer";
  data: string;
}

async function post(room: string, from: string, to: string, kind: Mail["kind"], data: string): Promise<void> {
  const response = await fetch(SIGNAL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ room, from, to, kind, data }) });
  if (response.status === 404) throw new Error("No world is open under that code. Check it with the host.");
  if (!response.ok) throw new Error(`The game's server answered ${response.status}.`);
}

async function poll(room: string, peer: string): Promise<Mail[]> {
  const response = await fetch(`${SIGNAL}?room=${room}&peer=${encodeURIComponent(peer)}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`The game's server answered ${response.status}.`);
  return ((await response.json()) as { messages: Mail[] }).messages;
}

/** STUN (and TURN, where the deployment has it) servers, from the game's server; public STUN without one. */
async function iceServers(): Promise<RTCIceServer[]> {
  try {
    const response = await fetch(ICE, { cache: "no-store" });
    if (response.ok) return ((await response.json()) as { iceServers: RTCIceServer[] }).iceServers;
  } catch {
    // Served without the endpoint
  }
  return [{ urls: ["stun:stun.cloudflare.com:3478", "stun:stun.l.google.com:19302"] }];
}

/** Resolves once the connection has all its candidates (or after GATHER_WAIT, with those it has). */
function gathered(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve) => {
    const done = (): void => {
      if (pc.iceGatheringState !== "complete") return;
      pc.removeEventListener("icegatheringstatechange", done);
      resolve();
    };
    pc.addEventListener("icegatheringstatechange", done);
    setTimeout(resolve, GATHER_WAIT);
  });
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * A world open to friends under a code: answers every guest's offer and hands each connection over once
 * its channel is open. Polling the signaling endpoint keeps the code alive; stop() lets it lapse.
 */
export class Hosting {
  readonly code: string = newCode();
  /** Called when polling fails (the endpoint is missing or down), and again when it works. */
  onStatus: ((error: string | null) => void) | null = null;
  private running: boolean = false;
  private ice: RTCIceServer[] | null = null;
  private readonly peers: Set<RTCPeerConnection> = new Set();

  constructor(private readonly onConnection: (conn: Connection) => void) {}

  /** Starts taking guests. Rejects if the signaling endpoint can't be reached at all. */
  async start(): Promise<void> {
    this.ice = await iceServers();
    await poll(this.code, "host");
    this.running = true;
    void this.loop();
  }

  stop(): void {
    this.running = false;
    for (const pc of this.peers) if (pc.connectionState !== "connected") pc.close();
    this.peers.clear();
  }

  private async loop(): Promise<void> {
    let failing = false;
    while (this.running) {
      try {
        for (const mail of await poll(this.code, "host")) if (mail.kind === "offer") void this.answer(mail).catch((e) => console.warn("Craft: a guest couldn't connect", e));
        if (failing) this.onStatus?.(null);
        failing = false;
      } catch (e) {
        if (!failing) this.onStatus?.((e as Error).message);
        failing = true;
      }
      await sleep(HOST_POLL);
    }
  }

  private async answer(offer: Mail): Promise<void> {
    const pc = new RTCPeerConnection({ iceServers: this.ice ?? [] });
    this.peers.add(pc);
    pc.addEventListener("datachannel", (e) => {
      const channel = e.channel;
      const ready = (): void => {
        this.peers.delete(pc);
        this.onConnection(new ChannelConnection(channel, pc));
      };
      if (channel.readyState === "open") ready();
      else channel.addEventListener("open", ready, { once: true });
    });
    await pc.setRemoteDescription({ type: "offer", sdp: offer.data });
    await pc.setLocalDescription(await pc.createAnswer());
    await gathered(pc);
    await post(this.code, "host", offer.from, "answer", pc.localDescription!.sdp);
    // A guest that never gets through is let go
    setTimeout(() => {
      if (this.peers.has(pc)) {
        this.peers.delete(pc);
        pc.close();
      }
    }, ANSWER_WAIT + OPEN_WAIT);
  }
}

/**
 * Joins the world open under a code as the guest `id`: sends an offer, waits for the host's answer and
 * for the channel to open. Rejects with a message for the player if it doesn't work out.
 */
export async function join(code: string, id: string): Promise<Connection> {
  const pc = new RTCPeerConnection({ iceServers: await iceServers() });
  const channel = pc.createDataChannel("craft", { ordered: true });
  try {
    await pc.setLocalDescription(await pc.createOffer());
    await gathered(pc);
    await post(code, id, "host", "offer", pc.localDescription!.sdp);
    const until = Date.now() + ANSWER_WAIT;
    let answer: Mail | undefined;
    while (!answer) {
      if (Date.now() > until) throw new Error("The host didn't answer. Is their world still open to friends?");
      await sleep(GUEST_POLL);
      answer = (await poll(code, id)).find((m) => m.kind === "answer");
    }
    await pc.setRemoteDescription({ type: "answer", sdp: answer.data });
    await new Promise<void>((resolve, reject) => {
      if (channel.readyState === "open") return resolve();
      const timer = setTimeout(() => reject(new Error("Couldn't connect to the host. One of your networks may block direct connections.")), OPEN_WAIT);
      channel.addEventListener("open", () => {
        clearTimeout(timer);
        resolve();
      });
    });
    return new ChannelConnection(channel, pc);
  } catch (e) {
    pc.close();
    throw e;
  }
}
