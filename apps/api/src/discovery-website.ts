export function normalizeDiscoveryWebsiteUrl(input: string) {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(candidate);
    if (!["http:", "https:"].includes(url.protocol) || !url.hostname || url.username || url.password) return null;
    const hostname = url.hostname.toLowerCase();
    return { domain: hostname, rootUrl: `${url.protocol}//${hostname}${url.port ? `:${url.port}` : ""}` };
  } catch {
    return null;
  }
}
