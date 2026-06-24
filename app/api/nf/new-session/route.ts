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

  return (
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

async function clickNewSessionButton(page: Page) {
  console.log("[New Session Router] Looking for exact New Session button...");

  await page
    .waitForFunction(
      () => {
        const buttons = Array.from(document.querySelectorAll("button"));

        return buttons.some((button) => {
          const text = (button.innerText || button.textContent || "")
            .replace(/\s+/g, " ")
            .trim()
            .toLowerCase();

          const rect = button.getBoundingClientRect();
          const style = window.getComputedStyle(button);

          return (
            text === "new session" &&
            rect.width > 0 &&
            rect.height > 0 &&
            style.display !== "none" &&
            style.visibility !== "hidden" &&
            !(button as HTMLButtonElement).disabled
          );
        });
      },
      {
        timeout: 15000,
      }
    )
    .catch(() => {});

  const buttons = await page.$$("button");

  for (const button of buttons) {
    const buttonInfo = await page.evaluate((el) => {
      const htmlButton = el as HTMLButtonElement;
      const text = (htmlButton.innerText || htmlButton.textContent || "")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();

      const rect = htmlButton.getBoundingClientRect();
      const style = window.getComputedStyle(htmlButton);

      return {
        text,
        width: rect.width,
        height: rect.height,
        visible:
          rect.width > 0 &&
          rect.height > 0 &&
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          htmlButton.offsetParent !== null,
        disabled: htmlButton.disabled,
      };
    }, button);

    console.log("[New Session Router] Button found:", buttonInfo);

    if (
      buttonInfo.text === "new session" &&
      buttonInfo.visible &&
      !buttonInfo.disabled
    ) {
      await button.hover().catch(() => {});
      await sleep(300);

      await button.click({
        delay: 150,
      });

      console.log("[New Session Router] Exact New Session button clicked.");

      return true;
    }
  }

  return false;
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
      .map((el) => {
        const element = el as HTMLElement;
        const rect = element.getBoundingClientRect();

        const isUser =
          element.classList.contains("user-chat-message-container") ||
          element.closest(".user-chat-bubble-container") !== null;

        return {
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

async function waitForNewSessionThreadToStabilize(
  page: Page,
  previousThreadKey: string
) {
  console.log("[New Session Router] Waiting for new session thread...");

  const timeoutMs = 90000;
  const start = Date.now();

  let lastKey = "";
  let stableCount = 0;
  let bestMessages: ChatMessage[] = [];

  while (Date.now() - start < timeoutMs) {
    const visibleMessages = await extractVisibleThread(page);
    const currentKey = getThreadKey(visibleMessages);

    const hasTemporaryMessage = visibleMessages.some(
      (message) =>
        message.role === "assistant" && isTemporaryAssistantText(message.content)
    );

    const threadChanged = currentKey !== previousThreadKey;
    const gracePeriodExpired = Date.now() - start > 7000;

    if (!hasTemporaryMessage && (threadChanged || gracePeriodExpired)) {
      bestMessages = visibleMessages;

      if (currentKey === lastKey) {
        stableCount++;
      } else {
        lastKey = currentKey;
        stableCount = 0;
      }

      console.log(
        `[New Session Router] Thread check: messages=${visibleMessages.length}, changed=${threadChanged}, stableCount=${stableCount}`
      );

      if (stableCount >= 3) {
        return visibleMessages;
      }
    }

    await sleep(1500);
  }

  console.log(
    "[New Session Router] New session wait timed out. Returning best visible messages."
  );

  return bestMessages;
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
  console.log("[New Session Router] Looking for lesson/chat start button...");

  const chatReadyBeforeClick = await hasChatInterface(page);

  if (chatReadyBeforeClick) {
    console.log("[New Session Router] Chat interface already visible.");

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
        `[New Session Router] Clicked lesson/chat button: "${clickedText}" | attempt=${attempt}`
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
        `[New Session Router] No lesson/chat button found on attempt ${attempt}.`
      );

      await sleep(2000);
    }

    const chatReadyAfterClick = await hasChatInterface(page);

    if (chatReadyAfterClick) {
      console.log("[New Session Router] Chat interface is now ready.");

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
    console.log("[New Session Router] Chat interface was not detected.");
  }

  return {
    chatReady: finalChatReady,
    openedFreshLesson: false,
  };
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
      console.log("[New Session Router] Reusing already-open chat panel.");

      return;
    }

    console.log(
      "[New Session Router] Previous chat state was stale. Reopening selected module..."
    );
  }

  console.log("[New Session Router] Opening chat panel for selected module...");

  await page.goto(NOODLE_TARGET_URL, {
    waitUntil: "networkidle2",
    timeout: 60000,
  });

  state.isOnCourseHome = true;
  state.isChatPanelOpen = false;
  state.activeContext = "";

  await openTargetModule(page, context);

  const { chatReady } = await openChatPanel(page);

  state.activeContext = context;
  state.isChatPanelOpen = chatReady;
  state.isOnCourseHome = false;

  if (!chatReady) {
    throw new Error(
      `Could not open the chat interface for "${context}". The lesson may still be loading or the button text changed.`
    );
  }
}

export async function POST(request: Request) {
  try {
    const { context } = await request.json();

    console.log(`[New Session Router] Request received for context: "${context}"`);

    if (!context || !context.trim()) {
      throw new Error("Missing module context for new session.");
    }

    const result = await withNoodlePage(async (page, state) => {
      await ensureChatIsOpenForContext(page, context, state);

      await scrollChatToNewest(page);

      const previousMessages = await extractVisibleThread(page);
      const previousThreadKey = getThreadKey(previousMessages);

      const clickedNewSession = await clickNewSessionButton(page);

      if (!clickedNewSession) {
        throw new Error(
          "Could not find the '+ New Session' button in Noodle Factory."
        );
      }

      console.log("[New Session Router] Clicked '+ New Session' button.");

      await page
        .waitForNavigation({
          waitUntil: "networkidle2",
          timeout: 10000,
        })
        .catch(() => {});

      await sleep(5000);

      await scrollChatToNewest(page);

      const newSessionMessages = await waitForNewSessionThreadToStabilize(
        page,
        previousThreadKey
      );

      const newSessionGroups =
        buildTurnGroupsFromNewestFirstMessages(newSessionMessages);

      const chronologicalNewSessionMessages =
        convertGroupsToChronologicalMessages(newSessionGroups);

      const assistantMessages = chronologicalNewSessionMessages.filter(
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
        history: chronologicalNewSessionMessages,
        answer: latestAnswer,
        images: latestAssistantImages,
      };
    });

    return NextResponse.json(result);
  } catch (error: any) {
    console.error("[New Session Router] New session failed:", error.message);

    return NextResponse.json({
      history: [],
      answer: "",
      images: [],
      error: error.message,
    });
  }
}