import express from "express";
import { afterEach, describe, expect, it } from "vitest";
import { changeIntelligenceRouter } from "./change-intelligence.js";

const servers: Array<ReturnType<ReturnType<typeof express>["listen"]>> = [];
afterEach(() => servers.splice(0).forEach((server) => server.close()));

describe("change intelligence route isolation", () => {
  it("does not intercept a customer workspace route mounted after the admin router", async () => {
    const app = express();
    app.use("/api", changeIntelligenceRouter);
    app.get("/api/workspace", (_req, res) => res.json({ ok: true }));
    const server = app.listen(0);
    servers.push(server);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Test server did not bind to a port.");

    const response = await fetch(`http://127.0.0.1:${address.port}/api/workspace`);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
  });
});
