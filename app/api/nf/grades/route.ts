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

type GradeSubmission = {
  id: string;
  exerciseName: string;
  type: string;
  submissionDate: string;
  highestScore: string;
  firstAttempt: string;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function getInsightsUrl() {
  const targetUrl = new URL(NOODLE_TARGET_URL);

  targetUrl.pathname = `${targetUrl.pathname.replace(/\/$/, "")}/reports`;
  targetUrl.searchParams.delete("through");

  return targetUrl.toString();
}

async function waitForSubmissionsGrid(page: Page) {
  await page.waitForFunction(
    () => {
      function clean(text: string) {
        return text.replace(/\s+/g, " ").trim();
      }

      const grids = Array.from(document.querySelectorAll(".MuiDataGrid-root"));

      return grids.some((grid) => {
        const text = clean((grid as HTMLElement).innerText || grid.textContent || "");

        return (
          text.includes("Exercise Name") &&
          text.includes("Highest Score") &&
          text.includes("First Attempt")
        );
      });
    },
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

    const tabs = Array.from(
      document.querySelectorAll('[role="tab"], .MuiTab-root, button')
    ).filter(isVisible);

    const allSubmissionsTab = tabs.find(
      (tab) => clean((tab as HTMLElement).innerText || tab.textContent || "") === "All Submissions"
    ) as HTMLElement | undefined;

    if (!allSubmissionsTab) {
      return false;
    }

    allSubmissionsTab.scrollIntoView({
      block: "center",
      behavior: "auto",
    });
    allSubmissionsTab.click();

    return true;
  });

  if (clickedTab) {
    await sleep(700);
  }
}

async function scrapeVisibleSubmissionRows(page: Page) {
  return await page.evaluate(() => {
    type BrowserSubmission = {
      id: string;
      exerciseName: string;
      type: string;
      submissionDate: string;
      highestScore: string;
      firstAttempt: string;
    };

    function clean(text: string) {
      return text.replace(/\s+/g, " ").trim();
    }

    function createId(value: string) {
      let hash = 0;

      for (let index = 0; index < value.length; index += 1) {
        hash = (hash * 31 + value.charCodeAt(index)) | 0;
      }

      return `grade-${Math.abs(hash)}`;
    }

    function findSubmissionsGrid() {
      const grids = Array.from(document.querySelectorAll(".MuiDataGrid-root"));

      return grids.find((grid) => {
        const text = clean((grid as HTMLElement).innerText || grid.textContent || "");

        return (
          text.includes("Exercise Name") &&
          text.includes("Highest Score") &&
          text.includes("First Attempt")
        );
      });
    }

    function getCellText(row: Element, field: string, fallbackIndex: number) {
      const fieldCell = row.querySelector(`[data-field="${field}"]`);

      if (fieldCell) {
        return clean((fieldCell as HTMLElement).innerText || fieldCell.textContent || "");
      }

      const cells = Array.from(
        row.querySelectorAll('[role="gridcell"], .MuiDataGrid-cell')
      ).filter((cell) => !cell.classList.contains("MuiDataGrid-cellEmpty"));

      return clean(
        (cells[fallbackIndex] as HTMLElement | undefined)?.innerText ||
          cells[fallbackIndex]?.textContent ||
          ""
      );
    }

    const grid = findSubmissionsGrid();

    if (!grid) {
      return [] as BrowserSubmission[];
    }

    const rows = Array.from(
      grid.querySelectorAll('.MuiDataGrid-row[data-rowindex], [role="row"][data-rowindex]')
    );

    return rows
      .map((row): BrowserSubmission | null => {
        const exerciseName = getCellText(row, "quiz_name", 0);
        const type = getCellText(row, "quiz_type", 1);
        const submissionDate = getCellText(row, "last_submission", 2);
        const highestScore = getCellText(row, "highest_score", 3);
        const firstAttempt = getCellText(row, "1st_attempt_score", 4);

        if (!exerciseName || exerciseName === "Exercise Name") {
          return null;
        }

        return {
          id:
            row.getAttribute("data-id") ||
            createId(
              `${exerciseName}::${type}::${submissionDate}::${highestScore}::${firstAttempt}`
            ),
          exerciseName,
          type,
          submissionDate,
          highestScore,
          firstAttempt,
        };
      })
      .filter((row): row is BrowserSubmission => Boolean(row));
  });
}

async function clickNextSubmissionsPage(page: Page) {
  return await page.evaluate(() => {
    function clean(text: string) {
      return text.replace(/\s+/g, " ").trim();
    }

    function findSubmissionsGrid() {
      const grids = Array.from(document.querySelectorAll(".MuiDataGrid-root"));

      return grids.find((grid) => {
        const text = clean((grid as HTMLElement).innerText || grid.textContent || "");

        return (
          text.includes("Exercise Name") &&
          text.includes("Highest Score") &&
          text.includes("First Attempt")
        );
      });
    }

    const grid = findSubmissionsGrid();

    if (!grid) {
      return false;
    }

    const nextButton = Array.from(grid.querySelectorAll("button")).find((button) => {
      const ariaLabel = button.getAttribute("aria-label") || "";
      const title = button.getAttribute("title") || "";

      return /next page/i.test(ariaLabel) || /next page/i.test(title);
    }) as HTMLButtonElement | undefined;

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

async function scrapeSubmissionRows(page: Page) {
  const submissions = new Map<string, GradeSubmission>();

  for (let pageIndex = 0; pageIndex < 25; pageIndex += 1) {
    const visibleRows = await scrapeVisibleSubmissionRows(page);

    for (const row of visibleRows) {
      submissions.set(row.id, row);
    }

    const clickedNextPage = await clickNextSubmissionsPage(page);

    if (!clickedNextPage) {
      break;
    }

    await sleep(900);
  }

  return Array.from(submissions.values());
}

async function loadGradesOnce() {
  return await withNoodlePage(async (page, state) => {
    const insightsUrl = getInsightsUrl();

    console.log("[Grades Router] Opening Noodle Factory Insights page...");

    await page.goto(insightsUrl, {
      waitUntil: "networkidle2",
      timeout: 60000,
    });

    state.activeContext = "Insights";
    state.isChatPanelOpen = false;
    state.isOnCourseHome = false;

    await waitForSubmissionsGrid(page);
    await selectAllSubmissionsTab(page);

    const submissions = await scrapeSubmissionRows(page);

    console.log(
      `[Grades Router] Loaded ${submissions.length} submission rows from Insights.`
    );

    return {
      submissions,
      sourceUrl: insightsUrl,
      scrapedAt: new Date().toISOString(),
    };
  });
}

export async function POST() {
  try {
    const result = await loadGradesOnce();

    return NextResponse.json({
      ok: true,
      ...result,
    });
  } catch (error: unknown) {
    console.error("[Grades Router] Failed:", getErrorMessage(error));

    if (isDetachedFrameError(error)) {
      console.log(
        "[Grades Router] Detached frame detected. Resetting page and retrying once..."
      );

      await resetNoodlePage();

      try {
        const result = await loadGradesOnce();

        return NextResponse.json({
          ok: true,
          ...result,
        });
      } catch (retryError: unknown) {
        console.error("[Grades Router] Retry failed:", getErrorMessage(retryError));

        return NextResponse.json(
          {
            ok: false,
            submissions: [],
            error: getErrorMessage(retryError),
          },
          { status: 500 }
        );
      }
    }

    return NextResponse.json(
      {
        ok: false,
        submissions: [],
        error: getErrorMessage(error),
      },
      { status: 500 }
    );
  }
}
