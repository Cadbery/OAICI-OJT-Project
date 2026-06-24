import {
  randomBytes,
  scryptSync,
} from "node:crypto";
import {
  existsSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";

const email = process.argv[2]?.trim().toLowerCase();
const password = process.argv[3] || "";

if (!email || !email.includes("@") || password.length < 8) {
  console.error(
    'Usage: npm run auth:create-user -- "you@example.com" "password-at-least-8-characters"',
  );
  process.exit(1);
}

const envPath = resolve(process.cwd(), ".env.local");
const existingEnv = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
const salt = randomBytes(16).toString("base64url");
const passwordHash = scryptSync(password, salt, 64).toString("base64url");
const sessionSecret = randomBytes(48).toString("base64url");

const newValues = {
  AUTH_EMAIL: email,
  AUTH_PASSWORD_HASH: `scrypt:${salt}:${passwordHash}`,
  AUTH_SECRET: sessionSecret,
};

function setEnvironmentValue(source, key, value) {
  const line = `${key}=${value}`;
  const matcher = new RegExp(`^${key}=.*$`, "m");

  if (matcher.test(source)) {
    return source.replace(matcher, line);
  }

  const separator = source.length === 0 || source.endsWith("\n") ? "" : "\n";

  return `${source}${separator}${line}\n`;
}

const updatedEnv = Object.entries(newValues).reduce(
  (source, [key, value]) => setEnvironmentValue(source, key, value),
  existingEnv,
);

writeFileSync(envPath, updatedEnv, "utf8");

console.log(`Local login account created for ${email}.`);
console.log("Restart the Next.js development server before signing in.");
