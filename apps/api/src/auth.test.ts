import { describe, expect, it } from "vitest";
import { clearSessionCookie, sessionCookie, sessionTokenFromCookie } from "./auth.js";

describe("browser session cookies", () => {
  it("uses an HttpOnly same-site API cookie", () => {
    const value = sessionCookie("signed.jwt.value");
    expect(value).toContain("senuke_session=signed.jwt.value");
    expect(value).toContain("Path=/api");
    expect(value).toContain("HttpOnly");
    expect(value).toContain("SameSite=Lax");
  });

  it("reads only the named session cookie", () => {
    expect(sessionTokenFromCookie("theme=dark; senuke_session=abc%2Edef; other=1")).toBe("abc.def");
    expect(sessionTokenFromCookie("theme=dark")).toBeNull();
  });

  it("expires the session cookie on logout", () => {
    expect(clearSessionCookie()).toContain("Max-Age=0");
  });
});
