import { NextResponse } from "next/server";
import {
  AUTH_COOKIE_NAME,
  AUTH_SESSION_DURATION_SECONDS,
  createSessionToken,
  isAuthConfigured,
  verifyCredentials,
} from "@/lib/auth";

type LoginRequest = {
  email?: unknown;
  password?: unknown;
};

export async function POST(request: Request) {
  if (!isAuthConfigured()) {
    return NextResponse.json(
      {
        error:
          "Login is not configured yet. Create the local account before signing in.",
      },
      { status: 503 },
    );
  }

  let credentials: LoginRequest;

  try {
    credentials = (await request.json()) as LoginRequest;
  } catch {
    return NextResponse.json(
      { error: "Enter a valid email and password." },
      { status: 400 },
    );
  }

  const email =
    typeof credentials.email === "string" ? credentials.email.trim() : "";
  const password =
    typeof credentials.password === "string" ? credentials.password : "";

  if (!email || !password) {
    return NextResponse.json(
      { error: "Email and password are required." },
      { status: 400 },
    );
  }

  if (!verifyCredentials(email, password)) {
    await new Promise((resolve) => setTimeout(resolve, 350));

    return NextResponse.json(
      { error: "The email or password is incorrect." },
      { status: 401 },
    );
  }

  const response = NextResponse.json({ success: true });

  response.cookies.set({
    name: AUTH_COOKIE_NAME,
    value: createSessionToken(email),
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: AUTH_SESSION_DURATION_SECONDS,
    priority: "high",
  });

  return response;
}
