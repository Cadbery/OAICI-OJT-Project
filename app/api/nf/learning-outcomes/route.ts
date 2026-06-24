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

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function normalizeText(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

async function waitForCourseCardsToLoad(page: Page) {
  await page.waitForFunction(
    () => {
      const cards = Array.from(document.querySelectorAll("div.cursor-pointer"));

      return cards.some((card) => {
        const title = card.querySelector("h5");
        const text = title?.textContent?.replace(/\s+/g, " ").trim() || "";

        return text.length > 0;
      });
    },
    {
      timeout: 45000,
    }
  );
}

async function openModuleFromCourseHome(page: Page, moduleTitle: string) {
  await page.goto(NOODLE_TARGET_URL, {
    waitUntil: "networkidle2",
    timeout: 60000,
  });

  await waitForCourseCardsToLoad(page);

  for (let scrollRound = 0; scrollRound < 24; scrollRound += 1) {
    const clickedModule = await page.evaluate((targetModuleTitle) => {
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

      const targetTitle = clean(targetModuleTitle).toLowerCase();
      const cards = Array.from(document.querySelectorAll("div.cursor-pointer"));
      const matchingCard = cards.find((card) => {
        if (!isVisible(card)) {
          return false;
        }

        const titleElement =
          card.querySelector("h5") ||
          card.querySelector(".MuiTypography-subtitle2");
        const title = clean(titleElement?.textContent || "").toLowerCase();

        return title === targetTitle;
      }) as HTMLElement | undefined;

      if (!matchingCard) {
        return false;
      }

      matchingCard.scrollIntoView({
        block: "center",
        behavior: "auto",
      });
      matchingCard.click();

      return true;
    }, moduleTitle);

    if (clickedModule) {
      await page.waitForFunction(
        (targetModuleTitle) => {
          const bodyText = document.body.innerText || "";

          return (
            bodyText.includes(targetModuleTitle) &&
            /By the end of the lesson|Begin Lesson|Continue Learning/i.test(
              bodyText
            )
          );
        },
        {
          timeout: 30000,
        },
        moduleTitle
      );

      await sleep(700);

      return;
    }

    const scrollState = await page.evaluate(() => {
      const scrollingElement =
        document.scrollingElement || document.documentElement || document.body;
      const beforeTop = scrollingElement.scrollTop;

      scrollingElement.scrollTop += 900;
      window.dispatchEvent(
        new Event("scroll", {
          bubbles: true,
        })
      );

      return {
        beforeTop,
        afterTop: scrollingElement.scrollTop,
        clientHeight: scrollingElement.clientHeight,
        scrollHeight: scrollingElement.scrollHeight,
      };
    });

    await sleep(500);

    const reachedBottom =
      scrollState.afterTop + scrollState.clientHeight >=
      scrollState.scrollHeight - 20;
    const didNotMove = scrollState.beforeTop === scrollState.afterTop;

    if (reachedBottom || didNotMove) {
      break;
    }
  }

  throw new Error(`Could not find module "${moduleTitle}" in Noodle Factory.`);
}

async function revealLearningOutcomes(page: Page) {
  const clickedShow = await page.evaluate(() => {
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

    const showButton = Array.from(
      document.querySelectorAll("button, [role='button'], a")
    ).find(
      (element) =>
        isVisible(element) &&
        /^show$/i.test(clean((element as HTMLElement).innerText || ""))
    ) as HTMLElement | undefined;

    if (!showButton) {
      return false;
    }

    showButton.click();

    return true;
  });

  if (clickedShow) {
    await sleep(700);
  }
}

async function scrapeLearningOutcomes(page: Page) {
  return await page.evaluate(() => {
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

    const visibleElements = Array.from(
      document.querySelectorAll("p, div, span, li")
    ).filter(isVisible) as HTMLElement[];
    const markerIndex = visibleElements.findIndex((element) =>
      {
        const text = clean(element.innerText || "");

        return (
          /^By the end of the lesson/i.test(text) &&
          text.length < 140
        );
      }
    );

    if (markerIndex < 0) {
      return [] as string[];
    }

    const outcomes: string[] = [];

    for (const element of visibleElements.slice(markerIndex + 1)) {
      const text = clean(element.innerText || element.textContent || "");
      const lowerText = text.toLowerCase();

      if (
        lowerText === "recommendations" ||
        lowerText.startsWith("recommendations ")
      ) {
        break;
      }

      if (!text || text.length < 12) {
        continue;
      }

      if (
        lowerText === "show" ||
        lowerText === "hide" ||
        lowerText === "accessibility" ||
        lowerText.includes("by the end of the lesson") ||
        lowerText.includes("continue learning") ||
        lowerText.includes("begin lesson") ||
        lowerText.includes("start learning")
      ) {
        continue;
      }

      if (text.length > 240) {
        continue;
      }

      if (!outcomes.includes(text)) {
        outcomes.push(text);
      }

      if (outcomes.length >= 12) {
        break;
      }
    }

    return outcomes;
  });
}

async function loadLearningOutcomesOnce(moduleTitle: string) {
  return await withNoodlePage(async (page, state) => {
    console.log(
      `[Learning Outcomes Router] Opening module for outcomes: ${moduleTitle}`
    );

    await openModuleFromCourseHome(page, moduleTitle);
    await revealLearningOutcomes(page);

    state.activeContext = moduleTitle;
    state.isChatPanelOpen = false;
    state.isOnCourseHome = false;

    const outcomes = await scrapeLearningOutcomes(page);

    console.log(
      `[Learning Outcomes Router] Loaded ${outcomes.length} outcomes for ${moduleTitle}.`
    );

    return {
      moduleTitle,
      outcomes,
      scrapedAt: new Date().toISOString(),
    };
  });
}

export async function POST(request: Request) {
  let moduleTitle = "";

  try {
    const body = (await request.json().catch(() => ({}))) as {
      moduleTitle?: unknown;
    };

    moduleTitle =
      typeof body.moduleTitle === "string" ? normalizeText(body.moduleTitle) : "";

    if (!moduleTitle) {
      return NextResponse.json(
        {
          ok: false,
          outcomes: [],
          error: "Missing moduleTitle.",
        },
        { status: 400 }
      );
    }

    const result = await loadLearningOutcomesOnce(moduleTitle);

    return NextResponse.json({
      ok: true,
      ...result,
    });
  } catch (error: unknown) {
    console.error("[Learning Outcomes Router] Failed:", getErrorMessage(error));

    if (isDetachedFrameError(error)) {
      console.log(
        "[Learning Outcomes Router] Detached frame detected. Resetting page and retrying once..."
      );

      await resetNoodlePage();

      try {
        const result = await loadLearningOutcomesOnce(moduleTitle);

        return NextResponse.json({
          ok: true,
          ...result,
        });
      } catch (retryError: unknown) {
        console.error(
          "[Learning Outcomes Router] Retry failed:",
          getErrorMessage(retryError)
        );

        return NextResponse.json(
          {
            ok: false,
            outcomes: [],
            error: getErrorMessage(retryError),
          },
          { status: 500 }
        );
      }
    }

    return NextResponse.json(
      {
        ok: false,
        outcomes: [],
        error: getErrorMessage(error),
      },
      { status: 500 }
    );
  }
}
