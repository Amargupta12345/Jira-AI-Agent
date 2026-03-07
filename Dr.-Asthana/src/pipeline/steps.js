/**
 * Step definitions.
 * Exports an ordered array of step objects with names and descriptions.
 */

export const STEPS = {
  FETCH_TICKET: 'FETCH_TICKET',
  VALIDATE_TICKET: 'VALIDATE_TICKET',
  CLONE_REPO: 'CLONE_REPO',
  BUILD_CHEATSHEET: 'BUILD_CHEATSHEET',
  EXECUTE: 'EXECUTE',
  VALIDATE_EXECUTION: 'VALIDATE_EXECUTION',
  SHIP: 'SHIP',
  NOTIFY: 'NOTIFY',
};

export const STEP_ORDER = [
  { name: STEPS.FETCH_TICKET, number: 1, description: 'Fetch and parse ticket' },
  { name: STEPS.VALIDATE_TICKET, number: 2, description: 'Validate ticket fields' },
  { name: STEPS.CLONE_REPO, number: 3, description: 'Clone repo and create feature branch' },
  { name: STEPS.BUILD_CHEATSHEET, number: 4, description: 'Build cheatsheet via debate' },
  { name: STEPS.EXECUTE, number: 5, description: 'Execute cheatsheet on clone' },
  { name: STEPS.VALIDATE_EXECUTION, number: 6, description: 'Validate execution result' },
  { name: STEPS.SHIP, number: 7, description: 'Commit, push, create PR' },
  { name: STEPS.NOTIFY, number: 8, description: 'Notify JIRA and Slack' },
];

/**
 * Get step number from step name.
 */
export function getStepNumber(stepName) {
  const step = STEP_ORDER.find(s => s.name === stepName);
  return step ? step.number : 0;
}
