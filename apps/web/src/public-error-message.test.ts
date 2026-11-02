import { describe, expect, it } from "vitest";
import { publicErrorMessage } from "./public-error-message.js";
describe("public service errors", () => {
  it("replaces provider server errors and support instructions with a calm action", () => {
    const message = publicErrorMessage("The server had an error while processing your request. Sorry about that! You can retry your request, or contact us through our help center at help.openai.com if the error persists. (Please include the request ID req_21b8019a045045d1afb4bd7cb3bf020f in your message.)");
    expect(message).toBe("The generation service could not finish this request. Please try again in a moment.");
  });
  it("preserves actionable validation errors", () => {
    expect(publicErrorMessage("Approve the page content before generating images.")).toBe("Approve the page content before generating images.");
  });
  it("provides a fallback without a server message", () => {
    expect(publicErrorMessage(null, "Please retry the remaining images.")).toBe("Please retry the remaining images.");
  });
});
