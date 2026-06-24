import { NextResponse } from "next/server";
import type { Page } from "puppeteer";
import {
  NOODLE_TARGET_URL,
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

      // Noodle Factory's recommendation rows are study-action prompts,
      // unlike Browse cards, which only have status text such as "Not Completed".
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

      // Based on the supplied Noodle Factory markup:
      // card > content div > h5 + prompt-list div.
      const card = heading.parentElement?.parentElement as HTMLElement | null;

      if (!card || !isVisible(card)) {
        continue;
      }

      const cardClassName = card.getAttribute("class") || "";

      // This excludes the Browse/module cards, which have a different layout.
      // The recommendation card sent by the user includes both of these classes.
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

          // Recommendation text uses MUI caption rows in the supplied markup.
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

      // A recommendation card needs at least one actual study prompt.
      // Cards containing only "Not Completed" will be ignored.
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

export async function POST() {
  try {
    const result = await withNoodlePage(async (page, state) => {
      await page.goto(NOODLE_TARGET_URL, {
        waitUntil: "networkidle2",
        timeout: 60000,
      });

      await sleep(900);
      await waitForRecommendedCards(page);

      const recommendations = await scrapeRecommendedCards(page);

      state.activeContext = "";
      state.isChatPanelOpen = false;
      state.isOnCourseHome = true;

      return {
        ok: true,
        recommendations: recommendations satisfies RecommendedPromptCard[],
      };
    });

    return NextResponse.json(result);
  } catch (error: any) {
    console.error(
      "[Recommendations Router] Failed to scrape recommended prompts:",
      error.message
    );

    return NextResponse.json(
      {
        ok: false,
        error:
          error.message ||
          "Failed to load recommended prompts from Noodle Factory.",
      },
      { status: 500 }
    );
  }
}
