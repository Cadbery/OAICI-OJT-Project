"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import WorkspaceUtilityPage from "./WorkspaceUtilityPage";

type GradeSubmission = {
  id: string;
  exerciseName: string;
  type: string;
  submissionDate: string;
  highestScore: string;
  firstAttempt: string;
};

type GradesResponse = {
  ok?: boolean;
  submissions?: GradeSubmission[];
  scrapedAt?: string;
  error?: string;
};

type GradeAttemptOption = {
  id: string;
  label: string;
  isSelected: boolean;
};

type QuizAttemptQuestion = {
  number: number;
  score: string;
  question: string;
  yourAnswer: string;
  correctAnswer: string;
};

type RolePlayAttemptLog = {
  id: string;
  message: string;
  sender: string;
  date: string;
};

type RolePlayAttemptCriterion = {
  id: string;
  criterion: string;
  score: string;
  feedback: string;
};

type GradeAttemptDetail = {
  exerciseName: string;
  type: "quiz" | "roleplay";
  attemptOptions: GradeAttemptOption[];
  selectedAttemptId: string;
  selectedAttemptDate: string;
  score: string;
  quizQuestions: QuizAttemptQuestion[];
  rolePlayLogs: RolePlayAttemptLog[];
  rolePlayCriteria: RolePlayAttemptCriterion[];
};

type GradeAttemptResponse = {
  ok?: boolean;
  attempt?: GradeAttemptDetail;
  error?: string;
};

