import { expect, it } from "vitest";
import { uniqueSavedBacklinks } from "./saved-backlink-list.js";
it("keeps newest observations, older unique links, and different targets", () => {
  const rows = [{ sourceUrl: "https://source/a", targetUrl: "https://owned/", id: "new" }, { sourceUrl: "https://source/a", targetUrl: "https://competitor/", id: "competitor" }, { sourceUrl: "https://source/a", targetUrl: "https://owned/", id: "old" }, { sourceUrl: "https://source/b", targetUrl: "https://owned/", id: "older-unique" }];
  expect(uniqueSavedBacklinks(rows).map(row => row.id)).toEqual(["new", "competitor", "older-unique"]);
});
it("does not truncate saved results at 50 or 100", () => {
  const rows = Array.from({ length: 400 }, (_, n) => ({ sourceUrl: `https://source/${n}`, targetUrl: "https://target/" }));
  expect(uniqueSavedBacklinks(rows)).toHaveLength(400);
});
