import { NextResponse } from "next/server";
import type { Page } from "puppeteer";
import { withNoodlePage } from "../../../../lib/noodleBrowser";

type RoleplayMessage = {
  role: "user" | "assistant";
  content: string;
  images?: string[];
};

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

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeText(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

function isTemporaryAssistantText(text: string) {
  const lower = normalizeText(text).toLowerCase();
  const isThinkingOnly = /^thinking(?:[.\u2026\s]*)$/i.test(lower);

  // Noodle Factory temporarily shows "Thinking..." before replacing it with
  // Walter's final role-play reply. Do not treat that loading bubble as an
  // answer, but do not discard valid answers that happen to use "thinking"
  // in a normal sentence.
  return (
    isThinkingOnly ||
    lower.includes("working on your answer") ||
    lower.includes("working on your response") ||
    lower.includes("typing") ||
    lower.includes("generating") ||
    lower.includes("please wait")
  );
}

async function extractVisibleRoleplayThread(
  page: Page
): Promise<RoleplayMessage[]> {
  const messages = await page.evaluate(() => {
    const messageSelector =
      ".user-chat-message-container, .text-reply-container";

    const allMessageElements = Array.from(
      document.querySelectorAll(messageSelector)
    );

    function isVisible(element: Element) {
      const htmlElement = element as HTMLElement;
      const rect = htmlElement.getBoundingClientRect();
      const style = window.getComputedStyle(htmlElement);

      return (
        rect.width > 0 &&
        rect.height > 0 &&
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        style.opacity !== "0" &&
        htmlElement.offsetParent !== null
      );
    }

    const topLevelMessageElements = allMessageElements.filter((el) => {
      return !el.parentElement?.closest(messageSelector) && isVisible(el);
    });

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

    function isTemporaryText(text: string) {
      const lower = text.replace(/\s+/g, " ").trim().toLowerCase();
      const isThinkingOnly = /^thinking(?:[.\u2026\s]*)$/i.test(lower);

      return (
        isThinkingOnly ||
        lower.includes("working on your answer") ||
        lower.includes("working on your response") ||
        lower.includes("typing") ||
        lower.includes("generating") ||
        lower.includes("please wait")
      );
    }

    return topLevelMessageElements
      .map((el) => {
        const element = el as HTMLElement;

        const isUser =
          element.classList.contains("user-chat-message-container") ||
          element.closest(".user-chat-bubble-container") !== null;

        return {
          role: isUser ? "user" : "assistant",
          content: element.innerText?.trim() || "",
          images: getImagesInsideElement(element),
        };
      })
      .filter(
        (message) =>
          !isTemporaryText(message.content) &&
          (message.content.length > 0 || message.images.length > 0)
      );
  });

  console.log(
    `[Roleplay Chat Router] Extracted visible thread: messages=${messages.length}`
  );

  return messages as RoleplayMessage[];
}
async function getAssistantTexts(page: Page): Promise<string[]> {
  const texts = await page.evaluate(() => {
    const selector = ".text-reply-container";
    const allElements = Array.from(document.querySelectorAll(selector));

    function isVisible(element: Element) {
      const htmlElement = element as HTMLElement;
      const rect = htmlElement.getBoundingClientRect();
      const style = window.getComputedStyle(htmlElement);

      return (
        rect.width > 0 &&
        rect.height > 0 &&
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        style.opacity !== "0" &&
        htmlElement.offsetParent !== null
      );
    }

    const topLevelElements = allElements.filter((el) => {
      return !el.parentElement?.closest(selector) && isVisible(el);
    });

    return topLevelElements
      .map((el) => (el as HTMLElement).innerText?.trim() || "")
      .filter((text) => text.length > 0);
  });

  return texts as string[];
}
function findNewAssistantCandidate(
  beforeTexts: string[],
  currentTexts: string[]
) {
  const normalizedBefore = beforeTexts.map(normalizeText);

  const uniqueNewText = currentTexts.find((text) => {
    const normalized = normalizeText(text);

    return (
      normalized.length > 0 &&
      !isTemporaryAssistantText(text) &&
      !normalizedBefore.includes(normalized)
    );
  });

  if (uniqueNewText) {
    return uniqueNewText;
  }

  if (currentTexts.length > beforeTexts.length) {
    const firstText = currentTexts[0];
    const lastText = currentTexts[currentTexts.length - 1];

    if (
      firstText &&
      !isTemporaryAssistantText(firstText) &&
      normalizeText(firstText) !== normalizedBefore[0]
    ) {
      return firstText;
    }

    if (
      lastText &&
      !isTemporaryAssistantText(lastText) &&
      normalizeText(lastText) !== normalizedBefore[normalizedBefore.length - 1]
    ) {
      return lastText;
    }
  }

  return "";
}

async function waitForFinalRoleplayAnswer(
  page: Page,
  beforeAssistantTexts: string[]
) {
  console.log("[Roleplay Chat Router] Waiting for final roleplay response...");

  const timeoutMs = 180000;
  const start = Date.now();
  const requiredStableChecks = 4;

  let hasSeenTemporaryBubble = false;
  let lastCandidate = "";
  let stableCount = 0;

  while (Date.now() - start < timeoutMs) {
    const currentTexts = await getAssistantTexts(page);

    const temporaryTexts = currentTexts.filter((text) =>
      isTemporaryAssistantText(text)
    );

    if (temporaryTexts.length > 0) {
      hasSeenTemporaryBubble = true;
      await sleep(1200);
      continue;
    }

    const candidate = findNewAssistantCandidate(
      beforeAssistantTexts,
      currentTexts
    );

    if (candidate && !isTemporaryAssistantText(candidate)) {
      if (normalizeText(candidate) === normalizeText(lastCandidate)) {
        stableCount += 1;
      } else {
        lastCandidate = candidate;
        stableCount = 0;
      }

      console.log(
        `[Roleplay Chat Router] Candidate answer detected. temporarySeen=${hasSeenTemporaryBubble}, stableCount=${stableCount}`
      );

      if (stableCount >= requiredStableChecks) {
        console.log("[Roleplay Chat Router] Final roleplay response stabilized.");
        return candidate;
      }
    }

    await sleep(1200);
  }

  console.log(
    "[Roleplay Chat Router] Response wait timed out. Returning the last non-temporary candidate."
  );

  return lastCandidate;
}
async function focusRoleplayInput(page: Page) {
  const didFocusInput = await page.evaluate(() => {
    const inputs = Array.from(
      document.querySelectorAll("textarea, input[type='text']")
    );

    const visibleInput = inputs.find((el) => {
      const input = el as HTMLInputElement | HTMLTextAreaElement;
      const rect = input.getBoundingClientRect();

      return (
        rect.width > 0 &&
        rect.height > 0 &&
        !input.disabled &&
        input.offsetParent !== null
      );
    }) as HTMLInputElement | HTMLTextAreaElement | undefined;

    if (!visibleInput) {
      return false;
    }

    visibleInput.focus();
    return true;
  });

  return didFocusInput;
}

async function scrollRoleplayToNewest(page: Page) {
  await page.evaluate(() => {
    const scrollContainer = document.querySelector(
      "#parent-container-scroll-view"
    ) as HTMLElement | null;

    if (!scrollContainer) return;

    scrollContainer.scrollTop = 0;

    scrollContainer.dispatchEvent(
      new Event("scroll", {
        bubbles: true,
      })
    );
  });

  await sleep(700);
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const message = normalizeText(body.message || "");
    const isInitialLoad = !message;

    const result = await withNoodlePage(async (page) => {
      const hasRoleplayInterface = await page.evaluate(() => {
        const scrollContainer = document.querySelector(
          "#parent-container-scroll-view"
        );

        const input = Array.from(
          document.querySelectorAll("textarea, input[type='text']")
        ).find((element) => {
          const inputElement = element as HTMLInputElement | HTMLTextAreaElement;
          const rect = inputElement.getBoundingClientRect();

          return (
            rect.width > 0 &&
            rect.height > 0 &&
            !inputElement.disabled &&
            inputElement.offsetParent !== null
          );
        });

        return Boolean(scrollContainer || input);
      });

      if (!hasRoleplayInterface) {
        throw new Error(
          "Role play chat interface is not open. Open a role play activity first."
        );
      }

      await scrollRoleplayToNewest(page);

      if (isInitialLoad) {
        const visibleHistory = await extractVisibleRoleplayThread(page);
        const history = convertRoleplayMessagesToChronological(visibleHistory);

        return {
            history,
            answer: "",
            images: [],
        };
      }

      console.log("[Roleplay Chat Router] Sending roleplay message:", message);

      const beforeAssistantTexts = await getAssistantTexts(page);

      const didFocusInput = await focusRoleplayInput(page);

      if (!didFocusInput) {
        throw new Error("Could not find the role play message input.");
      }

      await page.keyboard.type(message, {
        delay: 30,
      });

      await page.keyboard.press("Enter");

      const finalAnswer = await waitForFinalRoleplayAnswer(
        page,
        beforeAssistantTexts
      );

      const visibleHistory = await extractVisibleRoleplayThread(page);
      const history = convertRoleplayMessagesToChronological(visibleHistory);

      const assistantMessages = history.filter(
        (historyMessage) =>
          historyMessage.role === "assistant" &&
          !isTemporaryAssistantText(historyMessage.content)
      );

      const latestAssistantMessage =
        assistantMessages.find(
          (assistantMessage) =>
            normalizeText(assistantMessage.content) === normalizeText(finalAnswer)
        ) || assistantMessages[assistantMessages.length - 1];

      return {
        history,
        answer: latestAssistantMessage?.content || finalAnswer || "",
        images: latestAssistantMessage?.images || [],
      };
    });

    return NextResponse.json(result);
  } catch (error: any) {
    console.error("[Roleplay Chat Router] Failed:", error);

    return NextResponse.json(
      {
        history: [],
        answer: "",
        images: [],
        error: error.message || "Failed to send role play message.",
      },
      {
        status: 500,
      }
    );
  }
}