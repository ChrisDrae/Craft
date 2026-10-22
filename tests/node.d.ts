// The one Node API the tests use (reading fixtures), without pulling in all of @types/node
declare module "node:fs" {
  export function readFileSync(path: URL | string): Uint8Array;
}
