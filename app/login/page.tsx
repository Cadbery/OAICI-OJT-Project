import type { Metadata } from "next";
import LoginPageClient from "@/components/LoginPageClient";

export const metadata: Metadata = {
  title: "Sign in | Walter AI",
  description: "Sign in to the Walter AI learning workspace.",
};

type LoginPageProps = {
  searchParams: Promise<{
    next?: string | string[];
  }>;
};

function getSafeNextPath(nextValue: string | string[] | undefined) {
  const nextPath = Array.isArray(nextValue) ? nextValue[0] : nextValue;

  if (
    !nextPath ||
    !nextPath.startsWith("/") ||
    nextPath.startsWith("//") ||
    nextPath.startsWith("/login")
  ) {
    return "/";
  }

  return nextPath;
}

export default async function LoginPage({
  searchParams,
}: LoginPageProps) {
  const resolvedSearchParams = await searchParams;

  return (
    <LoginPageClient
      nextPath={getSafeNextPath(resolvedSearchParams.next)}
    />
  );
}
