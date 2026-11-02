function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function synchronizeFoundationEnquiryRecipient(settings: Record<string, unknown>) {
  const contact = record(settings.contactDetails);
  const enabled = contact.receiveEnquiries !== false;
  const email = String(contact.email || "").trim();
  const savedForms = Array.isArray(settings.forms) ? settings.forms.map(record) : [];
  if (!savedForms.length && !enabled) return settings;
  const forms = savedForms.length ? savedForms : [{ key: "primary-contact", name: "Website enquiry", type: "lead", fields: ["Name", "Email", "Phone", "Message", "Consent"], submitLabel: "Send enquiry" }];
  return { ...settings, contactDetails: { ...contact, receiveEnquiries: enabled }, forms: forms.map(form => {
    const followsFoundation = form.destinationSource === "foundation_email";
    if (enabled && (followsFoundation || !String(form.destination || "").trim())) {
      return { ...form, destination: email, destinationSource: "foundation_email" };
    }
    if (!enabled && followsFoundation) return { ...form, destination: "", destinationSource: null };
    return form;
  }) };
}
