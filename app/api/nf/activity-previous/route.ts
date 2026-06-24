import { NextResponse } from "next/server";
import { withNoodlePage } from "../../../../lib/noodleBrowser";

type QuizQuestion = {
  number: number;
  question: string;
  choices: string[];
};

export async function POST() {
  try {
    const activity = await withNoodlePage(async (page) => {
      const beforeSignature = await page.evaluate(() => {
        return Array.from(document.querySelectorAll("label.quiz-radio-wrapper"))
          .filter((label) => {
            const element = label as HTMLElement;
            const rect = element.getBoundingClientRect();
            const style = window.getComputedStyle(element);

            return (
              rect.width > 0 &&
              rect.height > 0 &&
              style.display !== "none" &&
              style.visibility !== "hidden" &&
              style.opacity !== "0"
            );
          })
          .map((label) => {
            const forValue = label.getAttribute("for") || "";
            const text = (label as HTMLElement).innerText || "";
            return `${forValue}|${text}`;
          })
          .join("||");
      });

      const clickedPrevious = await page.evaluate(() => {
        const previousImage = Array.from(
          document.querySelectorAll("button.quiz-navigation-button img")
        ).find((image) => {
          const alt = image.getAttribute("alt") || "";
          return alt.toLowerCase() === "previous";
        });

        const previousButton = previousImage?.closest(
          "button"
        ) as HTMLButtonElement | null;

        if (!previousButton || previousButton.disabled) {
          return false;
        }

        previousButton.click();
        return true;
      });

      if (!clickedPrevious) {
        throw new Error("Previous button was not found or is disabled.");
      }

      await page
        .waitForFunction(
          (oldSignature) => {
            const currentSignature = Array.from(
              document.querySelectorAll("label.quiz-radio-wrapper")
            )
              .filter((label) => {
                const element = label as HTMLElement;
                const rect = element.getBoundingClientRect();
                const style = window.getComputedStyle(element);

                return (
                  rect.width > 0 &&
                  rect.height > 0 &&
                  style.display !== "none" &&
                  style.visibility !== "hidden" &&
                  style.opacity !== "0"
                );
              })
              .map((label) => {
                const forValue = label.getAttribute("for") || "";
                const text = (label as HTMLElement).innerText || "";
                return `${forValue}|${text}`;
              })
              .join("||");

            return currentSignature && currentSignature !== oldSignature;
          },
          {
            timeout: 15000,
          },
          beforeSignature
        )
        .catch(() => null);

      await new Promise((resolve) => setTimeout(resolve, 700));

      const result = await page.evaluate(() => {
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

        function findNavigationButton(altName: string) {
          const image = Array.from(
            document.querySelectorAll("button.quiz-navigation-button img")
          ).find((img) => {
            const alt = img.getAttribute("alt") || "";
            return alt.toLowerCase() === altName.toLowerCase();
          });

          return image?.closest("button") as HTMLButtonElement | null;
        }

        const labels = Array.from(
          document.querySelectorAll("label.quiz-radio-wrapper")
        ).filter(isVisible);

        const questionMap: Record<string, string[]> = {};

        for (const label of labels) {
          const rawFor = label.getAttribute("for") || "";
          const question = clean(rawFor.replace(/\d+$/, ""));
          const choice = clean((label as HTMLElement).innerText || "");

          if (!question || !choice) continue;

          if (!questionMap[question]) {
            questionMap[question] = [];
          }

          questionMap[question].push(choice);
        }

        const questions: QuizQuestion[] = Object.entries(questionMap).map(
          ([question, choices], index) => ({
            number: index + 1,
            question,
            choices,
          })
        );

        const nextButton = findNavigationButton("Next");
        const previousButton = findNavigationButton("Previous");

        return {
          questions,
          hasNext: Boolean(
            nextButton && !nextButton.disabled && isVisible(nextButton)
          ),
          hasPrevious: Boolean(
            previousButton &&
              !previousButton.disabled &&
              isVisible(previousButton)
          ),
        };
      });

      return result;
    });

    return NextResponse.json({
      activity,
    });
  } catch (error: any) {
    console.error("[Activity Previous Router] Failed:", error);

    return NextResponse.json(
      {
        error: error.message || "Failed to load previous question.",
      },
      {
        status: 500,
      }
    );
  }
}