function parseScore(score: string) {
  const match = score.match(/(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/);

  if (!match) {
    return null;
  }

  const earned = Number(match[1]);
  const possible = Number(match[2]);

  if (!Number.isFinite(earned) || !Number.isFinite(possible) || possible <= 0) {
    return null;
  }

  return Math.round((earned / possible) * 100);
}

function scoreBadgeClass(score: string) {
  const percentage = parseScore(score);

  if (percentage === null) {
    return "bg-stone-100 text-stone-700";
  }

  if (percentage >= 80) {
    return "bg-emerald-50 text-emerald-700";
  }

  if (percentage >= 50) {
    return "bg-amber-50 text-amber-700";
  }

  return "bg-red-50 text-red-700";
}

function getCriterionFeedbackBody(
  criterion: RolePlayAttemptCriterion
) {
  const feedback = criterion.feedback.trim();
  const prefixMatch = feedback.match(/^([^:]+):\s*/);

  if (
    prefixMatch &&
    prefixMatch[1].replace(/\s+/g, " ").trim().toLowerCase() ===
      criterion.criterion.replace(/\s+/g, " ").trim().toLowerCase()
  ) {
    return feedback.slice(prefixMatch[0].length).trim();
  }

  return feedback;
}

function LoadingSpinner({ size = 28 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      style={{
        display: "block",
        width: `${size}px`,
        height: `${size}px`,
        minWidth: `${size}px`,
        maxWidth: `${size}px`,
        animation: "gradesSpinnerRotate 800ms linear infinite",
      }}
    >
      <circle
        cx="12"
        cy="12"
        r="9"
        stroke="#fee2e2"
        strokeWidth="3"
      />
      <path
        d="M12 3a9 9 0 0 1 9 9"
        stroke="#dc2626"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

function isQuizSubmission(submission: GradeSubmission) {
  return submission.type.toLowerCase().includes("quiz");
}

function isRolePlaySubmission(submission: GradeSubmission) {
  const normalizedType = submission.type.toLowerCase().replace(/[\s-]/g, "");

  return normalizedType.includes("roleplay");
}

function SubmissionTable({
  title,
  variant,
  submissions,
  isLoading,
  emptyTitle,
  emptyMessage,
  onSelectSubmission,
}: {
  title: string;
  variant: "quiz" | "roleplay";
  submissions: GradeSubmission[];
  isLoading: boolean;
  emptyTitle: string;
  emptyMessage: string;
  onSelectSubmission: (submission: GradeSubmission) => void;
}) {
  const [highlightedSubmissionId, setHighlightedSubmissionId] = useState<
    string | null
  >(null);
  const iconClassName =
    variant === "quiz"
      ? "border-blue-100 bg-blue-50 text-blue-600"
      : "border-emerald-100 bg-emerald-50 text-emerald-600";
  const getCellStyle = (submissionId: string) => ({
    backgroundColor:
      highlightedSubmissionId === submissionId ? "#fee2e2" : undefined,
  });

  return (
    <section className="overflow-hidden rounded-xl border border-red-100 bg-gradient-to-br from-red-50/70 via-white to-rose-50/40 shadow-md">
      <div className="border-b border-red-100 bg-red-50/70 px-5 py-4">
        <div className="flex items-center gap-3">
          <span
            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border ${iconClassName}`}
          >
            {variant === "quiz" ? (
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden="true"
              >
                <path d="M4 4h16v14H7l-3 3V4Z" />
                <path d="m8 13 2.5-2.5L12 12l4-4" />
              </svg>
            ) : (
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
            )}
          </span>

          <h2 className="text-sm font-bold text-red-700">{title}</h2>
        </div>
      </div>

      {isLoading && submissions.length === 0 ? (
        <div className="p-8 text-center text-sm text-stone-500">
          Loading grade submissions...
        </div>
      ) : submissions.length === 0 ? (
        <div className="p-8 text-center">
          <h3 className="text-base font-semibold text-stone-800">
            {emptyTitle}
          </h3>
          <p className="mt-2 text-sm text-stone-500">{emptyMessage}</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table
            className="w-full divide-y divide-red-100 text-sm"
            style={{ tableLayout: "fixed" }}
          >
            <colgroup>
              <col style={{ width: "34%" }} />
              <col style={{ width: "26%" }} />
              <col style={{ width: "20%" }} />
              <col style={{ width: "20%" }} />
            </colgroup>
            <thead className="bg-white/80">
              <tr>
                <th className="px-5 py-3 text-left font-semibold text-stone-600">
                  Exercise Name
                </th>
                <th className="px-5 py-3 text-left font-semibold text-stone-600">
                  Submission Date
                </th>
                <th className="px-5 py-3 text-left font-semibold text-stone-600">
                  Highest Score
                </th>
                <th className="px-5 py-3 text-left font-semibold text-stone-600">
                  First Attempt
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100 bg-white/95">
              {submissions.map((submission) => (
                <tr
                  key={submission.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => onSelectSubmission(submission)}
                  onMouseEnter={() =>
                    setHighlightedSubmissionId(submission.id)
                  }
                  onMouseLeave={() => setHighlightedSubmissionId(null)}
                  onFocus={() => setHighlightedSubmissionId(submission.id)}
                  onBlur={() => setHighlightedSubmissionId(null)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onSelectSubmission(submission);
                    }
                  }}
                  className="grade-submission-row group cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-red-300"
                  title={`View all attempts for ${submission.exerciseName}`}
                >
                  <td
                    className="px-5 py-4 font-medium text-blue-800 break-words transition-colors duration-200"
                    style={getCellStyle(submission.id)}
                  >
                    {submission.exerciseName}
                  </td>
                  <td
                    className="px-5 py-4 text-stone-600 transition-colors duration-200"
                    style={getCellStyle(submission.id)}
                  >
                    {submission.submissionDate}
                  </td>
                  <td
                    className="px-5 py-4 transition-colors duration-200"
                    style={getCellStyle(submission.id)}
                  >
                    <span
                      className={`rounded-full px-3 py-1 text-xs font-semibold ${scoreBadgeClass(
                        submission.highestScore
                      )}`}
                    >
                      {submission.highestScore || "-"}
                    </span>
                  </td>
                  <td
                    className="px-5 py-4 text-stone-600 transition-colors duration-200"
                    style={getCellStyle(submission.id)}
                  >
                    {submission.firstAttempt || "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <style jsx global>{`
        .grade-submission-row:hover > td,
        .grade-submission-row:focus > td {
          background-color: #fee2e2 !important;
        }
      `}</style>
    </section>
  );
}

function AttemptReview({
  submission,
  attempt,
  isLoading,
  error,
  onBack,
  onAttemptChange,
}: {
  submission: GradeSubmission;
  attempt: GradeAttemptDetail | null;
  isLoading: boolean;
  error: string;
  onBack: () => void;
  onAttemptChange: (attemptId: string) => void;
}) {
  const isRolePlay =
    attempt?.type === "roleplay" || isRolePlaySubmission(submission);
  const typeLabel = isRolePlay ? "Role Play Review" : "Quiz Review";

  return (
    <div className="space-y-4 pb-12" aria-busy={isLoading}>
      <section className="overflow-hidden rounded-xl border border-red-100 bg-gradient-to-br from-red-50/70 via-white to-rose-50/40 shadow-md">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-red-100 bg-white/85 px-5 py-4">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={onBack}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-stone-200 bg-white text-stone-600 transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-700"
              aria-label="Back to grade submissions"
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
                <path d="m15 18-6-6 6-6" />
              </svg>
            </button>

            <div className="min-w-0">
              <h2 className="truncate text-lg font-bold text-stone-800">
                {submission.exerciseName}
              </h2>
              <p className="mt-0.5 text-sm text-stone-500">{typeLabel}</p>
            </div>
          </div>

          <div className="shrink-0 rounded-xl border border-stone-200 bg-white px-5 py-3 text-right shadow-sm">
            <p className="text-[11px] font-bold uppercase tracking-wide text-stone-400">
              Score Attained
            </p>
            <p
              className={`mt-1 text-lg font-bold ${
                scoreBadgeClass(attempt?.score || submission.highestScore)
                  .split(" ")
                  .find((className) => className.startsWith("text-")) ||
                "text-stone-800"
              }`}
            >
              {attempt?.score || (isLoading ? "..." : submission.highestScore || "-")}
            </p>
          </div>
        </div>
      </section>

      <section
        className="rounded-xl border border-red-100 bg-white px-4 py-3 shadow-sm"
        style={{
          width: "fit-content",
          maxWidth: "100%",
        }}
      >
        <label className="flex max-w-full items-center gap-2.5">
          <span className="shrink-0 text-xs font-bold uppercase tracking-wide text-stone-500">
            Select Attempt:
          </span>
          <select
            value={attempt?.selectedAttemptId || ""}
            onChange={(event) => onAttemptChange(event.target.value)}
            disabled={
              isLoading || !attempt || attempt.attemptOptions.length === 0
            }
            className="h-9 rounded-lg border border-stone-200 bg-stone-50/50 px-3 text-sm font-medium text-stone-700 outline-none transition-colors focus:border-red-300 focus:bg-white focus:ring-2 focus:ring-red-100 disabled:cursor-wait disabled:text-stone-400"
            style={{
              width: "280px",
              maxWidth: "calc(100vw - 18rem)",
            }}
          >
            {!attempt && <option value="">Loading attempts...</option>}
            {attempt?.attemptOptions.map((option, optionIndex) => (
              <option key={option.id} value={option.id}>
                {`Attempt ${
                  attempt.attemptOptions.length - optionIndex
                } - ${option.label}`}
              </option>
            ))}
          </select>
        </label>
      </section>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      {isLoading && !attempt ? (
        <div className="flex min-h-[150px] flex-col items-center justify-center rounded-xl border border-red-100 bg-white px-6 py-8 text-center shadow-sm">
          <LoadingSpinner />
          <p className="mt-3 text-sm text-stone-500">
            Loading submission attempts...
          </p>
        </div>
      ) : attempt?.type === "quiz" ? (
        <section className="overflow-hidden rounded-xl border border-red-100 bg-white shadow-sm">
          <div className="border-b border-red-100 bg-red-50/45 px-5 py-4">
            <h3 className="font-bold text-stone-800">Submission</h3>
            <p className="mt-1 text-xs text-stone-500">
              {attempt.quizQuestions.length} quiz{" "}
              {attempt.quizQuestions.length === 1 ? "question" : "questions"}
            </p>
          </div>

          <div className="divide-y divide-stone-100 px-5">
            {attempt.quizQuestions.map((question) => (
              <article key={question.number} className="py-6">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs font-semibold text-stone-500">
                    Question {question.number}
                  </p>
                  <span
                    className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${scoreBadgeClass(
                      question.score
                    )}`}
                  >
                    Score: {question.score || "-"}
                  </span>
                </div>

                <p className="mt-3 text-sm font-medium leading-6 text-stone-800">
                  {question.question}
                </p>

                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <div className="rounded-lg border border-stone-200 bg-stone-50/70 p-4">
                    <p className="text-[11px] font-bold uppercase tracking-wide text-stone-400">
                      Your Answer
                    </p>
                    <p className="mt-2 text-sm leading-6 text-stone-700">
                      {question.yourAnswer || "No answer recorded"}
                    </p>
                  </div>

                  <div className="rounded-lg border border-emerald-100 bg-emerald-50/45 p-4">
                    <p className="text-[11px] font-bold uppercase tracking-wide text-emerald-700">
                      Correct Answer
                    </p>
                    <p className="mt-2 text-sm leading-6 text-stone-700">
                      {question.correctAnswer || "No answer provided"}
                    </p>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : attempt?.type === "roleplay" ? (
        <section className="overflow-hidden rounded-xl border border-red-100 bg-white shadow-sm">
          <div className="border-b border-red-100 bg-red-50/45 px-5 py-4">
            <h3 className="font-bold text-stone-800">Feedback</h3>
            <p className="mt-1 text-xs text-stone-500">
              Scores and comments for this attempt
            </p>
          </div>

          <div className="grid gap-4 p-5 md:grid-cols-2">
            {attempt.rolePlayCriteria.map((criterion) => (
              <article
                key={criterion.id}
                className="rounded-xl border border-stone-200 bg-stone-50/55 p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <h4 className="font-semibold text-stone-800">
                    {criterion.criterion}
                  </h4>
                  <span className="shrink-0 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700">
                    {criterion.score || "-"}
                  </span>
                </div>
                <p className="mt-3 text-justify text-sm leading-6 text-stone-600">
                  {getCriterionFeedbackBody(criterion) ||
                    "No written feedback provided."}
                </p>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {isLoading && attempt && (
        <div className="fixed bottom-6 right-6 z-30 flex items-center gap-2 rounded-full border border-red-100 bg-white px-4 py-2 text-xs font-semibold text-red-600 shadow-lg">
          <LoadingSpinner size={14} />
          Loading attempt...
        </div>
      )}

      <style jsx global>{`
        @keyframes gradesSpinnerRotate {
          to {
            transform: rotate(360deg);
          }
        }
      `}</style>
    </div>
  );
}

export default function GradesPageClient() {
  const [submissions, setSubmissions] = useState<GradeSubmission[]>([]);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [selectedSubmission, setSelectedSubmission] =
    useState<GradeSubmission | null>(null);
  const [attemptDetail, setAttemptDetail] =
    useState<GradeAttemptDetail | null>(null);
  const [attemptError, setAttemptError] = useState("");
  const [isAttemptLoading, setIsAttemptLoading] = useState(false);

  const loadGrades = useCallback(async () => {
    setIsLoading(true);
    setError("");

    try {
      const response = await fetch("/api/nf/grades", {
        method: "POST",
      });
      const data = (await response.json().catch(() => ({}))) as GradesResponse;

      if (!response.ok || data.ok === false) {
        throw new Error(data.error || "Failed to load grades.");
      }

      setSubmissions(Array.isArray(data.submissions) ? data.submissions : []);
    } catch (loadError) {
      const message =
        loadError instanceof Error
          ? loadError.message
          : "Failed to load grades.";

      setError(message);
      setSubmissions([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    let isActive = true;

    queueMicrotask(() => {
      if (isActive) {
        void loadGrades();
      }
    });

    return () => {
      isActive = false;
    };
  }, [loadGrades]);

  const quizSubmissions = useMemo(
    () => submissions.filter(isQuizSubmission),
    [submissions]
  );
  const rolePlaySubmissions = useMemo(
    () => submissions.filter(isRolePlaySubmission),
    [submissions]
  );

  const loadAttemptReview = async (
    submission: GradeSubmission,
    attemptId = ""
  ) => {
    if (isAttemptLoading) return;

    setSelectedSubmission(submission);
    setAttemptError("");
    setIsAttemptLoading(true);

    try {
      const response = await fetch("/api/nf/grade-attempts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          exerciseName: submission.exerciseName,
          type: submission.type,
          attemptId,
        }),
      });
      const data = (await response
        .json()
        .catch(() => ({}))) as GradeAttemptResponse;

      if (!response.ok || data.ok === false || !data.attempt) {
        throw new Error(data.error || "Failed to load submission attempts.");
      }

      setAttemptDetail(data.attempt);
    } catch (loadError) {
      const message =
        loadError instanceof Error
          ? loadError.message
          : "Failed to load submission attempts.";

      setAttemptError(message);
    } finally {
      setIsAttemptLoading(false);
    }
  };

  const handleSelectSubmission = (submission: GradeSubmission) => {
    setAttemptDetail(null);
    void loadAttemptReview(submission);
  };

  const handleAttemptChange = (attemptId: string) => {
    if (!selectedSubmission || !attemptId) return;

    void loadAttemptReview(selectedSubmission, attemptId);
  };

  const handleCloseAttemptReview = () => {
    if (isAttemptLoading) return;

    setSelectedSubmission(null);
    setAttemptDetail(null);
    setAttemptError("");
  };

  return (
    <WorkspaceUtilityPage
      activePage="grades"
      title="Grades"
      subtitle="Quiz and activity results in one place."
      storageKey="walter_ai_grades"
      emptyTitle="No grades yet"
      emptyMessage="Submitted quiz scores and activity results will appear here once they are available."
      badgeLabel="Submissions"
      badgeCount={submissions.length}
      showBadge={false}
    >
      {selectedSubmission ? (
        <AttemptReview
          submission={selectedSubmission}
          attempt={attemptDetail}
          isLoading={isAttemptLoading}
          error={attemptError}
          onBack={handleCloseAttemptReview}
          onAttemptChange={handleAttemptChange}
        />
      ) : (
        <div className="space-y-4 pb-12">
          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
              {error}
            </div>
          )}

          <SubmissionTable
            title="Quiz Submissions"
            variant="quiz"
            submissions={quizSubmissions}
            isLoading={isLoading}
            emptyTitle="No quiz submissions found"
            emptyMessage="Quiz scores will appear here once submissions are available."
            onSelectSubmission={handleSelectSubmission}
          />

          <SubmissionTable
            title="Role Play Submissions"
            variant="roleplay"
            submissions={rolePlaySubmissions}
            isLoading={isLoading}
            emptyTitle="No role play submissions found"
            emptyMessage="Role play attempts will appear here once submissions are available."
            onSelectSubmission={handleSelectSubmission}
          />
        </div>
      )}
    </WorkspaceUtilityPage>
  );
}
