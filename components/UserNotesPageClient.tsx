"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import WorkspaceUtilityPage from "./WorkspaceUtilityPage";

type UserNote = {
  id: string;
  title: string;
  topic: string;
  content: string;
  createdAt: number;
  updatedAt: number;
};

const USER_NOTES_STORAGE_KEY = "walter_user_notes";

function readStoredNotes() {
  try {
    const savedNotes = localStorage.getItem(USER_NOTES_STORAGE_KEY);

    if (!savedNotes) return [] as UserNote[];

    const parsedNotes = JSON.parse(savedNotes);

    return Array.isArray(parsedNotes)
      ? parsedNotes.filter(
          (note): note is UserNote =>
            Boolean(note) &&
            typeof note.id === "string" &&
            typeof note.title === "string" &&
            typeof note.content === "string",
        )
      : [];
  } catch (error) {
    console.error("Failed to read user notes:", error);
    return [] as UserNote[];
  }
}

function formatNoteDate(timestamp: number) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(timestamp);
}

function createNoteId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `note-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export default function UserNotesPageClient() {
  const [notes, setNotes] = useState<UserNote[]>([]);
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [viewingNoteId, setViewingNoteId] = useState<string | null>(null);
  const [isNoteModalClosing, setIsNoteModalClosing] = useState(false);
  const [copyStatus, setCopyStatus] = useState<
    "idle" | "copied" | "error"
  >("idle");
  const [isCreating, setIsCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [topic, setTopic] = useState("");
  const [content, setContent] = useState("");

  useEffect(() => {
    queueMicrotask(() => {
      setNotes(readStoredNotes());
    });
  }, []);

  const sortedNotes = useMemo(
    () => [...notes].sort((first, second) => second.updatedAt - first.updatedAt),
    [notes],
  );
  const selectedNote =
    notes.find((note) => note.id === selectedNoteId) || null;
  const viewingNote =
    notes.find((note) => note.id === viewingNoteId) || null;
  const isEditorOpen = isCreating || Boolean(selectedNote);
  const canSave = title.trim().length > 0 && content.trim().length > 0;

  const openNoteModal = (noteId: string) => {
    setIsNoteModalClosing(false);
    setCopyStatus("idle");
    setViewingNoteId(noteId);
  };

  const closeNoteModal = useCallback(() => {
    if (!viewingNoteId || isNoteModalClosing) return;

    setIsNoteModalClosing(true);

    window.setTimeout(() => {
      setViewingNoteId(null);
      setIsNoteModalClosing(false);
      setCopyStatus("idle");
    }, 320);
  }, [isNoteModalClosing, viewingNoteId]);

  const handleCopyNote = async () => {
    if (!viewingNote?.content) return;

    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(viewingNote.content);
      } else {
        const copyField = document.createElement("textarea");

        copyField.value = viewingNote.content;
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
      console.error("Failed to copy note:", error);
      setCopyStatus("error");
    }
  };

  useEffect(() => {
    if (!viewingNote) return;

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeNoteModal();
      }
    };

    window.addEventListener("keydown", closeOnEscape);

    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [closeNoteModal, viewingNote]);

  const persistNotes = (nextNotes: UserNote[]) => {
    setNotes(nextNotes);
    localStorage.setItem(USER_NOTES_STORAGE_KEY, JSON.stringify(nextNotes));
  };

  const closeEditor = () => {
    setSelectedNoteId(null);
    setIsCreating(false);
    setTitle("");
    setTopic("");
    setContent("");
  };

  const beginNewNote = () => {
    setSelectedNoteId(null);
    setIsCreating(true);
    setTitle("");
    setTopic("");
    setContent("");
  };

  const beginEditNote = (note: UserNote) => {
    setIsCreating(false);
    setSelectedNoteId(note.id);
    setTitle(note.title);
    setTopic(note.topic || "");
    setContent(note.content);
  };

  const saveNote = () => {
    if (!canSave) return;

    const now = Date.now();

    if (selectedNote) {
      persistNotes(
        notes.map((note) =>
          note.id === selectedNote.id
            ? {
                ...note,
                title: title.trim(),
                topic: topic.trim(),
                content: content.trim(),
                updatedAt: now,
              }
            : note,
        ),
      );
    } else {
      persistNotes([
        ...notes,
        {
          id: createNoteId(),
          title: title.trim(),
          topic: topic.trim(),
          content: content.trim(),
          createdAt: now,
          updatedAt: now,
        },
      ]);
    }

    closeEditor();
  };

  const deleteNote = (note: UserNote) => {
    const confirmed = window.confirm(`Delete "${note.title}"?`);

    if (!confirmed) return;

    persistNotes(notes.filter((candidate) => candidate.id !== note.id));

    if (selectedNoteId === note.id) {
      closeEditor();
    }
  };

  return (
    <>
      <WorkspaceUtilityPage
        activePage="user-notes"
        title="User Notes"
        subtitle="Keep personal study notes, reminders, and key takeaways in one place."
        storageKey={USER_NOTES_STORAGE_KEY}
        emptyTitle="No notes yet"
        emptyMessage="Create your first note to start organizing your study ideas."
        badgeLabel={notes.length === 1 ? "Note" : "Notes"}
        badgeCount={notes.length}
      >
        <div className="space-y-4 pb-12">
        <div className="flex justify-start">
          <button
            type="button"
            onClick={beginNewNote}
            className="inline-flex items-center gap-2 rounded-full bg-red-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-red-700"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <path d="M12 5v14" />
              <path d="M5 12h14" />
            </svg>
            New Note
          </button>
        </div>

        {isEditorOpen && (
          <section className="rounded-xl border border-red-100 bg-white p-5 shadow-md">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="font-bold text-stone-800">
                  {selectedNote ? "Edit Note" : "New Note"}
                </h2>
                <p className="mt-1 text-xs text-stone-500">
                  Notes are saved locally in this browser.
                </p>
              </div>

              <button
                type="button"
                onClick={closeEditor}
                className="rounded-full p-2 text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700"
                aria-label="Close note editor"
              >
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  aria-hidden="true"
                >
                  <path d="M18 6 6 18" />
                  <path d="m6 6 12 12" />
                </svg>
              </button>
            </div>

            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <label className="block">
                <span className="mb-2 block text-xs font-bold uppercase tracking-wide text-stone-500">
                  Title
                </span>
                <input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="e.g. UART vs SPI review"
                  className="h-11 w-full rounded-lg border border-stone-200 bg-stone-50/60 px-3 text-sm text-stone-800 outline-none transition-colors focus:border-red-300 focus:bg-white focus:ring-2 focus:ring-red-100"
                />
              </label>

              <label className="block">
                <span className="mb-2 block text-xs font-bold uppercase tracking-wide text-stone-500">
                  Module or Topic
                </span>
                <input
                  value={topic}
                  onChange={(event) => setTopic(event.target.value)}
                  placeholder="Optional"
                  className="h-11 w-full rounded-lg border border-stone-200 bg-stone-50/60 px-3 text-sm text-stone-800 outline-none transition-colors focus:border-red-300 focus:bg-white focus:ring-2 focus:ring-red-100"
                />
              </label>
            </div>

            <label className="mt-4 block">
              <span className="mb-2 block text-xs font-bold uppercase tracking-wide text-stone-500">
                Note
              </span>
              <textarea
                value={content}
                onChange={(event) => setContent(event.target.value)}
                placeholder="Write your notes here..."
                rows={7}
                className="w-full resize-none rounded-xl border border-stone-200 bg-stone-50/60 px-4 py-3 text-sm leading-6 text-stone-800 outline-none transition-colors focus:border-red-300 focus:bg-white focus:ring-2 focus:ring-red-100"
              />
            </label>

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={closeEditor}
                className="rounded-full border border-stone-200 bg-white px-4 py-2 text-sm font-semibold text-stone-600 transition-colors hover:bg-stone-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={saveNote}
                disabled={!canSave}
                className="rounded-full bg-red-600 px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {selectedNote ? "Save Changes" : "Save Note"}
              </button>
            </div>
          </section>
        )}

        {sortedNotes.length === 0 ? (
          <section className="rounded-xl border border-dashed border-stone-300 bg-white p-10 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-50 text-red-600">
              <svg
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden="true"
              >
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
                <path d="M14 2v6h6" />
                <path d="M8 13h8" />
                <path d="M8 17h5" />
              </svg>
            </div>
            <h2 className="mt-4 font-semibold text-stone-800">No notes yet</h2>
            <p className="mt-2 text-sm text-stone-500">
              Create a note for anything you want to remember while studying.
            </p>
          </section>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {sortedNotes.map((note) => (
              <article
                key={note.id}
                className="relative flex min-h-[220px] flex-col rounded-xl border border-red-100 bg-gradient-to-br from-white via-white to-red-50/45 p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:border-red-200 hover:shadow-md"
              >
                <button
                  type="button"
                  onClick={() => openNoteModal(note.id)}
                  className="absolute inset-0 z-0 cursor-pointer rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-red-300"
                  aria-label={`Open ${note.title}`}
                />

                <div className="pointer-events-none relative z-10 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="truncate font-bold text-stone-800">
                      {note.title}
                    </h2>
                    {note.topic && (
                      <span className="mt-2 inline-flex max-w-full truncate rounded-full bg-red-50 px-2.5 py-1 text-[11px] font-semibold text-red-700">
                        {note.topic}
                      </span>
                    )}
                  </div>

                  <div className="pointer-events-auto flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        beginEditNote(note);
                      }}
                      className="rounded-md p-1.5 text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700"
                      title="Edit note"
                      aria-label={`Edit ${note.title}`}
                    >
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        aria-hidden="true"
                      >
                        <path d="M12 20h9" />
                        <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z" />
                      </svg>
                    </button>

                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        deleteNote(note);
                      }}
                      className="rounded-md p-1.5 text-stone-400 transition-colors hover:bg-red-50 hover:text-red-600"
                      title="Delete note"
                      aria-label={`Delete ${note.title}`}
                    >
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        aria-hidden="true"
                      >
                        <path d="M3 6h18" />
                        <path d="M8 6V4h8v2" />
                        <path d="m19 6-1 14H6L5 6" />
                      </svg>
                    </button>
                  </div>
                </div>

                <p
                  className="pointer-events-none relative z-10 mt-4 flex-1 whitespace-pre-wrap text-sm leading-6 text-stone-600"
                  style={{
                    display: "-webkit-box",
                    WebkitLineClamp: 5,
                    WebkitBoxOrient: "vertical",
                    overflow: "hidden",
                  }}
                >
                  {note.content}
                </p>

                <p className="pointer-events-none relative z-10 mt-4 border-t border-stone-100 pt-3 text-[11px] text-stone-400">
                  Updated {formatNoteDate(note.updatedAt)}
                </p>
              </article>
            ))}
          </div>
        )}
        </div>
      </WorkspaceUtilityPage>

      {viewingNote &&
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
              aria-label="Close note"
              onClick={closeNoteModal}
              className="absolute inset-0"
              style={{
                backgroundColor: "rgba(15, 23, 42, 0.58)",
                backdropFilter: "blur(3px)",
                WebkitBackdropFilter: "blur(3px)",
                animation: isNoteModalClosing
                  ? "noteBackdropOut 320ms ease-in forwards"
                  : "noteBackdropIn 320ms ease-out forwards",
              }}
            />

            <section
              role="dialog"
              aria-modal="true"
              aria-labelledby={`note-dialog-title-${viewingNote.id}`}
              className="relative z-10 flex min-w-0 flex-col overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-2xl"
              style={{
                width: "min(780px, calc(100vw - 3rem))",
                maxHeight: "85vh",
                animation: isNoteModalClosing
                  ? "noteDialogOut 320ms cubic-bezier(0.4, 0, 1, 1) forwards"
                  : "noteDialogIn 420ms cubic-bezier(0.16, 1, 0.3, 1) forwards",
              }}
            >
              <header
                className="flex items-start justify-between gap-6 border-b border-stone-200"
                style={{ padding: "1.75rem 2rem 1.35rem" }}
              >
                <div className="min-w-0">
                  <h2
                    id={`note-dialog-title-${viewingNote.id}`}
                    className="text-xl font-bold leading-snug text-stone-800"
                    style={{ overflowWrap: "anywhere" }}
                  >
                    {viewingNote.title}
                  </h2>

                  <div className="mt-2 flex flex-wrap items-center gap-2.5">
                    {viewingNote.topic && (
                      <span className="inline-flex rounded-full border border-red-100 bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-700">
                        {viewingNote.topic}
                      </span>
                    )}
                    <span className="text-sm text-stone-400">
                      Updated {formatNoteDate(viewingNote.updatedAt)}
                    </span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleCopyNote}
                  disabled={!viewingNote.content}
                  className={`inline-flex shrink-0 items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                    copyStatus === "copied"
                      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                      : copyStatus === "error"
                        ? "border-red-200 bg-red-50 text-red-600"
                        : "border-stone-200 bg-white text-stone-600 hover:bg-stone-50 hover:text-stone-800"
                  }`}
                  aria-label="Copy note"
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
              </header>

              <div
                className="custom-scrollbar min-w-0 max-h-[58vh] overflow-y-auto"
                style={{ padding: "2rem" }}
              >
                <article className="min-w-0 max-w-none text-[15px] leading-8 text-stone-700">
                  <p
                    className="whitespace-pre-wrap"
                    style={{
                      overflowWrap: "anywhere",
                      wordBreak: "break-word",
                    }}
                  >
                    {viewingNote.content}
                  </p>
                </article>
              </div>
            </section>
          </div>,
          document.body,
        )}

      <style jsx global>{`
        @keyframes noteBackdropIn {
          from {
            opacity: 0;
          }
          to {
            opacity: 1;
          }
        }

        @keyframes noteBackdropOut {
          from {
            opacity: 1;
          }
          to {
            opacity: 0;
          }
        }

        @keyframes noteDialogIn {
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

        @keyframes noteDialogOut {
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
