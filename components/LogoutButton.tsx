"use client";

import { useState } from "react";

type LogoutButtonProps = {
  expanded: boolean;
};

export default function LogoutButton({
  expanded,
}: LogoutButtonProps) {
  const [isSigningOut, setIsSigningOut] = useState(false);

  const signOut = async () => {
    if (isSigningOut) return;

    setIsSigningOut(true);

    try {
      await fetch("/api/auth/logout", {
        method: "POST",
      });
    } finally {
      window.location.assign("/login");
    }
  };

  return (
    <div className="shrink-0 border-t border-stone-800 p-3">
      <button
        type="button"
        onClick={signOut}
        disabled={isSigningOut}
        className={`flex h-10 w-full items-center rounded-lg text-sm font-medium text-stone-400 transition-colors hover:bg-stone-800 hover:text-white disabled:cursor-wait disabled:opacity-50 ${
          expanded ? "justify-start gap-3 px-3" : "justify-center"
        }`}
        title="Sign Out"
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className="shrink-0"
          aria-hidden="true"
        >
          <path d="M10 17l5-5-5-5" />
          <path d="M15 12H3" />
          <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
        </svg>
        {expanded && (
          <span>{isSigningOut ? "Signing out..." : "Sign Out"}</span>
        )}
      </button>
    </div>
  );
}
