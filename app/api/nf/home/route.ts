import { NextResponse } from "next/server";
import {
  NOODLE_TARGET_URL,
  withNoodlePage,
} from "../../../../lib/noodleBrowser";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function POST() {
  try {
    const result = await withNoodlePage(async (page, state) => {
      // Return the persistent Puppeteer page to the Noodle Factory course home.
      // The frontend already has the folders/modules in memory, so it does not
      // need to scrape them again just because the user opens Course Home.
      await page.goto(NOODLE_TARGET_URL, {
        waitUntil: "networkidle2",
        timeout: 60000,
      });

      // Give Noodle Factory a brief moment to finish its client-side rendering.
      await sleep(1200);

      state.activeContext = "";
      state.isChatPanelOpen = false;
      state.isOnCourseHome = true;

      return {
        ok: true,
        message: "Noodle Factory browser returned to the course home.",
      };
    });

    return NextResponse.json(result);
  } catch (error: any) {
    console.error("[Home Router] Failed to return to course home:", error.message);

    return NextResponse.json(
      {
        ok: false,
        error: error.message || "Failed to return to the course home.",
      },
      { status: 500 }
    );
  }
}
