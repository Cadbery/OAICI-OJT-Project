"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import WorkspaceUtilityPage from "./WorkspaceUtilityPage";

type LearnerFeedbackItem = {
  id: string;
  moduleTitle: string;
  progress: string;
  feedbackDate: string;
  feedback: string;
};

type AiFeedbackResponse = {
  ok?: boolean;
  feedbackItems?: LearnerFeedbackItem[];
  scrapedAt?: string;
  error?: string;
};

type ParsedFeedback = {
  summary: string;
  strengths: string[];
  weaknesses: string[];
};

function removeDuplicateFeedbackLines(lines: string[]) {
  const seenLines = new Set<string>();

  return lines.filter((line) => {
    const normalizedLine = line.replace(/\s+/g, " ").trim().toLowerCase();

    if (!normalizedLine || seenLines.has(normalizedLine)) {
      return false;
    }

    seenLines.add(normalizedLine);
    return true;
  });
}

function parseFeedbackSections(feedback: string): ParsedFeedback {
  const allLines = feedback
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const recommendationsIndex = allLines.findIndex((line) =>
    /^(recommended next steps|recommendations)$/i.test(line)
  );
  const lines =
    recommendationsIndex >= 0
      ? allLines.slice(0, recommendationsIndex)
      : allLines;
  const strengthsIndex = lines.findIndex((line) => /^strengths?:$/i.test(line));
  const weaknessesIndex = lines.findIndex((line) =>
    /^weakness(?:es)?:$/i.test(line)
  );

  if (strengthsIndex === -1 && weaknessesIndex === -1) {
    return {
      summary: feedback,
      strengths: [],
      weaknesses: [],
    };
  }

  const firstSectionIndex = Math.min(
    ...[strengthsIndex, weaknessesIndex].filter((index) => index >= 0)
  );
  const summary = lines.slice(0, firstSectionIndex).join("\n");
  const strengths = removeDuplicateFeedbackLines(
    strengthsIndex >= 0
      ? lines.slice(
          strengthsIndex + 1,
          weaknessesIndex > strengthsIndex ? weaknessesIndex : lines.length
        )
      : []
  );
  const weaknesses = removeDuplicateFeedbackLines(
    weaknessesIndex >= 0 ? lines.slice(weaknessesIndex + 1) : []
  );

  return {
    summary,
    strengths,
    weaknesses,
  };
}

function FeedbackSection({
  title,
  variant,
  children,
}: {
  title: string;
  variant: "summary" | "strengths" | "weaknesses";
  children: ReactNode;
}) {
  const titleClassName =
    variant === "strengths"
      ? "text-emerald-700"
      : variant === "weaknesses"
        ? "text-red-700"
        : "text-stone-700";
  const dotClassName =
    variant === "strengths"
      ? "bg-emerald-500"
      : variant === "weaknesses"
        ? "bg-red-500"
        : "bg-stone-400";
  const cardClassName =
    variant === "strengths"
      ? "border-emerald-100 bg-emerald-50/35"
      : variant === "weaknesses"
        ? "border-red-100 bg-red-50/60"
        : "border-stone-100 bg-white/95";

  return (
    <section
      className={`my-3 min-w-0 rounded-xl border px-5 pt-5 pb-4 shadow-sm ${cardClassName}`}
    >
      <div className="mb-3 flex items-center gap-2">
        <span className={`h-1.5 w-1.5 rounded-full ${dotClassName}`} />
        <h3
          className={`text-xs font-bold uppercase tracking-[0.16em] ${titleClassName}`}
        >
          {title}
        </h3>
      </div>
      <div className="text-sm leading-7 text-stone-700">{children}</div>
    </section>
  );
}

