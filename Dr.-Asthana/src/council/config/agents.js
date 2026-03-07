/**
 * Council agent configuration resolver.
 *
 * Builds the debate agent list from council role config.
 * agent-0 is proposer, agent-1..N are critics.
 */
export function resolveAgents(councilConfig) {
  const proposer = councilConfig?.proposer || { provider: 'claude', model: 'sonnet', maxTurns: 15, timeoutMinutes: 10 };
  const critics = Array.isArray(councilConfig?.critics) && councilConfig.critics.length > 0
    ? councilConfig.critics
    : [proposer];
  return [proposer, ...critics];
}
