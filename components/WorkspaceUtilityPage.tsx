"use client";

import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import LogoutButton from "./LogoutButton";

type ActiveUtilityPage = "grades" | "ai-feedback" | "user-notes";

type RecentChat = {
  id: string;
  title: string;
  context: string;
  updatedAt: number;
  sessionIndex?: number;
  sessionNumber?: number;
  sessionTitle?: string;
  chatType?: "module" | "roleplay";
};

type UtilityRecord = {
  id?: string;
  title?: string;
  moduleTitle?: string;
  sessionLabel?: string;
  score?: string;
  summary?: string;
  feedback?: string;
  createdAt?: number;
  updatedAt?: number;
};

type WorkspaceUtilityPageProps = {
  activePage: ActiveUtilityPage;
  title: string;
  subtitle: string;
  storageKey: string;
  emptyTitle: string;
  emptyMessage: string;
  badgeLabel: string;
  badgeCount?: number;
  showBadge?: boolean;
  children?: ReactNode;
};

const RECENT_CHATS_STORAGE_KEY = "walter_recent_week_chats";
const PENDING_BOOKMARK_NAVIGATION_STORAGE_KEY =
  "walter_pending_bookmark_navigation";
const MAX_RECENT_CHATS = 50;

function formatRecentDate(timestamp: number) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(timestamp);
}

function readStoredRecentChats(): RecentChat[] {
  try {
    const savedRecentChats = localStorage.getItem(RECENT_CHATS_STORAGE_KEY);

    if (!savedRecentChats) return [];

    const parsedRecentChats = JSON.parse(savedRecentChats);

    return Array.isArray(parsedRecentChats)
      ? parsedRecentChats.filter(
          (chat): chat is RecentChat =>
            Boolean(chat) &&
            typeof chat.id === "string" &&
            typeof chat.context === "string",
        )
      : [];
  } catch (error) {
    console.error("Failed to read recent chats:", error);
    return [];
  }
}

function readStoredRecords(storageKey: string): UtilityRecord[] {
  try {
    const savedRecords = localStorage.getItem(storageKey);

    if (!savedRecords) return [];

    const parsedRecords = JSON.parse(savedRecords);

    return Array.isArray(parsedRecords)
      ? parsedRecords
          .filter((record): record is UtilityRecord => Boolean(record))
          .sort(
            (firstRecord, secondRecord) =>
              (secondRecord.createdAt || secondRecord.updatedAt || 0) -
              (firstRecord.createdAt || firstRecord.updatedAt || 0),
          )
      : [];
  } catch (error) {
    console.error(`Failed to read records from ${storageKey}:`, error);
    return [];
  }
}

