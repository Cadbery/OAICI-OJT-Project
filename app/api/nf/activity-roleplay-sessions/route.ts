import { NextResponse } from "next/server";
import type { Page } from "puppeteer";
import { withNoodlePage } from "../../../../lib/noodleBrowser";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  images?: string[];
};

type ChatTurnGroup = ChatMessage[];

type SessionOption = {
  id: string;
  title: string;
  index: number;
  isActive: boolean;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeText(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

function getTurnGroupKey(group: ChatTurnGroup) {
  return group
    .map((message) => {
      const imageKey = (message.images || []).join(",");
      return `${message.role}::${normalizeText(
        message.content
      )}::images:${imageKey}`;
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

function isMatchingRoleplaySession(optionTitle: string, activityTitle: string) {
  const cleanOptionTitle = normalizeText(optionTitle).toLowerCase();
  const cleanActivityTitle = normalizeText(activityTitle).toLowerCase();

  const isRoleplay =
    cleanOptionTitle.startsWith("role play:") ||
    cleanOptionTitle.startsWith("roleplay:") ||
    cleanOptionTitle.includes("role play:");

  if (!isRoleplay) return false;

  if (!cleanActivityTitle) return true;

  const optionTitleWithoutPrefix = cleanOptionTitle
    .replace(/^role\s*play:\s*/i, "")
    .replace(/^roleplay:\s*/i, "")
    .trim();

  return (
    cleanOptionTitle.includes(cleanActivityTitle) ||
    optionTitleWithoutPrefix.includes(cleanActivityTitle) ||
    cleanActivityTitle.includes(optionTitleWithoutPrefix)
  );
}

async function getCurrentSessionTitle(page: Page) {
  return await page.evaluate(() => {
    const combobox = document.querySelector(
      '[role="combobox"][aria-haspopup="listbox"], .MuiSelect-select'
    ) as HTMLElement | null;

    if (!combobox) return "";

    return (combobox.innerText || combobox.textContent || "")
      .replace(/\s+/g, " ")
      .trim();
  });
}

async function openSessionDropdown(page: Page) {
  const opened = await page.evaluate(() => {
    const comboboxes = Array.from(
      document.querySelectorAll(
        '[role="combobox"][aria-haspopup="listbox"], .MuiSelect-select'
      )
    );

    const target = comboboxes.find((element) => {
      const htmlElement = element as HTMLElement;
      const rect = htmlElement.getBoundingClientRect();
      const text = (
        htmlElement.innerText ||
        htmlElement.textContent ||
        ""
      ).trim();
      const style = window.getComputedStyle(htmlElement);

      return (
        text.length > 0 &&
        rect.width > 0 &&
        rect.height > 0 &&
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        htmlElement.offsetParent !== null
      );
    }) as HTMLElement | undefined;

    if (!target) {
      return false;
    }

    target.focus();

    target.dispatchEvent(
      new MouseEvent("mousedown", {
        bubbles: true,
        cancelable: true,
        view: window,
      })
    );

    target.dispatchEvent(
      new MouseEvent("mouseup", {
        bubbles: true,
        cancelable: true,
        view: window,
      })
    );

    target.click();

    return true;
  });

  if (!opened) return false;

  await page
    .waitForSelector('[role="listbox"], [role="option"], .MuiMenu-list', {
      timeout: 7000,
    })
    .catch(() => {});

  await sleep(700);

  return true;
}

async function scrapeOpenSessionDropdown(
  page: Page,
  activityTitle: string
): Promise<SessionOption[]> {
  const currentTitle = await getCurrentSessionTitle(page);

  const rawOptions = await page.evaluate((activeTitle) => {
    const optionElements = Array.from(
      document.querySelectorAll(
        '[role="option"], li.MuiMenuItem-root, .MuiMenuItem-root'
      )
    );

    const visibleOptions = optionElements
      .map((element) => {
        const htmlElement = element as HTMLElement;
        const rect = htmlElement.getBoundingClientRect();
        const style = window.getComputedStyle(htmlElement);
        const title = (htmlElement.innerText || htmlElement.textContent || "")
          .replace(/\s+/g, " ")
          .trim();

        const ariaSelected = htmlElement.getAttribute("aria-selected");
        const isMuiSelected = String(htmlElement.className).includes(
          "Mui-selected"
        );

        return {
          title,
          visible:
            title.length > 0 &&
            rect.width > 0 &&
            rect.height > 0 &&
            style.display !== "none" &&
            style.visibility !== "hidden",
          selected:
            ariaSelected === "true" ||
            isMuiSelected ||
            title === activeTitle,
        };
      })
      .filter((option) => option.visible && option.title.length > 0);

    return visibleOptions.map((option, visibleIndex) => ({
      ...option,
      visibleIndex,
    }));
  }, currentTitle);

  const filteredRoleplayOptions = rawOptions.filter((option) =>
    isMatchingRoleplaySession(option.title, activityTitle)
  );

  console.log(
    "[Roleplay Sessions Router] Raw dropdown options:",
    rawOptions.map((option) => option.title)
  );

  console.log(
    "[Roleplay Sessions Router] Filtered role play options:",
    filteredRoleplayOptions.map((option) => option.title)
  );

  const hasSelectedOption = filteredRoleplayOptions.some(
    (option) => option.selected
  );

  return filteredRoleplayOptions.map((option) => ({
    id: `roleplay-session-${option.visibleIndex}-${normalizeText(
      option.title
    ).slice(0, 60)}`,
    title: option.title,

    // This is important:
    // index uses the real visible Noodle dropdown index, not the filtered UI index.
    // This allows the frontend to display only role play sessions while still clicking
    // the correct item inside Noodle Factory.
    index: option.visibleIndex,

    isActive: hasSelectedOption
      ? option.selected
      : normalizeText(option.title) === normalizeText(currentTitle),
  }));
}

async function getSessionOptions(page: Page, activityTitle: string) {
  const opened = await openSessionDropdown(page);

  if (!opened) {
    console.log("[Roleplay Sessions Router] Could not open role play dropdown.");
    return [];
  }

  const sessions = await scrapeOpenSessionDropdown(page, activityTitle);

  await page.keyboard.press("Escape").catch(() => {});
  await sleep(300);

  return sessions;
}

async function selectSessionByIndex(page: Page, sessionIndex: number) {
  const opened = await openSessionDropdown(page);

  if (!opened) {
    throw new Error(
      "Could not open the Noodle Factory role play session dropdown."
    );
  }

  const selectedTitle = await page.evaluate((targetIndex) => {
    const optionElements = Array.from(
      document.querySelectorAll(
        '[role="option"], li.MuiMenuItem-root, .MuiMenuItem-root'
      )
    );

    const visibleOptions = optionElements
      .map((element) => {
        const htmlElement = element as HTMLElement;
        const rect = htmlElement.getBoundingClientRect();
        const style = window.getComputedStyle(htmlElement);
        const title = (htmlElement.innerText || htmlElement.textContent || "")
          .replace(/\s+/g, " ")
          .trim();

        return {
          element: htmlElement,
          title,
          visible:
            title.length > 0 &&
            rect.width > 0 &&
            rect.height > 0 &&
            style.display !== "none" &&
            style.visibility !== "hidden",
        };
      })
      .filter((option) => option.visible);

    const targetOption = visibleOptions[targetIndex];

    if (!targetOption) {
      return "";
    }

    targetOption.element.scrollIntoView({
      block: "center",
    });

    targetOption.element.dispatchEvent(
      new MouseEvent("mousedown", {
        bubbles: true,
        cancelable: true,
        view: window,
      })
    );

    targetOption.element.dispatchEvent(
      new MouseEvent("mouseup", {
        bubbles: true,
        cancelable: true,
        view: window,
      })
    );

    targetOption.element.click();

    return targetOption.title;
  }, sessionIndex);

  if (!selectedTitle) {
    await page.keyboard.press("Escape").catch(() => {});
    throw new Error(`Could not select role play session at index ${sessionIndex}.`);
  }

  console.log(`[Roleplay Sessions Router] Selected session: "${selectedTitle}"`);

  await page
    .waitForNavigation({
      waitUntil: "networkidle2",
      timeout: 10000,
    })
    .catch(() => {});

  await sleep(4000);

  return selectedTitle;
}

async function extractVisibleRoleplayThread(page: Page): Promise<ChatMessage[]> {
  const messages = await page.evaluate(() => {
    const messageSelector =
      ".user-chat-message-container, .text-reply-container";
    const allMessageElements = Array.from(
      document.querySelectorAll(messageSelector)
    );

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

async function scrollChatUpOnly(page: Page) {
  const beforeState = await page.evaluate(() => {
    const scrollContainer = document.querySelector(
      "#parent-container-scroll-view"
    ) as HTMLElement | null;

    if (!scrollContainer) {
      return {
        found: false,
        scrollTop: 0,
        x: 800,
        y: 400,
      };
    }

    const rect = scrollContainer.getBoundingClientRect();

    return {
      found: true,
      scrollTop: scrollContainer.scrollTop,
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    };
  });

  if (!beforeState.found) {
    return {
      found: false,
      before: 0,
      after: 0,
      moved: false,
    };
  }

  await page.evaluate(() => {
    const scrollContainer = document.querySelector(
      "#parent-container-scroll-view"
    ) as HTMLElement | null;

    if (!scrollContainer) return;

    scrollContainer.scrollTop = scrollContainer.scrollTop - 2500;

    scrollContainer.dispatchEvent(
      new Event("scroll", {
        bubbles: true,
      })
    );

    scrollContainer.dispatchEvent(
      new WheelEvent("wheel", {
        deltaY: -2500,
        bubbles: true,
        cancelable: true,
      })
    );
  });

  await page.mouse.move(beforeState.x, beforeState.y);
  await page.mouse.wheel({ deltaY: -2500 });

  await sleep(500);

  const afterState = await page.evaluate(() => {
    const scrollContainer = document.querySelector(
      "#parent-container-scroll-view"
    ) as HTMLElement | null;

    if (!scrollContainer) {
      return {
        found: false,
        scrollTop: 0,
      };
    }

    return {
      found: true,
      scrollTop: scrollContainer.scrollTop,
    };
  });

  return {
    found: true,
    before: beforeState.scrollTop,
    after: afterState.scrollTop,
    moved: beforeState.scrollTop !== afterState.scrollTop,
  };
}

async function loadFullRoleplayHistory(page: Page) {
  console.log("[Roleplay Sessions Router] Loading selected role play history...");

  const seenTurnGroups = new Set<string>();
  const collectedGroupsNewestFirst: ChatTurnGroup[] = [];

  let lastGroupCount = 0;
  let noGrowthCount = 0;

  for (let i = 0; i < 80; i++) {
    const visibleMessages = await extractVisibleRoleplayThread(page);
    const visibleGroups =
      buildTurnGroupsFromNewestFirstMessages(visibleMessages);

    for (const group of visibleGroups) {
      const key = getTurnGroupKey(group);

      if (!seenTurnGroups.has(key)) {
        seenTurnGroups.add(key);
        collectedGroupsNewestFirst.push(group);
      }
    }

    const scrollResult = await scrollChatUpOnly(page);

    await sleep(1200);

    if (!scrollResult.found) {
      break;
    }

    if (collectedGroupsNewestFirst.length === lastGroupCount) {
      noGrowthCount++;
    } else {
      noGrowthCount = 0;
    }

    lastGroupCount = collectedGroupsNewestFirst.length;

    if (noGrowthCount >= 8) {
      break;
    }
  }

  return convertGroupsToChronologicalMessages(collectedGroupsNewestFirst);
}

export async function POST(request: Request) {
  try {
    const { action, sessionIndex, title } = await request.json();

    const activityTitle = typeof title === "string" ? title : "";

    const result = await withNoodlePage(async (page) => {
      if (action === "list") {
        const sessions = await getSessionOptions(page, activityTitle);
        const activeSession = sessions.find((session) => session.isActive);

        return {
          sessions,
          selectedSessionIndex: activeSession?.index ?? "",
          history: [],
          answer: "",
          images: [],
        };
      }

      if (action === "select") {
        if (typeof sessionIndex !== "number") {
          throw new Error("Missing role play session index.");
        }

        await selectSessionByIndex(page, sessionIndex);

        await scrollChatToNewest(page);

        const chronologicalThread = await loadFullRoleplayHistory(page);

        const assistantMessages = chronologicalThread.filter(
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

        const sessions = await getSessionOptions(page, activityTitle);
        const activeSession = sessions.find((session) => session.isActive);

        return {
          sessions,
          selectedSessionIndex: activeSession?.index ?? sessionIndex,
          history: chronologicalThread,
          answer: latestAnswer,
          images: latestAssistantImages,
        };
      }

      throw new Error(`Unsupported role play sessions action: ${action}`);
    });

    return NextResponse.json(result);
  } catch (error: any) {
    console.error(
      "[Roleplay Sessions Router] Session action failed:",
      error.message
    );

    return NextResponse.json(
      {
        sessions: [],
        selectedSessionIndex: "",
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