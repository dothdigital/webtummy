export function DownloadEmailSetupInstructions() {
  return <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-slate-700">
    <strong className="text-amber-950">Make contact emails work after upload</strong>
    <p>The ZIP includes a PHP contact handler. Email works only on PHP hosting with working mail delivery; opening the HTML on your computer or using static-only hosting cannot send email.</p>
    <p>Your developer must upload all files, configure the hosting mail service and verified sender, and test an enquiry. If enabled, reCAPTCHA also needs its secret on the host. Full steps are in <strong>CONTACT-FORM-SETUP.md</strong> inside the ZIP and in the handoff email.</p>
  </div>;
}

export function WordPressMailSetupInstructions() {
  return <details className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
    <summary className="cursor-pointer text-sm font-bold text-amber-950">Set up contact form emails · SMTP instructions</summary>
    <p className="mt-2 text-xs leading-5 text-slate-700">Connecting WordPress lets SEnuke publish your website. You also need working WordPress email delivery to receive Contact Us enquiries.</p>
    <ol className="mt-2 list-decimal space-y-2 pl-5 text-xs leading-5 text-slate-700">
      <li>In WordPress, open <strong>Plugins → Add New Plugin</strong> and install an SMTP or email delivery plugin supported by your email provider.</li>
      <li>Open that plugin’s settings. Connect your provider, or enter the SMTP host, port, encryption and credentials supplied by your hosting or email provider.</li>
      <li>Set the From email to a verified address on your domain. Add the provider’s SPF and DKIM records in your domain’s DNS settings. Use the visitor’s email as Reply-To where your form supports it.</li>
      <li>Send the plugin’s test email and check the receiving inbox and spam folder. Then submit the live Contact Us form and confirm the enquiry reaches the address saved in Foundation → Business Details.</li>
    </ol>
    <p className="mt-2 text-xs leading-5 text-slate-700">The WordPress Application Password below is for publishing. Enter SMTP credentials only in your WordPress email plugin, using your provider’s instructions.</p>
    <a href="https://developer.wordpress.org/advanced-administration/server/mail/" target="_blank" rel="noopener noreferrer" className="mt-2 inline-block text-xs font-bold text-indigo-700 underline">WordPress email setup guide ↗</a>
  </details>;
}
