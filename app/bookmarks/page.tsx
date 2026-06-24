"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import FormattedMessage from "../../components/FormattedMessage";
import LogoutButton from "../../components/LogoutButton";

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

type BookmarkedMessage = {
  id: string;
  messageIdentity?: string;
  content: string;
  images?: string[];
  sourceType: "chat" | "roleplay";
  sourceTitle: string;
  moduleTitle?: string;
  sessionIndex?: number;
  sessionNumber?: number;
  sessionTitle?: string;
  sessionLabel?: string;
  createdAt: number;
};

type PendingBookmarkNavigation = {
  sourceType: "chat" | "roleplay";
  sourceTitle: string;
  moduleTitle: string;
  sessionIndex?: number;
  sessionNumber?: number;
  sessionTitle?: string;
  messageIdentity?: string;
  messageContent?: string;
};

type BookmarkSessionFolder = {
  key: string;
  label: string;
  bookmarks: BookmarkedMessage[];
};

type BookmarkModuleFolder = {
  title: string;
  bookmarks: BookmarkedMessage[];
  sessions: BookmarkSessionFolder[];
};

const RECENT_CHATS_STORAGE_KEY = "walter_recent_week_chats";
const BOOKMARKS_STORAGE_KEY = "walter_ai_bookmarked_messages";
const PENDING_BOOKMARK_NAVIGATION_STORAGE_KEY =
  "walter_pending_bookmark_navigation";
const MAX_RECENT_CHATS = 50;

function normalizeText(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

function formatRecentDate(timestamp: number) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(timestamp);
}

function formatBookmarkDate(timestamp: number) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(timestamp);
}

function getModuleTitle(bookmark: BookmarkedMessage) {
  return (
    bookmark.moduleTitle?.trim() ||
    bookmark.sourceTitle?.trim() ||
    "Saved Messages"
  );
}

function getSessionLabel(bookmark: BookmarkedMessage) {
  return bookmark.sessionLabel?.trim() || "Previous / Unidentified Session";
}

function getSessionFolderLabel(bookmark: BookmarkedMessage) {
  return getSessionLabel(bookmark);
}

function getResolvedBookmarkSessionNumber(bookmark: BookmarkedMessage) {
  if (
    typeof bookmark.sessionNumber === "number" &&
    Number.isFinite(bookmark.sessionNumber)
  ) {
    return bookmark.sessionNumber;
  }

  const match = getSessionLabel(bookmark).match(/session\s+(\d+)/i);
  const parsedSessionNumber = match ? Number(match[1]) : NaN;

  return Number.isFinite(parsedSessionNumber)
    ? parsedSessionNumber
    : undefined;
}

function getResolvedBookmarkSessionTitle(
  bookmark: BookmarkedMessage,
  sessionNumber?: number,
) {
  if (bookmark.sessionTitle?.trim()) {
    return bookmark.sessionTitle.trim();
  }

  const cleanModuleTitle = normalizeText(getModuleTitle(bookmark)).toLowerCase();

  const matchingRecentChat = readStoredRecentChats().find((chat) => {
    const sameModule =
      normalizeText(chat.context).toLowerCase() === cleanModuleTitle;
    const sameSessionNumber =
      typeof sessionNumber === "number" &&
      chat.sessionNumber === sessionNumber;

    return sameModule && sameSessionNumber;
  });

  return matchingRecentChat?.sessionTitle?.trim() || "";
}

