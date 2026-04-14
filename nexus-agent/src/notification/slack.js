/**
 * Slack integration.
 * Uses @slack/web-api WebClient. Builds Block Kit messages.
 */

import { log, warn, err } from '../utils/logger.js';

/**
 * Send a Slack DM using Block Kit.
 *
 * @param {object} config - Full config object
 * @param {object[]} blocks - Block Kit blocks array
 * @param {string} fallbackText - Fallback text for notifications
 */
export async function sendDM(config, blocks, fallbackText) {
  if (!config.slack.botToken || !config.slack.userId) {
    warn('Slack not configured, skipping notification');
    return;
  }

  try {
    const { WebClient } = await import('@slack/web-api');
    const client = new WebClient(config.slack.botToken);

    const conversation = await client.conversations.open({ users: config.slack.userId });
    const dmChannelId = conversation.channel.id;

    try {
      await client.chat.postMessage({
        channel: dmChannelId,
        text: fallbackText,
        blocks,
      });
      log('Slack notification sent');
    } catch (blockError) {
      // If Block Kit is invalid, retry with plain text only
      if (blockError.data?.error === 'invalid_blocks' || blockError.message?.includes('invalid_blocks')) {
        warn(`Slack invalid_blocks error — retrying with plain text fallback`);
        await client.chat.postMessage({
          channel: dmChannelId,
          text: fallbackText,
        });
        log('Slack notification sent (plain text fallback)');
      } else {
        throw blockError;
      }
    }
  } catch (error) {
    err(`Failed to send Slack notification: ${error.message}`);
  }
}
