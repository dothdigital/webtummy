import express from "express";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Server } from "node:http";

vi.mock("../config.js", () => ({ config: { redisUrl: "redis://127.0.0.1:1" }, JVZOO_PROCESSING_QUEUE: "audit-unused" }));
vi.mock("ioredis", () => ({ default: class { status = "wait"; on() {} async connect() { throw new Error("offline"); } } }));
vi.mock("../commercial-service.js", () => ({ processStoredJvZooEvent: vi.fn(), reconcileJvZooLifecycle: vi.fn() }));
vi.mock("../jvzoo-activation.js", () => ({ activateJvZooPurchase: vi.fn(async () => ({ activated: true })), inspectJvZooActivation: vi.fn(async () => null), requestJvZooActivation: vi.fn() }));
vi.mock("../queue.js", () => ({ jvZooProcessingQueue: {}, queueConnection: {} }));
vi.mock("../jvzoo-intake.js", () => ({ acceptJvZooWebhook: vi.fn() }));
import { jvZooRouter } from "./jvzoo.js";
import { activateJvZooPurchase, inspectJvZooActivation } from "../jvzoo-activation.js";

let server: Server;
let base: string;
beforeAll(async () => {
  const app = express(); app.use(express.json()); app.use(jvZooRouter);
  server = await new Promise<Server>((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(() => new Promise<void>((resolve, reject) => { server.closeAllConnections(); server.close(e => e ? reject(e) : resolve()); }));
async function post(path: string, body: unknown) {
  const response = await fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { status: response.status, retryAfter: response.headers.get("retry-after"), body: await response.json() };
}
describe("public activation abuse protection", () => {
  it("rejects oversized and object tokens before token lookup", async () => {
    for (const token of ["a".repeat(257), { $ne: null }]) expect((await post("/activation/inspect", { token })).status).toBe(400);
    expect(inspectJvZooActivation).not.toHaveBeenCalled();
  });
  it("limits password verification attempts even while Redis is unavailable", async () => {
    const body = { token: "audit-token-".repeat(4), name: "Audit", password: "test-password" };
    for (let i = 0; i < 20; i++) expect((await post("/activation/complete", body)).status).toBe(200);
    const blocked = await post("/activation/complete", body);
    expect(blocked.status).toBe(429);
    expect(Number(blocked.retryAfter)).toBeGreaterThan(0);
    expect(activateJvZooPurchase).toHaveBeenCalledTimes(20);
    // Rotating a token cannot bypass the IP bucket.
    expect((await post("/activation/complete", { ...body, token: "different-token-".repeat(4) })).status).toBe(429);
  });
});
