import { describe, expect, it } from "vitest";
import { decodeImageDataUrl } from "./generated-assets.js";

describe("decodeImageDataUrl", () => {
  it("accepts bytes matching the declared image type", () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
    expect(decodeImageDataUrl(`data:image/png;base64,${png.toString("base64")}`).body).toEqual(png);
  });

  it("rejects non-image bytes disguised as an image", () => {
    const payload = Buffer.from("<script>alert(1)</script>");
    expect(() => decodeImageDataUrl(`data:image/png;base64,${payload.toString("base64")}`)).toThrow(/do not match/);
  });
});
