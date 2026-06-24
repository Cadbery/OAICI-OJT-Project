import {
  createHmac,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";

export const AUTH_COOKIE_NAME = "walter_session";
export const AUTH_SESSION_DURATION_SECONDS = 60 * 60 * 24 * 7;

type SessionPayload = {
  email: string;
  expiresAt: number;
};

function getConfiguredEmail() {
  return process.env.AUTH_EMAIL?.trim().toLowerCase() || "";
}

function getSessionSecret() {
  return process.env.AUTH_SECRET?.trim() || "";
}

function safelyCompare(firstValue: string, secondValue: string) {
  const firstBuffer = Buffer.from(firstValue);
  const secondBuffer = Buffer.from(secondValue);

  if (firstBuffer.length !== secondBuffer.length) return false;

  return timingSafeEqual(firstBuffer, secondBuffer);
}

function signSessionPayload(encodedPayload: string) {
  const secret = getSessionSecret();

  if (!secret) return "";

  return createHmac("sha256", secret)
    .update(encodedPayload)
    .digest("base64url");
}

export function isAuthConfigured() {
  return Boolean(
    getConfiguredEmail() &&
      process.env.AUTH_PASSWORD_HASH?.trim() &&
      getSessionSecret(),
  );
}

export function verifyCredentials(email: string, password: string) {
  const configuredEmail = getConfiguredEmail();
  const storedPasswordHash = process.env.AUTH_PASSWORD_HASH?.trim() || "";

  if (!configuredEmail || !storedPasswordHash || !password) return false;
  if (!safelyCompare(email.trim().toLowerCase(), configuredEmail)) return false;

  const separator = storedPasswordHash.startsWith("scrypt:")
    ? ":"
    : "$";
  const [algorithm, salt, expectedHash] =
    storedPasswordHash.split(separator);

  if (algorithm !== "scrypt" || !salt || !expectedHash) return false;

  try {
    const calculatedHash = scryptSync(password, salt, 64).toString("base64url");

    return safelyCompare(calculatedHash, expectedHash);
  } catch {
    return false;
  }
}

export function createSessionToken(email: string) {
  if (!isAuthConfigured()) {
    throw new Error("Authentication is not configured.");
  }

  const payload: SessionPayload = {
    email: email.trim().toLowerCase(),
    expiresAt: Date.now() + AUTH_SESSION_DURATION_SECONDS * 1000,
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString(
    "base64url",
  );
  const signature = signSessionPayload(encodedPayload);

  return `${encodedPayload}.${signature}`;
}

export function verifySessionToken(token: string | undefined) {
  if (!token || !isAuthConfigured()) return null;

  const [encodedPayload, suppliedSignature, ...unexpectedParts] =
    token.split(".");

  if (
    !encodedPayload ||
    !suppliedSignature ||
    unexpectedParts.length > 0
  ) {
    return null;
  }

  const expectedSignature = signSessionPayload(encodedPayload);

  if (
    !expectedSignature ||
    !safelyCompare(suppliedSignature, expectedSignature)
  ) {
    return null;
  }

  try {
    const payload = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8"),
    ) as Partial<SessionPayload>;

    if (
      typeof payload.email !== "string" ||
      typeof payload.expiresAt !== "number" ||
      payload.expiresAt <= Date.now() ||
      !safelyCompare(payload.email, getConfiguredEmail())
    ) {
      return null;
    }

    return payload as SessionPayload;
  } catch {
    return null;
  }
}
