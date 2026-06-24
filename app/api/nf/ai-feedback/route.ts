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

type LearnerFeedbackItem = {
  id: string;
  moduleTitle: string;
  progress: string;
  feedbackDate: string;
  feedback: string;
};

type LearnerFeedbackRow = {
  rowId: string;
  moduleTitle: string;
  progress: string;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function createStableId(value: string) {
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }

  return `feedback-${Math.abs(hash)}`;
}

function getInsightsUrl() {
  const targetUrl = new URL(NOODLE_TARGET_URL);

  targetUrl.pathname = `${targetUrl.pathname.replace(/\/$/, "")}/reports`;
  targetUrl.searchParams.delete("through");

  return targetUrl.toString();
}

async function waitForLearnerProgressGrid(page: Page) {
  await page.waitForFunction(
    () => {
      function clean(text: string) {
        return text.replace(/\s+/g, " ").trim();
      }

      const grids = Array.from(document.querySelectorAll(".MuiDataGrid-root"));

      return grids.some((grid) => {
        const text = clean(
          (grid as HTMLElement).innerText || grid.textContent || ""
        );

        return (
          text.includes("Name") &&
          text.includes("Progress") &&
          text.includes("Feedback") &&
          text.includes("View Feedback")
        );
      });
    },
    {
      timeout: 45000,
    }
  );
}

