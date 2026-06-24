import { NextResponse } from "next/server";
import { withNoodlePage } from "../../../../lib/noodleBrowser";

type SelectedActivityAnswer = {
  questionNumber: number;
  question: string;
  choice: string;
};

type ActivitySubmitBody = {
  mode?: "all-at-once" | "one-at-a-time";
  answers?: SelectedActivityAnswer[];
  currentAnswers?: (SelectedActivityAnswer | null | undefined)[];
};

function isSelectedActivityAnswer(
  answer: SelectedActivityAnswer | null | undefined
): answer is SelectedActivityAnswer {
  return Boolean(answer && answer.question && answer.choice);
}

async function clickSubmitConfirmationIfPresent(page: any) {
  await page
    .waitForFunction(
      () => {
        const text = document.body.innerText || "";

        return (
          /are you sure you want to submit/i.test(text) ||
          /i want to submit/i.test(text)
        );
      },
      {
        timeout: 6000,
      }
    )
    .catch(() => null);

  const clickedConfirmation = await page.evaluate(() => {
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

    const clickableElements = Array.from(
      document.querySelectorAll("button, [role='button']")
    ).filter(isVisible);

    const confirmButton = clickableElements.find((element) => {
      const text = clean((element as HTMLElement).innerText || "");

      return (
        text.toLowerCase() === "i want to submit" ||
        text.toLowerCase().includes("i want to submit")
      );
    }) as HTMLElement | undefined;

    if (!confirmButton) {
      return false;
    }

    confirmButton.scrollIntoView({
      behavior: "auto",
      block: "center",
    });

    confirmButton.click();

    return true;
  });

  if (clickedConfirmation) {
    console.log("[Activity Submit Router] Clicked I want to submit button.");
    await new Promise((resolve) => setTimeout(resolve, 1200));
  } else {
    console.log("[Activity Submit Router] No confirmation modal detected.");
  }

  return clickedConfirmation;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as ActivitySubmitBody;

    const mode = body.mode || "all-at-once";

    const answersToClick =
      mode === "one-at-a-time"
        ? (body.currentAnswers || []).filter(isSelectedActivityAnswer)
        : body.answers || [];

    if (!answersToClick || answersToClick.length === 0) {
      return NextResponse.json(
        {
          error: "No selected answers were received.",
        },
        {
          status: 400,
        }
      );
    }

    const result = await withNoodlePage(async (page) => {
      console.log(
        "[Activity Submit Router] Received answers:",
        JSON.stringify(answersToClick, null, 2)
      );

      const selectionResult = await page.evaluate((selectedAnswers) => {
        function clean(text: string) {
          return text.replace(/\s+/g, " ").trim();
        }

        function normalize(text: string) {
          return clean(text).toLowerCase();
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

        const visibleLabels = Array.from(
          document.querySelectorAll("label.quiz-radio-wrapper")
        ).filter(isVisible);

        const clickedAnswers: SelectedActivityAnswer[] = [];
        const missingAnswers: SelectedActivityAnswer[] = [];

        for (const selectedAnswer of selectedAnswers) {
          const targetQuestion = normalize(selectedAnswer.question || "");
          const targetChoice = normalize(selectedAnswer.choice || "");

          let matchedLabel = visibleLabels.find((label) => {
            const rawFor = label.getAttribute("for") || "";
            const question = normalize(rawFor.replace(/\d+$/, ""));
            const choice = normalize((label as HTMLElement).innerText || "");

            return question === targetQuestion && choice === targetChoice;
          });

          if (!matchedLabel) {
            const choiceOnlyMatches = visibleLabels.filter((label) => {
              const choice = normalize((label as HTMLElement).innerText || "");
              return choice === targetChoice;
            });

            if (choiceOnlyMatches.length === 1) {
              matchedLabel = choiceOnlyMatches[0];
            }
          }

          if (!matchedLabel) {
            missingAnswers.push(selectedAnswer);
            continue;
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

          clickedAnswers.push(selectedAnswer);
        }

        return {
          clickedAnswers,
          missingAnswers,
        };
      }, answersToClick as SelectedActivityAnswer[]);

      console.log(
        "[Activity Submit Router] Selection result:",
        JSON.stringify(selectionResult, null, 2)
      );

      if (selectionResult.missingAnswers.length > 0) {
        throw new Error(
          `Some selected answers could not be found in Noodle Factory: ${selectionResult.missingAnswers
            .map((answer) => answer.choice)
            .join(", ")}`
        );
      }

      await new Promise((resolve) => setTimeout(resolve, 700));

      const beforeSubmitSignature = await page.evaluate(() => {
        return (document.body.innerText || "").replace(/\s+/g, " ").trim();
      });

      const clickedSubmit = await page.evaluate(() => {
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

        const buttons = Array.from(
          document.querySelectorAll("button, [role='button']")
        ).filter(isVisible);

        const submitButton = buttons.find((button) => {
          const text = clean((button as HTMLElement).innerText || "").toLowerCase();

          return (
            text === "submit quiz" ||
            text === "submit" ||
            text.includes("submit quiz")
          );
        }) as HTMLElement | undefined;

        if (!submitButton) {
          return false;
        }

        if (
          submitButton instanceof HTMLButtonElement &&
          submitButton.disabled
        ) {
          return false;
        }

        submitButton.scrollIntoView({
          behavior: "auto",
          block: "center",
        });

        submitButton.click();

        return true;
      });

      if (!clickedSubmit) {
        throw new Error("Submit Quiz button was not found or is disabled.");
      }

      console.log("[Activity Submit Router] Main submit button clicked.");

      await new Promise((resolve) => setTimeout(resolve, 1000));

      await clickSubmitConfirmationIfPresent(page);

      await page
        .waitForFunction(
          () => {
            const text = document.body.innerText || "";

            return (
              /quiz result/i.test(text) ||
              /you scored/i.test(text) ||
              /thank you for completing the quiz/i.test(text) ||
              /check out the correct answers to the quiz questions/i.test(text)
            );
          },
          {
            timeout: 25000,
          }
        )
        .catch(() => null);

      await page
        .waitForFunction(
          (oldSignature) => {
            const currentText = (document.body.innerText || "")
              .replace(/\s+/g, " ")
              .trim();

            return currentText.length > 0 && currentText !== oldSignature;
          },
          {
            timeout: 8000,
          },
          beforeSubmitSignature
        )
        .catch(() => null);

      await new Promise((resolve) => setTimeout(resolve, 1500));

      const scrapedResult = await page.evaluate(() => {
        function clean(text: string) {
          return text.replace(/\s+/g, " ").trim();
        }

        function uniqueLines(lines: string[]) {
          const seen = new Set<string>();

          return lines.filter((line) => {
            const key = line.toLowerCase();

            if (seen.has(key)) return false;

            seen.add(key);
            return true;
          });
        }

        const rawText = document.body.innerText || "";

        const allLines = uniqueLines(
          rawText
            .split("\n")
            .map((line) => clean(line))
            .filter(Boolean)
        );

        const startIndex = (() => {
          const quizResultIndex = allLines.findIndex((line) =>
            /quiz result/i.test(line)
          );

          if (quizResultIndex >= 0) return quizResultIndex;

          const thankYouIndex = allLines.findIndex((line) =>
            /thank you for completing the quiz/i.test(line)
          );

          if (thankYouIndex >= 0) return thankYouIndex;

          const scoredIndex = allLines.findIndex((line) =>
            /you scored/i.test(line)
          );

          if (scoredIndex >= 0) return scoredIndex;

          const scoreIndex = allLines.findIndex((line) =>
            /score|points|correct|grade|result|\/\s*\d+/i.test(line)
          );

          if (scoreIndex >= 0) return scoreIndex;

          return 0;
        })();

        const footerPatterns = [
          /AI can make mistakes/i,
          /Learn more/i,
          /How to switch languages/i,
          /Accessibility/i,
        ];

        const skipPatterns = [
          /^Go to Activities$/i,
          /^New Session$/i,
          /^Ask Anything/i,
          /^Are you sure you want to submit/i,
          /^Your report will be shown after the submission/i,
          /^Cancel$/i,
          /^I want to submit$/i,
        ];

        const resultLines: string[] = [];

        for (const line of allLines.slice(startIndex)) {
          if (footerPatterns.some((pattern) => pattern.test(line))) {
            break;
          }

          if (skipPatterns.some((pattern) => pattern.test(line))) {
            continue;
          }

          resultLines.push(line);
        }

        const cleanedResultLines =
          resultLines.length > 0 ? resultLines.slice(0, 20) : allLines.slice(0, 20);

        const youScoredIndex = cleanedResultLines.findIndex((line) =>
          /you scored/i.test(line)
        );

        const score =
          youScoredIndex >= 0 && cleanedResultLines[youScoredIndex + 1]
            ? `${cleanedResultLines[youScoredIndex]}: ${
                cleanedResultLines[youScoredIndex + 1]
              }`
            : cleanedResultLines.find((line) =>
                /you scored|score|points|correct|grade|result|\/\s*\d+/i.test(
                  line
                )
              ) || "";

        const summary =
          cleanedResultLines.find((line) =>
            /thank you for completing|completed|submitted|passed|failed|attempt/i.test(
              line
            )
          ) || "";

        return {
          title: "Quiz Result",
          score,
          summary,
          text: cleanedResultLines.join("\n"),
          rawText,
          lines: cleanedResultLines,
        };
      });

      console.log(
        "[Activity Submit Router] Scraped result:",
        JSON.stringify(scrapedResult, null, 2)
      );

      return scrapedResult;
    });

    return NextResponse.json({
      result,
    });
  } catch (error: any) {
    console.error("[Activity Submit Router] Failed:", error);

    return NextResponse.json(
      {
        error: error.message || "Failed to submit activity.",
      },
      {
        status: 500,
      }
    );
  }
}