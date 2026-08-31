import { describe, expect, it } from "vitest";
import { discoveryBusinessLocation, discoveryTargetMarkets, latestExplicitConversationTargetMarkets, sameGeographicTargetMarkets } from "./discovery-target-markets.js";

describe("Discovery target markets", () => {
  it("keeps explicit AI-structured markets", () => {
    expect(discoveryTargetMarkets({ understanding: { targetMarkets: ["Edmonton", "Calgary", "edmonton"] } })).toEqual(["Edmonton", "Calgary"]);
  });

  it("recovers labelled markets from an older Discovery Draft", () => {
    expect(discoveryTargetMarkets({ answers: { main: "Services offered: Life insurance. We serve Edmonton and Calgary. Target audience: Alberta families." } })).toEqual(["Edmonton", "Calgary"]);
    expect(discoveryTargetMarkets({ sourceText: "Location: Edmonton and Calgary, but able to serve clients online." })).toEqual([]);
    expect(discoveryTargetMarkets({ sourceText: "Target locations: Edmonton and Calgary." })).toEqual(["Edmonton", "Calgary"]);
  });

  it("uses only confirmed geographic facts and ignores audience prose", () => {
    expect(discoveryTargetMarkets({
      facts: [
        { key: "target_markets", value: ["Edmonton", "Calgary"], state: "CONFIRMED", source: "USER_INPUT" },
        { key: "target_audience", value: "Alberta families", state: "CONFIRMED", source: "USER_INPUT" },
        { key: "target_markets", value: ["Mississauga"], state: "AI_SUGGESTED", source: "AI_INFERENCE" },
      ],
    })).toEqual(["Edmonton", "Calgary"]);
  });

  it("preserves a confirmed physical business location without treating it as a target market", () => {
    const facts = [{ key: "businessLocation", value: "Vaughan, Ontario", state: "CONFIRMED", source: "USER_INPUT" }];
    expect(discoveryBusinessLocation({ facts })).toBe("Vaughan, Ontario");
    expect(discoveryTargetMarkets({ facts })).toEqual([]);
  });

  it("uses the latest explicitly labelled market from a conversation", () => {
    expect(latestExplicitConversationTargetMarkets([
      { role: "user", text: "Target markets: Mississauga" },
      { role: "assistant", text: "Which locations should this project target?" },
      { role: "user", text: "Correction. We serve Edmonton and Calgary." },
    ])).toEqual(["Edmonton", "Calgary"]);
  });

  it("compares normalized market sets without depending on order or casing", () => {
    expect(sameGeographicTargetMarkets(["Calgary", "Edmonton"], ["edmonton", "calgary"])).toBe(true);
    expect(sameGeographicTargetMarkets(["Mississauga"], ["Edmonton", "Calgary"])).toBe(false);
  });
});
