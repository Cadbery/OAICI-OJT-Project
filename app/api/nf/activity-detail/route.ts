import { NextResponse } from "next/server";
import { withNoodlePage } from "../../../../lib/noodleBrowser";

const NOODLE_ACTIVITIES_URL =
  "https://org88300f0fbca24257.noodlefactory.app/home/agents/69fb09de0cee9f6e925c7bcd/activities?class=69fb09e80cee9f6e925c7bec";

type QuizQuestion = {
  number: number;
  question: string;
  choices: string[];
};

type RoleplayMessage = {
  role: "user" | "assistant";
  content: string;
  images?: string[];
};

type ActivityDetail = {
  title: string;
  type: "quiz" | "roleplay" | "unknown";
  mode: "all-at-once" | "one-at-a-time";
  questions: QuizQuestion[];
  hasNext: boolean;
  roleplayMessages?: RoleplayMessage[];
};

function isTemporaryAssistantText(text: string) {
  const lower = normalizeText(text).toLowerCase();

  return (
    lower === "thinking" ||
    lower === "thinking..." ||
    lower.includes("thinking") ||
    lower.includes("working on your answer") ||
    lower.includes("working on your response") ||
    lower.includes("typing") ||
    lower.includes("generating") ||
    lower.includes("please wait")
  );
}

async function waitForRoleplayAssistantToFinish(page: any) {
  console.log("[Activity Detail Router] Waiting for roleplay response to finish...");

  const timeoutMs = 120000;
  const start = Date.now();

  let lastText = "";
  let stableCount = 0;

  while (Date.now() - start < timeoutMs) {
    const latestAssistantText = await page.evaluate(() => {
      const assistantElements = Array.from(
        document.querySelectorAll(".text-reply-container")
      );

      const texts = assistantElements
        .map((element) =>
          ((element as HTMLElement).innerText || "")
            .replace(/\s+/g, " ")
            .trim()
        )
        .filter(Boolean);

      return texts[0] || texts[texts.length - 1] || "";
    });

    const cleanLatestText = normalizeText(latestAssistantText);

    if (!cleanLatestText || isTemporaryAssistantText(cleanLatestText)) {
      stableCount = 0;
      lastText = "";
      await new Promise((resolve) => setTimeout(resolve, 1500));
      continue;
    }

    if (cleanLatestText === lastText) {
      stableCount++;
    } else {
      lastText = cleanLatestText;
      stableCount = 0;
    }

    console.log(
      `[Activity Detail Router] Roleplay response stableCount=${stableCount}`
    );

    if (stableCount >= 8) {
      console.log("[Activity Detail Router] Roleplay response finished.");
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 1500));
  }

  console.log("[Activity Detail Router] Roleplay response wait timed out.");
}

