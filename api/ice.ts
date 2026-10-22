// Vercel function: STUN and TURN servers for multiplayer connections (see _signal.ts)
import { handleIce } from "./_signal.js";

export function GET(): Promise<Response> {
  return handleIce();
}