function getBookmarkPreview(content: string) {
  const cleanedContent = normalizeText(content);

  if (!cleanedContent) {
    return "Saved AI response";
  }

  return cleanedContent;
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

export default function BookmarksPage() {
  const router = useRouter();

  const [isMounted, setIsMounted] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(true);
  const [isReturningHome, setIsReturningHome] = useState(false);
  const [recentChats, setRecentChats] = useState<RecentChat[]>([]);
  const [bookmarks, setBookmarks] = useState<BookmarkedMessage[]>([]);

  // Only one folder at each level can be open at a time.
  const [openModuleFolder, setOpenModuleFolder] = useState<string | null>(null);
  const [openSessionFolder, setOpenSessionFolder] = useState<string | null>(
    null
  );
  const [openBookmarkId, setOpenBookmarkId] = useState<string | null>(null);
  const [isBookmarkModalClosing, setIsBookmarkModalClosing] = useState(false);
  const [copyStatus, setCopyStatus] = useState<
    "idle" | "copied" | "error"
  >("idle");

  const selectedBookmark =
    bookmarks.find((bookmark) => bookmark.id === openBookmarkId) || null;

  const bookmarkFolders = useMemo<BookmarkModuleFolder[]>(() => {
    const modules = new Map<
      string,
      {
        bookmarks: BookmarkedMessage[];
        sessions: Map<string, BookmarkSessionFolder>;
      }
    >();

    [...bookmarks]
      .sort((bookmarkA, bookmarkB) => bookmarkB.createdAt - bookmarkA.createdAt)
      .forEach((bookmark) => {
        const moduleTitle = getModuleTitle(bookmark);
        const sessionLabel = getSessionLabel(bookmark);

        const sessionFolderKey = [
          moduleTitle,
          bookmark.sourceType,
          normalizeText(bookmark.sourceTitle).toLowerCase(),
          sessionLabel,
        ].join("::");

        if (!modules.has(moduleTitle)) {
          modules.set(moduleTitle, {
            bookmarks: [],
            sessions: new Map(),
          });
        }

        const moduleFolder = modules.get(moduleTitle)!;
        moduleFolder.bookmarks.push(bookmark);

        if (!moduleFolder.sessions.has(sessionFolderKey)) {
          moduleFolder.sessions.set(sessionFolderKey, {
            key: sessionFolderKey,
            label: getSessionFolderLabel(bookmark),
            bookmarks: [],
          });
        }

        moduleFolder.sessions.get(sessionFolderKey)!.bookmarks.push(bookmark);
      });

    return Array.from(modules.entries())
      .map(([title, moduleFolder]) => ({
        title,
        bookmarks: moduleFolder.bookmarks,
        sessions: Array.from(moduleFolder.sessions.values()).sort(
          (sessionA, sessionB) =>
            sessionB.bookmarks[0].createdAt - sessionA.bookmarks[0].createdAt
        ),
      }))
      .sort((moduleA, moduleB) => moduleA.title.localeCompare(moduleB.title));
  }, [bookmarks]);

  useEffect(() => {
    setIsMounted(true);

    const savedRecentChats = localStorage.getItem(RECENT_CHATS_STORAGE_KEY);

    if (savedRecentChats) {
      try {
        const parsedRecentChats = JSON.parse(savedRecentChats);

        if (Array.isArray(parsedRecentChats)) {
          setRecentChats(
            parsedRecentChats.filter(
              (chat: RecentChat) => chat.chatType !== "roleplay"
            )
          );
        }
      } catch (error) {
        console.error("Failed to load recent chats:", error);
      }
    }

    const savedBookmarks = localStorage.getItem(BOOKMARKS_STORAGE_KEY);

    if (!savedBookmarks) {
      return;
    }

    try {
      const parsedBookmarks = JSON.parse(savedBookmarks);

      if (!Array.isArray(parsedBookmarks)) {
        return;
      }

      const cleanedBookmarks = parsedBookmarks
        .filter(
          (bookmark: BookmarkedMessage) =>
            bookmark &&
            typeof bookmark.id === "string" &&
            typeof bookmark.content === "string" &&
            bookmark.sourceType === "chat"
        )
        .sort(
          (bookmarkA: BookmarkedMessage, bookmarkB: BookmarkedMessage) =>
            bookmarkB.createdAt - bookmarkA.createdAt
        );

      if (cleanedBookmarks.length !== parsedBookmarks.length) {
        localStorage.setItem(
          BOOKMARKS_STORAGE_KEY,
          JSON.stringify(cleanedBookmarks)
        );
      }

      setBookmarks(cleanedBookmarks);
    } catch (error) {
      console.error("Failed to load bookmarks:", error);
    }
  }, []);

  useEffect(() => {
    if (!openBookmarkId) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [openBookmarkId]);

  useEffect(() => {
    if (!openBookmarkId) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeBookmarkModal();
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [openBookmarkId]);

  const toggleModuleFolder = (moduleTitle: string) => {
    setOpenModuleFolder((previousFolder) =>
      previousFolder === moduleTitle ? null : moduleTitle
    );

    // Opening or closing a week always resets the lower levels.
    setOpenSessionFolder(null);
    setOpenBookmarkId(null);
  };

  const toggleSessionFolder = (sessionKey: string) => {
    setOpenSessionFolder((previousFolder) =>
      previousFolder === sessionKey ? null : sessionKey
    );

    // Opening a new session closes any expanded saved response.
    setOpenBookmarkId(null);
  };

  const openRecentChat = (recentChat: RecentChat) => {
    const pendingNavigation: PendingBookmarkNavigation = {
      sourceType: "chat",
      sourceTitle: recentChat.context,
      moduleTitle: recentChat.context,
      sessionIndex: recentChat.sessionIndex,
      sessionNumber: recentChat.sessionNumber,
      sessionTitle: recentChat.sessionTitle,
    };

    localStorage.setItem(
      PENDING_BOOKMARK_NAVIGATION_STORAGE_KEY,
      JSON.stringify(pendingNavigation)
    );

    // Read the complete storage value again before updating it. The Bookmarks
    // sidebar displays normal chats only, so writing from its filtered React
    // state would otherwise erase older or hidden entries.
    const storedRecentChats = readStoredRecentChats();

    const refreshedRecentChats = [
      {
        ...recentChat,
        updatedAt: Date.now(),
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
      JSON.stringify(refreshedRecentChats)
    );

    router.push("/");
  };

  const handleCourseHome = async () => {
    if (isReturningHome) return;

    setIsReturningHome(true);

    try {
      const response = await fetch("/api/nf/home", {
        method: "POST",
      });

      const data = await response.json();

      if (!response.ok || !data.ok) {
        throw new Error(data.error || "Failed to return to course home.");
      }
    } catch (error) {
      console.error("Error returning Noodle Factory to course home:", error);
    } finally {
      router.push("/");
      setIsReturningHome(false);
    }
  };

  const openBookmarkModal = (bookmarkId: string) => {
    setIsBookmarkModalClosing(false);
    setCopyStatus("idle");
    setOpenBookmarkId(bookmarkId);
  };

  const closeBookmarkModal = () => {
    if (!openBookmarkId || isBookmarkModalClosing) return;

    setIsBookmarkModalClosing(true);

    window.setTimeout(() => {
      setOpenBookmarkId(null);
      setIsBookmarkModalClosing(false);
      setCopyStatus("idle");
    }, 320);
  };

  const handleCopyBookmark = async () => {
    if (!selectedBookmark?.content) return;

    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(selectedBookmark.content);
      } else {
        const copyField = document.createElement("textarea");

        copyField.value = selectedBookmark.content;
        copyField.setAttribute("readonly", "");
        copyField.style.position = "fixed";
        copyField.style.opacity = "0";
        document.body.appendChild(copyField);
        copyField.select();

        const didCopy = document.execCommand("copy");
        copyField.remove();

        if (!didCopy) {
          throw new Error("The browser did not allow clipboard access.");
        }
      }

      setCopyStatus("copied");

      window.setTimeout(() => {
        setCopyStatus("idle");
      }, 1800);
    } catch (error) {
      console.error("Failed to copy bookmarked response:", error);
      setCopyStatus("error");
    }
  };

  const handleGoToSession = () => {
    if (!selectedBookmark) return;

    const resolvedSessionNumber =
      getResolvedBookmarkSessionNumber(selectedBookmark);
    const resolvedSessionTitle = getResolvedBookmarkSessionTitle(
      selectedBookmark,
      resolvedSessionNumber,
    );

    const pendingNavigation: PendingBookmarkNavigation = {
      sourceType: selectedBookmark.sourceType,
      sourceTitle: selectedBookmark.sourceTitle,
      moduleTitle: getModuleTitle(selectedBookmark),
      sessionIndex: selectedBookmark.sessionIndex,
      sessionNumber: resolvedSessionNumber,
      sessionTitle: resolvedSessionTitle || undefined,
      messageIdentity: selectedBookmark.messageIdentity,
      messageContent: selectedBookmark.content,
    };

    localStorage.setItem(
      PENDING_BOOKMARK_NAVIGATION_STORAGE_KEY,
      JSON.stringify(pendingNavigation)
    );

    closeBookmarkModal();
    router.push("/");
  };

  const removeBookmark = (bookmarkId: string) => {
    const updatedBookmarks = bookmarks.filter(
      (bookmark) => bookmark.id !== bookmarkId
    );

    setBookmarks(updatedBookmarks);
    localStorage.setItem(
      BOOKMARKS_STORAGE_KEY,
      JSON.stringify(updatedBookmarks)
    );

    if (openBookmarkId === bookmarkId) {
      setOpenBookmarkId(null);
      setIsBookmarkModalClosing(false);
    }
  };

  const clearAllBookmarks = () => {
    const confirmed = window.confirm(
      "Are you sure you want to remove all saved bookmarks?"
    );

    if (!confirmed) return;

    setBookmarks([]);
    setOpenModuleFolder(null);
    setOpenSessionFolder(null);
    setOpenBookmarkId(null);
    localStorage.removeItem(BOOKMARKS_STORAGE_KEY);
  };

  if (!isMounted) {
    return null;
  }

  return (
    <> 
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
            disabled={isReturningHome}
            className={`flex h-10 w-full items-center rounded-lg text-sm font-medium text-stone-300 transition-colors hover:bg-stone-800 hover:text-white disabled:cursor-wait disabled:opacity-60 ${
              isChatOpen ? "justify-start gap-3 px-3" : "justify-center"
            }`}
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
              className="shrink-0 text-stone-400"
            >
              <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
              <polyline points="9 22 9 12 15 12 15 22" />
            </svg>
            {isChatOpen && (
              <span>Course Home</span>
            )}
          </button>

          <button
            type="button"
            onClick={() => router.push("/bookmarks")}
            className={`flex h-10 w-full items-center rounded-lg bg-stone-800 text-sm font-medium text-red-400 transition-colors ${
              isChatOpen ? "justify-start gap-3 px-3" : "justify-center"
            }`}
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
              className="shrink-0 text-red-400"
            >
              <path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z" />
            </svg>
            {isChatOpen && <span>Bookmarks</span>}
          </button>

          <button
            type="button"
            onClick={() => router.push("/grades")}
            className={`flex h-10 w-full items-center rounded-lg text-sm font-medium text-stone-300 transition-colors hover:bg-stone-800 hover:text-white ${
              isChatOpen ? "justify-start gap-3 px-3" : "justify-center"
            }`}
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
            className={`flex h-10 w-full items-center rounded-lg text-sm font-medium text-stone-300 transition-colors hover:bg-stone-800 hover:text-white ${
              isChatOpen ? "justify-start gap-3 px-3" : "justify-center"
            }`}
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
            className={`flex h-10 w-full items-center rounded-lg text-sm font-medium text-stone-300 transition-colors hover:bg-stone-800 hover:text-white ${
              isChatOpen ? "justify-start gap-3 px-3" : "justify-center"
            }`}
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

          <div className="bookmarks-recent-scroll flex-1 min-h-0 overflow-y-auto px-3 pb-4 space-y-1">
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
              <h1 className="text-xl font-bold text-stone-800">
                Saved Bookmarks
              </h1>
              <p className="mt-1 text-sm text-stone-500">
                Saved AI tutor responses organized by week and session.
              </p>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <span className="rounded-full bg-stone-200 px-3 py-1 text-xs font-medium text-stone-600">
                {bookmarks.length} Saved{" "}
                {bookmarks.length === 1 ? "Item" : "Items"}
              </span>

              {bookmarks.length > 0 && (
                <button
                  type="button"
                  onClick={clearAllBookmarks}
                  className="rounded-full border border-red-200 bg-white px-4 py-2 text-xs font-semibold text-red-600 transition-colors hover:bg-red-50 hover:text-red-700"
                >
                  Clear All
                </button>
              )}
            </div>
          </div>

          {bookmarks.length === 0 && (
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
                  <path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z" />
                </svg>
              </div>

              <h2 className="text-lg font-bold text-stone-800">
                No bookmarks yet
              </h2>

              <p className="mt-2 text-sm text-stone-500">
                Save an AI response from a chat or role play session to see it
                here.
              </p>

              <button
                type="button"
                onClick={() => router.push("/")}
                className="mt-5 rounded-full bg-red-600 px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-700"
              >
                Back to Course Home
              </button>
            </div>
          )}

          {bookmarkFolders.length > 0 && (
            <div className="space-y-3 pb-12">
              {bookmarkFolders.map((moduleFolder) => {
                const isModuleOpen = openModuleFolder === moduleFolder.title;

                return (
                  <section
                    key={moduleFolder.title}
                    className="overflow-hidden rounded-xl border border-stone-200 bg-white"
                  >
                    <button
                      type="button"
                      onClick={() => toggleModuleFolder(moduleFolder.title)}
                      className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left transition-colors hover:bg-stone-50"
                    >
                      <div className="min-w-0">
                        <span
                          className={`block truncate text-base font-semibold ${
                            isModuleOpen ? "text-red-700" : "text-stone-800"
                          }`}
                        >
                          {moduleFolder.title}
                        </span>

                        <span className="mt-1 block text-sm text-stone-400">
                          {moduleFolder.sessions.length} session{" "}
                          {moduleFolder.sessions.length === 1
                            ? "folder"
                            : "folders"}{" "}
                          • {moduleFolder.bookmarks.length} saved{" "}
                          {moduleFolder.bookmarks.length === 1
                            ? "message"
                            : "messages"}
                        </span>
                      </div>

                      <svg
                        className={`shrink-0 text-stone-400 transition-transform duration-300 ease-out ${
                          isModuleOpen ? "rotate-180" : ""
                        }`}
                        width="18"
                        height="18"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <path d="M6 9l6 6 6-6" />
                      </svg>
                    </button>

                    <div
                      aria-hidden={!isModuleOpen}
                      className="grid"
                      style={{
                        gridTemplateRows: isModuleOpen ? "1fr" : "0fr",
                        opacity: isModuleOpen ? 1 : 0,
                        pointerEvents: isModuleOpen ? "auto" : "none",
                        transition:
                          "grid-template-rows 300ms ease-out, opacity 220ms ease-out",
                      }}
                    >
                      <div className="min-h-0 overflow-hidden">
                        <div className="divide-y divide-stone-100 border-t border-stone-100">
                        {moduleFolder.sessions.map((sessionFolder) => {
                          const isSessionOpen =
                            openSessionFolder === sessionFolder.key;
                          const latestBookmark = sessionFolder.bookmarks[0];

                          return (
                            <div key={sessionFolder.key}>
                              <button
                                type="button"
                                onClick={() =>
                                  toggleSessionFolder(sessionFolder.key)
                                }
                                className={`flex w-full items-center justify-between gap-4 px-6 py-3 text-left transition-colors ${
                                  isSessionOpen
                                    ? "bg-stone-50"
                                    : "bg-white hover:bg-stone-50"
                                }`}
                              >
                                <div className="flex min-w-0 items-center gap-3">
                                  <svg
                                    xmlns="http://www.w3.org/2000/svg"
                                    width="16"
                                    height="16"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    className="shrink-0 text-stone-400"
                                  >
                                    <path d="M3 7h5l2 3h11v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
                                    <path d="M3 7V5a2 2 0 0 1 2-2h4l2 3h8a2 2 0 0 1 2 2v2" />
                                  </svg>

                                  <div className="min-w-0">
                                    <span className="block truncate text-sm font-semibold text-stone-700">
                                      {sessionFolder.label}
                                    </span>
                                    <span className="mt-0.5 block text-xs text-stone-400">
                                      {sessionFolder.bookmarks.length} saved{" "}
                                      {sessionFolder.bookmarks.length === 1
                                        ? "message"
                                        : "messages"}{" "}
                                      • Latest saved{" "}
                                      {formatBookmarkDate(
                                        latestBookmark.createdAt
                                      )}
                                    </span>
                                  </div>
                                </div>

                                <svg
                                  className={`shrink-0 text-stone-400 transition-transform duration-300 ease-out ${
                                    isSessionOpen ? "rotate-180" : ""
                                  }`}
                                  width="16"
                                  height="16"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="2"
                                >
                                  <path d="M6 9l6 6 6-6" />
                                </svg>
                              </button>

                              <div
                                aria-hidden={!isSessionOpen}
                                className="grid"
                                style={{
                                  gridTemplateRows: isSessionOpen
                                    ? "1fr"
                                    : "0fr",
                                  opacity: isSessionOpen ? 1 : 0,
                                  pointerEvents: isSessionOpen
                                    ? "auto"
                                    : "none",
                                  transition:
                                    "grid-template-rows 300ms ease-out, opacity 220ms ease-out",
                                }}
                              >
                                <div className="min-h-0 overflow-hidden">
                                  <div className="space-y-3 border-t border-stone-200 bg-stone-50 p-3">
                                  {sessionFolder.bookmarks.map((bookmark) => (
                                    <article
                                      key={bookmark.id}
                                      className="rounded-lg border border-stone-200 bg-white px-5 py-4 shadow-sm"
                                    >
                                      <div className="flex items-start gap-4">
                                        <button
                                          type="button"
                                          onClick={() =>
                                            openBookmarkModal(bookmark.id)
                                          }
                                          className="min-w-0 flex-1 text-left"
                                          aria-haspopup="dialog"
                                        >
                                          <div className="flex items-center justify-start gap-3">
                                            <span className="shrink-0 text-xs text-stone-400">
                                              {formatBookmarkDate(
                                                bookmark.createdAt
                                              )}
                                            </span>
                                          </div>

                                          <p
                                            className="mt-1.5 text-sm leading-relaxed text-stone-500"
                                            style={{
                                              display: "-webkit-box",
                                              WebkitLineClamp: 2,
                                              WebkitBoxOrient: "vertical",
                                              overflow: "hidden",
                                            }}
                                          >
                                            {getBookmarkPreview(bookmark.content)}
                                          </p>

                                          <p className="mt-2 text-xs font-medium text-red-600">
                                            View saved response
                                          </p>
                                        </button>

                                        <button
                                          type="button"
                                          onClick={() =>
                                            removeBookmark(bookmark.id)
                                          }
                                          className="mt-0.5 shrink-0 rounded-md p-1 text-stone-400 transition-colors hover:bg-red-50 hover:text-red-600"
                                          title="Remove Bookmark"
                                          aria-label="Remove Bookmark"
                                        >
                                          <svg
                                            xmlns="http://www.w3.org/2000/svg"
                                            width="18"
                                            height="18"
                                            viewBox="0 0 24 24"
                                            fill="none"
                                            stroke="currentColor"
                                            strokeWidth="2"
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                          >
                                            <path d="M3 6h18" />
                                            <path d="M8 6V4h8v2" />
                                            <path d="M19 6l-1 14H6L5 6" />
                                            <path d="M10 11v5" />
                                            <path d="M14 11v5" />
                                          </svg>
                                        </button>
                                      </div>
                                    </article>
                                  ))}
                                  </div>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                        </div>
                      </div>
                    </div>
                  </section>
                );
              })}
            </div>
          )}
        </div>
      </section>

      </main>

      {selectedBookmark &&
        createPortal(
          <div
            className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
            style={{
              position: "fixed",
              inset: 0,
              width: "100vw",
              height: "100vh",
            }}
          >
            <button
              type="button"
              aria-label="Close saved response"
              onClick={closeBookmarkModal}
              className="absolute inset-0"
              style={{
                backgroundColor: "rgba(15, 23, 42, 0.58)",
                backdropFilter: "blur(3px)",
                WebkitBackdropFilter: "blur(3px)",
                animation: isBookmarkModalClosing
                  ? "bookmarkBackdropOut 320ms ease-in forwards"
                  : "bookmarkBackdropIn 320ms ease-out forwards",
              }}
            />

            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="saved-response-dialog-title"
              className="relative z-10 flex flex-col overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-2xl"
              style={{
                width: "min(780px, calc(100vw - 3rem))",
                maxHeight: "85vh",
                animation: isBookmarkModalClosing
                  ? "bookmarkDialogOut 320ms cubic-bezier(0.4, 0, 1, 1) forwards"
                  : "bookmarkDialogIn 420ms cubic-bezier(0.16, 1, 0.3, 1) forwards",
              }}
              onClick={(event) => event.stopPropagation()}
            >
              <div
                className="flex items-start justify-between gap-6 border-b border-stone-200"
                style={{ padding: "1.75rem 2rem 1.35rem" }}
              >
                <div className="min-w-0 pr-3">
                  <h2
                    id="saved-response-dialog-title"
                    className="text-xl font-bold leading-snug text-stone-800"
                  >
                    {`${getSessionLabel(selectedBookmark)} • Chat`}
                  </h2>

                  <p className="mt-2 text-sm text-stone-400">
                    Saved {formatBookmarkDate(selectedBookmark.createdAt)}
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    onClick={handleCopyBookmark}
                    disabled={!selectedBookmark.content}
                    className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                      copyStatus === "copied"
                        ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                        : copyStatus === "error"
                          ? "border-red-200 bg-red-50 text-red-600"
                          : "border-stone-200 bg-white text-stone-600 hover:bg-stone-50 hover:text-stone-800"
                    }`}
                    aria-label="Copy saved response"
                  >
                    {copyStatus === "copied" ? (
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <path d="m5 12 4 4L19 6" />
                      </svg>
                    ) : (
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <rect width="14" height="14" x="8" y="8" rx="2" />
                        <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
                      </svg>
                    )}
                    {copyStatus === "copied"
                      ? "Copied"
                      : copyStatus === "error"
                        ? "Try again"
                        : "Copy"}
                  </button>

                  <button
                    type="button"
                    onClick={handleGoToSession}
                    className="inline-flex items-center gap-2 rounded-full border border-red-200 bg-white px-4 py-2 text-sm font-semibold text-red-600 transition-colors hover:bg-red-50 hover:text-red-700"
                  >
                    Go to Session
                    <span aria-hidden="true">→</span>
                  </button>
                </div>
              </div>

              <div
                className="custom-scrollbar max-h-[58vh] overflow-y-auto"
                style={{ padding: "2rem" }}
              >
                <article className="max-w-none text-[15px] leading-8 text-stone-700">
                  {selectedBookmark.content ? (
                    <FormattedMessage content={selectedBookmark.content} />
                  ) : (
                    <p>Saved AI response</p>
                  )}

                  {selectedBookmark.images &&
                    selectedBookmark.images.length > 0 && (
                      <div className="mt-6 space-y-4">
                        {selectedBookmark.images.map((imageUrl, imageIndex) => (
                          <img
                            key={`${selectedBookmark.id}-${imageUrl}-${imageIndex}`}
                            src={imageUrl}
                            alt="Bookmarked response visual"
                            className="w-full max-w-[620px] rounded-xl border border-stone-200 bg-white"
                          />
                        ))}
                      </div>
                    )}
                </article>
              </div>
            </div>
          </div>,
          document.body
        )}

      <style jsx global>{`
        .bookmarks-recent-scroll {
          overscroll-behavior: contain;
          scrollbar-width: thin;
          scrollbar-color: #57534e transparent;
        }

        .bookmarks-recent-scroll::-webkit-scrollbar {
          width: 8px;
        }

        .bookmarks-recent-scroll::-webkit-scrollbar-track {
          background: transparent;
        }

        .bookmarks-recent-scroll::-webkit-scrollbar-thumb {
          background: #57534e;
          border: 2px solid #1c1917;
          border-radius: 999px;
        }

        .bookmarks-recent-scroll::-webkit-scrollbar-thumb:hover {
          background: #78716c;
        }

        .bookmarks-recent-scroll::-webkit-scrollbar-button {
          display: none;
          width: 0;
          height: 0;
        }

        @keyframes bookmarkBackdropIn {
          from {
            opacity: 0;
          }
          to {
            opacity: 1;
          }
        }

        @keyframes bookmarkBackdropOut {
          from {
            opacity: 1;
          }
          to {
            opacity: 0;
          }
        }

        @keyframes bookmarkDialogIn {
          from {
            opacity: 0;
            transform: translateY(22px) scale(0.96);
          }
          65% {
            opacity: 1;
            transform: translateY(-2px) scale(1.008);
          }
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }

        @keyframes bookmarkDialogOut {
          from {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
          to {
            opacity: 0;
            transform: translateY(18px) scale(0.97);
          }
        }
      `}</style>
    </>
  );
}
