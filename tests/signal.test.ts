import { describe, expect, it } from "vitest";
import { MemoryStore, handleSignal, storeFromEnv, UpstashStore } from "../api/_signal.js";

const post = (store: MemoryStore, body: unknown): Promise<Response> => handleSignal(new Request("http://x/api/signal", { method: "POST", body: JSON.stringify(body) }), store);
const poll = async (store: MemoryStore, room: string, peer: string): Promise<{ messages: Array<{ from: string; kind: string; data: string }> }> =>
  (await handleSignal(new Request(`http://x/api/signal?room=${room}&peer=${peer}`), store)).json();

describe("signaling", () => {
  it("passes an offer to the host of an open world and the answer back", async () => {
    let now = 0;
    const store = new MemoryStore(() => now);
    // Nobody hosts ABC234 yet
    expect((await post(store, { room: "ABC234", from: "guest-1", to: "host", kind: "offer", data: "v=0 offer" })).status).toBe(404);
    // The host's polling opens it
    expect((await poll(store, "ABC234", "host")).messages).toEqual([]);
    expect((await post(store, { room: "ABC234", from: "guest-1", to: "host", kind: "offer", data: "v=0 offer" })).status).toBe(200);
    expect((await poll(store, "ABC234", "host")).messages).toEqual([{ from: "guest-1", kind: "offer", data: "v=0 offer" }]);
    // Taken once
    expect((await poll(store, "ABC234", "host")).messages).toEqual([]);
    await post(store, { room: "ABC234", from: "host", to: "guest-1", kind: "answer", data: "v=0 answer" });
    expect((await poll(store, "ABC234", "guest-1")).messages).toEqual([{ from: "host", kind: "answer", data: "v=0 answer" }]);
    // A host that stops polling closes its world
    now += 60_000;
    expect((await post(store, { room: "ABC234", from: "guest-2", to: "host", kind: "offer", data: "v=0" })).status).toBe(404);
  });

  it("turns away anything malformed", async () => {
    const store = new MemoryStore();
    await poll(store, "ABC234", "host");
    for (const bad of [
      { room: "abc", from: "guest-1", to: "host", kind: "offer", data: "x" },
      { room: "ABC234", from: "Guest One", to: "host", kind: "offer", data: "x" },
      { room: "ABC234", from: "guest-1", to: "host", kind: "chat", data: "x" },
      { room: "ABC234", from: "guest-1", to: "host", kind: "offer", data: 5 },
    ]) {
      expect((await post(store, bad)).status).toBe(400);
    }
    expect((await post(store, { room: "ABC234", from: "guest-1", to: "host", kind: "offer", data: "x".repeat(40000) })).status).toBe(413);
    expect((await handleSignal(new Request("http://x/api/signal", { method: "PUT" }), store)).status).toBe(405);
  });

  it("keeps mailboxes in Upstash where it is set up, in memory otherwise", () => {
    expect(storeFromEnv({})).toBeInstanceOf(MemoryStore);
    expect(storeFromEnv({ KV_REST_API_URL: "https://x.upstash.io", KV_REST_API_TOKEN: "t" })).toBeInstanceOf(UpstashStore);
    expect(storeFromEnv({ UPSTASH_REDIS_REST_URL: "https://x.upstash.io", UPSTASH_REDIS_REST_TOKEN: "t" })).toBeInstanceOf(UpstashStore);
  });
});
