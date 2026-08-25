import { describe, expect, it } from "vitest";
import { accountsForExternalUser } from "./social-connect.js";

describe("accountsForExternalUser", () => {
  it("returns only accounts owned by the signed-in external user", () => {
    const payload = {
      accounts: [
        { id: "a", external_user_id: "user-1", platform: "facebook" },
        { id: "b", external_user_id: "user-2", platform: "instagram" },
        { id: "c", external_user_id: "user-1", platform: "instagram" },
      ],
    };
    expect(accountsForExternalUser(payload, "user-1").map((account) => account.id)).toEqual(["a", "c"]);
  });

  it("does not expose malformed or unowned account records", () => {
    expect(accountsForExternalUser({ accounts: [null, "bad", { id: "a" }] }, "user-1")).toEqual([]);
    expect(accountsForExternalUser(null, "user-1")).toEqual([]);
  });
});
