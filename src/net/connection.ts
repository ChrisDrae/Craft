/**
 * A link between host and guest that carries frames in order (a WebRTC data channel, or a pair in memory
 * for tests).
 */
export interface Connection {
  send(frame: Uint8Array): void;
  /** Bytes sent but not yet on their way: the sender holds back while this is high. */
  readonly buffered: number;
  readonly open: boolean;
  onMessage: ((frame: Uint8Array) => void) | null;
  /** Called once, when either end closes or the link breaks. */
  onClose: (() => void) | null;
  close(): void;
}

/** One end of a pair in memory: frames arrive at the other end a moment later, in order. */
class MemoryEnd implements Connection {
  other: MemoryEnd | null = null;
  open: boolean = true;
  onMessage: ((frame: Uint8Array) => void) | null = null;
  onClose: (() => void) | null = null;
  /** Frames on their way, delivered from a timer as a network would. */
  private readonly inbox: Uint8Array[] = [];
  private scheduled: boolean = false;
  /** Bytes sent: everything counts as on its way at once. */
  readonly buffered: number = 0;

  send(frame: Uint8Array): void {
    const to = this.other;
    if (!this.open || !to || !to.open) return;
    // A copy, as a real link would deliver
    to.inbox.push(frame.slice());
    to.schedule();
  }

  private schedule(): void {
    if (this.scheduled) return;
    this.scheduled = true;
    setTimeout(() => {
      this.scheduled = false;
      // Taken out first: with nobody listening yet the frame is dropped, not delivered forever
      while (this.open && this.inbox.length > 0) {
        const frame = this.inbox.shift()!;
        this.onMessage?.(frame);
      }
    }, 0);
  }

  close(): void {
    if (!this.open) return;
    this.open = false;
    this.onClose?.();
    this.other?.close();
  }
}

/** Two connected ends in memory, for tests. */
export function memoryPair(): [Connection, Connection] {
  const a = new MemoryEnd();
  const b = new MemoryEnd();
  a.other = b;
  b.other = a;
  return [a, b];
}

/** A WebRTC data channel as a connection. */
export class ChannelConnection implements Connection {
  onMessage: ((frame: Uint8Array) => void) | null = null;
  onClose: (() => void) | null = null;
  private closed: boolean = false;

  constructor(
    private readonly channel: RTCDataChannel,
    /** Closed along with the channel. */
    private readonly peer: RTCPeerConnection | null = null,
  ) {
    channel.binaryType = "arraybuffer";
    channel.onmessage = (e) => this.onMessage?.(new Uint8Array(e.data as ArrayBuffer));
    channel.onclose = () => this.finish();
    peer?.addEventListener("connectionstatechange", () => {
      if (peer.connectionState === "failed" || peer.connectionState === "closed") this.finish();
    });
  }

  get open(): boolean {
    return !this.closed && this.channel.readyState === "open";
  }

  get buffered(): number {
    return this.channel.bufferedAmount;
  }

  send(frame: Uint8Array): void {
    if (this.open) this.channel.send(frame as Uint8Array<ArrayBuffer>);
  }

  close(): void {
    this.channel.close();
    this.peer?.close();
    this.finish();
  }

  private finish(): void {
    if (this.closed) return;
    this.closed = true;
    this.onClose?.();
  }
}
