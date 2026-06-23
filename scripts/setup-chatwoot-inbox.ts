/**
 * Helper: create a Chatwoot API inbox for VK and print its id.
 *
 * Usage:
 *   INBOX_NAME="VK" INBOX_WEBHOOK_URL="https://gw.example.com/chatwoot/webhook" \
 *     npm run setup:inbox
 *
 * Or positionally:
 *   npm run setup:inbox -- "VK" "https://gw.example.com/chatwoot/webhook"
 *
 * Requires CHATWOOT_URL, CHATWOOT_ACCOUNT_ID and CHATWOOT_TOKEN in the env.
 */
import { loadConfig } from '../src/config.js';

interface CreatedInbox {
  id?: number;
  name?: string;
  inbox_identifier?: string;
}

async function main(): Promise<void> {
  const config = loadConfig();
  const name = process.env.INBOX_NAME ?? process.argv[2] ?? 'VK';
  const webhookUrl =
    process.env.INBOX_WEBHOOK_URL ??
    process.argv[3] ??
    (config.publicUrl ? `${config.publicUrl}/chatwoot/webhook` : '');

  const url = `${config.chatwootUrl}/api/v1/accounts/${config.chatwootAccountId}/inboxes`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', api_access_token: config.chatwootToken },
    body: JSON.stringify({ name, channel: { type: 'api', webhook_url: webhookUrl } }),
  });

  if (!res.ok) {
    console.error(`Failed to create inbox: ${res.status} ${await res.text()}`);
    process.exit(1);
  }

  const inbox = (await res.json()) as CreatedInbox;
  console.log('Inbox created:');
  console.log(JSON.stringify(inbox, null, 2));
  console.log(`\nNext: set CHATWOOT_INBOX_ID=${inbox.id} in your .env`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
