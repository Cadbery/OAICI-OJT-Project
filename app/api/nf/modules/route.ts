import { NextResponse } from "next/server";
import {
  NOODLE_TARGET_URL,
  isDetachedFrameError,
  resetNoodlePage,
  withNoodlePage,
} from "../../../../lib/noodleBrowser";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeText(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

async function waitForCourseCardsToLoad(page: any) {
  await page
    .waitForFunction(
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
    )
    .catch(() => {});
}

async function collectCourseItemTitles(page: any) {
  const collectedTitles: string[] = [];

  for (let scrollRound = 0; scrollRound < 20; scrollRound++) {
    const visibleTitles = await page.evaluate(() => {
      function normalizeTextInBrowser(text: string) {
        return text.replace(/\s+/g, " ").trim();
      }

      function isValidCourseItemTitle(text: string) {
        const cleanText = normalizeTextInBrowser(text);

        if (!cleanText) return false;
        if (cleanText.length > 160) return false;

        const lowerText = cleanText.toLowerCase();

        if (lowerText === "not completed") return false;
        if (lowerText === "completed") return false;
        if (lowerText === "course home") return false;
        if (lowerText === "bookmarks") return false;
        if (lowerText === "activities") return false;
        if (lowerText === "question board") return false;
        if (lowerText === "insights") return false;
        if (lowerText === "browse") return false;

        return true;
      }

      const cardElements = Array.from(
        document.querySelectorAll("div.cursor-pointer")
      );

      const titlesFromCards = cardElements
        .map((card) => {
          const titleElement =
            card.querySelector("h5") ||
            card.querySelector(".MuiTypography-subtitle2");

          return normalizeTextInBrowser(titleElement?.textContent || "");
        })
        .filter((title) => isValidCourseItemTitle(title));

      return titlesFromCards;
    });

    for (const title of visibleTitles) {
      const cleanTitle = normalizeText(title);

      if (cleanTitle && !collectedTitles.includes(cleanTitle)) {
        collectedTitles.push(cleanTitle);
      }
    }

    const scrollState = await page.evaluate(() => {
      const scrollingElement =
        document.scrollingElement || document.documentElement || document.body;

      const beforeTop = scrollingElement.scrollTop;

      scrollingElement.scrollTop = scrollingElement.scrollTop + 900;

      window.dispatchEvent(
        new Event("scroll", {
          bubbles: true,
        })
      );

      return {
        beforeTop,
        afterTop: scrollingElement.scrollTop,
        scrollHeight: scrollingElement.scrollHeight,
        clientHeight: scrollingElement.clientHeight,
      };
    });

    await sleep(700);

    const reachedBottom =
      scrollState.afterTop + scrollState.clientHeight >=
      scrollState.scrollHeight - 20;

    const didNotMove = scrollState.beforeTop === scrollState.afterTop;

    if (reachedBottom || didNotMove) {
      break;
    }
  }

  return collectedTitles;
}

async function loadModulesOnce() {
  return await withNoodlePage(async (page, state) => {
    console.log("[Modules Router] Loading course item cards from Noodle Factory...");

    await page.goto(NOODLE_TARGET_URL, {
      waitUntil: "networkidle2",
      timeout: 60000,
    });

    state.isOnCourseHome = true;
    state.isChatPanelOpen = false;
    state.activeContext = "";

    await waitForCourseCardsToLoad(page);

    const modules = await collectCourseItemTitles(page);

    console.log(
      `[Modules Router] Course items loaded: ${modules.length}`,
      modules
    );

    return modules;
  });
}

export async function GET() {
  try {
    const modules = await loadModulesOnce();

    return NextResponse.json({
      modules,
    });
  } catch (error: any) {
    console.error("[Modules Router] Failed to load modules:", error.message);

    if (isDetachedFrameError(error)) {
      console.log(
        "[Modules Router] Detached frame detected. Resetting page and retrying once..."
      );

      await resetNoodlePage();

      try {
        const modules = await loadModulesOnce();

        return NextResponse.json({
          modules,
        });
      } catch (retryError: any) {
        console.error(
          "[Modules Router] Retry failed:",
          retryError.message
        );

        return NextResponse.json(
          {
            modules: [],
            error: retryError.message,
          },
          {
            status: 500,
          }
        );
      }
    }

    return NextResponse.json(
      {
        modules: [],
        error: error.message,
      },
      {
        status: 500,
      }
    );
  }
}