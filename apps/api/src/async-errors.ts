import { createRequire } from "node:module";

// Express 4 does not forward rejected promises from async route handlers to the
// central error middleware. Patch its router layer once at startup so every API
// route returns a controlled JSON error instead of terminating the Node process.
const require = createRequire(import.meta.url);
const Layer = require("express/lib/router/layer") as {
  prototype: { handle_request: (req: unknown, res: unknown, next: (error?: unknown) => void) => void; handle: (...args: unknown[]) => unknown };
};

Layer.prototype.handle_request = function handleRequest(req: unknown, res: unknown, next: (error?: unknown) => void) {
  const handler = this.handle;
  if (handler.length > 3) return next();
  try {
    const result = handler(req, res, next);
    if (result && typeof (result as Promise<unknown>).catch === "function") (result as Promise<unknown>).catch(next);
  } catch (error) {
    next(error);
  }
};
