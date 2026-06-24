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

type ChatOpenResult = {
  chatReady: boolean;
  openedFreshLesson: boolean;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeText(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

function isTemporaryAssistantText(text: string) {
  const lower = normalizeText(text).toLowerCase();

  // Noodle Factory can display a short-lived "Thinking..." bubble before
  // replacing it with Walter's final response. Treat it as loading content,
  // never as a valid assistant answer.
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

function getTurnGroupKey(group: ChatTurnGroup) {
  return group
    .map((msg) => {
      const imageKey = (msg.images || []).join(",");
      return `${msg.role}::${normalizeText(msg.content)}::images:${imageKey}`;
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

function convertGroupsToChronologicalMessages(groupsNewestFirst: ChatTurnGroup[]) {
  return groupsNewestFirst
    .slice()
    .reverse()
    .flatMap((group) => group.slice().reverse());
}

async function hasChatInterface(page: Page) {
  return await page.evaluate(() => {
    const chatScrollContainer = document.querySelector(
      "#parent-container-scroll-view"
    );

    const messageInput = Array.from(
      document.querySelectorAll("textarea, input[type='text']")
    ).find((el) => {
      const input = el as HTMLInputElement | HTMLTextAreaElement;
      const rect = input.getBoundingClientRect();

      return (
        rect.width > 0 &&
        rect.height > 0 &&
        !input.disabled &&
        input.offsetParent !== null
      );
    });

    return Boolean(chatScrollContainer || messageInput);
  });
}

async function clickButtonByText(page: Page, targetTexts: string[]) {
  const elementHandles = await page.$$("button, a, [role='button']");

  for (const targetText of targetTexts) {
    for (const handle of elementHandles) {
      const text = await page.evaluate((el) => {
        return (el as HTMLElement).innerText || el.textContent || "";
      }, handle);

      const cleanText = normalizeText(text).toLowerCase();

      if (
        cleanText.length > 0 &&
        cleanText.length <= 80 &&
        cleanText.includes(targetText.toLowerCase())
      ) {
        await handle.click();
        return cleanText;
      }
    }
  }

  return "";
}

async function extractVisibleThread(page: Page): Promise<ChatMessage[]> {
  const messages = await page.evaluate(() => {
    const messageSelector = ".user-chat-message-container, .text-reply-container";
    const allMessageElements = Array.from(
      document.querySelectorAll(messageSelector)
    );

    const topLevelMessageElements = allMessageElements.filter((el) => {
      return !el.parentElement?.closest(messageSelector);
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

    const messageEntries = topLevelMessageElements
      .map((el, index) => {
        const element = el as HTMLElement;
        const rect = element.getBoundingClientRect();

        const isUser =
          element.classList.contains("user-chat-message-container") ||
          element.closest(".user-chat-bubble-container") !== null;

        return {
          index,
          element,
          role: isUser ? "user" : "assistant",
          content: element.innerText?.trim() || "",
          images: getImagesInsideElement(element),
          top: rect.top,
          bottom: rect.bottom,
        };
      })
      .filter((entry) => {
        return (
          entry.content.length > 0 ||
          entry.images.length > 0 ||
          entry.element.getBoundingClientRect().height > 0
        );
      });

    const usefulImages = Array.from(document.querySelectorAll("img"))
      .map((img) => {
        const image = img as HTMLImageElement;
        const rect = image.getBoundingClientRect();

        return {
          element: image,
          src: getImageUrl(image),
          top: rect.top,
          bottom: rect.bottom,
          centerY: rect.top + rect.height / 2,
          isUseful: isUsefulChatImage(image),
        };
      })
      .filter((image) => image.isUseful && image.src);

    const sortedMessages = [...messageEntries].sort((a, b) => a.top - b.top);

    usefulImages.forEach((image) => {
      const directMessage = messageEntries.find((message) =>
        message.element.contains(image.element)
      );

      if (directMessage) {
        if (!directMessage.images.includes(image.src)) {
          directMessage.images.push(image.src);
        }

        return;
      }

      for (let i = 0; i < sortedMessages.length; i++) {
        const currentMessage = sortedMessages[i];

        if (currentMessage.role !== "assistant") {
          continue;
        }

        const nextMessage = sortedMessages[i + 1];

        const regionTop = currentMessage.top - 80;
        const regionBottom = nextMessage
          ? nextMessage.top - 10
          : currentMessage.bottom + 900;

        const imageBelongsToThisMessage =
          image.centerY >= regionTop && image.centerY <= regionBottom;

        if (imageBelongsToThisMessage) {
          if (!currentMessage.images.includes(image.src)) {
            currentMessage.images.push(image.src);
          }

          break;
        }
      }
    });

    return messageEntries
      .map((entry) => ({
        role: entry.role,
        content: entry.content,
        images: Array.from(new Set(entry.images)),
      }))
      .filter((msg) => msg.content.length > 0 || msg.images.length > 0);
  });

  const totalImages = messages.reduce(
    (count, message) => count + (message.images?.length || 0),
    0
  );

  console.log(
    `[Chat Router] Extracted visible thread: messages=${messages.length}, images=${totalImages}`
  );

  return messages as ChatMessage[];
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

async function getLatestAssistantMessageWithImages(
  page: Page,
  fallbackAnswer: string
): Promise<ChatMessage> {
  const visibleMessages = await extractVisibleThread(page);

  const assistantMessages = visibleMessages.filter(
    (message) => message.role === "assistant"
  );

  const matchingAssistantMessage = assistantMessages.find(
    (message) =>
      normalizeText(message.content) === normalizeText(fallbackAnswer) &&
      !isTemporaryAssistantText(message.content)
  );

  if (matchingAssistantMessage) {
    return matchingAssistantMessage;
  }

  const finalAssistantMessage = assistantMessages.find(
    (message) => !isTemporaryAssistantText(message.content)
  );

  if (finalAssistantMessage) {
    return finalAssistantMessage;
  }

  return {
    role: "assistant",
    content: fallbackAnswer,
    images: [],
  };
}

function findNewAssistantCandidate(
  beforeTexts: string[],
  currentTexts: string[],
  temporaryIndex: number | null
) {
  const normalizedBefore = beforeTexts.map(normalizeText);
  const normalizedCurrent = currentTexts.map(normalizeText);

  if (
    temporaryIndex !== null &&
    currentTexts[temporaryIndex] &&
    !isTemporaryAssistantText(currentTexts[temporaryIndex])
  ) {
    return currentTexts[temporaryIndex];
  }

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
    for (let i = 0; i < currentTexts.length; i++) {
      const candidate = currentTexts[i];

      if (!candidate || isTemporaryAssistantText(candidate)) {
        continue;
      }

      const currentWithoutCandidate = [
        ...normalizedCurrent.slice(0, i),
        ...normalizedCurrent.slice(i + 1),
      ];

      const matchesBefore =
        currentWithoutCandidate.length === normalizedBefore.length &&
        currentWithoutCandidate.every(
          (text, index) => text === normalizedBefore[index]
        );

      if (matchesBefore) {
        return candidate;
      }
    }

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

async function waitForFinalAssistantAnswer(
  page: Page,
  beforeAssistantTexts: string[]
) {
  console.log("[Chat Router] Waiting for final assistant response...");

  const timeoutMs = 180000;
  const start = Date.now();

  let temporaryIndex: number | null = null;
  let hasSeenTemporaryBubble = false;
  let lastCandidate = "";
  let stableCount = 0;

  while (Date.now() - start < timeoutMs) {
    const currentTexts = await getAssistantTexts(page);

    const temporaryIndexes = currentTexts
      .map((text, index) => ({
        text,
        index,
      }))
      .filter((item) => isTemporaryAssistantText(item.text))
      .map((item) => item.index);

    if (temporaryIndex === null && temporaryIndexes.length > 0) {
      temporaryIndex = temporaryIndexes[0];
      hasSeenTemporaryBubble = true;

      console.log(
        `[Chat Router] Temporary assistant bubble detected at index ${temporaryIndex}.`
      );
    }

    // Do not inspect candidates while Noodle Factory is still showing
    // "Thinking..." or another temporary assistant-state bubble.
    if (temporaryIndexes.length > 0) {
      await sleep(1200);
      continue;
    }

    const candidate = findNewAssistantCandidate(
      beforeAssistantTexts,
      currentTexts,
      temporaryIndex
    );

    if (candidate && !isTemporaryAssistantText(candidate)) {
      if (normalizeText(candidate) === normalizeText(lastCandidate)) {
        stableCount += 1;
      } else {
        lastCandidate = candidate;
        stableCount = 0;
      }

      console.log(
        `[Chat Router] Candidate answer detected. temporarySeen=${hasSeenTemporaryBubble}, stableCount=${stableCount}`
      );

      // Four repeated checks at 1.2 seconds gives the DOM enough time to
      // replace streamed text with its complete final response.
      if (stableCount >= 4) {
        console.log("[Chat Router] Final assistant response stabilized.");
        return candidate;
      }
    }

    await sleep(1200);
  }

  console.log(
    "[Chat Router] Response wait timed out. Returning the last non-temporary candidate."
  );

  return lastCandidate;
}

async function waitForVisibleThreadToStabilize(page: Page) {
  console.log("[Chat Router] Waiting for fresh lesson prompt to stabilize...");

  const timeoutMs = 90000;
  const start = Date.now();

  let lastKey = "";
  let stableCount = 0;
  let bestMessages: ChatMessage[] = [];

  while (Date.now() - start < timeoutMs) {
    const visibleMessages = await extractVisibleThread(page);

    const hasTemporaryMessage = visibleMessages.some(
      (message) =>
        message.role === "assistant" && isTemporaryAssistantText(message.content)
    );

    const currentKey = visibleMessages
      .map((message) => {
        const imageKey = (message.images || []).join(",");
        return `${message.role}:${normalizeText(message.content)}:${imageKey}`;
      })
      .join(" || ");

    if (visibleMessages.length > 0 && !hasTemporaryMessage) {
      bestMessages = visibleMessages;

      if (currentKey === lastKey) {
        stableCount++;
      } else {
        lastKey = currentKey;
        stableCount = 0;
      }

      console.log(
        `[Chat Router] Fresh lesson visible messages detected. count=${visibleMessages.length}, stableCount=${stableCount}`
      );

      if (stableCount >= 4) {
        console.log("[Chat Router] Fresh lesson prompt stabilized.");
        return visibleMessages;
      }
    }

    await sleep(1500);
  }

  console.log(
    "[Chat Router] Fresh lesson prompt wait timed out. Returning best visible messages."
  );

  return bestMessages;
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

async function loadFullChatHistory(page: Page) {
  console.log("[Chat Router] Executing upward-only deep history sync...");

  const seenTurnGroups = new Set<string>();
  const collectedGroupsNewestFirst: ChatTurnGroup[] = [];

  let lastGroupCount = 0;
  let noGrowthCount = 0;

  for (let i = 0; i < 80; i++) {
    const visibleMessages = await extractVisibleThread(page);
    const visibleGroups =
      buildTurnGroupsFromNewestFirstMessages(visibleMessages);

    let newlyAddedGroupCount = 0;

    for (const group of visibleGroups) {
      const key = getTurnGroupKey(group);

      if (!seenTurnGroups.has(key)) {
        seenTurnGroups.add(key);
        collectedGroupsNewestFirst.push(group);
        newlyAddedGroupCount++;
      }
    }

    console.log(
      `[Chat Router] Sync round ${i + 1}: visibleMessages=${
        visibleMessages.length
      }, visibleGroups=${visibleGroups.length}, addedGroups=${newlyAddedGroupCount}, totalGroups=${
        collectedGroupsNewestFirst.length
      }`
    );

    const scrollResult = await scrollChatUpOnly(page);

    console.log(
      `[Chat Router] Scroll check: found=${scrollResult.found}, before=${scrollResult.before}, after=${scrollResult.after}, moved=${scrollResult.moved}`
    );

    await sleep(1500);

    if (!scrollResult.found) {
      console.log("[Chat Router] No scrollable chat container found.");
      break;
    }

    if (collectedGroupsNewestFirst.length === lastGroupCount) {
      noGrowthCount++;
    } else {
      noGrowthCount = 0;
    }

    lastGroupCount = collectedGroupsNewestFirst.length;

    if (noGrowthCount >= 10) {
      console.log(
        "[Chat Router] Turn group count stopped growing. Ending upward sync."
      );
      break;
    }
  }

  return convertGroupsToChronologicalMessages(collectedGroupsNewestFirst);
}

async function openTargetModule(page: Page, context: string) {
  if (!context) return;

  const folderClicked = await page.evaluate((contextText) => {
    const elements = Array.from(
      document.querySelectorAll("div, p, span, h1, h2, h3, h4")
    );

    const targetRow = elements.find(
      (el) => (el as HTMLElement).innerText?.trim() === contextText.trim()
    );

    if (targetRow) {
      (targetRow as HTMLElement).click();
      return true;
    }

    return false;
  }, context);

  if (folderClicked) {
    await page
      .waitForNavigation({
        waitUntil: "networkidle2",
        timeout: 15000,
      })
      .catch(() => {});

    await sleep(3000);
  }
}

async function openChatPanel(page: Page): Promise<ChatOpenResult> {
  console.log("[Chat Router] Looking for lesson/chat start button...");

  const chatReadyBeforeClick = await hasChatInterface(page);

  if (chatReadyBeforeClick) {
    console.log("[Chat Router] Chat interface already visible.");

    return {
      chatReady: true,
      openedFreshLesson: false,
    };
  }

  const clickableTexts = [
    "chat",
    "begin lesson",
    "continue lesson",
    "start lesson",
    "begin learning",
    "continue learning",
    "resume lesson",
    "resume learning",
  ];

  for (let attempt = 1; attempt <= 5; attempt++) {
    const clickedText = await clickButtonByText(page, clickableTexts);

    if (clickedText) {
      console.log(
        `[Chat Router] Clicked lesson/chat button: "${clickedText}" | attempt=${attempt}`
      );

      await page
        .waitForNavigation({
          waitUntil: "networkidle2",
          timeout: 10000,
        })
        .catch(() => {});

      await sleep(5000);
    } else {
      console.log(
        `[Chat Router] No lesson/chat button found on attempt ${attempt}.`
      );

      await sleep(2000);
    }

    const chatReadyAfterClick = await hasChatInterface(page);

    if (chatReadyAfterClick) {
      console.log("[Chat Router] Chat interface is now ready.");

      return {
        chatReady: true,
        openedFreshLesson:
          clickedText.includes("begin lesson") ||
          clickedText.includes("start lesson") ||
          clickedText.includes("begin learning"),
      };
    }
  }

  await page
    .waitForSelector(
      "#parent-container-scroll-view, textarea, input[type='text']",
      {
        timeout: 30000,
      }
    )
    .catch(() => {});

  const finalChatReady = await hasChatInterface(page);

  if (!finalChatReady) {
    console.log("[Chat Router] Chat interface was not detected.");
  }

  return {
    chatReady: finalChatReady,
    openedFreshLesson: false,
  };
}

async function focusMessageInput(page: Page) {
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

async function ensureChatIsOpenForContext(
  page: Page,
  context: string,
  state: {
    activeContext: string;
    isChatPanelOpen: boolean;
    isOnCourseHome: boolean;
  }
) {
  if (state.activeContext === context && state.isChatPanelOpen) {
    const chatStillReady = await hasChatInterface(page);

    if (chatStillReady) {
      console.log("[Chat Router] Reusing already-open chat panel.");

      return {
        openedFreshLesson: false,
      };
    }

    console.log(
      "[Chat Router] Previous chat state was stale. Reopening selected module..."
    );
  }

  console.log("[Chat Router] Opening chat panel for selected module...");

  await page.goto(NOODLE_TARGET_URL, {
    waitUntil: "networkidle2",
    timeout: 60000,
  });

  state.isOnCourseHome = true;
  state.isChatPanelOpen = false;
  state.activeContext = "";

  await openTargetModule(page, context);

  const { chatReady, openedFreshLesson } = await openChatPanel(page);

  state.activeContext = context;
  state.isChatPanelOpen = chatReady;
  state.isOnCourseHome = false;

  if (!chatReady) {
    throw new Error(
      `Could not open the chat interface for "${context}". The lesson may still be loading or the button text changed.`
    );
  }

  return {
    openedFreshLesson,
  };
}

export async function POST(request: Request) {
  try {
    const { question, context } = await request.json();
    const isInitialLoad = !question || question.trim() === "";

    console.log(
      `[Chat Router] Query received: "${question}" | Context focus: "${context}"`
    );

    const result = await withNoodlePage(async (page, state) => {
      const { openedFreshLesson } = await ensureChatIsOpenForContext(
        page,
        context,
        state
      );

      if (isInitialLoad) {
        console.log("[Chat Router] Initial load mode. Loading chat history...");

        await scrollChatToNewest(page);

        if (openedFreshLesson) {
          console.log(
            "[Chat Router] Fresh lesson detected. Skipping deep history scroll."
          );

          const visibleMessages = await waitForVisibleThreadToStabilize(page);
          const visibleGroups =
            buildTurnGroupsFromNewestFirstMessages(visibleMessages);

          const chronologicalThread =
            convertGroupsToChronologicalMessages(visibleGroups);

          const aiReplies = chronologicalThread.filter(
            (m) => m.role === "assistant"
          );

          const latestAnswer =
            aiReplies.length > 0 ? aiReplies[aiReplies.length - 1].content : "";

          return {
            history: chronologicalThread,
            answer: latestAnswer,
          };
        }

        const chronologicalThread = await loadFullChatHistory(page);

        const userCount = chronologicalThread.filter(
          (m) => m.role === "user"
        ).length;

        const assistantCount = chronologicalThread.filter(
          (m) => m.role === "assistant"
        ).length;

        const imageCount = chronologicalThread.reduce(
          (total, message) => total + (message.images?.length || 0),
          0
        );

        console.log(
          `[Chat Router] History sync complete. Total messages loaded: ${chronologicalThread.length}`
        );

        console.log(
          `[Chat Router] Role count: user=${userCount}, assistant=${assistantCount}, images=${imageCount}`
        );

        const aiReplies = chronologicalThread.filter(
          (m) => m.role === "assistant"
        );

        const latestAnswer =
          aiReplies.length > 0 ? aiReplies[aiReplies.length - 1].content : "";

        return {
          history: chronologicalThread,
          answer: latestAnswer,
        };
      }

      console.log("[Chat Router] Live message mode. Sending question only...");

      await scrollChatToNewest(page);

      const beforeAssistantTexts = await getAssistantTexts(page);

      const didFocusInput = await focusMessageInput(page);

      if (!didFocusInput) {
        throw new Error("Could not find the chat message input.");
      }

      await page.keyboard.type(question, {
        delay: 30,
      });

      await page.keyboard.press("Enter");

      console.log(
        "[Chat Router] Question submitted. Browser will stay open while waiting..."
      );

      const finalAnswer = await waitForFinalAssistantAnswer(
        page,
        beforeAssistantTexts
      );

      const finalAssistantMessage = await getLatestAssistantMessageWithImages(
        page,
        finalAnswer
      );

      return {
        history: [],
        answer: finalAssistantMessage.content,
        images: finalAssistantMessage.images || [],
      };
    });

    return NextResponse.json(result);
  } catch (error: any) {
    console.error("[Chat Router] Stream interaction crashed:", error.message);

    return NextResponse.json({
      history: [],
      answer: "",
      images: [],
      error: error.message,
    });
  }
}