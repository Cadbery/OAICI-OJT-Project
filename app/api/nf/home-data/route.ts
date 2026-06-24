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

type RecommendedPrompt = {
  id: string;
  text: string;
  type: "review" | "practice";
};

type RecommendedPromptCard = {
  id: string;
  moduleTitle: string;
  prompts: RecommendedPrompt[];
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeText(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

async function waitForCourseCardsToLoad(page: Page) {
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
    .catch(() => undefined);
}

async function waitForRecommendedCards(page: Page) {
  await page
    .waitForFunction(
      () =>
        Array.from(document.querySelectorAll("h5")).some((heading) => {
          const parent = heading.parentElement;
          const card = parent?.parentElement;

          return Boolean(
            card &&
              (heading.textContent || "").trim() &&
              card.querySelectorAll("p").length > 0
          );
        }),
      { timeout: 15000 }
    )
    .catch(() => undefined);
}

async function collectCourseItemTitles(page: Page) {
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

    await new Promise((resolve) => setTimeout(resolve, 700));

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

async function scrapeRecommendedCards(page: Page) {
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
        style.visibility !== "hidden" &&
        style.opacity !== "0"
      );
    }

    function createId(value: string) {
      let hash = 0;

      for (let index = 0; index < value.length; index += 1) {
        hash = (hash * 31 + value.charCodeAt(index)) | 0;
      }

      return `recommendation-${Math.abs(hash)}`;
    }

    function isCompletionStatus(text: string) {
      return [
        "not completed",
        "not started",
        "completed",
        "in progress",
        "started",
        "submitted",
      ].includes(clean(text).toLowerCase());
    }

    function looksLikeStudyPrompt(text: string) {
      const lower = clean(text).toLowerCase();

      if (!lower || isCompletionStatus(lower) || lower.length < 15) {
        return false;
      }

      return /^(review|help me|explore|explain|teach me|show me|guide me|test me|quiz me|compare|describe|identify|practice|learn|walk me through)\b/i.test(
        lower
      );
    }

    const seenCards = new Set<string>();
    const cards: Array<{
      id: string;
      moduleTitle: string;
      prompts: Array<{
        id: string;
        text: string;
        type: "review" | "practice";
      }>;
    }> = [];

    const headings = Array.from(document.querySelectorAll("h5")).filter(
      isVisible
    ) as HTMLElement[];

    for (const heading of headings) {
      const moduleTitle = clean(heading.innerText || heading.textContent || "");

      if (!moduleTitle) {
        continue;
      }

      const card = heading.parentElement?.parentElement as HTMLElement | null;

      if (!card || !isVisible(card)) {
        continue;
      }

      const cardClassName = card.getAttribute("class") || "";

      if (
        !cardClassName.includes("rounded-2xl") ||
        !cardClassName.includes("items-start")
      ) {
        continue;
      }

      const promptParagraphs = Array.from(card.querySelectorAll("p")).filter(
        (paragraph) => {
          if (!isVisible(paragraph)) {
            return false;
          }

          const className = paragraph.getAttribute("class") || "";

          return className.includes("MuiTypography-caption");
        }
      ) as HTMLElement[];

      const prompts = promptParagraphs
        .map((paragraph, promptIndex) => {
          const text = clean(paragraph.innerText || paragraph.textContent || "");

          if (!looksLikeStudyPrompt(text)) {
            return null;
          }

          const row = paragraph.parentElement;
          const iconClassName =
            row?.querySelector("svg")?.getAttribute("class") || "";

          return {
            id: createId(`${moduleTitle}::${promptIndex}::${text}`),
            text,
            type: /colorPrimary/i.test(iconClassName)
              ? ("review" as const)
              : ("practice" as const),
          };
        })
        .filter(
          (
            prompt
          ): prompt is {
            id: string;
            text: string;
            type: "review" | "practice";
          } => Boolean(prompt)
        );

      if (prompts.length === 0) {
        continue;
      }

      const cardKey = `${moduleTitle}::${prompts
        .map((prompt) => prompt.text)
        .join("::")}`;

      if (seenCards.has(cardKey)) {
        continue;
      }

      seenCards.add(cardKey);
      cards.push({
        id: createId(cardKey),
        moduleTitle,
        prompts,
      });
    }

    return cards;
  });
}

async function loadHomeDataOnce() {
  return await withNoodlePage(async (page, state) => {
    console.log("[Home Data Router] Opening Course Home once...");

    await page.goto(NOODLE_TARGET_URL, {
      waitUntil: "networkidle2",
      timeout: 60000,
    });

    state.isOnCourseHome = true;
    state.isChatPanelOpen = false;
    state.activeContext = "";

    // Both sets of data belong to Course Home. Wait for them while the browser
    // is already on this page, then scrape recommendations before the folder
    // collector scrolls through the course cards.
    await Promise.all([
      waitForCourseCardsToLoad(page),
      waitForRecommendedCards(page),
    ]);

    await sleep(900);

    const recommendations = await scrapeRecommendedCards(page);
    const modules = await collectCourseItemTitles(page);

    console.log(
      `[Home Data Router] Loaded ${modules.length} course folders and ${recommendations.length} recommendation cards.`
    );

    return {
      modules,
      recommendations: recommendations as RecommendedPromptCard[],
    };
  });
}

export async function POST() {
  try {
    const homeData = await loadHomeDataOnce();

    return NextResponse.json({
      ok: true,
      ...homeData,
    });
  } catch (error: any) {
    console.error("[Home Data Router] Failed:", error.message);

    if (isDetachedFrameError(error)) {
      console.log(
        "[Home Data Router] Detached frame detected. Resetting page and retrying once..."
      );

      await resetNoodlePage();

      try {
        const homeData = await loadHomeDataOnce();

        return NextResponse.json({
          ok: true,
          ...homeData,
        });
      } catch (retryError: any) {
        console.error("[Home Data Router] Retry failed:", retryError.message);

        return NextResponse.json(
          {
            ok: false,
            modules: [],
            recommendations: [],
            error: retryError.message || "Failed to load Course Home data.",
          },
          { status: 500 }
        );
      }
    }

    return NextResponse.json(
      {
        ok: false,
        modules: [],
        recommendations: [],
        error: error.message || "Failed to load Course Home data.",
      },
      { status: 500 }
    );
  }
}
