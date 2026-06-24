import puppeteer, { Browser, Page } from "puppeteer";
import { readFile } from "fs/promises";
import path from "path";
import os from "os";

export const NOODLE_TARGET_URL =
  "https://org88300f0fbca24257.noodlefactory.app/home/agents/69fb09de0cee9f6e925c7bcd?through=admin-portal&class=69fb09e80cee9f6e925c7bec";

type NoodleSessionState = {
  activeContext: string;
  isChatPanelOpen: boolean;
  isOnCourseHome: boolean;
};

declare global {
  var __noodleBrowser: Browser | null | undefined;
  var __noodleBrowserPromise: Promise<Browser> | null | undefined;
  var __noodlePage: Page | null | undefined;
  var __noodleLock: Promise<void> | null | undefined;
  var __noodleReleaseLock: (() => void) | null | undefined;
  var __noodleSessionState: NoodleSessionState | undefined;
}

function getEdgeExecutablePath() {
  const platform = os.platform();

  if (platform === "win32") {
    return "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
  }

  if (platform === "darwin") {
    return "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge";
  }

  return "/usr/bin/microsoft-edge";
}

function getNoodleProfilePath() {
  return path.resolve("./puppeteer_edge_data");
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function isBrowserAlreadyRunningError(error: unknown) {
  return getErrorMessage(error).toLowerCase().includes("browser is already running");
}

async function readDevToolsPort(profilePath: string) {
  try {
    const activePort = await readFile(
      path.join(profilePath, "DevToolsActivePort"),
      "utf8"
    );
    const [portLine] = activePort.split(/\r?\n/);
    const port = Number(portLine?.trim());

    return Number.isFinite(port) && port > 0 ? port : null;
  } catch {
    return null;
  }
}

function rememberNoodleBrowser(browser: Browser) {
  browser.on("disconnected", () => {
    console.log("[Noodle Browser] Browser disconnected.");

    globalThis.__noodleBrowser = null;
    globalThis.__noodleBrowserPromise = null;
    globalThis.__noodlePage = null;

    resetNoodleSessionState();
  });

  globalThis.__noodleBrowser = browser;
  globalThis.__noodleBrowserPromise = null;
  globalThis.__noodlePage = null;

  resetNoodleSessionState();

  return browser;
}

async function connectToExistingNoodleBrowser(profilePath: string) {
  const port = await readDevToolsPort(profilePath);

  if (!port) {
    return null;
  }

  try {
    console.log(
      `[Noodle Browser] Connecting to existing Edge browser on port ${port}...`
    );
    const browser = await puppeteer.connect({
      browserURL: `http://127.0.0.1:${port}`,
    });

    return rememberNoodleBrowser(browser);
  } catch (error) {
    console.log(
      `[Noodle Browser] Could not reconnect to existing Edge browser: ${getErrorMessage(
        error
      )}`
    );

    return null;
  }
}

async function launchNoodleBrowser() {
  const profilePath = getNoodleProfilePath();
  const existingBrowser = await connectToExistingNoodleBrowser(profilePath);

  if (existingBrowser) {
    return existingBrowser;
  }

  console.log("[Noodle Browser] Launching persistent Edge browser...");

  const edgePath = getEdgeExecutablePath();

  try {
    const browser = await puppeteer.launch({
      headless: false,
      executablePath: edgePath,
      userDataDir: profilePath,
      defaultViewport: null,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--start-maximized",
        "--window-size=1400,900",
        "--disable-features=Translate",
      ],
    });

    return rememberNoodleBrowser(browser);
  } catch (error) {
    if (isBrowserAlreadyRunningError(error)) {
      const reconnectedBrowser = await connectToExistingNoodleBrowser(profilePath);

      if (reconnectedBrowser) {
        return reconnectedBrowser;
      }
    }

    throw error;
  }
}

