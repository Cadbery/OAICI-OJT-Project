import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  AUTH_COOKIE_NAME,
  verifySessionToken,
} from "@/lib/auth";

const PUBLIC_PATHS = new Set([
  "/login",
  "/api/auth/login",
  "/api/auth/logout",
]);

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const session = verifySessionToken(
    request.cookies.get(AUTH_COOKIE_NAME)?.value,
  );

  if (pathname === "/login") {
    return session
      ? NextResponse.redirect(new URL("/", request.url))
      : NextResponse.next();
  }

  if (PUBLIC_PATHS.has(pathname)) {
    return NextResponse.next();
  }

  if (session) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json(
      { error: "Authentication required." },
      { status: 401 },
    );
  }

  const loginUrl = new URL("/login", request.url);
  const destination = `${pathname}${search}`;

  if (destination !== "/") {
    loginUrl.searchParams.set("next", destination);
  }

  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: [
    "/((?!_next|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
