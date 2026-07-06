/**
 * Lightweight zero-dependency markdown renderer.
 * Handles: headings, bold, italic, inline-code, code blocks,
 * unordered lists, ordered lists, tables, horizontal rules, paragraphs.
 */

/** Render inline markup inside a string (bold, italic, inline code). */
function renderInline(text, key) {
  // Split on **bold**, *italic*, `code` while preserving delimiters
  const parts = [];
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g;
  let last = 0;
  let m;
  let idx = 0;

  while ((m = pattern.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const token = m[0];
    if (token.startsWith("`"))        parts.push(<code key={idx++} className="md-inline-code">{token.slice(1, -1)}</code>);
    else if (token.startsWith("**"))  parts.push(<strong key={idx++}>{token.slice(2, -2)}</strong>);
    else                              parts.push(<em key={idx++}>{token.slice(1, -1)}</em>);
    last = m.index + token.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <span key={key}>{parts}</span>;
}

/** Parse a markdown table block into a React <table>. */
function parseTable(lines) {
  if (lines.length < 2) return null;

  const parseRow = (line) =>
    line
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((c) => c.trim());

  const headers = parseRow(lines[0]);
  // lines[1] is the separator row (---)
  const rows = lines.slice(2).map(parseRow);

  return (
    <div className="md-table-wrap">
      <table className="md-table">
        <thead>
          <tr>
            {headers.map((h, i) => (
              <th key={i}>{renderInline(h, i)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri}>
              {row.map((cell, ci) => (
                <td key={ci}>{renderInline(cell, ci)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Top-level block parser. Returns an array of React elements. */
function parseBlocks(raw) {
  const lines = raw.split("\n");
  const elements = [];
  let i = 0;

  const isTableSep = (line) => /^\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?$/.test(line.trim());
  const isTableRow = (line) => line.trim().startsWith("|") || (line.includes("|") && !line.trim().startsWith("#"));

  while (i < lines.length) {
    const line = lines[i];

    // ── Fenced code block ```
    if (line.trimStart().startsWith("```")) {
      const lang = line.trimStart().slice(3).trim();
      const codeLines = [];
      i++;
      while (i < lines.length && !lines[i].trimStart().startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing ```
      elements.push(
        <pre key={elements.length} className="md-code-block">
          <code className={lang ? `language-${lang}` : ""}>{codeLines.join("\n")}</code>
        </pre>
      );
      continue;
    }

    // ── Horizontal rule
    if (/^(\*{3,}|-{3,}|_{3,})$/.test(line.trim())) {
      elements.push(<hr key={elements.length} className="md-hr" />);
      i++;
      continue;
    }

    // ── Heading
    const headingMatch = line.match(/^(#{1,6})\s+(.*)/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const Tag = `h${level}`;
      elements.push(
        <Tag key={elements.length} className={`md-h${level}`}>
          {renderInline(headingMatch[2], 0)}
        </Tag>
      );
      i++;
      continue;
    }

    // ── Table (look-ahead for separator row)
    if (isTableRow(line) && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const tableLines = [];
      while (i < lines.length && (isTableRow(lines[i]) || isTableSep(lines[i]))) {
        tableLines.push(lines[i]);
        i++;
      }
      const tableEl = parseTable(tableLines);
      if (tableEl) elements.push(<div key={elements.length}>{tableEl}</div>);
      continue;
    }

    // ── Unordered list
    if (/^[\*\-\+]\s/.test(line)) {
      const items = [];
      while (i < lines.length && /^[\*\-\+]\s/.test(lines[i])) {
        items.push(<li key={i}>{renderInline(lines[i].replace(/^[\*\-\+]\s/, ""), 0)}</li>);
        i++;
      }
      elements.push(<ul key={elements.length} className="md-ul">{items}</ul>);
      continue;
    }

    // ── Ordered list
    if (/^\d+\.\s/.test(line)) {
      const items = [];
      while (i < lines.length && /^\d+\.\s/.test(lines[i])) {
        items.push(<li key={i}>{renderInline(lines[i].replace(/^\d+\.\s/, ""), 0)}</li>);
        i++;
      }
      elements.push(<ol key={elements.length} className="md-ol">{items}</ol>);
      continue;
    }

    // ── Blank line — skip
    if (line.trim() === "") {
      i++;
      continue;
    }

    // ── Paragraph: collect consecutive non-special lines
    const paraLines = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !lines[i].trimStart().startsWith("```") &&
      !lines[i].trimStart().startsWith("#") &&
      !/^[\*\-\+]\s/.test(lines[i]) &&
      !/^\d+\.\s/.test(lines[i]) &&
      !(isTableRow(lines[i]) && i + 1 < lines.length && isTableSep(lines[i + 1]))
    ) {
      paraLines.push(lines[i]);
      i++;
    }
    if (paraLines.length > 0) {
      elements.push(
        <p key={elements.length} className="md-p">
          {renderInline(paraLines.join(" "), 0)}
        </p>
      );
    }
  }

  return elements;
}

export default function MarkdownContent({ content }) {
  if (!content) return null;
  const blocks = parseBlocks(content);
  return <div className="md-body">{blocks}</div>;
}
