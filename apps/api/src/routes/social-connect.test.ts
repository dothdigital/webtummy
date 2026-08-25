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

  it("deduplicates repeated OAuth rows and keeps the newest connected account", () => {
    const accounts = accountsForExternalUser({ accounts: [
      { id: "old", account_id: "page-1", external_user_id: "user-1", platform: "facebook", status: "connected", updated_at: "2026-01-01T00:00:00.000Z" },
      { id: "new", account_id: "page-1", external_user_id: "user-1", platform: "facebook", status: "connected", updated_at: "2026-08-01T00:00:00.000Z" },
      { id: "expired", account_id: "page-1", external_user_id: "user-1", platform: "facebook", status: "expired", updated_at: "2026-08-02T00:00:00.000Z" },
    ] }, "user-1");
    expect(accounts).toHaveLength(1);
    expect(accounts[0].id).toBe("new");
  });
});
