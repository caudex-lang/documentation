const VALID_STATUSES = [
  "In Development",
  "Under Review",
  "Draft",
  "Approved",
  "Retired",
  "Archived"
];

module.exports = [
  {
    names: ["CXD001", "cxd-title-and-metadata"],
    description: "Enforces CSR-7 title format and metadata table fields",
    tags: ["cxd", "structure"],
    function: function rule(params, onError) {
      const lines = params.lines;
      if (lines.length < 5) return;
      if (!lines[0].startsWith("## Caudex Standard Recommendation")) {
        onError({
          lineNumber: 1,
          detail: "Line 1 must start with '## Caudex Standard Recommendation X (CSR-X)'"
        });
      }
      if (!lines[2].startsWith("## ")) {
        onError({
          lineNumber: 3,
          detail: "Line 3 must be a level-2 heading containing the document name"
        });
      }
      const fullText = lines.join("\n");
      const statusMatch = fullText.match(/\|\s*\*\*Status\*\*\s*\|\s*([^|]+)\s*\|/);
      if (statusMatch) {
        const statusValue = statusMatch[1].trim();
        if (!VALID_STATUSES.includes(statusValue)) {
          onError({
            lineNumber: 1,
            detail: `Invalid Status '${statusValue}'. Allowed: ${VALID_STATUSES.join(", ")}`
          });
        }
      } else {
        onError({
          lineNumber: 1,
          detail: "Missing mandatory metadata table field '**Status**'"
        });
      }
    }
  },
  {
    names: ["CXD002", "cxd-heading-numbering"],
    description: "Enforces and auto-fixes section numbering format",
    tags: ["cxd", "headings"],
    function: function rule(params, onError) {
      if (!/CSR-\d+/i.test(params.name)) return;

      let isAppendix = false;
      let appendixCharCode = 65;
      let currentAppendixLetter = "A";
      const sectionCounters = [0, 0, 0, 0];

      params.tokens
        .filter((token) => token.type === "heading_open")
        .forEach((token) => {
          if (token.tag === "h2") return;
          const level = parseInt(token.tag.substring(1), 10) - 3;
          if (level < 0) return;
          const inlineToken = params.tokens[params.tokens.indexOf(token) + 1];
          if (!inlineToken) return;
          const fullHeadingText = inlineToken.content.trim();
          if (level === 0) {
            if (/^Appendix\b/i.test(fullHeadingText)) {
              isAppendix = true;
              currentAppendixLetter = String.fromCharCode(appendixCharCode++);
            } else {
              isAppendix = false;
              sectionCounters[0]++;
            }
            for (let i = 1; i < sectionCounters.length; i++) {
              sectionCounters[i] = 0;
            }
          } else {
            sectionCounters[level]++;
            for (let i = level + 1; i < sectionCounters.length; i++) {
              sectionCounters[i] = 0;
            }
          }
          let expectedPrefix = "";
          if (isAppendix) {
            if (level === 0) {
              expectedPrefix = `Appendix ${currentAppendixLetter} - `;
            } else {
              const subPath = sectionCounters.slice(1, level + 1).join(".");
              expectedPrefix = `${currentAppendixLetter}.${subPath} - `;
            }
          } else {
            const mainPath = sectionCounters.slice(0, level + 1).join(".");
            expectedPrefix = `${mainPath} - `;
          }
          const cleanTitle = fullHeadingText
            .replace(/^Appendix(\s+([A-Z]|\d+)(\.([A-Z]|\d+))*)?\s*[-\.:]*\s*/i, "")
            .replace(/^([A-Z]|\d+)(\.([A-Z]|\d+))*\s*[-\.:]+\s*/i, "")
            .trim();

          const expectedHeadingText = `${expectedPrefix}${cleanTitle}`;

          if (fullHeadingText !== expectedHeadingText) {
            const lineIndex = token.lineNumber - 1;
            const originalLine = params.lines[lineIndex];
            const hashPrefix = originalLine.match(/^#+\s*/)[0];
            const correctedLine = `${hashPrefix}${expectedHeadingText}`;

            onError({
              lineNumber: token.lineNumber,
              detail: `Expected '${expectedHeadingText}', got '${fullHeadingText}'`,
              fixInfo: {
                editColumn: 1,
                deleteCount: originalLine.length,
                insertText: correctedLine
              }
            });
          }
        });
    }
  }
];
