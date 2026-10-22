// Vercel function: WebRTC introductions for multiplayer (see _signal.ts)
import { handleSignal, storeFromEnv } from "./_signal.js";

const store = storeFromEnv();

export function GET(request: Request): Promise<Response> {
  return handleSignal(request, store);
}

export function POST(request: Request): Promise<Response> {
  return handleSignal(request, store);
}