export default function WorkspaceUtilityPage({
  activePage,
  title,
  subtitle,
  storageKey,
  emptyTitle,
  emptyMessage,
  badgeLabel,
  badgeCount,
  showBadge = true,
  children,
}: WorkspaceUtilityPageProps) {
  const router = useRouter();

  const [isChatOpen, setIsChatOpen] = useState(true);
  const [recentChats, setRecentChats] = useState<RecentChat[]>([]);
  const [records, setRecords] = useState<UtilityRecord[]>([]);

  useEffect(() => {
    queueMicrotask(() => {
      setRecentChats(
        readStoredRecentChats().filter((chat) => chat.chatType !== "roleplay"),
      );
      setRecords(readStoredRecords(storageKey));
    });
  }, [storageKey]);

  const handleCourseHome = () => {
    router.push("/");
  };

  const openRecentChat = (recentChat: RecentChat) => {
    localStorage.setItem(
      PENDING_BOOKMARK_NAVIGATION_STORAGE_KEY,
      JSON.stringify({
        sourceType: "chat",
        sourceTitle: recentChat.context,
        moduleTitle: recentChat.context,
        sessionIndex: recentChat.sessionIndex,
        sessionNumber: recentChat.sessionNumber,
        sessionTitle: recentChat.sessionTitle,
      }),
    );

    const storedRecentChats = readStoredRecentChats();
    const refreshedRecentChats = [
      {
        ...recentChat,
        updatedAt: new Date().getTime(),
      },
      ...storedRecentChats.filter((chat) => chat.id !== recentChat.id),
    ]
      .sort((firstChat, secondChat) => secondChat.updatedAt - firstChat.updatedAt)
      .slice(0, MAX_RECENT_CHATS);

    setRecentChats(
      refreshedRecentChats.filter((chat) => chat.chatType !== "roleplay"),
    );

    localStorage.setItem(
      RECENT_CHATS_STORAGE_KEY,
      JSON.stringify(refreshedRecentChats),
    );

    router.push("/");
  };

  const navButtonClass = (isActive: boolean) =>
    `flex h-10 w-full items-center rounded-lg text-sm font-medium transition-colors ${
      isActive
        ? "bg-stone-800 text-red-400"
        : "text-stone-300 hover:bg-stone-800 hover:text-white"
    } ${isChatOpen ? "justify-start gap-3 px-3" : "justify-center"}`;
  const displayedBadgeCount = badgeCount ?? records.length;

  return (
    <main className="flex h-screen w-full overflow-hidden bg-stone-50 font-sans">
      <aside
        className={`flex h-full shrink-0 flex-col overflow-hidden border-r border-stone-800 bg-stone-900 transition-all duration-300 ease-in-out ${
          isChatOpen ? "w-[320px]" : "w-16"
        }`}
      >
        <div
          className={`mt-2 flex h-16 shrink-0 items-center ${
            isChatOpen ? "justify-between px-4" : "justify-center"
          }`}
        >
          {isChatOpen && (
            <h2 className="whitespace-nowrap pl-2 text-lg font-bold tracking-tight text-white">
              Walter AI
            </h2>
          )}

          <button
            type="button"
            onClick={() => setIsChatOpen(!isChatOpen)}
            className="rounded-md p-2 text-stone-400 transition-colors hover:bg-stone-800"
            title={isChatOpen ? "Collapse sidebar" : "Expand sidebar"}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
              {isChatOpen ? (
                <path d="m15 9-3 3 3 3M9 3v18" />
              ) : (
                <path d="m11 15 3-3-3-3M9 3v18" />
              )}
            </svg>
          </button>
        </div>

        <nav className="mt-2 mb-4 shrink-0 space-y-1 px-3">
          <button
            type="button"
            onClick={handleCourseHome}
            className={navButtonClass(false)}
            title="Go to Course Home"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="shrink-0"
            >
              <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
              <polyline points="9 22 9 12 15 12 15 22" />
            </svg>
            {isChatOpen && <span>Course Home</span>}
          </button>

          <button
            type="button"
            onClick={() => router.push("/bookmarks")}
            className={navButtonClass(false)}
            title="Saved Bookmarks"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="shrink-0"
            >
              <path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z" />
            </svg>
            {isChatOpen && <span>Bookmarks</span>}
          </button>

          <button
            type="button"
            onClick={() => router.push("/grades")}
            className={navButtonClass(activePage === "grades")}
            title="Grades"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="shrink-0"
            >
              <path d="M4 19V5" />
              <path d="M4 19h16" />
              <path d="M8 16v-5" />
              <path d="M12 16V8" />
              <path d="M16 16v-3" />
            </svg>
            {isChatOpen && <span>Grades</span>}
          </button>

          <button
            type="button"
            onClick={() => router.push("/ai-feedback")}
            className={navButtonClass(activePage === "ai-feedback")}
            title="AI Feedback"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="shrink-0"
            >
              <path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              <path d="M8 9h8" />
              <path d="M8 13h5" />
            </svg>
            {isChatOpen && <span>AI Feedback</span>}
          </button>

          <button
            type="button"
            onClick={() => router.push("/user-notes")}
            className={navButtonClass(activePage === "user-notes")}
            title="User Notes"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="shrink-0"
            >
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
              <path d="M14 2v6h6" />
              <path d="M8 13h8" />
              <path d="M8 17h5" />
            </svg>
            {isChatOpen && <span>User Notes</span>}
          </button>
        </nav>

        <div className="shrink-0 px-4">
          <div className="h-px w-full bg-stone-800" />
        </div>

        <div
          className={`mt-2 flex min-h-0 flex-1 flex-col overflow-hidden transition-opacity duration-200 ${
            isChatOpen ? "opacity-100" : "pointer-events-none opacity-0"
          }`}
        >
          <div className="shrink-0 px-5 py-2">
            <h3 className="text-xs font-semibold tracking-wide text-stone-500">
              Recent
            </h3>
          </div>

          <div className="recent-chats-scroll flex-1 min-h-0 overflow-y-auto px-3 pb-4 space-y-1">
            {recentChats.length === 0 && (
              <p className="px-3 py-2 text-xs text-stone-500">
                No recent session chats yet.
              </p>
            )}

            {recentChats.map((chat) => (
              <button
                key={chat.id}
                type="button"
                onClick={() => openRecentChat(chat)}
                className="group flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left text-sm text-stone-300 transition-colors hover:bg-stone-800 hover:text-white"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  className="mt-0.5 shrink-0 text-stone-500 group-hover:text-stone-300"
                >
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>

                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">{chat.title}</p>
                  <p className="mt-0.5 truncate text-[11px] text-stone-500 group-hover:text-stone-400">
                    Last opened {formatRecentDate(chat.updatedAt)}
                  </p>
                </div>
              </button>
            ))}
          </div>
        </div>

        <LogoutButton expanded={isChatOpen} />
      </aside>

      <section className="flex h-full min-w-0 flex-1 flex-col overflow-hidden bg-stone-50">
        <div className="custom-scrollbar flex-1 space-y-4 overflow-y-auto p-6">
          <div className="flex items-center justify-between gap-4 px-1">
            <div>
              <h1 className="text-xl font-bold text-stone-800">{title}</h1>
              <p className="mt-1 text-sm text-stone-500">{subtitle}</p>
            </div>

            {showBadge && (
              <span className="rounded-full bg-stone-200 px-3 py-1 text-xs font-medium text-stone-600">
                {displayedBadgeCount} {badgeLabel}
              </span>
            )}
          </div>

          {children ? (
            children
          ) : records.length === 0 ? (
            <div className="rounded-xl border border-stone-200 bg-white p-8 text-center">
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-stone-100 text-stone-400">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="26"
                  height="26"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  {activePage === "grades" ? (
                    <>
                      <path d="M4 19V5" />
                      <path d="M4 19h16" />
                      <path d="M8 16v-5" />
                      <path d="M12 16V8" />
                      <path d="M16 16v-3" />
                    </>
                  ) : (
                    <>
                      <path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                      <path d="M8 9h8" />
                      <path d="M8 13h5" />
                    </>
                  )}
                </svg>
              </div>

              <h2 className="text-lg font-bold text-stone-800">
                {emptyTitle}
              </h2>

              <p className="mt-2 text-sm text-stone-500">{emptyMessage}</p>

              <button
                type="button"
                onClick={() => router.push("/")}
                className="mt-5 rounded-full bg-red-600 px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-700"
              >
                Back to Course Home
              </button>
            </div>
          ) : (
            <div className="space-y-3 pb-12">
              {records.map((record, index) => {
                const recordDate = record.createdAt || record.updatedAt;
                const primaryText =
                  activePage === "grades"
                    ? record.score || record.summary || "Grade saved"
                    : record.feedback || record.summary || "Feedback saved";

                return (
                  <article
                    key={record.id || `${record.title}-${index}`}
                    className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <h2 className="truncate text-base font-semibold text-stone-800">
                          {record.title || record.moduleTitle || title}
                        </h2>
                        <p className="mt-1 text-xs text-stone-400">
                          {[record.moduleTitle, record.sessionLabel]
                            .filter(Boolean)
                            .join(" - ")}
                        </p>
                      </div>

                      {recordDate && (
                        <span className="shrink-0 text-xs text-stone-400">
                          {formatRecentDate(recordDate)}
                        </span>
                      )}
                    </div>

                    <p className="mt-4 whitespace-pre-wrap text-sm leading-7 text-stone-600">
                      {primaryText}
                    </p>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </section>

      <style>{`
        .recent-chats-scroll {
          overscroll-behavior: contain;
          scrollbar-width: thin;
          scrollbar-color: #57534e transparent;
        }

        .recent-chats-scroll::-webkit-scrollbar {
          width: 8px;
        }

        .recent-chats-scroll::-webkit-scrollbar-track {
          background: transparent;
        }

        .recent-chats-scroll::-webkit-scrollbar-thumb {
          background: #57534e;
          border: 2px solid #1c1917;
          border-radius: 999px;
        }

        .recent-chats-scroll::-webkit-scrollbar-thumb:hover {
          background: #78716c;
        }

        .recent-chats-scroll::-webkit-scrollbar-button {
          display: none;
          width: 0;
          height: 0;
        }
      `}</style>
    </main>
  );
}
