import { NextResponse } from "next/server";
import { withNoodlePage } from "../../../../lib/noodleBrowser";

const NOODLE_ACTIVITIES_URL =
  "https://org88300f0fbca24257.noodlefactory.app/home/agents/69fb09de0cee9f6e925c7bcd/activities?class=69fb09e80cee9f6e925c7bec";

type ActivityItem = {
  title: string;
  type: "quiz" | "roleplay" | "unknown";
  groupTitle: string;
  status?: string;
  attempts?: string;
  url?: string;
};

function normalizeText(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

function findMatchingModule(groupTitle: string, modules: string[]) {
  const cleanGroupTitle = normalizeText(groupTitle).toLowerCase();

  const exactMatch = modules.find(
    (moduleName) => normalizeText(moduleName).toLowerCase() === cleanGroupTitle
  );

  if (exactMatch) return exactMatch;

  const weekMatch = cleanGroupTitle.match(/week\s*\d+/i);
  const weekLabel = weekMatch?.[0]?.toLowerCase();

  if (!weekLabel) return groupTitle;

  const partialMatch = modules.find((moduleName) =>
    normalizeText(moduleName).toLowerCase().includes(weekLabel)
  );

  return partialMatch || groupTitle;
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const modules = Array.isArray(body.modules) ? body.modules : [];

    const activitiesByGroup = await withNoodlePage(async (page) => {
      console.log("[Activities Router] Opening Activities page...");

      await page.goto(NOODLE_ACTIVITIES_URL, {
        waitUntil: "networkidle2",
        timeout: 60000,
      });

      await page.waitForSelector("body", {
        timeout: 30000,
      });

      await new Promise((resolve) => setTimeout(resolve, 1500));

      const activities = await page.evaluate((knownModules: string[]) => {
        function clean(text: string) {
          return text.replace(/\s+/g, " ").trim();
        }

        function isStatus(text: string) {
          const lower = clean(text).toLowerCase();

          return [
            "not started",
            "not completed",
            "completed",
            "in progress",
            "submitted",
            "started",
          ].includes(lower);
        }

        function isAttemptText(text: string) {
          return /^\d+\s+attempts?$/i.test(clean(text));
        }

        function isActionText(text: string) {
          const lower = clean(text).toLowerCase();

          return (
            [
              "browse",
              "start",
              "continue",
              "view",
              "open",
              "launch",
              "begin",
              "resume",
              "start activity",
              "continue activity",
              "browse activity",
              "view activity",
              "open activity",
              "start quiz",
              "continue quiz",
              "browse quiz",
              "view quiz",
              "open quiz",
            ].includes(lower) ||
            /^(browse|start|continue|view|open|launch|begin|resume)\s*(activity|quiz|role play|roleplay)?$/i.test(
              lower
            )
          );
        }

        function isTypeText(text: string) {
          const lower = clean(text).toLowerCase();

          return [
            "quiz",
            "role play",
            "roleplay",
            "activity",
            "multiple choice quiz",
            "one question at a time",
          ].includes(lower);
        }

        function isKnownModuleText(text: string) {
          const lower = clean(text).toLowerCase();

          return knownModules.some((moduleName) => {
            const cleanModuleName = clean(moduleName).toLowerCase();

            return (
              lower === cleanModuleName ||
              cleanModuleName.includes(lower) ||
              lower.includes(cleanModuleName)
            );
          });
        }

        function isBadTitleCandidate(text: string) {
          const cleanedText = clean(text);

          if (!cleanedText) return true;
          if (cleanedText.length < 2) return true;
          if (cleanedText.length > 180) return true;
          if (isStatus(cleanedText)) return true;
          if (isActionText(cleanedText)) return true;
          if (isTypeText(cleanedText)) return true;
          if (isKnownModuleText(cleanedText)) return true;

          return false;
        }

        function getDirectText(element: Element) {
          return Array.from(element.childNodes)
            .filter((node) => node.nodeType === Node.TEXT_NODE)
            .map((node) => node.textContent || "")
            .join(" ");
        }

        function getUniqueLines(text: string) {
          const seen = new Set<string>();

          return text
            .split("\n")
            .map((line) => clean(line))
            .filter(Boolean)
            .filter((line) => {
              const key = line.toLowerCase();

              if (seen.has(key)) return false;

              seen.add(key);
              return true;
            });
        }

        function classifyByIconColor(
          title: string,
          cardText: string,
          iconBackgroundColor: string
        ): "quiz" | "roleplay" | "unknown" {
          const lowerTitle = title.toLowerCase();
          const lowerCardText = cardText.toLowerCase();
          const lowerColor = iconBackgroundColor.toLowerCase();

          if (
            lowerTitle.includes("quiz") ||
            lowerCardText.includes("quiz") ||
            lowerCardText.includes("multiple choice")
          ) {
            return "quiz";
          }

          if (
            lowerTitle.includes("role play") ||
            lowerTitle.includes("roleplay") ||
            lowerCardText.includes("role play") ||
            lowerCardText.includes("roleplay")
          ) {
            return "roleplay";
          }

          if (lowerColor.includes("254, 229, 244")) {
            return "roleplay";
          }

          return "quiz";
        }

        function getBestTitleFromCard(card: Element) {
          const candidates: string[] = [];
          const seen = new Set<string>();

          function addCandidate(text: string) {
            const cleanedText = clean(text);
            const key = cleanedText.toLowerCase();

            if (isBadTitleCandidate(cleanedText)) return;
            if (seen.has(key)) return;

            seen.add(key);
            candidates.push(cleanedText);
          }

          const linkElement = card.closest("a") || card.querySelector("a");

          if (linkElement) {
            addCandidate(linkElement.getAttribute("aria-label") || "");
            addCandidate(linkElement.getAttribute("title") || "");
          }

          Array.from(card.querySelectorAll("h1, h2, h3, h4, h5, h6")).forEach(
            (heading) => {
              addCandidate(heading.getAttribute("aria-label") || "");
              addCandidate(heading.getAttribute("title") || "");
              addCandidate(getDirectText(heading));
              addCandidate(heading.textContent || "");
            }
          );

          Array.from(card.querySelectorAll("[aria-label], [title]")).forEach(
            (element) => {
              addCandidate(element.getAttribute("aria-label") || "");
              addCandidate(element.getAttribute("title") || "");
            }
          );

          Array.from(card.querySelectorAll("p, span")).forEach((element) => {
            addCandidate(getDirectText(element));
            addCandidate(element.textContent || "");
          });

          const cardLines = getUniqueLines((card as HTMLElement).innerText || "");

          cardLines.forEach((line) => {
            addCandidate(line);
          });

          return candidates[0] || "";
        }

        function getGroupTitleFromCard(card: Element) {
          const paragraphTexts = Array.from(card.querySelectorAll("p"))
            .map((paragraph) => clean(paragraph.textContent || ""))
            .filter(Boolean);

          const knownModuleParagraph = paragraphTexts.find((text) =>
            isKnownModuleText(text)
          );

          if (knownModuleParagraph) return knownModuleParagraph;

          const weekParagraph = paragraphTexts.find((text) =>
            /week\s*\d+/i.test(text)
          );

          if (weekParagraph) return weekParagraph;

          const nonStatusParagraph = paragraphTexts.find(
            (text) =>
              !isStatus(text) &&
              !isActionText(text) &&
              !isTypeText(text) &&
              clean(text).length > 2
          );

          return nonStatusParagraph || "Ungrouped Activities";
        }

        const cards = Array.from(
          document.querySelectorAll("div.shadow.rounded-lg.h-full")
        );

        const scrapedActivities = cards
          .map((card) => {
            const cardText = clean((card as HTMLElement).innerText || "");

            const title = getBestTitleFromCard(card);

            if (!title) return null;

            const iconElement = card.querySelector(
              ".rounded-full"
            ) as HTMLElement | null;

            const iconBackgroundColor = iconElement
              ? window.getComputedStyle(iconElement).backgroundColor
              : "";

            const allLines = getUniqueLines((card as HTMLElement).innerText || "");

            const status = allLines.find((text) => isStatus(text));
            const attempts = allLines.find((text) => isAttemptText(text));

            const groupTitle = getGroupTitleFromCard(card);

            const type = classifyByIconColor(
              title,
              cardText,
              iconBackgroundColor
            );

            const linkElement = card.closest("a") || card.querySelector("a");
            const href = linkElement?.getAttribute("href") || "";

            const url = href
              ? new URL(href, window.location.origin).toString()
              : "";

            return {
              title,
              type,
              groupTitle,
              status,
              attempts,
              url,
              iconBackgroundColor,
              debugLines: allLines,
            };
          })
          .filter(Boolean);

        return scrapedActivities;
      }, modules);

      console.log(
        "[Activities Router] Raw scraped activities:",
        JSON.stringify(activities, null, 2)
      );

      const grouped: Record<string, ActivityItem[]> = {};

      for (const activity of activities as (ActivityItem & {
        iconBackgroundColor?: string;
        debugLines?: string[];
      })[]) {
        const matchingGroupTitle = findMatchingModule(
          activity.groupTitle,
          modules
        );

        if (!grouped[matchingGroupTitle]) {
          grouped[matchingGroupTitle] = [];
        }

        const alreadyExists = grouped[matchingGroupTitle].some(
          (existingActivity) =>
            existingActivity.title === activity.title &&
            existingActivity.type === activity.type
        );

        if (!alreadyExists) {
          grouped[matchingGroupTitle].push({
            title: activity.title,
            type: activity.type,
            groupTitle: matchingGroupTitle,
            status: activity.status,
            attempts: activity.attempts,
            url: activity.url,
          });
        }
      }

      console.log(
        "[Activities Router] Grouped activities:",
        JSON.stringify(grouped, null, 2)
      );

      return grouped;
    });

    return NextResponse.json({
      activitiesByGroup,
    });
  } catch (error: unknown) {
    console.error("[Activities Router] Failed:", error);

    return NextResponse.json(
      {
        activitiesByGroup: {},
        error:
          error instanceof Error
            ? error.message
            : "Failed to load activities.",
      },
      {
        status: 500,
      }
    );
  }
}
