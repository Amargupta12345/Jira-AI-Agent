/**
 * PR review output parsing helpers.
 */

function parseFindingsSection(report, heading) {
  const knownHeadings = ['Verdict', 'Critical Findings', 'Warning Findings', 'Summary'];
  const terminators = knownHeadings
    .filter((h) => h.toLowerCase() !== heading.toLowerCase())
    .map((h) => h.replace(/\s+/g, '\\s+'))
    .join('|');

  const pattern = new RegExp(`${heading}\\s*:\\s*([\\s\\S]*?)(?:\\n(?:${terminators})\\s*:|$)`, 'i');
  const match = report.match(pattern);
  if (!match) return [];

  return match[1]
    .split('\n')
    .map((line) => line.replace(/^\s*[-*]\s*/, '').trim())
    .filter((line) => line && !/^none$/i.test(line));
}

export function parseReviewReport(reviewReport, rounds) {
  const verdictMatch = reviewReport.match(/Verdict\s*:\s*(APPROVE|REJECT)/i);
  const verdict = verdictMatch ? verdictMatch[1].toUpperCase() : 'REJECT';

  const critical = parseFindingsSection(reviewReport, 'Critical Findings');
  const warnings = parseFindingsSection(reviewReport, 'Warning Findings');

  const summaryMatch = reviewReport.match(/Summary\s*:\s*(.*)/i);
  const summary = summaryMatch?.[1]?.trim() || `PR review completed in ${rounds} round(s)`;

  return { verdict, critical, warnings, summary };
}
