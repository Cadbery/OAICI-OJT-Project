import { NextResponse } from "next/server";
import { withNoodlePage } from "../../../../lib/noodleBrowser";

type ActivityReviewQuestion = {
  number: number;
  score: string;
  question: string;
  recommendedAnswer: string;
  yourAnswer: string;
};

export async function POST() {
  try {
    const review = await withNoodlePage(async (page) => {
      const clickedReviewButton = await page.evaluate(() => {
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

        const targetText = "check out the correct answers to the quiz questions";

        const accordions = Array.from(
          document.querySelectorAll('.accordion[role="button"]')
        ).filter(isVisible);

        const reviewAccordion = accordions.find((accordion) => {
          const text = clean((accordion as HTMLElement).innerText || "");

          return text.toLowerCase().includes(targetText);
        }) as HTMLElement | undefined;

        if (!reviewAccordion) {
          return {
            clicked: false,
            reason: "Review accordion was not found.",
          };
        }

        const isExpanded =
          reviewAccordion.getAttribute("aria-expanded") === "true";

        if (!isExpanded) {
          reviewAccordion.scrollIntoView({
            behavior: "auto",
            block: "center",
          });

          reviewAccordion.click();
        }

        return {
          clicked: true,
          reason: isExpanded
            ? "Review accordion was already expanded."
            : "Review accordion was clicked.",
        };
      });

      console.log(
        "[Activity Review Router] Review accordion status:",
        clickedReviewButton
      );

      if (!clickedReviewButton.clicked) {
        throw new Error(clickedReviewButton.reason);
      }

      await page
        .waitForFunction(
          () => {
            const text = document.body.innerText || "";

            const reviewAccordion = Array.from(
              document.querySelectorAll('.accordion[role="button"]')
            ).find((accordion) => {
              const accordionText = (accordion as HTMLElement).innerText || "";

              return accordionText
                .toLowerCase()
                .includes(
                  "check out the correct answers to the quiz questions"
                );
            });

            const isExpanded =
              reviewAccordion?.getAttribute("aria-expanded") === "true";

            return (
              isExpanded &&
              /Question\s+\d+\s*(?:\(\s*)?Score:/i.test(text) &&
              /Recommended Answer/i.test(text) &&
              /Your Answer/i.test(text)
            );
          },
          {
            timeout: 20000,
          }
        )
        .catch(() => null);

      await new Promise((resolve) => setTimeout(resolve, 1000));

      const scrapedReview = await page.evaluate(() => {
        function clean(text: string) {
          return text.replace(/\s+/g, " ").trim();
        }

        function removeConsecutiveDuplicateLines(lines: string[]) {
          const cleanedLines: string[] = [];

          for (const line of lines) {
            const previousLine = cleanedLines[cleanedLines.length - 1];

            if (
              previousLine &&
              previousLine.toLowerCase() === line.toLowerCase()
            ) {
              continue;
            }

            cleanedLines.push(line);
          }

          return cleanedLines;
        }

        function removeUnwantedLines(lines: string[]) {
          const footerPatterns = [
            /AI can make mistakes/i,
            /Learn more/i,
            /How to switch languages/i,
            /Accessibility/i,
          ];

          const skipPatterns = [
            /^Select to send for review$/i,
            /^Add comment here/i,
            /^Add comment here \(optional\)$/i,
            /^Go to Activities$/i,
            /^New Session$/i,
            /^Ask Anything/i,
            /^Check out the correct answers to the quiz questions$/i,
          ];

          const cleanedLines: string[] = [];

          for (const line of lines) {
            if (footerPatterns.some((pattern) => pattern.test(line))) {
              break;
            }

            if (skipPatterns.some((pattern) => pattern.test(line))) {
              continue;
            }

            cleanedLines.push(line);
          }

          return cleanedLines;
        }

        function isQuestionHeader(line: string) {
          return /^Question\s+\d+\s*(?:\(\s*)?Score:/i.test(line);
        }

        function parseScoreHeader(header: string) {
          const match = header.match(
            /Question\s+(\d+)\s*(?:\(\s*)?Score:\s*([^)]+)\)?/i
          );

          return {
            number: match ? Number(match[1]) : 0,
            score: match ? clean(match[2]) : "",
          };
        }

        function findLabelIndex(lines: string[], label: string) {
          return lines.findIndex((line) => {
            return line.trim().toLowerCase() === label.toLowerCase();
          });
        }

        function parseQuestionBlock(blockLines: string[]) {
          const header = blockLines[0] || "";
          const { number, score } = parseScoreHeader(header);

          const recommendedIndex = findLabelIndex(
            blockLines,
            "Recommended Answer"
          );

          const yourAnswerIndex = findLabelIndex(blockLines, "Your Answer");

          const firstAnswerLabelIndex = Math.min(
            recommendedIndex >= 0 ? recommendedIndex : blockLines.length,
            yourAnswerIndex >= 0 ? yourAnswerIndex : blockLines.length
          );

          const question = blockLines.slice(1, firstAnswerLabelIndex).join(" ");

          let recommendedAnswer = "";
          let yourAnswer = "";

          if (recommendedIndex >= 0 && yourAnswerIndex >= 0) {
            if (recommendedIndex < yourAnswerIndex) {
              recommendedAnswer = blockLines
                .slice(recommendedIndex + 1, yourAnswerIndex)
                .join(" ");

              yourAnswer = blockLines
                .slice(yourAnswerIndex + 1)
                .join(" ");
            } else {
              yourAnswer = blockLines
                .slice(yourAnswerIndex + 1, recommendedIndex)
                .join(" ");

              recommendedAnswer = blockLines
                .slice(recommendedIndex + 1)
                .join(" ");
            }
          }

          return {
            number,
            score,
            question: clean(question),
            recommendedAnswer: clean(recommendedAnswer),
            yourAnswer: clean(yourAnswer),
          };
        }

        const rawText = document.body.innerText || "";

        const rawLines = rawText
          .split("\n")
          .map((line) => clean(line))
          .filter(Boolean);

        const allLines = removeUnwantedLines(
          removeConsecutiveDuplicateLines(rawLines)
        );

        const firstQuestionIndex = allLines.findIndex((line) =>
          isQuestionHeader(line)
        );

        const reviewLines =
          firstQuestionIndex >= 0 ? allLines.slice(firstQuestionIndex) : [];

        const questionStartIndexes = reviewLines
          .map((line, index) => (isQuestionHeader(line) ? index : -1))
          .filter((index) => index >= 0);

        const questions: ActivityReviewQuestion[] = [];

        for (let i = 0; i < questionStartIndexes.length; i++) {
          const startIndex = questionStartIndexes[i];

          const endIndex =
            questionStartIndexes[i + 1] !== undefined
              ? questionStartIndexes[i + 1]
              : reviewLines.length;

          const blockLines = reviewLines.slice(startIndex, endIndex);
          const parsedQuestion = parseQuestionBlock(blockLines);

          if (parsedQuestion.number && parsedQuestion.question) {
            questions.push(parsedQuestion);
          }
        }

        return {
          title: "Correct Answers Review",
          questions,
          rawLines: reviewLines,
        };
      });

      console.log(
        "[Activity Review Router] Scraped review:",
        JSON.stringify(scrapedReview, null, 2)
      );

      return scrapedReview;
    });

    return NextResponse.json({
      review,
    });
  } catch (error: any) {
    console.error("[Activity Review Router] Failed:", error);

    return NextResponse.json(
      {
        error: error.message || "Failed to load activity review.",
      },
      {
        status: 500,
      }
    );
  }
}