function FeedbackCard({
  feedbackItem,
  isExpanded,
  onToggle,
}: {
  feedbackItem: LearnerFeedbackItem;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const parsedFeedback = parseFeedbackSections(feedbackItem.feedback);

  return (
    <article className="overflow-hidden rounded-xl border border-red-100 bg-gradient-to-br from-white via-white to-red-50/35 shadow-sm">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isExpanded}
        className="flex w-full items-start justify-between gap-4 border-b border-red-100/70 bg-red-50/25 px-5 py-4 text-left transition-colors hover:bg-red-50/50"
      >
        <div className="min-w-0">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-red-100 bg-red-50 text-red-600">
              <svg
                width="16"
                height="16"
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
            </span>

            <div className="min-w-0">
              <h2 className="break-words text-sm font-bold text-stone-900">
                {feedbackItem.moduleTitle}
              </h2>
              {feedbackItem.feedbackDate && (
                <p className="mt-1 text-xs text-stone-500">
                  Feedback from {feedbackItem.feedbackDate}
                </p>
              )}
            </div>
          </div>
        </div>

        <span className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700">
          <svg
            className={`transition-transform duration-300 ease-out ${isExpanded ? "rotate-180" : ""}`}
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </span>
      </button>

      <div
        aria-hidden={!isExpanded}
        className="grid"
        style={{
          gridTemplateRows: isExpanded ? "1fr" : "0fr",
          opacity: isExpanded ? 1 : 0,
          transition: "grid-template-rows 300ms ease-out, opacity 220ms ease-out",
        }}
      >
        <div className="overflow-hidden">
        <div
          className="grid gap-4 bg-stone-50/60 px-5 py-5"
          style={{
            gridTemplateColumns:
              "minmax(0, 1.2fr) minmax(0, 1fr) minmax(0, 1fr)",
          }}
        >
          <FeedbackSection title="Summary" variant="summary">
            <p className="whitespace-pre-wrap">
              {parsedFeedback.summary || feedbackItem.feedback}
            </p>
          </FeedbackSection>

          <FeedbackSection title="Strengths" variant="strengths">
            {parsedFeedback.strengths.length > 0 ? (
              <ol className="space-y-2.5">
                {parsedFeedback.strengths.map((strength, index) => (
                  <li
                    key={`${feedbackItem.id}-strength-${index}`}
                    className="flex gap-3"
                  >
                    <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-xs font-bold text-emerald-700">
                      {index + 1}
                    </span>
                    <span>{strength}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-stone-400">No strengths listed yet.</p>
            )}
          </FeedbackSection>

          <FeedbackSection title="Weaknesses" variant="weaknesses">
            {parsedFeedback.weaknesses.length > 0 ? (
              <ol className="space-y-2.5">
                {parsedFeedback.weaknesses.map((weakness, index) => (
                  <li
                    key={`${feedbackItem.id}-weakness-${index}`}
                    className="flex gap-3 text-red-900"
                  >
                    <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-red-100 text-xs font-bold text-red-700">
                      {index + 1}
                    </span>
                    <span>{weakness}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-stone-400">No weaknesses listed yet.</p>
            )}
          </FeedbackSection>
        </div>
        </div>
      </div>
    </article>
  );
}

export default function AiFeedbackPageClient() {
  const [feedbackItems, setFeedbackItems] = useState<LearnerFeedbackItem[]>([]);
  const [expandedFeedbackId, setExpandedFeedbackId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  const loadFeedback = useCallback(async () => {
    setIsLoading(true);
    setError("");

    try {
      const response = await fetch("/api/nf/ai-feedback", {
        method: "POST",
      });
      const data = (await response.json().catch(() => ({}))) as AiFeedbackResponse;

      if (!response.ok || data.ok === false) {
        throw new Error(
          data.error || "Failed to load AI feedback from Noodle Factory."
        );
      }

      const nextFeedbackItems = Array.isArray(data.feedbackItems)
        ? data.feedbackItems
        : [];

      setFeedbackItems(nextFeedbackItems);
      setExpandedFeedbackId((currentFeedbackId) => {
        if (
          currentFeedbackId &&
          nextFeedbackItems.some((feedbackItem) => feedbackItem.id === currentFeedbackId)
        ) {
          return currentFeedbackId;
        }

        return null;
      });
    } catch (loadError) {
      const message =
        loadError instanceof Error
          ? loadError.message
          : "Failed to load AI feedback from Noodle Factory.";

      setError(message);
      setFeedbackItems([]);
      setExpandedFeedbackId(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    let isActive = true;

    queueMicrotask(() => {
      if (isActive) {
        void loadFeedback();
      }
    });

    return () => {
      isActive = false;
    };
  }, [loadFeedback]);

  return (
    <WorkspaceUtilityPage
      activePage="ai-feedback"
      title="AI Feedback"
      subtitle="Learner module feedback and improvement notes in one place."
      storageKey="walter_ai_feedback"
      emptyTitle="No AI feedback yet"
      emptyMessage="Available learner feedback from Insights will appear here once Noodle Factory lists it."
      badgeLabel="Feedback Items"
      badgeCount={feedbackItems.length}
      showBadge={false}
    >
      <div className="space-y-4 pb-12">
        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {error}
          </div>
        )}

        {isLoading && feedbackItems.length === 0 ? (
          <div className="rounded-xl border border-red-100 bg-white p-8 text-center text-sm text-stone-500 shadow-sm">
            Loading learner feedback...
          </div>
        ) : feedbackItems.length === 0 ? (
          <div className="rounded-xl border border-red-100 bg-white p-8 text-center shadow-sm">
            <h2 className="text-base font-semibold text-stone-800">
              No available feedback found
            </h2>
            <p className="mt-2 text-sm text-stone-500">
              I found the Insights page, but no enabled learner feedback buttons
              were available yet.
            </p>
          </div>
        ) : (
          feedbackItems.map((feedbackItem) => (
            <FeedbackCard
              key={feedbackItem.id}
              feedbackItem={feedbackItem}
              isExpanded={expandedFeedbackId === feedbackItem.id}
              onToggle={() =>
                setExpandedFeedbackId((currentFeedbackId) =>
                  currentFeedbackId === feedbackItem.id ? null : feedbackItem.id
                )
              }
            />
          ))
        )}
      </div>
    </WorkspaceUtilityPage>
  );
}
