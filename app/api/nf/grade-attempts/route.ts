import { NextResponse } from "next/server";
import type { Page } from "puppeteer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import {
  NOODLE_TARGET_URL,
  isDetachedFrameError,
  resetNoodlePage,
  withNoodlePage,
} from "../../../../lib/noodleBrowser";

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

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function isDetachedNodeError(error: unknown) {
  const message = getErrorMessage(error).toLowerCase();

  return (
    message.includes("node is detached") ||
    message.includes("not part of the document") ||
    message.includes("detached element")
  );
}

function normalizeText(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

function normalizeType(type: string) {
  return normalizeText(type).toLowerCase().replace(/[\s-]/g, "");
}

function getInsightsUrl() {
  const targetUrl = new URL(NOODLE_TARGET_URL);

  targetUrl.pathname = `${targetUrl.pathname.replace(/\/$/, "")}/reports`;
  targetUrl.searchParams.delete("through");

  return targetUrl.toString();
}

async function waitForSubmissionsGrid(page: Page) {
  await page.waitForFunction(
    () =>
      Array.from(document.querySelectorAll(".MuiDataGrid-root")).some(
        (grid) =>
          Boolean(grid.querySelector('[data-field="quiz_name"]')) &&
          Boolean(grid.querySelector('[data-field="highest_score"]'))
      ),
    {
      timeout: 45000,
    }
  );
}

async function selectAllSubmissionsTab(page: Page) {
  const clickedTab = await page.evaluate(() => {
    function clean(text: string) {
      return text.replace(/\s+/g, " ").trim();
    }

    function isVisible(element: Element) {
      const htmlElement = element as HTMLElement;
      const rect = htmlElement.getBoundingClientRect();
      const style = window.getComputedStyle(htmlElement);

      return (
        rect.width > 0 &&
        rect.height > 0 &&
        style.display !== "none" &&
        style.visibility !== "hidden"
      );
    }

    const tab = Array.from(
      document.querySelectorAll('[role="tab"], .MuiTab-root, button')
    ).find(
      (candidate) =>
        isVisible(candidate) &&
        clean((candidate as HTMLElement).innerText || "") === "All Submissions"
    ) as HTMLElement | undefined;

    if (!tab) {
      return false;
    }

    tab.scrollIntoView({
      block: "center",
      behavior: "auto",
    });
    tab.click();

    return true;
  });

  if (clickedTab) {
    await sleep(700);
  }
}

async function clickNextSubmissionsPage(page: Page) {
  return await page.evaluate(() => {
    const grid = Array.from(
      document.querySelectorAll(".MuiDataGrid-root")
    ).find(
      (candidate) =>
        Boolean(candidate.querySelector('[data-field="quiz_name"]')) &&
        Boolean(candidate.querySelector('[data-field="highest_score"]'))
    );

    if (!grid) {
      return false;
    }

    const nextButton = Array.from(grid.querySelectorAll("button")).find(
      (button) => {
        const ariaLabel = button.getAttribute("aria-label") || "";
        const title = button.getAttribute("title") || "";

        return /next page/i.test(ariaLabel) || /next page/i.test(title);
      }
    ) as HTMLButtonElement | undefined;

    if (
      !nextButton ||
      nextButton.disabled ||
      nextButton.getAttribute("aria-disabled") === "true"
    ) {
      return false;
    }

    nextButton.click();
    return true;
  });
}

async function openSubmissionReview(
  page: Page,
  exerciseName: string,
  submissionType: string
) {
  const targetType = normalizeType(submissionType);

  for (let pageIndex = 0; pageIndex < 25; pageIndex += 1) {
    const clickedSubmission = await page.evaluate(
      ({ targetExerciseName, targetSubmissionType }) => {
        function clean(text: string) {
          return text.replace(/\s+/g, " ").trim();
        }

        function cleanType(text: string) {
          return clean(text).toLowerCase().replace(/[\s-]/g, "");
        }

        const grid = Array.from(
          document.querySelectorAll(".MuiDataGrid-root")
        ).find(
          (candidate) =>
            Boolean(candidate.querySelector('[data-field="quiz_name"]')) &&
            Boolean(candidate.querySelector('[data-field="highest_score"]'))
        );

        if (!grid) {
          return false;
        }

        const matchingRow = Array.from(
          grid.querySelectorAll(
            '.MuiDataGrid-row[data-rowindex], [role="row"][data-rowindex]'
          )
        ).find((row) => {
          const nameCell = row.querySelector('[data-field="quiz_name"]');
          const typeCell = row.querySelector('[data-field="quiz_type"]');
          const name = clean((nameCell as HTMLElement | null)?.innerText || "");
          const type = cleanType(
            (typeCell as HTMLElement | null)?.innerText || ""
          );

          return (
            name.toLowerCase() === targetExerciseName.toLowerCase() &&
            (!targetSubmissionType || type === targetSubmissionType)
          );
        });

        if (!matchingRow) {
          return false;
        }

        const nameCell = matchingRow.querySelector(
          '[data-field="quiz_name"]'
        ) as HTMLElement | null;
        const clickableName =
          (nameCell?.querySelector(".cursor-pointer") as HTMLElement | null) ||
          (nameCell?.querySelector("p") as HTMLElement | null) ||
          nameCell;

        if (!clickableName) {
          return false;
        }

        clickableName.scrollIntoView({
          block: "center",
          behavior: "auto",
        });
        clickableName.click();

        return true;
      },
      {
        targetExerciseName: normalizeText(exerciseName),
        targetSubmissionType: targetType,
      }
    );

    if (clickedSubmission) {
      await page.waitForFunction(
        (targetExerciseName) => {
          const bodyText = document.body.innerText || "";

          return (
            bodyText.includes(targetExerciseName) &&
            /(Quiz|Role Play) Review/i.test(bodyText) &&
            /Select Submission:/i.test(bodyText) &&
            /Score Attained:/i.test(bodyText)
          );
        },
        {
          timeout: 30000,
        },
        exerciseName
      );

      await sleep(700);
      return;
    }

    const clickedNextPage = await clickNextSubmissionsPage(page);

    if (!clickedNextPage) {
      break;
    }

    await sleep(800);
  }

  throw new Error(`Could not open submission review for "${exerciseName}".`);
}

async function openAttemptDropdown(page: Page) {
  for (let lookupAttempt = 0; lookupAttempt < 3; lookupAttempt += 1) {
    const comboboxes = await page.$$(
      '[role="combobox"][aria-haspopup="listbox"], .MuiSelect-select'
    );

    for (const combobox of comboboxes) {
      try {
        const details = await combobox.evaluate((element) => {
          const htmlElement = element as HTMLElement;
          const rect = htmlElement.getBoundingClientRect();
          const style = window.getComputedStyle(htmlElement);

          return {
            isVisible:
              rect.width > 0 &&
              rect.height > 0 &&
              style.display !== "none" &&
              style.visibility !== "hidden",
            text: (htmlElement.innerText || "")
              .replace(/\s+/g, " ")
              .trim(),
          };
        });

        if (
          details.isVisible &&
          /\d{2}\/\d{2}\/\d{4}\s+\d{1,2}:\d{2}\s+[AP]M/i.test(details.text)
        ) {
          await combobox.click();
          return true;
        }
      } catch (error: unknown) {
        if (!isDetachedNodeError(error)) {
          throw error;
        }

        break;
      }
    }

    await sleep(150);
  }

  return false;
}

async function getAttemptOptions(page: Page) {
  const opened = await openAttemptDropdown(page);

  if (!opened) {
    console.log("[Grade Attempts Router] Attempt dropdown was not found.");
    return [] as GradeAttemptOption[];
  }

  await page
    .waitForFunction(
      () =>
        Array.from(
          document.querySelectorAll('[role="option"], .MuiMenuItem-root')
        ).some((option) =>
          /\d{2}\/\d{2}\/\d{4}\s+\d{1,2}:\d{2}\s+[AP]M/i.test(
            (option as HTMLElement).innerText || ""
          )
        ),
      {
        timeout: 8000,
      }
    )
    .catch(() => {});

  const options = await page.evaluate(() => {
    function clean(text: string) {
      return text.replace(/\s+/g, " ").trim();
    }

    const datePattern =
      /\d{2}\/\d{2}\/\d{4}\s+\d{1,2}:\d{2}\s+[AP]M/i;

    return Array.from(
      document.querySelectorAll('[role="option"], .MuiMenuItem-root')
    )
      .map((option, index) => {
        const label = clean((option as HTMLElement).innerText || "");

        if (!datePattern.test(label)) {
          return null;
        }

        return {
          id:
            option.getAttribute("data-value") ||
            `attempt-${index}-${label.replace(/\W+/g, "-")}`,
          label,
          isSelected: option.getAttribute("aria-selected") === "true",
        };
      })
      .filter((option): option is GradeAttemptOption => Boolean(option));
  });

  console.log(
    `[Grade Attempts Router] Found ${options.length} submission attempts.`
  );

  await page.keyboard.press("Escape").catch(() => {});
  await sleep(150);

  return options;
}

async function selectAttempt(
  page: Page,
  attemptId: string,
  attemptOptions: GradeAttemptOption[]
) {
  const targetAttempt = attemptOptions.find(
    (attempt) => attempt.id === attemptId
  );

  if (!targetAttempt || targetAttempt.isSelected) {
    return;
  }

  for (let clickAttempt = 0; clickAttempt < 3; clickAttempt += 1) {
    const opened = await openAttemptDropdown(page);

    if (!opened) {
      await page.keyboard.press("Escape").catch(() => {});
      await sleep(200);
      continue;
    }

    await page
      .waitForFunction(
        (targetId) =>
          Array.from(
            document.querySelectorAll('[role="option"], .MuiMenuItem-root')
          ).some((option) => option.getAttribute("data-value") === targetId),
        {
          timeout: 8000,
        },
        attemptId
      )
      .catch(() => {});

    const clickedAttempt = await page.evaluate((targetId) => {
      const option = Array.from(
        document.querySelectorAll('[role="option"], .MuiMenuItem-root')
      ).find(
        (candidate) => candidate.getAttribute("data-value") === targetId
      ) as HTMLElement | undefined;

      if (!option || !option.isConnected) {
        return false;
      }

      option.click();
      return true;
    }, attemptId);

    if (clickedAttempt) {
      const selectionChanged = await page
        .waitForFunction(
          (targetLabel) =>
            Array.from(
              document.querySelectorAll(
                '[role="combobox"][aria-haspopup="listbox"], .MuiSelect-select'
              )
            ).some(
              (candidate) =>
                ((candidate as HTMLElement).innerText || "")
                  .replace(/\s+/g, " ")
                  .trim() === targetLabel
            ),
          {
            timeout: 12000,
          },
          targetAttempt.label
        )
        .then(() => true)
        .catch(() => false);

      if (selectionChanged) {
        await sleep(700);
        return;
      }
    }

    await page.keyboard.press("Escape").catch(() => {});
    await sleep(250);
  }

  throw new Error("The selected submission attempt is no longer available.");
}

async function scrapeReviewSummary(page: Page) {
  return await page.evaluate(() => {
    function clean(text: string) {
      return text.replace(/\s+/g, " ").trim();
    }

    const bodyText = document.body.innerText || "";
    const type = /Role Play Review/i.test(bodyText) ? "roleplay" : "quiz";
    const datePattern =
      /\d{2}\/\d{2}\/\d{4}\s+\d{1,2}:\d{2}\s+[AP]M/i;
    const selectedAttemptDate =
      Array.from(
        document.querySelectorAll(
          '[role="combobox"][aria-haspopup="listbox"], .MuiSelect-select'
        )
      )
        .map((candidate) =>
          clean((candidate as HTMLElement).innerText || "")
        )
        .find((text) => datePattern.test(text)) || "";
    const scoreMatch = bodyText.match(
      /Score Attained:\s*([\d.]+\s*\/\s*[\d.]+)/i
    );

    return {
      type,
      selectedAttemptDate,
      score: scoreMatch ? clean(scoreMatch[1]) : "",
    };
  });
}

async function scrapeQuizQuestions(page: Page) {
  return await page.evaluate(() => {
    function clean(text: string) {
      return text.replace(/\s+/g, " ").trim();
    }

    function isQuestionHeader(line: string) {
      return /^Question\s+\d+\s*\(\s*Score:/i.test(line);
    }

    function findLabelIndex(lines: string[], label: string) {
      return lines.findIndex(
        (line) => line.toLowerCase() === label.toLowerCase()
      );
    }

    const lines = (document.body.innerText || "")
      .split("\n")
      .map(clean)
      .filter(Boolean);
    const firstQuestionIndex = lines.findIndex(isQuestionHeader);

    if (firstQuestionIndex < 0) {
      return [] as QuizAttemptQuestion[];
    }

    const linesAfterFirstQuestion = lines.slice(firstQuestionIndex);
    const reviewBoundaryIndex = linesAfterFirstQuestion.findIndex(
      (line, index) =>
        index > 0 &&
        (/^Accessibility$/i.test(line) ||
          /^\d{2}\/\d{2}\/\d{4}\s+\d{1,2}:\d{2}\s+[AP]M$/i.test(line))
    );
    const relevantLines =
      reviewBoundaryIndex >= 0
        ? linesAfterFirstQuestion.slice(0, reviewBoundaryIndex)
        : linesAfterFirstQuestion;
    const questionIndexes = relevantLines
      .map((line, index) => (isQuestionHeader(line) ? index : -1))
      .filter((index) => index >= 0);
    const questions: QuizAttemptQuestion[] = [];

    for (let index = 0; index < questionIndexes.length; index += 1) {
      const startIndex = questionIndexes[index];
      const endIndex =
        questionIndexes[index + 1] !== undefined
          ? questionIndexes[index + 1]
          : relevantLines.length;
      const block = relevantLines.slice(startIndex, endIndex);
      const headerMatch = block[0]?.match(
        /^Question\s+(\d+)\s*\(\s*Score:\s*([^)]+)\)/i
      );
      const yourAnswerIndex = findLabelIndex(block, "Your Answer");
      const correctAnswerIndex = findLabelIndex(block, "Correct Answer");
      const firstAnswerIndex = Math.min(
        yourAnswerIndex >= 0 ? yourAnswerIndex : block.length,
        correctAnswerIndex >= 0 ? correctAnswerIndex : block.length
      );
      const question = clean(block.slice(1, firstAnswerIndex).join(" "));
      let yourAnswer = "";
      let correctAnswer = "";

      if (yourAnswerIndex >= 0 && correctAnswerIndex >= 0) {
        if (yourAnswerIndex < correctAnswerIndex) {
          yourAnswer = clean(
            block.slice(yourAnswerIndex + 1, correctAnswerIndex).join(" ")
          );
          correctAnswer = clean(
            block.slice(correctAnswerIndex + 1).join(" ")
          );
        } else {
          correctAnswer = clean(
            block.slice(correctAnswerIndex + 1, yourAnswerIndex).join(" ")
          );
          yourAnswer = clean(block.slice(yourAnswerIndex + 1).join(" "));
        }
      }

      const number = headerMatch ? Number(headerMatch[1]) : 0;

      if (number && question) {
        questions.push({
          number,
          score: headerMatch ? clean(headerMatch[2]) : "",
          question,
          yourAnswer,
          correctAnswer,
        });
      }
    }

    return questions;
  });
}

async function scrapeRolePlayGrid(
  page: Page,
  gridType: "logs" | "criteria"
) {
  const records = new Map<
    string,
    RolePlayAttemptLog | RolePlayAttemptCriterion
  >();

  for (let pageIndex = 0; pageIndex < 50; pageIndex += 1) {
    await page.evaluate((targetGridType) => {
      const grid = Array.from(
        document.querySelectorAll(".MuiDataGrid-root")
      ).find((candidate) =>
        targetGridType === "logs"
          ? Boolean(candidate.querySelector('[data-field="text"]')) &&
            Boolean(candidate.querySelector('[data-field="from"]'))
          : Boolean(candidate.querySelector('[data-field="name"]')) &&
            Boolean(candidate.querySelector('[data-field="feedback"]'))
      );
      const scroller = grid?.querySelector(
        ".MuiDataGrid-virtualScroller"
      ) as HTMLElement | null;

      if (scroller) {
        scroller.scrollTop = 0;
        scroller.dispatchEvent(new Event("scroll", { bubbles: true }));
      }
    }, gridType);

    await sleep(150);

    for (let scrollRound = 0; scrollRound < 100; scrollRound += 1) {
      const scrollResult = await page.evaluate(
        ({ targetGridType, currentPageIndex }) => {
          function clean(text: string) {
            return text.replace(/\s+/g, " ").trim();
          }

          const grid = Array.from(
            document.querySelectorAll(".MuiDataGrid-root")
          ).find((candidate) => {
            if (targetGridType === "logs") {
              return (
                Boolean(candidate.querySelector('[data-field="text"]')) &&
                Boolean(candidate.querySelector('[data-field="from"]')) &&
                Boolean(candidate.querySelector('[data-field="created_at"]'))
              );
            }

            return (
              Boolean(candidate.querySelector('[data-field="name"]')) &&
              Boolean(candidate.querySelector('[data-field="score"]')) &&
              Boolean(candidate.querySelector('[data-field="feedback"]'))
            );
          });

          if (!grid) {
            return {
              records: [],
              reachedBottom: true,
            };
          }

          const rows = Array.from(
            grid.querySelectorAll(
              '.MuiDataGrid-row[data-rowindex], [role="row"][data-rowindex]'
            )
          );
          const rowRecords = rows.map((row, index) => {
            const getCellText = (field: string) =>
              clean(
                (
                  row.querySelector(
                    `[data-field="${field}"]`
                  ) as HTMLElement | null
                )?.innerText || ""
              );
            const rowId =
              row.getAttribute("data-id") ||
              `${targetGridType}-${currentPageIndex}-${index}`;

            if (targetGridType === "logs") {
              return {
                id: rowId,
                message: getCellText("text"),
                sender: getCellText("from"),
                date: getCellText("created_at"),
              };
            }

            return {
              id: rowId,
              criterion: getCellText("name"),
              score: getCellText("score"),
              feedback: getCellText("feedback"),
            };
          });
          const scroller = grid.querySelector(
            ".MuiDataGrid-virtualScroller"
          ) as HTMLElement | null;

          if (!scroller) {
            return {
              records: rowRecords,
              reachedBottom: true,
            };
          }

          const beforeTop = scroller.scrollTop;
          const scrollAmount = Math.max(
            Math.round(scroller.clientHeight * 0.75),
            160
          );

          scroller.scrollTop = Math.min(
            scroller.scrollTop + scrollAmount,
            scroller.scrollHeight
          );
          scroller.dispatchEvent(new Event("scroll", { bubbles: true }));

          return {
            records: rowRecords,
            reachedBottom:
              scroller.scrollTop + scroller.clientHeight >=
                scroller.scrollHeight - 2 ||
              scroller.scrollTop === beforeTop,
          };
        },
        {
          targetGridType: gridType,
          currentPageIndex: pageIndex,
        }
      );

      for (const record of scrollResult.records) {
        records.set(record.id, record);
      }

      if (scrollResult.reachedBottom) {
        await sleep(100);

        const finalRecords = await page.evaluate((targetGridType) => {
          function clean(text: string) {
            return text.replace(/\s+/g, " ").trim();
          }

          const grid = Array.from(
            document.querySelectorAll(".MuiDataGrid-root")
          ).find((candidate) =>
            targetGridType === "logs"
              ? Boolean(candidate.querySelector('[data-field="text"]')) &&
                Boolean(candidate.querySelector('[data-field="from"]'))
              : Boolean(candidate.querySelector('[data-field="name"]')) &&
                Boolean(candidate.querySelector('[data-field="feedback"]'))
          );

          return Array.from(
            grid?.querySelectorAll(
              '.MuiDataGrid-row[data-rowindex], [role="row"][data-rowindex]'
            ) || []
          ).map((row, index) => {
            const getCellText = (field: string) =>
              clean(
                (
                  row.querySelector(
                    `[data-field="${field}"]`
                  ) as HTMLElement | null
                )?.innerText || ""
              );
            const rowId =
              row.getAttribute("data-id") || `${targetGridType}-final-${index}`;

            return targetGridType === "logs"
              ? {
                  id: rowId,
                  message: getCellText("text"),
                  sender: getCellText("from"),
                  date: getCellText("created_at"),
                }
              : {
                  id: rowId,
                  criterion: getCellText("name"),
                  score: getCellText("score"),
                  feedback: getCellText("feedback"),
                };
          });
        }, gridType);

        for (const record of finalRecords) {
          records.set(record.id, record);
        }

        break;
      }

      await sleep(120);
    }

    const canGoNext = await page.evaluate((targetGridType) => {
      const grid = Array.from(
        document.querySelectorAll(".MuiDataGrid-root")
      ).find((candidate) =>
        targetGridType === "logs"
          ? Boolean(candidate.querySelector('[data-field="text"]')) &&
            Boolean(candidate.querySelector('[data-field="from"]'))
          : Boolean(candidate.querySelector('[data-field="name"]')) &&
            Boolean(candidate.querySelector('[data-field="feedback"]'))
      );
      const nextButton = Array.from(grid?.querySelectorAll("button") || []).find(
        (button) => {
          const ariaLabel = button.getAttribute("aria-label") || "";
          const title = button.getAttribute("title") || "";

          return /next page/i.test(ariaLabel) || /next page/i.test(title);
        }
      ) as HTMLButtonElement | undefined;

      return Boolean(
        nextButton &&
          !nextButton.disabled &&
          nextButton.getAttribute("aria-disabled") !== "true"
      );
    }, gridType);

    if (!canGoNext) {
      break;
    }

    const clickedNext = await page.evaluate((targetGridType) => {
      const grid = Array.from(
        document.querySelectorAll(".MuiDataGrid-root")
      ).find((candidate) => {
        if (targetGridType === "logs") {
          return (
            Boolean(candidate.querySelector('[data-field="text"]')) &&
            Boolean(candidate.querySelector('[data-field="from"]'))
          );
        }

        return (
          Boolean(candidate.querySelector('[data-field="name"]')) &&
          Boolean(candidate.querySelector('[data-field="feedback"]'))
        );
      });
      const nextButton = Array.from(grid?.querySelectorAll("button") || []).find(
        (button) => {
          const ariaLabel = button.getAttribute("aria-label") || "";
          const title = button.getAttribute("title") || "";

          return /next page/i.test(ariaLabel) || /next page/i.test(title);
        }
      ) as HTMLButtonElement | undefined;

      if (!nextButton || nextButton.disabled) {
        return false;
      }

      nextButton.click();
      return true;
    }, gridType);

    if (!clickedNext) {
      break;
    }

    await sleep(450);
  }

  return Array.from(records.values());
}

async function loadGradeAttemptOnce(
  exerciseName: string,
  submissionType: string,
  attemptId: string
) {
  return await withNoodlePage(async (page, state) => {
    const insightsUrl = getInsightsUrl();

    await page.goto(insightsUrl, {
      waitUntil: "networkidle2",
      timeout: 60000,
    });

    state.activeContext = "Insights";
    state.isChatPanelOpen = false;
    state.isOnCourseHome = false;

    await waitForSubmissionsGrid(page);
    await selectAllSubmissionsTab(page);
    await openSubmissionReview(page, exerciseName, submissionType);

    const attemptOptions = await getAttemptOptions(page);

    if (attemptId) {
      await selectAttempt(page, attemptId, attemptOptions);
    }

    const summary = await scrapeReviewSummary(page);
    const selectedAttempt =
      attemptOptions.find((attempt) =>
        attemptId
          ? attempt.id === attemptId
          : attempt.label === summary.selectedAttemptDate
      ) ||
      attemptOptions.find((attempt) => attempt.isSelected) ||
      attemptOptions[0];
    const normalizedOptions = attemptOptions.map((attempt) => ({
      ...attempt,
      isSelected: attempt.id === selectedAttempt?.id,
    }));

    if (summary.type === "roleplay") {
      const logs = (await scrapeRolePlayGrid(
        page,
        "logs"
      )) as RolePlayAttemptLog[];
      const criteria = (await scrapeRolePlayGrid(
        page,
        "criteria"
      )) as RolePlayAttemptCriterion[];

      return {
        exerciseName,
        type: summary.type,
        attemptOptions: normalizedOptions,
        selectedAttemptId: selectedAttempt?.id || "",
        selectedAttemptDate: summary.selectedAttemptDate,
        score: summary.score,
        quizQuestions: [],
        rolePlayLogs: logs,
        rolePlayCriteria: criteria,
      };
    }

    return {
      exerciseName,
      type: summary.type,
      attemptOptions: normalizedOptions,
      selectedAttemptId: selectedAttempt?.id || "",
      selectedAttemptDate: summary.selectedAttemptDate,
      score: summary.score,
      quizQuestions: await scrapeQuizQuestions(page),
      rolePlayLogs: [],
      rolePlayCriteria: [],
    };
  });
}

export async function POST(request: Request) {
  let exerciseName = "";
  let submissionType = "";
  let attemptId = "";

  try {
    const body = (await request.json().catch(() => ({}))) as {
      exerciseName?: unknown;
      type?: unknown;
      attemptId?: unknown;
    };

    exerciseName =
      typeof body.exerciseName === "string"
        ? normalizeText(body.exerciseName)
        : "";
    submissionType =
      typeof body.type === "string" ? normalizeText(body.type) : "";
    attemptId =
      typeof body.attemptId === "string" ? normalizeText(body.attemptId) : "";

    if (!exerciseName || !submissionType) {
      return NextResponse.json(
        {
          ok: false,
          error: "Missing exerciseName or type.",
        },
        {
          status: 400,
        }
      );
    }

    const attempt = await loadGradeAttemptOnce(
      exerciseName,
      submissionType,
      attemptId
    );

    return NextResponse.json({
      ok: true,
      attempt,
    });
  } catch (error: unknown) {
    console.error("[Grade Attempts Router] Failed:", getErrorMessage(error));

    if (isDetachedFrameError(error)) {
      await resetNoodlePage();

      try {
        const attempt = await loadGradeAttemptOnce(
          exerciseName,
          submissionType,
          attemptId
        );

        return NextResponse.json({
          ok: true,
          attempt,
        });
      } catch (retryError: unknown) {
        console.error(
          "[Grade Attempts Router] Retry failed:",
          getErrorMessage(retryError)
        );

        return NextResponse.json(
          {
            ok: false,
            error: getErrorMessage(retryError),
          },
          {
            status: 500,
          }
        );
      }
    }

    return NextResponse.json(
      {
        ok: false,
        error: getErrorMessage(error),
      },
      {
        status: 500,
      }
    );
  }
}
