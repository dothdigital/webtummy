import { flattenWebsiteComponents, type WebsiteModel } from "./websiteModel.js";
import type { WebsiteRenderFile } from "./websiteRenderer.js";

export const WEBSITE_PHP_MAIL_REQUIREMENTS = "Contact email requires PHP 8.2 or newer on the hosting server and working mail delivery. Opening HTML locally or using static-only hosting cannot send email. Upload senuke-contact.php with the website, configure the server's mail service and SENUKE_MAIL_FROM with a verified sender, then submit a test enquiry and check the recipient inbox. If reCAPTCHA is enabled, configure SENUKE_RECAPTCHA_SECRET on the host. Read CONTACT-FORM-SETUP.md in the ZIP for the full instructions.";

export function createWebsitePhpFormFiles(model: WebsiteModel): WebsiteRenderFile[] {
  const forms = model.forms.map(form => ({ id: form.formId, recipient: form.destination || model.identity?.contactEmail || "", fields: form.fields.map(label => ({
    name: label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "field",
    label, required: /name|email|message|details|consent/i.test(label), email: /email/i.test(label),
  })) }));
  for (const component of model.pages.flatMap(page => flattenWebsiteComponents(page.sections))) {
    if (component.componentId !== "conversion.contact_form" || component.props.submissionUrl || component.props.providerEmbedHtml) continue;
    const id = String(component.props.formId || "");
    const saved = forms.find(form => form.id === id);
    const fields = (Array.isArray(component.props.fields) ? component.props.fields : []).flatMap(value => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return [];
      const label = String(value.label || value.title || "Contact detail");
      const name = String(value.name || label.toLowerCase().replace(/[^a-z0-9]+/g, "-"));
      return [{ name, label, required: value.required === true, email: String(value.inputType || value.type).toLowerCase() === "email" || /email/i.test(name) }];
    });
    if (saved) saved.fields = fields;
    else forms.push({ id, recipient: model.identity?.contactEmail || model.forms[0]?.destination || "", fields });
  }
  // Encode approved configuration, never credentials or visitor-controlled recipients.
  const config = Buffer.from(JSON.stringify({ forms, captchaHostname: model.recaptcha?.hostname || "" })).toString("base64");
  const php = String.raw`<?php
declare(strict_types=1);
// Generated contact handler. See CONTACT-FORM-SETUP.md. Keep credentials on the server.
ini_set('display_errors', '0');
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
function respond(int $status, string $message): never {
    http_response_code($status);
    echo json_encode([$status >= 400 ? 'error' : 'message' => $message]);
    exit;
}
set_exception_handler(function (Throwable $error): void { respond(503, 'The enquiry could not be sent. Please contact the business directly.'); });
if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') { header('Allow: POST'); respond(405, 'Please submit the contact form.'); }
if ((int)($_SERVER['CONTENT_LENGTH'] ?? 0) > 32768) respond(413, 'Please shorten your enquiry.');
$raw = file_get_contents('php://input', false, null, 0, 32769);
if ($raw === false || strlen($raw) > 32768) respond(413, 'Please shorten your enquiry.');
$data = str_contains(strtolower($_SERVER['CONTENT_TYPE'] ?? ''), 'application/json') ? json_decode($raw, true) : $_POST;
if (!is_array($data)) respond(400, 'Please check the form and try again.');
if (!empty($data['_senuke_company_website'])) respond(400, 'Please check the form and try again.');
$config = json_decode(base64_decode('${config}'), true, 512, JSON_THROW_ON_ERROR);
$form = null;
foreach ($config['forms'] as $candidate) { if ($candidate['id'] === ($data['_senuke_form_id'] ?? '')) { $form = $candidate; break; } }
if (!$form) respond(400, 'This contact form is unavailable.');
$from = getenv('SENUKE_MAIL_FROM') ?: '';
$to = $form['recipient'];
if (!filter_var($from, FILTER_VALIDATE_EMAIL) || !filter_var($to, FILTER_VALIDATE_EMAIL) || preg_match('/[\r\n]/', $from . $to) || !function_exists('mail')) respond(503, 'Email delivery is not configured. Please contact the business directly.');
$lines = []; $replyTo = '';
foreach ($form['fields'] as $field) {
    $value = $data[$field['name']] ?? '';
    if (!is_scalar($value)) respond(400, 'Please check the form fields.');
    $value = trim((string)$value);
    if ($field['required'] && ($value === '' || $value === '0')) respond(400, 'Please complete all required fields.');
    if (strlen($value) > 5000) respond(400, 'Please shorten your enquiry.');
    if ($field['email'] && $value !== '') {
        if (!filter_var($value, FILTER_VALIDATE_EMAIL) || preg_match('/[\r\n]/', $value)) respond(400, 'Please enter a valid email address.');
        $replyTo = $value;
    }
    $lines[] = $field['label'] . ': ' . $value;
}
// Bounded, per-server rate-limit storage outside the website. No enquiry content is stored.
$bucket = hexdec(substr(hash('sha256', ($_SERVER['REMOTE_ADDR'] ?? 'unknown') . __FILE__), 0, 3));
$rateFile = sys_get_temp_dir() . '/senuke-mail-' . substr(hash('sha256', __FILE__), 0, 16) . '-' . $bucket;
$lock = @fopen($rateFile, 'c+');
if (!$lock || !flock($lock, LOCK_EX)) respond(503, 'The enquiry service is temporarily unavailable.');
$rate = json_decode(stream_get_contents($lock) ?: '{}', true) ?: [];
$now = time();
if (($rate['until'] ?? 0) <= $now) $rate = ['until' => $now + 600, 'count' => 0];
if (($rate['count'] ?? 0) >= 5) { fclose($lock); header('Retry-After: 600'); respond(429, 'Please wait a few minutes before sending another enquiry.'); }
$rate['count']++; rewind($lock); ftruncate($lock, 0);
if (fwrite($lock, json_encode($rate)) === false) { fclose($lock); respond(503, 'The enquiry service is temporarily unavailable.'); }
flock($lock, LOCK_UN); fclose($lock);
if ($config['captchaHostname'] !== '') {
    $secret = getenv('SENUKE_RECAPTCHA_SECRET') ?: '';
    if ($secret === '' || !function_exists('curl_init')) respond(503, 'Spam protection needs to be configured by the website owner.');
    $token = $data['g-recaptcha-response'] ?? '';
    if (!is_string($token) || $token === '' || strlen($token) > 8192) respond(400, 'Please complete the spam protection check.');
    $curl = curl_init('https://www.google.com/recaptcha/api/siteverify');
    curl_setopt_array($curl, [CURLOPT_POST => true, CURLOPT_POSTFIELDS => http_build_query(['secret' => $secret, 'response' => $token]), CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 10]);
    $result = curl_exec($curl); $status = curl_getinfo($curl, CURLINFO_HTTP_CODE); curl_close($curl);
    $check = is_string($result) ? json_decode($result, true) : null;
    $hostname = strtolower((string)($check['hostname'] ?? ''));
    $expected = strtolower($config['captchaHostname']);
    $age = time() - (strtotime($check['challenge_ts'] ?? '') ?: 0);
    if ($status !== 200 || empty($check['success']) || ($hostname !== $expected && !str_ends_with($hostname, '.' . $expected)) || $age < -30 || $age > 120) respond(400, 'Spam protection could not be verified. Please try again.');
}
$headers = ['From' => $from, 'MIME-Version' => '1.0', 'Content-Type' => 'text/plain; charset=UTF-8', 'Content-Transfer-Encoding' => 'base64'];
if ($replyTo !== '') $headers['Reply-To'] = $replyTo;
$body = chunk_split(base64_encode(implode("\r\n\r\n", $lines)));
if (!@mail($to, 'Website enquiry', $body, $headers)) respond(503, 'The enquiry could not be sent. Please try again or contact the business directly.');
respond(200, 'Thank you. Your enquiry has been accepted for email delivery.');
`;
  const readme = `# Contact form email setup\n\n${WEBSITE_PHP_MAIL_REQUIREMENTS}\n\n## Developer setup\n\n1. Upload the complete ZIP contents, keeping folders intact, to an HTTPS host running PHP 8.2 or newer. Ensure .php requests execute PHP; never serve PHP source as text. Local file previews and static-only hosts cannot run this handler.\n2. Check the receiving address in Foundation → Business Details before approving and exporting. This package uses the approved form recipients. Provider embeds and forms with their own submission URL retain their existing provider setup.\n3. Ask the host to configure mail delivery for PHP mail(), using its mail service or authenticated SMTP relay. PHP alone is not enough. This handler does not log in to an SMTP provider itself; if your host only offers SMTP credentials, your developer must configure the server relay or replace the mail transport with an SMTP library.\n4. In the hosting control panel or PHP-FPM/server environment, set SENUKE_MAIL_FROM to a verified sender on your domain, such as website@example.com. Configure the provider's SPF/DKIM DNS records. Keep the visitor address as Reply-To, never From. Ensure environment variables reach the PHP process.\n5. If reCAPTCHA is enabled, enable PHP cURL and set SENUKE_RECAPTCHA_SECRET to the matching private secret on the host. Register the live domain at https://www.google.com/recaptcha/admin/create . Secrets are deliberately excluded from the ZIP. Do not put them in HTML, JavaScript or public text files.\n6. Allow PHP to write to its temporary directory for the rate limiter (five attempts per ten minutes per address bucket). Behind a proxy, configure the server's trusted client IP handling. Multiple servers also need shared edge rate limiting.\n7. Submit an enquiry from the live Contact Us page. Confirm it reaches the intended inbox, check spam and the hosting mail logs, and confirm Reply works. An accepted response means the mail service accepted the message, not guaranteed inbox delivery. Errors must be resolved before launch.\n\nReference: https://www.php.net/manual/en/function.mail.php\n`;
  return [{ path: "senuke-contact.php", content: php, mimeType: "application/x-httpd-php" }, { path: "CONTACT-FORM-SETUP.md", content: readme, mimeType: "text/markdown" }];
}
