import { NextResponse } from "next/server";
import { withNoodlePage } from "../../../../lib/noodleBrowser";

type QuizQuestion = {
  number: number;
  question: string;
  choices: string[];
};

type SelectedActivityAnswer = {
  questionNumber: number;
  question: string;
  choice: string;
};

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const answer = body.answer as SelectedActivityAnswer | undefined;

    const activity = await withNoodlePage(async (page) => {
      if (answer?.choice) {
        const answerClicked = await page.evaluate((selectedAnswer) => {
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

          function normalize(text: string) {
            return clean(text).toLowerCase();
          }

          const targetQuestion = normalize(selectedAnswer.question || "");
          const targetChoice = normalize(selectedAnswer.choice || "");

          const visibleLabels = Array.from(
            document.querySelectorAll("label.quiz-radio-wrapper")
          ).filter(isVisible);

          let matchedLabel = visibleLabels.find((label) => {
            const rawFor = label.getAttribute("for") || "";
            const question = normalize(rawFor.replace(/\d+$/, ""));
            const choice = normalize((label as HTMLElement).innerText || "");

            return question === targetQuestion && choice === targetChoice;
          });

          if (!matchedLabel) {
            matchedLabel = visibleLabels.find((label) => {
              const choice = normalize((label as HTMLElement).innerText || "");
              return choice === targetChoice;
            });
          }

          if (!matchedLabel) {
            return false;
          }

          const inputId = matchedLabel.getAttribute("for") || "";
          const input = document.getElementById(
            inputId
          ) as HTMLInputElement | null;

          if (input) {
            input.click();
          } else {
            (matchedLabel as HTMLElement).click();
          }

          return true;
        }, answer);

        if (!answerClicked) {
          throw new Error("Selected answer could not be found in Noodle Factory.");
        }

        await new Promise((resolve) => setTimeout(resolve, 500));
      }

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

      const clickedNext = await page.evaluate(() => {
        const nextImage = Array.from(
          document.querySelectorAll("button.quiz-navigation-button img")
        ).find((image) => {
          const alt = image.getAttribute("alt") || "";
          return alt.toLowerCase() === "next";
        });

        const nextButton = nextImage?.closest(
          "button"
        ) as HTMLButtonElement | null;

        if (!nextButton || nextButton.disabled) {
          return false;
        }

        nextButton.click();
        return true;
      });

      if (!clickedNext) {
        throw new Error("Next button was not found or is disabled.");
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

        const hasNext = Boolean(
          nextButton && !nextButton.disabled && isVisible(nextButton)
        );

        const hasPrevious = Boolean(
          previousButton &&
            !previousButton.disabled &&
            isVisible(previousButton)
        );

        return {
          questions,
          hasNext,
          hasPrevious,
        };
      });

      return result;
    });

    return NextResponse.json({
      activity,
    });
  } catch (error: any) {
    console.error("[Activity Next Router] Failed:", error);

    return NextResponse.json(
      {
        error: error.message || "Failed to load next question.",
      },
      {
        status: 500,
      }
    );
  }
}