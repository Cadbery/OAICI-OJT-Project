type FormattedMessageProps = {
  content: string;
};

function normalizeLine(line: string) {
  return line.trim();
}

function shouldBoldLabel(label: string) {
  const cleanLabel = label.trim();

  return (
    cleanLabel.length > 0 &&
    cleanLabel.length <= 60 &&
    /[A-Za-z]/.test(cleanLabel)
  );
}

function renderInlineFormatting(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);

  return parts.map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <strong key={index} className="font-semibold">
          {part.slice(2, -2)}
        </strong>
      );
    }

    const colonMatch = part.match(/^([^:]{1,60}):\s*(.*)$/);

    if (colonMatch && shouldBoldLabel(colonMatch[1])) {
      return (
        <span key={index}>
          <strong className="font-semibold">{colonMatch[1]}:</strong>
          {colonMatch[2] ? ` ${colonMatch[2]}` : ""}
        </span>
      );
    }

    return <span key={index}>{part}</span>;
  });
}

function isBulletLine(line: string) {
  return /^[-•*]\s+/.test(line);
}

function isNumberedLine(line: string) {
  return /^\d+[.)]\s+/.test(line);
}

function isLabelLine(line: string) {
  const match = line.match(/^([^:]{1,60}):\s*(.*)$/);
  return !!match && shouldBoldLabel(match[1]);
}

export default function FormattedMessage({ content }: FormattedMessageProps) {
  const paragraphs = content.split(/\n\s*\n/g);

  return (
    <div className="space-y-3">
      {paragraphs.map((paragraph, paragraphIndex) => {
        const lines = paragraph
          .split("\n")
          .map(normalizeLine)
          .filter(Boolean);

        if (lines.length === 0) return null;

        const allBulletLines = lines.every(isBulletLine);
        const allNumberedLines = lines.every(isNumberedLine);
        const allLabelLines = lines.length > 1 && lines.every(isLabelLine);

        if (allBulletLines) {
          return (
            <ul key={paragraphIndex} className="list-disc pl-5 space-y-1">
              {lines.map((line, lineIndex) => (
                <li key={lineIndex}>
                  {renderInlineFormatting(line.replace(/^[-•*]\s+/, ""))}
                </li>
              ))}
            </ul>
          );
        }

        if (allNumberedLines) {
          return (
            <ol key={paragraphIndex} className="list-decimal pl-5 space-y-1">
              {lines.map((line, lineIndex) => (
                <li key={lineIndex}>
                  {renderInlineFormatting(line.replace(/^\d+[.)]\s+/, ""))}
                </li>
              ))}
            </ol>
          );
        }

        if (allLabelLines) {
          return (
            <ul key={paragraphIndex} className="list-disc pl-5 space-y-1">
              {lines.map((line, lineIndex) => (
                <li key={lineIndex}>{renderInlineFormatting(line)}</li>
              ))}
            </ul>
          );
        }

        return (
          <p key={paragraphIndex} className="leading-6">
            {lines.map((line, lineIndex) => (
              <span key={lineIndex}>
                {renderInlineFormatting(line)}
                {lineIndex < lines.length - 1 && <br />}
              </span>
            ))}
          </p>
        );
      })}
    </div>
  );
}