function normalizeText(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

type RoleplayTurnGroup = RoleplayMessage[];

function getRoleplayTurnGroupKey(group: RoleplayTurnGroup) {
  return group
    .map((message) => {
      const imageKey = (message.images || []).join(",");
      return `${message.role}::${normalizeText(message.content)}::images:${imageKey}`;
    })
    .join(" || ");
}

function buildRoleplayTurnGroupsFromNewestFirstMessages(
  messages: RoleplayMessage[]
): RoleplayTurnGroup[] {
  const groups: RoleplayTurnGroup[] = [];
  let currentGroup: RoleplayTurnGroup = [];

  for (const message of messages) {
    currentGroup.push(message);

    if (message.role === "user") {
      groups.push(currentGroup);
      currentGroup = [];
    }
  }

  if (currentGroup.length > 0) {
    groups.push(currentGroup);
  }

  return groups;
}

function convertRoleplayGroupsToChronologicalMessages(
  groupsNewestFirst: RoleplayTurnGroup[]
) {
  return groupsNewestFirst
    .slice()
    .reverse()
    .flatMap((group) => group.slice().reverse());
}

function convertRoleplayMessagesToChronological(messages: RoleplayMessage[]) {
  const groupsNewestFirst =
    buildRoleplayTurnGroupsFromNewestFirstMessages(messages);

  const seenGroups = new Set<string>();
  const uniqueGroups = groupsNewestFirst.filter((group) => {
    const key = getRoleplayTurnGroupKey(group);

    if (seenGroups.has(key)) return false;

    seenGroups.add(key);
    return true;
  });

  return convertRoleplayGroupsToChronologicalMessages(uniqueGroups);
}

export async function POST(request: Request) {
  try {
    const body = await request.json();

    const targetTitle = normalizeText(body.title || "");
    const targetGroupTitle = normalizeText(body.groupTitle || "");
    const targetType = (body.type || "unknown") as
      | "quiz"
      | "roleplay"
      | "unknown";

    if (!targetTitle) {
      return NextResponse.json(
        {
          error: "Activity title is required.",
        },
        {
          status: 400,
        }
      );
    }

    const activity = await withNoodlePage(async (page) => {
      console.log("[Activity Detail Router] Opening Activities page...");

      await page.goto(NOODLE_ACTIVITIES_URL, {
        waitUntil: "networkidle2",
        timeout: 60000,
      });

      await page.waitForSelector("body", {
        timeout: 30000,
      });

      await new Promise((resolve) => setTimeout(resolve, 1200));

      const cards = await page.$$("div.shadow.rounded-lg.h-full");

      let matchedCard: (typeof cards)[number] | null = null;

      for (const card of cards) {
        const cardData = await card.evaluate((element) => {
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

          function isActionText(text: string) {
            const lower = clean(text).toLowerCase();

            return [
              "browse",
              "start",
              "continue",
              "view",
              "open",
              "launch",
              "begin",
              "resume",
            ].includes(lower);
          }

          const headingTexts = Array.from(
            element.querySelectorAll("h1, h2, h3, h4, h5, h6")
          )
            .map((heading) => {
              return (
                clean(heading.getAttribute("aria-label") || "") ||
                clean(heading.getAttribute("title") || "") ||
                clean(heading.textContent || "")
              );
            })
            .filter(Boolean)
            .filter((text) => !isActionText(text));

          const title = headingTexts[0] || "";

          const paragraphTexts = Array.from(element.querySelectorAll("p"))
            .map((paragraph) => clean(paragraph.textContent || ""))
            .filter(Boolean);

          const groupTitle =
            paragraphTexts.find((text) => !isStatus(text)) || "";

          return {
            title,
            groupTitle,
            cardText: clean((element as HTMLElement).innerText || ""),
          };
        });

        const cardTitle = normalizeText(cardData.title);
        const cardGroupTitle = normalizeText(cardData.groupTitle);

        const titleMatches =
          cardTitle.toLowerCase() === targetTitle.toLowerCase();

        const groupMatches =
          !targetGroupTitle ||
          cardGroupTitle.toLowerCase() === targetGroupTitle.toLowerCase() ||
          targetGroupTitle.toLowerCase().includes(cardGroupTitle.toLowerCase()) ||
          cardGroupTitle.toLowerCase().includes(targetGroupTitle.toLowerCase());

        if (titleMatches && groupMatches) {
          matchedCard = card;
          break;
        }
      }

      if (!matchedCard) {
        throw new Error(`Activity not found: ${targetTitle}`);
      }

      console.log("[Activity Detail Router] Clicking activity:", targetTitle);

      await matchedCard.click();

      await Promise.race([
        page
          .waitForSelector("label.quiz-radio-wrapper", {
            timeout: 30000,
          })
          .catch(() => null),
        page
          .waitForSelector("button.quiz-navigation-button", {
            timeout: 30000,
          })
          .catch(() => null),
        page
          .waitForSelector(
            "#parent-container-scroll-view, textarea, input[type='text'], .user-chat-message-container, .text-reply-container",
            {
              timeout: 30000,
            }
          )
          .catch(() => null),
      ]);

      await new Promise((resolve) => setTimeout(resolve, 1200));


      if (targetType === "roleplay") {
        await waitForRoleplayAssistantToFinish(page);
      }

      const scrapedActivity = await page.evaluate(
        (fallbackTitle, fallbackType) => {
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

          function getImageUrl(img: HTMLImageElement) {
            return img.currentSrc || img.src || "";
          }

          function isUsefulChatImage(img: HTMLImageElement) {
            const url = getImageUrl(img);
            const alt = img.alt || "";
            const className = img.className || "";
            const rect = img.getBoundingClientRect();

            if (!url) return false;
            if (rect.width <= 0 || rect.height <= 0) return false;

            return (
              className.includes("image-preview-img") ||
              alt.includes("![]") ||
              url.includes("media.noodlefactory.ai")
            );
          }

          function getImagesInsideElement(element: HTMLElement) {
            const images = Array.from(element.querySelectorAll("img"))
              .filter((img) => isUsefulChatImage(img as HTMLImageElement))
              .map((img) => getImageUrl(img as HTMLImageElement))
              .filter(Boolean);

            return Array.from(new Set(images));
          }

          function extractRoleplayMessages() {
            const messageSelector =
              ".user-chat-message-container, .text-reply-container";

            const allMessageElements = Array.from(
              document.querySelectorAll(messageSelector)
            );

            const topLevelMessageElements = allMessageElements.filter((el) => {
              return !el.parentElement?.closest(messageSelector);
            });

            return topLevelMessageElements
              .map((el) => {
                const element = el as HTMLElement;

                const isUser =
                  element.classList.contains("user-chat-message-container") ||
                  element.closest(".user-chat-bubble-container") !== null;

                return {
                  role: isUser ? "user" : "assistant",
                  content: clean(element.innerText || ""),
                  images: getImagesInsideElement(element),
                };
              })
              .filter(
                (message) =>
                  message.content.length > 0 ||
                  (message.images && message.images.length > 0)
              );
          }

          const titleCandidates = Array.from(
            document.querySelectorAll("h1, h2, h3, h4, h5")
          )
            .map((element) => clean(element.textContent || ""))
            .filter(Boolean);

          const pageTitle =
            titleCandidates.find((text) => {
              const lower = text.toLowerCase();

              return (
                !lower.startsWith("question") &&
                lower !== "activities" &&
                lower !== "browse"
              );
            }) || fallbackTitle;

          const visibleLabels = Array.from(
            document.querySelectorAll("label.quiz-radio-wrapper")
          ).filter(isVisible);

          const questionMap: Record<string, string[]> = {};

          for (const label of visibleLabels) {
            const rawFor = label.getAttribute("for") || "";
            const question = clean(rawFor.replace(/\d+$/, ""));
            const choice = clean((label as HTMLElement).innerText || "");

            if (!question || !choice) continue;

            if (!questionMap[question]) {
              questionMap[question] = [];
            }

            questionMap[question].push(choice);
          }

          const questions = Object.entries(questionMap).map(
            ([question, choices], index) => ({
              number: index + 1,
              question,
              choices,
            })
          );

          const nextImage = Array.from(
            document.querySelectorAll("button.quiz-navigation-button img")
          ).find((image) => {
            const alt = image.getAttribute("alt") || "";
            return alt.toLowerCase() === "next";
          });

          const nextButton = nextImage?.closest(
            "button"
          ) as HTMLButtonElement | null;

          const hasNext = Boolean(
            nextButton && !nextButton.disabled && isVisible(nextButton)
          );

          const hasRoleplayInput = Array.from(
            document.querySelectorAll("textarea, input[type='text']")
          ).some((element) => {
            const input = element as HTMLInputElement | HTMLTextAreaElement;
            return isVisible(input) && !input.disabled;
          });

          const hasRoleplayMessages =
            document.querySelectorAll(
              ".user-chat-message-container, .text-reply-container"
            ).length > 0;

          const detectedType =
            fallbackType === "roleplay" ||
            (questions.length === 0 && (hasRoleplayInput || hasRoleplayMessages))
              ? "roleplay"
              : fallbackType;

          const mode = hasNext ? "one-at-a-time" : "all-at-once";

          return {
            title: fallbackTitle || pageTitle,
            type: detectedType,
            mode,
            questions,
            hasNext,
            roleplayMessages:
              detectedType === "roleplay" ? extractRoleplayMessages() : [],
          };
        },
        targetTitle,
        targetType
      );

      console.log(
        "[Activity Detail Router] Scraped activity:",
        JSON.stringify(scrapedActivity, null, 2)
      );

      const normalizedActivity = scrapedActivity as ActivityDetail;

      if (
        normalizedActivity.type === "roleplay" &&
        Array.isArray(normalizedActivity.roleplayMessages)
      ) {
        normalizedActivity.roleplayMessages = convertRoleplayMessagesToChronological(
          normalizedActivity.roleplayMessages
        );
      }

      return normalizedActivity;
    });

    return NextResponse.json({
      activity,
    });
  } catch (error: any) {
    console.error("[Activity Detail Router] Failed:", error);

    return NextResponse.json(
      {
        error: error.message || "Failed to load activity detail.",
      },
      {
        status: 500,
      }
    );
  }
}