async function getNoodleBrowser() {
  if (globalThis.__noodleBrowser && globalThis.__noodleBrowser.connected) {
    return globalThis.__noodleBrowser;
  }

  if (globalThis.__noodleBrowserPromise) {
    try {
      return await globalThis.__noodleBrowserPromise;
    } catch (error) {
      console.log(
        `[Noodle Browser] Previous launch failed. Retrying with a fresh browser handle: ${getErrorMessage(
          error
        )}`
      );
      globalThis.__noodleBrowserPromise = null;
    }
  }

  globalThis.__noodleBrowserPromise = launchNoodleBrowser().catch((error) => {
    globalThis.__noodleBrowserPromise = null;
    throw error;
  });

  return await globalThis.__noodleBrowserPromise;
}

async function getReusablePage(browser: Browser) {
  const existingPages = await browser.pages();

  const usablePages = existingPages.filter((page) => !page.isClosed());

  const nonBlankPage = usablePages.find((page) => {
    const url = page.url();
    return url && url !== "about:blank";
  });

  if (nonBlankPage) {
    return nonBlankPage;
  }

  if (usablePages.length > 0) {
    return usablePages[0];
  }

  return await browser.newPage();
}

async function getNoodlePage() {
  const browser = await getNoodleBrowser();

  if (globalThis.__noodlePage && !globalThis.__noodlePage.isClosed()) {
    return globalThis.__noodlePage;
  }

  console.log("[Noodle Browser] Getting reusable persistent page...");

  const page = await getReusablePage(browser);

  await page.setViewport({
    width: 1400,
    height: 900,
  });

  await page.bringToFront().catch(() => {});

  page.on("close", () => {
    if (globalThis.__noodlePage === page) {
      globalThis.__noodlePage = null;
      resetNoodleSessionState();
    }
  });

  page.on("error", () => {
    if (globalThis.__noodlePage === page) {
      globalThis.__noodlePage = null;
      resetNoodleSessionState();
    }
  });

  globalThis.__noodlePage = page;

  return globalThis.__noodlePage;
}

async function acquireNoodleLock() {
  while (globalThis.__noodleLock) {
    await globalThis.__noodleLock;
  }

  globalThis.__noodleLock = new Promise<void>((resolve) => {
    globalThis.__noodleReleaseLock = resolve;
  });

  return () => {
    const release = globalThis.__noodleReleaseLock;

    globalThis.__noodleLock = null;
    globalThis.__noodleReleaseLock = null;

    if (release) {
      release();
    }
  };
}

export function resetNoodleSessionState() {
  globalThis.__noodleSessionState = {
    activeContext: "",
    isChatPanelOpen: false,
    isOnCourseHome: false,
  };
}

export async function resetNoodlePage() {
  console.log("[Noodle Browser] Resetting persistent page...");

  if (globalThis.__noodlePage && !globalThis.__noodlePage.isClosed()) {
    await globalThis.__noodlePage.close().catch(() => {});
  }

  globalThis.__noodlePage = null;
  resetNoodleSessionState();
}

export async function resetNoodleBrowser() {
  console.log("[Noodle Browser] Resetting whole browser...");

  if (globalThis.__noodleBrowser && globalThis.__noodleBrowser.connected) {
    await globalThis.__noodleBrowser.close().catch(() => {});
  }

  globalThis.__noodleBrowser = null;
  globalThis.__noodleBrowserPromise = null;
  globalThis.__noodlePage = null;

  resetNoodleSessionState();
}

export function isDetachedFrameError(error: unknown) {
  const message = getErrorMessage(error).toLowerCase();

  return (
    message.includes("detached frame") ||
    message.includes("frame was detached") ||
    message.includes("attempted to use detached frame")
  );
}

export function getNoodleSessionState() {
  if (!globalThis.__noodleSessionState) {
    resetNoodleSessionState();
  }

  return globalThis.__noodleSessionState!;
}

export async function withNoodlePage<T>(
  callback: (page: Page, state: NoodleSessionState) => Promise<T>
) {
  const releaseLock = await acquireNoodleLock();

  try {
    const page = await getNoodlePage();
    const state = getNoodleSessionState();

    return await callback(page, state);
  } finally {
    releaseLock();
  }
}
