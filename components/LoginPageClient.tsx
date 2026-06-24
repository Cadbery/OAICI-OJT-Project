"use client";

import { useState, type FormEvent } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";

type LoginPageClientProps = {
  nextPath: string;
};

export default function LoginPageClient({
  nextPath,
}: LoginPageClientProps) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!email.trim() || !password) {
      setErrorMessage("Enter your email and password.");
      return;
    }

    setIsSubmitting(true);
    setErrorMessage("");

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: email.trim(),
          password,
        }),
      });
      const result = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;

      if (!response.ok) {
        throw new Error(result?.error || "Unable to sign in.");
      }

      router.replace(nextPath);
      router.refresh();
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Unable to sign in.",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-stone-950 px-4 py-10 font-sans">
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(circle at 18% 15%, rgba(239,68,68,0.2), transparent 34%), radial-gradient(circle at 82% 88%, rgba(127,29,29,0.24), transparent 38%), linear-gradient(135deg, #0c0a09 0%, #1c1917 52%, #0c0a09 100%)",
        }}
      />

      <Image
        src="/cardinal-logo.png"
        alt="Cardinal logo"
        width={1431}
        height={1648}
        priority
        className="pointer-events-none absolute h-auto object-contain opacity-95 drop-shadow-2xl"
        style={{
          right: "4vw",
          top: "50%",
          transform: "translateY(-50%)",
          width: "min(28vw, 500px)",
          filter:
            "drop-shadow(0 0 4px rgba(248, 113, 113, 0.9)) drop-shadow(0 0 16px rgba(220, 38, 38, 0.55))",
        }}
      />

      <div className="relative z-10 w-full" style={{ maxWidth: "430px" }}>
        <div className="mb-7 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-red-400/30 bg-red-500/10 text-red-400 shadow-lg shadow-red-950/30">
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              <path d="M8 9h8" />
              <path d="M8 13h5" />
            </svg>
          </div>
          <p className="mt-4 text-2xl font-bold tracking-tight text-white">
            Walter <span className="text-red-400">AI</span>
          </p>
          <p className="mt-2 text-sm text-stone-400">
            Agentic Learning Workspace
          </p>
        </div>

        <section className="rounded-3xl border border-white/10 bg-white p-7 shadow-2xl shadow-black/40 sm:p-9">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-red-600">
              Welcome back
            </p>
            <h1 className="mt-3 text-3xl font-bold tracking-tight text-stone-900">
              Sign in
            </h1>
            <p className="mt-2 text-sm leading-6 text-stone-500">
              Enter your email and password to access your workspace.
            </p>
          </div>

          <form className="mt-7 space-y-5" onSubmit={handleSubmit}>
            <label className="block" htmlFor="login-email">
              <span className="mb-2 block text-sm font-semibold text-stone-700">
                Email
              </span>
              <input
                id="login-email"
                type="email"
                name="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="username"
                placeholder="you@example.com"
                disabled={isSubmitting}
                className="h-12 w-full rounded-xl border border-stone-200 bg-stone-50 px-4 text-sm text-stone-900 outline-none transition focus:border-red-300 focus:bg-white focus:ring-4 focus:ring-red-100 disabled:cursor-wait disabled:opacity-60"
              />
            </label>

            <label className="block" htmlFor="login-password">
              <span className="mb-2 block text-sm font-semibold text-stone-700">
                Password
              </span>
              <div className="relative">
                <input
                  id="login-password"
                  type={showPassword ? "text" : "password"}
                  name="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="current-password"
                  placeholder="Enter your password"
                  disabled={isSubmitting}
                  className="h-12 w-full rounded-xl border border-stone-200 bg-stone-50 px-4 pr-12 text-sm text-stone-900 outline-none transition focus:border-red-300 focus:bg-white focus:ring-4 focus:ring-red-100 disabled:cursor-wait disabled:opacity-60"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((isVisible) => !isVisible)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-2 text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700"
                  aria-label={
                    showPassword ? "Hide password" : "Show password"
                  }
                  disabled={isSubmitting}
                >
                  {showPassword ? (
                    <svg
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      aria-hidden="true"
                    >
                      <path d="m2 2 20 20" />
                      <path d="M6.7 6.7C4.8 8 3.3 9.8 2.5 12c1.7 4.4 5.2 7 9.5 7 1.5 0 2.9-.3 4.2-.9" />
                      <path d="M10.7 5.1c.4-.1.9-.1 1.3-.1 4.3 0 7.8 2.6 9.5 7-.5 1.2-1.1 2.2-2 3.1" />
                    </svg>
                  ) : (
                    <svg
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      aria-hidden="true"
                    >
                      <path d="M2.5 12s3.5-7 9.5-7 9.5 7 9.5 7-3.5 7-9.5 7-9.5-7-9.5-7Z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                  )}
                </button>
              </div>
            </label>

            {errorMessage && (
              <div
                className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm leading-5 text-red-700"
                role="alert"
              >
                {errorMessage}
              </div>
            )}

            <button
              type="submit"
              disabled={isSubmitting}
              className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-red-600 px-4 text-sm font-bold text-white shadow-lg shadow-red-200 transition-colors hover:bg-red-700 disabled:cursor-wait disabled:opacity-60"
            >
              {isSubmitting && (
                <svg
                  className="animate-spin"
                  width="17"
                  height="17"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  aria-hidden="true"
                >
                  <circle cx="12" cy="12" r="9" opacity="0.25" />
                  <path d="M21 12a9 9 0 0 0-9-9" />
                </svg>
              )}
              {isSubmitting ? "Signing in..." : "Sign in"}
            </button>
          </form>
        </section>

        <p className="mt-5 text-center text-xs text-stone-500">
          Private workspace access. No public registration.
        </p>
      </div>
    </main>
  );
}
