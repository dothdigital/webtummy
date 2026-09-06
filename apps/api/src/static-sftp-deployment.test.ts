import { describe, expect, it } from "vitest";
import {
  staticRemotePath,
  staticRenderFileBuffer,
} from "./static-sftp-deployment.js";

describe("static SFTP deployment packaging", () => {
  it("keeps pages and assets under the configured hosting path", () => {
    expect(staticRemotePath("/public_html", "index.html")).toBe("/public_html/index.html");
    expect(staticRemotePath("/public_html", "assets/media/hero.webp")).toBe("/public_html/assets/media/hero.webp");
    expect(staticRemotePath("/", "services/example/index.html")).toBe("/services/example/index.html");
  });

  it("rejects paths that could escape the hosting root", () => {
    expect(() => staticRemotePath("/public_html", "../outside.txt")).toThrow("Unsafe static deployment path");
  });

  it("decodes packaged media and preserves text output", () => {
    expect(staticRenderFileBuffer({ path: "index.html", content: "<h1>Hello</h1>", mimeType: "text/html" }).toString()).toBe("<h1>Hello</h1>");
    expect(staticRenderFileBuffer({ path: "assets/media/pixel.png", content: "aGVsbG8=", mimeType: "image/png", base64: true }).toString()).toBe("hello");
  });
});
