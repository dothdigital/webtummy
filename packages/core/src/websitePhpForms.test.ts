import { afterEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWebsitePhpFormFiles } from "./websitePhpForms.js";
import type { WebsiteModel } from "./websiteModel.js";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const model = { pages: [], forms: [{ formId: "contact", destination: "owner@example.com", fields: ["Name", "Email", "Message"] }] } as unknown as WebsiteModel;
const valid = { _senuke_form_id: "contact", name: "Test visitor", email: "visitor@example.org", message: "Please call me." };
function fixture(source = model, mailSucceeds = true) {
  const dir = mkdtempSync(join(tmpdir(), "senuke-php-test-")); dirs.push(dir);
  const handler = join(dir, "senuke-contact.php"), capture = join(dir, "mail.txt"), transport = join(dir, "sendmail");
  writeFileSync(handler, createWebsitePhpFormFiles(source)[0].content);
  // Local capture only: this transport never connects to an email server.
  writeFileSync(transport, `#!/bin/sh\ncat > '${capture}'\nexit ${mailSucceeds ? 0 : 1}\n`, { mode: 0o700 });
  function submit(data: unknown = valid, method = "POST", from = "website@example.com") {
    const body = Buffer.from(JSON.stringify(data)).toString("base64");
    const script = `$_SERVER['REQUEST_METHOD']='${method}'; $_POST=json_decode(base64_decode('${body}'),true); register_shutdown_function(function(){echo "\\nSTATUS=".http_response_code();}); include '${handler}';`;
    return execFileSync("php", ["-d", `sendmail_path=${transport}`, "-d", `sys_temp_dir=${dir}`, "-r", script], { encoding: "utf8", env: { ...process.env, SENUKE_MAIL_FROM: from, SENUKE_RECAPTCHA_SECRET: "" } });
  }
  return { handler, capture, submit };
}
describe("downloaded PHP enquiry delivery", () => {
  it("generates valid PHP and delivers only to the approved recipient with a safe reply address", () => {
    const f = fixture();
    expect(execFileSync("php", ["-l", f.handler], { encoding: "utf8" })).toContain("No syntax errors");
    expect(f.submit({ ...valid, to: "attacker@example.org" })).toContain("STATUS=200");
    const mail = readFileSync(f.capture, "utf8");
    expect(mail).toContain("To: owner@example.com");
    expect(mail).toContain("From: website@example.com");
    expect(mail).toContain("Reply-To: visitor@example.org");
    expect(mail).not.toContain("attacker@example.org");
  });
  it("rejects missing fields, invalid email, forged form IDs, spam and non-POST requests", () => {
    const f = fixture();
    for (const data of [{ ...valid, name: "" }, { ...valid, email: "a@example.org\r\nBcc: bad@example.org" }, { ...valid, _senuke_form_id: "other" }, { ...valid, _senuke_company_website: "spam" }, { ...valid, message: ["array"] }]) expect(f.submit(data)).toContain("STATUS=400");
    expect(f.submit(valid, "GET")).toContain("STATUS=405");
  });
  it("reports missing sender configuration and rejected mail as failures", () => {
    expect(fixture().submit(valid, "POST", "")).toContain("STATUS=503");
    expect(fixture(model, false).submit()).toContain("STATUS=503");
  });
  it("limits repeated attempts", () => {
    const f = fixture();
    for (let index = 0; index < 5; index++) expect(f.submit()).toContain("STATUS=200");
    expect(f.submit()).toContain("STATUS=429");
  });
  it("fails closed when the host has no reCAPTCHA secret", () => {
    expect(fixture({ ...model, recaptcha: { credentialId: "private-reference", siteKey: "public-key", hostname: "example.com" } }).submit()).toContain("STATUS=503");
    const files = createWebsitePhpFormFiles(model);
    expect(files[1].content).toContain("SENUKE_MAIL_FROM");
    expect(files[1].content).toContain("static-only hosts");
  });
});
