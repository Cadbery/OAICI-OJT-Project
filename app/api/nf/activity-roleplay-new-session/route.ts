import { NextResponse } from "next/server";
import type { Page } from "puppeteer";
import {
  NOODLE_TARGET_URL,
  withNoodlePage,
} from "../../../../lib/noodleBrowser";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  images?: string[];
};

type ChatTurnGroup = ChatMessage[];

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeText(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

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

function getThreadKey(messages: ChatMessage[]) {
  return messages
    .map((message) => {
      const imageKey = (message.images || []).join(",");
      return `${message.role}:${normalizeText(message.content)}:${imageKey}`;
    })
    .join(" || ");
}

function getTurnGroupKey(group: ChatTurnGroup) {
  return group
    .map((message) => {
      const imageKey = (message.images || []).join(",");
      return `${message.role}::${normalizeText(message.content)}::images:${imageKey}`;
    })
    .join(" || ");
}

function buildTurnGroupsFromNewestFirstMessages(
  messages: ChatMessage[]
): ChatTurnGroup[] {
  const groups: ChatTurnGroup[] = [];
  let currentGroup: ChatTurnGroup = [];

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

function convertGroupsToChronologicalMessages(
  groupsNewestFirst: ChatTurnGroup[]
) {
  return groupsNewestFirst
    .slice()
    .reverse()
    .flatMap((group) => group.slice().reverse());
}

function convertMessagesToChronological(messages: ChatMessage[]) {
  const groupsNewestFirst = buildTurnGroupsFromNewestFirstMessages(messages);

  const seenGroups = new Set<string>();
  const uniqueGroups = groupsNewestFirst.filter((group) => {
    const key = getTurnGroupKey(group);

    if (seenGroups.has(key)) return false;

    seenGroups.add(key);
    return true;
  });

  return convertGroupsToChronologicalMessages(uniqueGroups);
}

async function openRoleplayFromActivityList(page: Page, title: string) {
  console.log(
    `[Roleplay New Session Router] Opening role play from activity list: "${title}"`
  );

  await page.goto(NOODLE_TARGET_URL, {
    waitUntil: "networkidle2",
    timeout: 60000,
  });

  await sleep(2500);

  const clickedActivity = await page.evaluate((activityTitle) => {
    function clean(text: string) {
      return text.replace(/\s+/g, " ").trim();
    }

    function isVisible(element: HTMLElement) {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);

      return (
        rect.width > 0 &&
        rect.height > 0 &&
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        element.offsetParent !== null
      );
    }

    function findScopeWithTitle(element: HTMLElement, lowerTargetTitle: string) {
      let currentElement: HTMLElement | null = element;

      for (let depth = 0; currentElement && depth < 8; depth++) {
        const scopeText = clean(
          currentElement.innerText || currentElement.textContent || ""
        ).toLowerCase();

        if (scopeText.includes(lowerTargetTitle)) {
          return currentElement;
        }

        currentElement = currentElement.parentElement;
      }

      return null;
    }

    function clickElement(element: HTMLElement) {
      element.scrollIntoView({
        block: "center",
      });

      element.dispatchEvent(
        new MouseEvent("mousedown", {
          bubbles: true,
          cancelable: true,
          view: window,
        })
      );

      element.dispatchEvent(
        new MouseEvent("mouseup", {
          bubbles: true,
          cancelable: true,
          view: window,
        })
      );

      element.click();
    }

    const lowerTargetTitle = clean(activityTitle).toLowerCase();

    const clickables = Array.from(
      document.querySelectorAll("button, a, [role='button']")
    ) as HTMLElement[];

    const candidates = clickables
      .map((element) => {
        const buttonText = clean(
          element.innerText || element.textContent || ""
        ).toLowerCase();

        if (!isVisible(element)) return null;

        // IMPORTANT: never click Noodle Factory's broken New Session button.
        if (buttonText.includes("new session")) return null;

        const scope = findScopeWithTitle(element, lowerTargetTitle);

        if (!scope) return null;

        const scopeText = clean(scope.innerText || scope.textContent || "")
          .toLowerCase();

        let score = 100;

        if (
          buttonText.includes("start roleplay") ||
          buttonText.includes("start role play")
        ) {
          score = 0;
        } else if (buttonText.includes("start")) {
          score = 1;
        } else if (buttonText.includes("browse")) {
          score = 2;
        } else if (buttonText.includes("continue")) {
          score = 3;
        } else if (buttonText.includes("open")) {
          score = 4;
        } else if (buttonText.includes("view")) {
          score = 5;
        } else if (buttonText.includes(lowerTargetTitle)) {
          score = 6;
        } else if (scopeText.includes(lowerTargetTitle)) {
          score = 7;
        }

        return {
          element,
          buttonText,
          scopeText,
          score,
        };
      })
      .filter(Boolean)
      .sort((a, b) => {
        return (a?.score || 100) - (b?.score || 100);
      }) as Array<{
      element: HTMLElement;
      buttonText: string;
      scopeText: string;
      score: number;
    }>;

    const target = candidates[0];

    if (target) {
      clickElement(target.element);

      return {
        clicked: true,
        clickedText: target.buttonText,
        score: target.score,
      };
    }

    // Fallback: click the visible title/card itself, but still avoid New Session.
    const titleElement = (
      Array.from(
        document.querySelectorAll("button, a, [role='button'], div, p, span, h1, h2, h3, h4")
      ) as HTMLElement[]
    ).find((element) => {
      if (!isVisible(element)) return false;

      const text = clean(element.innerText || element.textContent || "")
        .toLowerCase();

      if (text.includes("new session")) return false;

      return text.includes(lowerTargetTitle);
    });

    if (titleElement) {
      const clickableParent = titleElement.closest(
        "button, a, [role='button']"
      ) as HTMLElement | null;

      if (clickableParent) {
        const clickableText = clean(
          clickableParent.innerText || clickableParent.textContent || ""
        ).toLowerCase();

        if (!clickableText.includes("new session")) {
          clickElement(clickableParent);

          return {
            clicked: true,
            clickedText: clickableText,
            score: 8,
          };
        }
      }

      clickElement(titleElement);

      return {
        clicked: true,
        clickedText: clean(titleElement.innerText || titleElement.textContent || ""),
        score: 9,
      };
    }

    return {
      clicked: false,
      clickedText: "",
      score: 100,
    };
  }, title);

  console.log("[Roleplay New Session Router] Activity click result:", clickedActivity);

  if (!clickedActivity.clicked) {
    throw new Error(
      `Could not find and open the role play activity named "${title}".`
    );
  }

  await page
    .waitForNavigation({
      waitUntil: "networkidle2",
      timeout: 15000,
    })
    .catch(() => {});

  await Promise.race([
    page
      .waitForSelector(
        "#parent-container-scroll-view, textarea, input[type='text'], .user-chat-message-container, .text-reply-container",
        {
          timeout: 60000,
        }
      )
      .catch(() => null),
    sleep(60000),
  ]);

  await sleep(2500);
}

async function extractVisibleRoleplayThread(page: Page): Promise<ChatMessage[]> {
  const messages = await page.evaluate(() => {
    const messageSelector = ".user-chat-message-container, .text-reply-container";
    const allMessageElements = Array.from(document.querySelectorAll(messageSelector));

    const topLevelMessageElements = allMessageElements.filter((element) => {
      return !element.parentElement?.closest(messageSelector);
    });

    function getImageUrl(image: HTMLImageElement) {
      return image.currentSrc || image.src || "";
    }

    function isUsefulChatImage(image: HTMLImageElement) {
      const url = getImageUrl(image);
      const alt = image.alt || "";
      const className = String(image.className || "");
      const rect = image.getBoundingClientRect();

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
        .filter((image) => isUsefulChatImage(image as HTMLImageElement))
        .map((image) => getImageUrl(image as HTMLImageElement))
        .filter(Boolean);

      return Array.from(new Set(images));
    }

    return topLevelMessageElements
      .map((element) => {
        const htmlElement = element as HTMLElement;

        const isUser =
          htmlElement.classList.contains("user-chat-message-container") ||
          htmlElement.closest(".user-chat-bubble-container") !== null;

        return {
          role: isUser ? "user" : "assistant",
          content: htmlElement.innerText?.trim() || "",
          images: getImagesInsideElement(htmlElement),
        };
      })
      .filter((message) => {
        const lowerContent = message.content
          .replace(/\s+/g, " ")
          .trim()
          .toLowerCase();

        const isTemporary =
          lowerContent === "thinking" ||
          lowerContent === "thinking..." ||
          lowerContent.includes("thinking") ||
          lowerContent.includes("working on your answer") ||
          lowerContent.includes("working on your response") ||
          lowerContent.includes("typing") ||
          lowerContent.includes("generating") ||
          lowerContent.includes("please wait");

        return (
          !isTemporary &&
          (message.content.length > 0 || message.images.length > 0)
        );
      });
  });

  return messages as ChatMessage[];
}

async function scrollChatToNewest(page: Page) {
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

async function waitForRoleplayThreadToStabilize(page: Page) {
  console.log("[Roleplay New Session Router] Waiting for new role play thread...");

  const timeoutMs = 120000;
  const start = Date.now();

  let lastKey = "";
  let stableCount = 0;
  let bestMessages: ChatMessage[] = [];

  while (Date.now() - start < timeoutMs) {
    const visibleMessages = await extractVisibleRoleplayThread(page);
    const currentKey = getThreadKey(visibleMessages);

    const assistantMessages = visibleMessages.filter(
      (message) => message.role === "assistant"
    );

    const hasAssistantMessage = assistantMessages.some(
      (message) => message.content.trim().length > 0 || (message.images || []).length > 0
    );

    const hasTemporaryMessage = assistantMessages.some((message) =>
      isTemporaryAssistantText(message.content)
    );

    if (hasAssistantMessage && !hasTemporaryMessage) {
      bestMessages = visibleMessages;

      if (currentKey === lastKey) {
        stableCount++;
      } else {
        lastKey = currentKey;
        stableCount = 0;
      }

      console.log(
        `[Roleplay New Session Router] Thread check: messages=${visibleMessages.length}, stableCount=${stableCount}`
      );

      if (stableCount >= 8) {
        return visibleMessages;
      }
    }

    await sleep(1500);
  }

  console.log(
    "[Roleplay New Session Router] Wait timed out. Returning best visible messages."
  );

  return bestMessages;
}

export async function POST(request: Request) {
  try {
    const { title } = await request.json();

    if (!title || !title.trim()) {
      throw new Error("Missing role play activity title.");
    }

    const result = await withNoodlePage(async (page, state) => {
      // Clear normal chat state because this route intentionally leaves the current chat
      // and reopens the role play from the activities menu.
      if (state) {
        state.activeContext = "";
        state.isChatPanelOpen = false;
        state.isOnCourseHome = false;
      }

      await openRoleplayFromActivityList(page, title.trim());

      await scrollChatToNewest(page);

      const newRoleplayMessages = await waitForRoleplayThreadToStabilize(page);

      const chronologicalMessages =
        convertMessagesToChronological(newRoleplayMessages);

      const assistantMessages = chronologicalMessages.filter(
        (message) => message.role === "assistant"
      );

      const latestAnswer =
        assistantMessages.length > 0
          ? assistantMessages[assistantMessages.length - 1].content
          : "";

      const latestAssistantImages =
        assistantMessages.length > 0
          ? assistantMessages[assistantMessages.length - 1].images || []
          : [];

      return {
        history: chronologicalMessages,
        answer: latestAnswer,
        images: latestAssistantImages,
      };
    });

    return NextResponse.json(result);
  } catch (error: any) {
    console.error(
      "[Roleplay New Session Router] New role play session failed:",
      error.message
    );

    return NextResponse.json(
      {
        history: [],
        answer: "",
        images: [],
        error: error.message,
      },
      {
        status: 500,
      }
    );
  }
}