async function getVisibleLearnerFeedbackRows(page: Page) {
  return await page.evaluate(() => {
    type BrowserLearnerFeedbackRow = {
      rowId: string;
      moduleTitle: string;
      progress: string;
    };

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

    function findLearnerProgressGrid() {
      const grids = Array.from(document.querySelectorAll(".MuiDataGrid-root"));

      return grids.find((grid) => {
        const text = clean(
          (grid as HTMLElement).innerText || grid.textContent || ""
        );

        return (
          text.includes("Name") &&
          text.includes("Progress") &&
          text.includes("Feedback") &&
          text.includes("View Feedback")
        );
      });
    }

    function getCellText(row: Element, field: string, fallbackIndex: number) {
      const fieldCell = row.querySelector(`[data-field="${field}"]`);

      if (fieldCell) {
        return clean(
          (fieldCell as HTMLElement).innerText || fieldCell.textContent || ""
        );
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

    function hasEnabledFeedbackButton(row: Element) {
      const feedbackCell = row.querySelector('[data-field="feedback"]');
      const buttons = Array.from(
        feedbackCell?.querySelectorAll("button, a, [role='button']") || []
      );

      return buttons.some((button) => {
        const htmlButton = button as HTMLButtonElement;
        const text = clean(htmlButton.innerText || htmlButton.textContent || "");

        return (
          isVisible(button) &&
          /view feedback/i.test(text) &&
          !htmlButton.disabled &&
          htmlButton.getAttribute("aria-disabled") !== "true"
        );
      });
    }

    const grid = findLearnerProgressGrid();

    if (!grid) {
      return [] as BrowserLearnerFeedbackRow[];
    }

    const rows = Array.from(
      grid.querySelectorAll('.MuiDataGrid-row[data-rowindex], [role="row"][data-rowindex]')
    );

    return rows
      .map((row): BrowserLearnerFeedbackRow | null => {
        const moduleTitle = getCellText(row, "name", 0);
        const progress = getCellText(row, "progress", 1);

        if (!moduleTitle || moduleTitle === "Name" || !hasEnabledFeedbackButton(row)) {
          return null;
        }

        return {
          rowId: row.getAttribute("data-id") || moduleTitle,
          moduleTitle,
          progress,
        };
      })
      .filter((row): row is BrowserLearnerFeedbackRow => Boolean(row));
  });
}

async function clickLearnerFeedbackButton(page: Page, learnerRow: LearnerFeedbackRow) {
  return await page.evaluate((targetRow) => {
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

    function findLearnerProgressGrid() {
      const grids = Array.from(document.querySelectorAll(".MuiDataGrid-root"));

      return grids.find((grid) => {
        const text = clean(
          (grid as HTMLElement).innerText || grid.textContent || ""
        );

        return (
          text.includes("Name") &&
          text.includes("Progress") &&
          text.includes("Feedback") &&
          text.includes("View Feedback")
        );
      });
    }

    function getModuleTitle(row: Element) {
      const nameCell = row.querySelector('[data-field="name"]');

      return clean((nameCell as HTMLElement | null)?.innerText || "");
    }

    const grid = findLearnerProgressGrid();

    if (!grid) {
      return false;
    }

    const rows = Array.from(
      grid.querySelectorAll('.MuiDataGrid-row[data-rowindex], [role="row"][data-rowindex]')
    );
    const row =
      rows.find((candidate) => candidate.getAttribute("data-id") === targetRow.rowId) ||
      rows.find((candidate) => getModuleTitle(candidate) === targetRow.moduleTitle);

    if (!row) {
      return false;
    }

    const feedbackButton = Array.from(
      row.querySelectorAll('[data-field="feedback"] button, [data-field="feedback"] a, [data-field="feedback"] [role="button"]')
    ).find((button) => {
      const htmlButton = button as HTMLButtonElement;
      const text = clean(htmlButton.innerText || htmlButton.textContent || "");

      return (
        isVisible(button) &&
        /view feedback/i.test(text) &&
        !htmlButton.disabled &&
        htmlButton.getAttribute("aria-disabled") !== "true"
      );
    }) as HTMLElement | undefined;

    if (!feedbackButton) {
      return false;
    }

    feedbackButton.scrollIntoView({
      block: "center",
      behavior: "auto",
    });
    feedbackButton.click();

    return true;
  }, learnerRow);
}

async function scrapeOpenFeedbackDrawer(page: Page) {
  await page.waitForFunction(
    () => {
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

      return Array.from(document.querySelectorAll('[role="dialog"], .MuiDrawer-root')).some(
        (dialog) => isVisible(dialog) && clean((dialog as HTMLElement).innerText || "").includes("View Feedback")
      );
    },
    { timeout: 15000 }
  );

  await page.evaluate(() => {
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

    const dialog = Array.from(
      document.querySelectorAll('[role="dialog"], .MuiDrawer-root')
    ).find(
      (candidate) =>
        isVisible(candidate) &&
        clean((candidate as HTMLElement).innerText || "").includes("View Feedback")
    );

    const feedbackTab = Array.from(
      dialog?.querySelectorAll('[role="tab"], .MuiTab-root') || []
    ).find((tab) => clean((tab as HTMLElement).innerText || "") === "Feedback") as
      | HTMLElement
      | undefined;

    if (feedbackTab && feedbackTab.getAttribute("aria-selected") !== "true") {
      feedbackTab.click();
    }
  });

  await sleep(400);

  return await page.evaluate(() => {
    function clean(text: string) {
      return text.replace(/\s+/g, " ").trim();
    }

    function cleanMultiline(text: string) {
      const lines = text
        .split(/\n+/)
        .map((line) => line.trim())
        .filter(Boolean);
      const recommendationsIndex = lines.findIndex((line) =>
        /^(recommended next steps|recommendations)$/i.test(line)
      );
      const feedbackLines =
        recommendationsIndex >= 0
          ? lines.slice(0, recommendationsIndex)
          : lines;

      return feedbackLines.join("\n");
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

    const dialog = Array.from(
      document.querySelectorAll('[role="dialog"], .MuiDrawer-root')
    ).find(
      (candidate) =>
        isVisible(candidate) &&
        clean((candidate as HTMLElement).innerText || "").includes("View Feedback")
    );

    if (!dialog) {
      return {
        feedbackDate: "",
        feedback: "",
      };
    }

    const dialogText = (dialog as HTMLElement).innerText || "";
    const dateMatch = dialogText.match(
      /\d{2}\/\d{2}\/\d{4}\s+\d{1,2}:\d{2}\s+[AP]M/i
    );
    const feedbackPanel = Array.from(
      dialog.querySelectorAll('[role="tabpanel"], .MuiTabPanel-root')
    ).find(isVisible) as HTMLElement | undefined;

    return {
      feedbackDate: dateMatch?.[0] || "",
      feedback: cleanMultiline(feedbackPanel?.innerText || ""),
    };
  });
}

async function closeFeedbackDrawer(page: Page) {
  const clickedClose = await page.evaluate(() => {
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

    const dialog = Array.from(
      document.querySelectorAll('[role="dialog"], .MuiDrawer-root')
    ).find(
      (candidate) =>
        isVisible(candidate) &&
        clean((candidate as HTMLElement).innerText || "").includes("View Feedback")
    );

    if (!dialog) {
      return false;
    }

    const iconButtons = Array.from(dialog.querySelectorAll("button")).filter(
      (button) => isVisible(button) && clean(button.innerText || button.textContent || "") === ""
    ) as HTMLButtonElement[];
    const closeButton = iconButtons.sort(
      (firstButton, secondButton) =>
        firstButton.getBoundingClientRect().top -
        secondButton.getBoundingClientRect().top
    )[0];

    if (!closeButton) {
      return false;
    }

    closeButton.click();

    return true;
  });

  if (!clickedClose) {
    await page.keyboard.press("Escape").catch(() => {});
  }

  await page
    .waitForFunction(
      () => {
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

        return !Array.from(
          document.querySelectorAll('[role="dialog"], .MuiDrawer-root')
        ).some(
          (dialog) =>
            isVisible(dialog) &&
            clean((dialog as HTMLElement).innerText || "").includes("View Feedback")
        );
      },
      { timeout: 8000 }
    )
    .catch(() => {});

  await sleep(300);
}

async function clickNextLearnerPage(page: Page) {
  return await page.evaluate(() => {
    function clean(text: string) {
      return text.replace(/\s+/g, " ").trim();
    }

    function findLearnerProgressGrid() {
      const grids = Array.from(document.querySelectorAll(".MuiDataGrid-root"));

      return grids.find((grid) => {
        const text = clean(
          (grid as HTMLElement).innerText || grid.textContent || ""
        );

        return (
          text.includes("Name") &&
          text.includes("Progress") &&
          text.includes("Feedback") &&
          text.includes("View Feedback")
        );
      });
    }

    const grid = findLearnerProgressGrid();

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

async function scrapeLearnerFeedback(page: Page) {
  const feedbackItems = new Map<string, LearnerFeedbackItem>();

  for (let pageIndex = 0; pageIndex < 25; pageIndex += 1) {
    const learnerRows = await getVisibleLearnerFeedbackRows(page);

    for (const learnerRow of learnerRows) {
      const clickedFeedback = await clickLearnerFeedbackButton(page, learnerRow);

      if (!clickedFeedback) {
        continue;
      }

      try {
        const scrapedFeedback = await scrapeOpenFeedbackDrawer(page);

        if (scrapedFeedback.feedback) {
          const id = createStableId(
            `${learnerRow.rowId}::${learnerRow.moduleTitle}::${scrapedFeedback.feedbackDate}::${scrapedFeedback.feedback}`
          );

          feedbackItems.set(id, {
            id,
            moduleTitle: learnerRow.moduleTitle,
            progress: learnerRow.progress,
            feedbackDate: scrapedFeedback.feedbackDate,
            feedback: scrapedFeedback.feedback,
          });
        }
      } finally {
        await closeFeedbackDrawer(page);
      }
    }

    const clickedNextPage = await clickNextLearnerPage(page);

    if (!clickedNextPage) {
      break;
    }

    await sleep(900);
  }

  return Array.from(feedbackItems.values());
}

async function loadAiFeedbackOnce() {
  return await withNoodlePage(async (page, state) => {
    const insightsUrl = getInsightsUrl();

    console.log("[AI Feedback Router] Opening Noodle Factory Insights page...");

    await page.goto(insightsUrl, {
      waitUntil: "networkidle2",
      timeout: 60000,
    });

    state.activeContext = "Insights";
    state.isChatPanelOpen = false;
    state.isOnCourseHome = false;

    await waitForLearnerProgressGrid(page);

    const feedbackItems = await scrapeLearnerFeedback(page);

    console.log(
      `[AI Feedback Router] Loaded ${feedbackItems.length} learner feedback items from Insights.`
    );

    return {
      feedbackItems,
      sourceUrl: insightsUrl,
      scrapedAt: new Date().toISOString(),
    };
  });
}

export async function POST() {
  try {
    const result = await loadAiFeedbackOnce();

    return NextResponse.json({
      ok: true,
      ...result,
    });
  } catch (error: unknown) {
    console.error("[AI Feedback Router] Failed:", getErrorMessage(error));

    if (isDetachedFrameError(error)) {
      console.log(
        "[AI Feedback Router] Detached frame detected. Resetting page and retrying once..."
      );

      await resetNoodlePage();

      try {
        const result = await loadAiFeedbackOnce();

        return NextResponse.json({
          ok: true,
          ...result,
        });
      } catch (retryError: unknown) {
        console.error(
          "[AI Feedback Router] Retry failed:",
          getErrorMessage(retryError)
        );

        return NextResponse.json(
          {
            ok: false,
            feedbackItems: [],
            error: getErrorMessage(retryError),
          },
          { status: 500 }
        );
      }
    }

    return NextResponse.json(
      {
        ok: false,
        feedbackItems: [],
        error: getErrorMessage(error),
      },
      { status: 500 }
    );
  }
}
