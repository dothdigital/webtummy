import { randomBytes } from "node:crypto";

export const GENERIC_SYSTEM_ERROR = "We could not complete this request. Please try again. If the problem continues, send the error code below to support.";

export function createApiErrorCode(now = new Date()) {
  const day = now.toISOString().slice(0, 10).replace(/-/g, "");
  return `SEN-${day}-${randomBytes(4).toString("hex").toUpperCase()}`;
}

export function isGenericInternalError(value: unknown) {
  return typeof value === "string" && /^internal server error\.?$/i.test(value.trim());
}

export function systemErrorPayload(body: unknown, errorCode: string, supportEmail: string, preservePublicMessage = false) {
  const source = body && typeof body === "object" && !Array.isArray(body)
    ? body as Record<string, unknown>
    : { error: body };
  return {
    error: preservePublicMessage && typeof source.error === "string" && !isGenericInternalError(source.error)
      ? source.error
      : GENERIC_SYSTEM_ERROR,
    errorCode,
    supportEmail,
  };
}
