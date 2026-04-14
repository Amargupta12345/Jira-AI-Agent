/**
 * PR review output parsing helpers.
 */

const KNOWN_HEADINGS = ['Verdict', 'Critical Findings', 'Warning Findings', 'Summary'];

function parseHeadingLine(line) {
  const match = line.match(/^\s*[-*]?\s*([A-Za-z][A-Za-z\s]+?)\s*:\s*(.*)$/);
  if (!match) return null;

  const heading = match[1].trim();
  if (!KNOWN_HEADINGS.some((known) => known.toLowerCase() === heading.toLowerCase())) {
    return null;
  }

  return {
    heading,
    rest: match[2].trim(),
  };
}

function parseFindingsSection(report, heading) {
  const findings = [];
  let insideSection = false;

  for (const line of report.split('\n')) {
    const parsedLine = parseHeadingLine(line);

    if (!insideSection) {
      if (!parsedLine || parsedLine.heading.toLowerCase() !== heading.toLowerCase()) continue;
      insideSection = true;
      if (parsedLine.rest && !/^none$/i.test(parsedLine.rest)) {
        findings.push(parsedLine.rest.replace(/^\s*[-*]\s*/, '').trim());
      }
      continue;
    }

    if (parsedLine) break;

    const cleaned = line.replace(/^\s*[-*]\s*/, '').trim();
    if (cleaned && !/^none$/i.test(cleaned)) {
      findings.push(cleaned);
    }
  }

  return findings;
}

function parseInlineSection(report, heading) {
  for (const line of report.split('\n')) {
    const parsedLine = parseHeadingLine(line);
    if (parsedLine && parsedLine.heading.toLowerCase() === heading.toLowerCase()) {
      return parsedLine.rest;
    }
  }

  return '';
}

export function parseReviewReport(reviewReport, rounds) {
  const verdict = parseInlineSection(reviewReport, 'Verdict').match(/APPROVE|REJECT/i)?.[0]?.toUpperCase() || 'REJECT';

  const critical = parseFindingsSection(reviewReport, 'Critical Findings');
  const warnings = parseFindingsSection(reviewReport, 'Warning Findings');

  const summary = parseInlineSection(reviewReport, 'Summary') || `PR review completed in ${rounds} round(s)`;

  return { verdict, critical, warnings, summary };
}
