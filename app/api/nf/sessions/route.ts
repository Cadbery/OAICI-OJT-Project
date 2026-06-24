import { NextResponse } from "next/server";
import type { Dialog, Page } from "puppeteer";
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

type SessionOption = {
  id: string;
  title: string;
  index: number;
  isActive: boolean;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Session action failed.";
}

function normalizeText(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

function removeSessionPrefix(title: string) {
  return normalizeText(title).replace(/^session\s+\d+\s*-\s*/i, "").trim();
}

function isMatchingModuleSession(sessionTitle: string, context: string) {
  const cleanContext = normalizeText(context).toLowerCase();
  const cleanSessionTitle = normalizeText(sessionTitle).toLowerCase();
  const cleanSessionTitleWithoutPrefix =
    removeSessionPrefix(sessionTitle).toLowerCase();

  if (!cleanContext || !cleanSessionTitleWithoutPrefix) {
    return false;
  }

  const isQuizSession = cleanSessionTitleWithoutPrefix.startsWith("quiz:");
  const isRoleplaySession =
    cleanSessionTitleWithoutPrefix.startsWith("role play:") ||
    cleanSessionTitleWithoutPrefix.startsWith("roleplay:");

  if (isQuizSession || isRoleplaySession) {
    return false;
  }

  return (
    cleanSessionTitle.includes(cleanContext) ||
    cleanSessionTitleWithoutPrefix.includes(cleanContext)
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

    const target = comboboxes.find((el) => {
      const element = el as HTMLElement;
      const rect = element.getBoundingClientRect();
      const text = (element.innerText || element.textContent || "").trim();
      const style = window.getComputedStyle(element);

      return (
        text.length > 0 &&
        rect.width > 0 &&
        rect.height > 0 &&
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        element.offsetParent !== null
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
  context: string
): Promise<SessionOption[]> {
  const currentTitle = await getCurrentSessionTitle(page);

  const rawOptions = await page.evaluate((activeTitle) => {
    const optionElements = Array.from(
      document.querySelectorAll(
        '[role="option"], li.MuiMenuItem-root, .MuiMenuItem-root'
      )
    );

    const visibleOptions = optionElements
      .map((el, rawIndex) => {
        const element = el as HTMLElement;
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        const title = (element.innerText || element.textContent || "")
          .replace(/\s+/g, " ")
          .trim();

        const ariaSelected = element.getAttribute("aria-selected");
        const isMuiSelected = element.className.includes("Mui-selected");
        const explicitlySelected = ariaSelected === "true" || isMuiSelected;

        return {
          rawIndex,
          title,
          visible:
            title.length > 0 &&
            rect.width > 0 &&
            rect.height > 0 &&
            style.display !== "none" &&
            style.visibility !== "hidden",
          explicitlySelected,
          titleMatchesActive: title === activeTitle,
        };
      })
      .filter((option) => option.visible && option.title.length > 0)
      .map((option, visibleIndex) => ({
        ...option,
        visibleIndex,
      }));

    return visibleOptions;
  }, currentTitle);

  const filteredOptions = rawOptions.filter((option) =>
    isMatchingModuleSession(option.title, context)
  );

  const hasExplicitlySelectedOption = filteredOptions.some(
    (option) => option.explicitlySelected
  );
  const activeTitleMatchCount = filteredOptions.filter(
    (option) => option.titleMatchesActive
  ).length;

  return filteredOptions.map((option) => ({
    id: `session-${option.visibleIndex}-${normalizeText(option.title).slice(
      0,
      60
    )}`,
    title: option.title,
    index: option.visibleIndex,
    isActive: hasExplicitlySelectedOption
      ? option.explicitlySelected
      : activeTitleMatchCount === 1 && option.titleMatchesActive,
  }));
}

async function getSessionOptions(page: Page, context: string) {
  const opened = await openSessionDropdown(page);

  if (!opened) {
    console.log("[Sessions Router] Could not open Noodle Factory dropdown.");
    return [];
  }

  const sessions = await scrapeOpenSessionDropdown(page, context);

  await page.keyboard.press("Escape").catch(() => {});
  await sleep(300);

  return sessions;
}

async function selectSessionByIndex(
  page: Page,
  sessionIndex: number,
  sessionTitle?: string
) {
  const opened = await openSessionDropdown(page);

  if (!opened) {
    throw new Error("Could not open the Noodle Factory session dropdown.");
  }

  const selectedTitle = await page.evaluate(
    ({ targetIndex, targetTitle }) => {
      const normalize = (value: string) =>
        value.replace(/\s+/g, " ").trim().toLowerCase();

      const optionElements = Array.from(
        document.querySelectorAll(
          '[role="option"], li.MuiMenuItem-root, .MuiMenuItem-root'
        )
      );

      const visibleOptions = optionElements
        .map((el) => {
          const element = el as HTMLElement;
          const rect = element.getBoundingClientRect();
          const style = window.getComputedStyle(element);
          const title = (element.innerText || element.textContent || "")
            .replace(/\s+/g, " ")
            .trim();

          return {
            element,
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

      const cleanTargetTitle = normalize(targetTitle || "");

      // The title includes the session number and module name, making it much
      // safer than a positional index when the dropdown list changes.
      const matchingTitleOptions = cleanTargetTitle
        ? visibleOptions.filter(
            (option) => normalize(option.title) === cleanTargetTitle
          )
        : [];

      // Many Noodle chat sessions can share the same visible title. In that
      // case title matching would always pick the newest duplicate, so only use
      // the title as a selector when it uniquely identifies one option.
      const targetOption =
        matchingTitleOptions.length === 1
          ? matchingTitleOptions[0]
          : visibleOptions[targetIndex];

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
    },
    {
      targetIndex: sessionIndex,
      targetTitle: sessionTitle || "",
    }
  );

  if (!selectedTitle) {
    await page.keyboard.press("Escape").catch(() => {});
    throw new Error(
      `Could not select session "${sessionTitle || sessionIndex}".`
    );
  }

  console.log(`[Sessions Router] Selected session: "${selectedTitle}"`);

  await page
    .waitForNavigation({
      waitUntil: "networkidle2",
      timeout: 10000,
    })
    .catch(() => {});

  await sleep(4000);

  return selectedTitle;
}

async function verifySelectedSession(
  page: Page,
  context: string,
  expectedSessionIndex: number,
  expectedSessionTitle?: string
) {
  let sessions: SessionOption[] = [];

  for (let attempt = 1; attempt <= 3; attempt++) {
    sessions = await getSessionOptions(page, context);

    const activeSession = sessions.find((session) => session.isActive);

    if (!activeSession || activeSession.index === expectedSessionIndex) {
      return {
        sessions,
        selectedSessionIndex: activeSession?.index ?? expectedSessionIndex,
      };
    }

    console.log(
      `[Sessions Router] Expected session index ${expectedSessionIndex}, but Noodle still reports ${activeSession.index}. Retrying selection...`
    );

    await selectSessionByIndex(page, expectedSessionIndex, expectedSessionTitle);
    await sleep(1500);
  }

  const activeSession = sessions.find((session) => session.isActive);

  if (activeSession && activeSession.index !== expectedSessionIndex) {
    throw new Error(
      `Noodle Factory stayed on "${activeSession.title}" instead of the requested session.`
    );
  }

  return {
    sessions,
    selectedSessionIndex: expectedSessionIndex,
  };
}

async function openSessionOverflowMenu(
  page: Page,
  sessionIndex: number,
  sessionTitle?: string
) {
  const opened = await openSessionDropdown(page);

  if (!opened) {
    throw new Error("Could not open the Noodle Factory session dropdown.");
  }

  const menuTarget = await page.evaluate(
    ({ targetIndex, targetTitle }) => {
      const normalize = (value: string) =>
        value.replace(/\s+/g, " ").trim().toLowerCase();

      const optionElements = Array.from(
        document.querySelectorAll(
          '[role="option"], li.MuiMenuItem-root, .MuiMenuItem-root'
        )
      );

      const visibleOptions = optionElements
        .map((el) => {
          const element = el as HTMLElement;
          const rect = element.getBoundingClientRect();
          const style = window.getComputedStyle(element);
          const title = (element.innerText || element.textContent || "")
            .replace(/\s+/g, " ")
            .trim();

          return {
            element,
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

      const cleanTargetTitle = normalize(targetTitle || "");
      const matchingTitleOptions = cleanTargetTitle
        ? visibleOptions.filter(
            (option) => normalize(option.title) === cleanTargetTitle
          )
        : [];

      const targetOption =
        matchingTitleOptions.length === 1
          ? matchingTitleOptions[0]
          : visibleOptions[targetIndex];

      if (!targetOption) {
        return {
          found: false,
          title: "",
          x: 0,
          y: 0,
        };
      }

      targetOption.element.scrollIntoView({
        block: "center",
      });

      const menuButton = Array.from(
        targetOption.element.querySelectorAll(
          'button, [role="button"], svg[data-testid*="More"], svg[data-testid*="more"]'
        )
      )
        .map((candidate) => {
          const element =
            candidate.closest("button, [role='button']") || candidate;
          const htmlElement = element as HTMLElement;
          const rect = htmlElement.getBoundingClientRect();
          const style = window.getComputedStyle(htmlElement);

          return {
            element: htmlElement,
            rect,
            visible:
              rect.width > 0 &&
              rect.height > 0 &&
              style.display !== "none" &&
              style.visibility !== "hidden",
          };
        })
        .find((candidate) => candidate.visible);

      if (menuButton) {
        return {
          found: true,
          title: targetOption.title,
          x: menuButton.rect.left + menuButton.rect.width / 2,
          y: menuButton.rect.top + menuButton.rect.height / 2,
        };
      }

      const rowRect = targetOption.element.getBoundingClientRect();

      return {
        found: true,
        title: targetOption.title,
        x: rowRect.right - 24,
        y: rowRect.top + rowRect.height / 2,
      };
    },
    {
      targetIndex: sessionIndex,
      targetTitle: sessionTitle || "",
    }
  );

  if (!menuTarget.found) {
    await page.keyboard.press("Escape").catch(() => {});
    throw new Error(
      `Could not find session "${sessionTitle || sessionIndex}" in the dropdown.`
    );
  }

  await page.mouse.click(menuTarget.x, menuTarget.y);
  await sleep(500);

  return menuTarget.title;
}

async function clickVisibleMenuItemByText(page: Page, targetText: string) {
  return await page.evaluate((textToMatch) => {
    const cleanTargetText = textToMatch.replace(/\s+/g, " ").trim().toLowerCase();
    const candidates = Array.from(
      document.querySelectorAll(
        '[role="menuitem"], li.MuiMenuItem-root, .MuiMenuItem-root, button, [role="button"]'
      )
    );

    const target = candidates.find((candidate) => {
      const element = candidate as HTMLElement;
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      const text = (element.innerText || element.textContent || "")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();

      return (
        text === cleanTargetText &&
        rect.width > 0 &&
        rect.height > 0 &&
        style.display !== "none" &&
        style.visibility !== "hidden"
      );
    }) as HTMLElement | undefined;

    if (!target) return false;

    target.click();
    return true;
  }, targetText);
}

async function clickDeleteConfirmationIfPresent(page: Page) {
  await sleep(700);

  return await page.evaluate(() => {
    const modalContainers = Array.from(
      document.querySelectorAll(
        '[role="dialog"], .MuiDialog-root, .MuiModal-root'
      )
    ).filter((candidate) => {
      const element = candidate as HTMLElement;
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);

      return (
        rect.width > 0 &&
        rect.height > 0 &&
        style.display !== "none" &&
        style.visibility !== "hidden"
      );
    });

    if (modalContainers.length === 0) return false;

    const buttonTexts = [
      "delete",
      "delete session",
      "yes, delete",
      "confirm",
      "remove",
    ];

    for (const container of modalContainers) {
      const buttons = Array.from(
        container.querySelectorAll("button, [role='button']")
      );

      const targetButton = buttons.find((button) => {
        const element = button as HTMLElement;
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        const text = (element.innerText || element.textContent || "")
          .replace(/\s+/g, " ")
          .trim()
          .toLowerCase();

        const isDeleteConfirmation =
          buttonTexts.includes(text) ||
          (text.includes("delete") && !text.includes("cancel"));

        return (
          isDeleteConfirmation &&
          rect.width > 0 &&
          rect.height > 0 &&
          style.display !== "none" &&
          style.visibility !== "hidden"
        );
      }) as HTMLElement | undefined;

      if (targetButton) {
        targetButton.click();
        return true;
      }
    }

    return false;
  });
}

async function deleteSessionByIndex(
  page: Page,
  context: string,
  sessionIndex: number,
  sessionTitle?: string
) {
  const deletedTitle = await openSessionOverflowMenu(
    page,
    sessionIndex,
    sessionTitle
  );

  let handledNativeDialog = false;
  const nativeDialogHandler = async (dialog: Dialog) => {
    handledNativeDialog = true;
    await dialog.accept();
  };

  page.once("dialog", nativeDialogHandler);

  const clickedDelete = await clickVisibleMenuItemByText(page, "Delete");

  if (!clickedDelete) {
    page.off("dialog", nativeDialogHandler);
    await page.keyboard.press("Escape").catch(() => {});
    throw new Error(`Could not find Delete for "${deletedTitle}".`);
  }

  await sleep(500);

  if (!handledNativeDialog) {
    page.off("dialog", nativeDialogHandler);
  }

  await clickDeleteConfirmationIfPresent(page);

  await page
    .waitForNavigation({
      waitUntil: "networkidle2",
      timeout: 10000,
    })
    .catch(() => {});

  await sleep(2500);

  const sessions = await getSessionOptions(page, context);
  const activeSession = sessions.find((session) => session.isActive);

  return {
    deletedTitle,
    sessions,
    selectedSessionIndex: activeSession?.index ?? sessions[0]?.index ?? "",
  };
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
  console.log("[Sessions Router] Loading selected session history...");

  const seenTurnGroups = new Set<string>();
  const collectedGroupsNewestFirst: ChatTurnGroup[] = [];

  let lastGroupCount = 0;
  let noGrowthCount = 0;

  for (let i = 0; i < 80; i++) {
    const visibleMessages = await extractVisibleThread(page);
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
  console.log("[Sessions Router] Looking for lesson/chat start button...");

  const chatReadyBeforeClick = await hasChatInterface(page);

  if (chatReadyBeforeClick) {
    console.log("[Sessions Router] Chat interface already visible.");

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
        `[Sessions Router] Clicked lesson/chat button: "${clickedText}" | attempt=${attempt}`
      );

      await page
        .waitForNavigation({
          waitUntil: "networkidle2",
          timeout: 10000,
        })
        .catch(() => {});

      await sleep(5000);
    } else {
      await sleep(2000);
    }

    const chatReadyAfterClick = await hasChatInterface(page);

    if (chatReadyAfterClick) {
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
      console.log("[Sessions Router] Reusing already-open chat panel.");
      return;
    }
  }

  console.log("[Sessions Router] Opening chat panel for selected module...");

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
      `Could not open the chat interface for "${context}".`
    );
  }
}

export async function POST(request: Request) {
  try {
    const { action, context, sessionIndex, sessionTitle } = await request.json();

    if (!context || !context.trim()) {
      throw new Error("Missing module context for sessions.");
    }

    const result = await withNoodlePage(async (page, state) => {
      await ensureChatIsOpenForContext(page, context, state);

      if (action === "list") {
        const sessions = await getSessionOptions(page, context);
        const activeSession = sessions.find((session) => session.isActive);

        return {
          sessions,
          selectedSessionIndex: activeSession?.index ?? sessions[0]?.index ?? "",
          history: [],
          answer: "",
          images: [],
        };
      }

      if (action === "select") {
        if (typeof sessionIndex !== "number") {
          throw new Error("Missing session index.");
        }

        await selectSessionByIndex(page, sessionIndex, sessionTitle);

        const verifiedSelection = await verifySelectedSession(
          page,
          context,
          sessionIndex,
          sessionTitle
        );

        await scrollChatToNewest(page);

        const chronologicalThread = await loadFullChatHistory(page);

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

        return {
          sessions: verifiedSelection.sessions,
          selectedSessionIndex: verifiedSelection.selectedSessionIndex,
          history: chronologicalThread,
          answer: latestAnswer,
          images: latestAssistantImages,
        };
      }

      if (action === "delete") {
        if (typeof sessionIndex !== "number") {
          throw new Error("Missing session index.");
        }

        const existingSessions = await getSessionOptions(page, context);

        if (existingSessions.length <= 1) {
          throw new Error("At least one session must remain.");
        }

        const deleteResult = await deleteSessionByIndex(
          page,
          context,
          sessionIndex,
          sessionTitle
        );

        return {
          sessions: deleteResult.sessions,
          selectedSessionIndex: deleteResult.selectedSessionIndex,
          deletedTitle: deleteResult.deletedTitle,
          history: [],
          answer: "",
          images: [],
        };
      }

      throw new Error(`Unsupported sessions action: ${action}`);
    });

    return NextResponse.json(result);
  } catch (error: unknown) {
    const errorMessage = getErrorMessage(error);

    console.error("[Sessions Router] Session action failed:", errorMessage);

    return NextResponse.json({
      sessions: [],
      selectedSessionIndex: "",
      history: [],
      answer: "",
      images: [],
      error: errorMessage,
    });
  }
}
