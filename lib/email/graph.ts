// Sends mail through Microsoft Graph (app-only, client-credentials flow) as the HR mailbox.
// No SMTP and no third-party email API -- the app registration + client secret carry the auth.

const FETCH_TIMEOUT_MS = 10_000;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

interface GraphTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

async function getGraphAccessToken(): Promise<string> {
  const tenantId = requireEnv("GRAPH_TENANT_ID");
  const clientId = requireEnv("GRAPH_CLIENT_ID");
  const clientSecret = requireEnv("GRAPH_CLIENT_SECRET");

  const res = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      scope: "https://graph.microsoft.com/.default",
      grant_type: "client_credentials",
    }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  console.log(`[graph:token] status=${res.status} ok=${res.ok}`);

  if (!res.ok) {
    throw new Error(`Graph token request failed (${res.status}): ${await res.text()}`);
  }

  // Unlike sendMail, the token endpoint always returns a JSON body on 200 -- but guard the
  // parse anyway so a malformed response reads as a clear "token" failure, not a mystery throw.
  let data: GraphTokenResponse;
  try {
    data = (await res.json()) as GraphTokenResponse;
  } catch (e) {
    throw new Error(`Graph token response wasn't valid JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
  return data.access_token;
}

export interface GraphEmailAttachment {
  name: string;
  contentType: string;
  contentBytes: string; // base64
}

export interface SendGraphEmailParams {
  subject: string;
  bodyText: string;
  to: string;
  replyTo: string;
  attachment: GraphEmailAttachment;
}

export async function sendGraphEmail(params: SendGraphEmailParams): Promise<void> {
  const sender = requireEnv("GRAPH_SENDER");
  const accessToken = await getGraphAccessToken();

  const res = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(sender)}/sendMail`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message: {
        subject: params.subject,
        body: { contentType: "Text", content: params.bodyText },
        toRecipients: [{ emailAddress: { address: params.to } }],
        replyTo: [{ emailAddress: { address: params.replyTo } }],
        attachments: [
          {
            "@odata.type": "#microsoft.graph.fileAttachment",
            name: params.attachment.name,
            contentType: params.attachment.contentType,
            contentBytes: params.attachment.contentBytes,
          },
        ],
      },
      saveToSentItems: true,
    }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  // sendMail returns 202 Accepted with an EMPTY body on success -- status is the only signal.
  // Never call res.json()/res.text() here on the success path: reading an empty body is safe,
  // but there is nothing useful in it, and doing so on the error path only is intentional.
  console.log(`[graph:sendMail] status=${res.status} ok=${res.ok}`);

  if (!res.ok) {
    throw new Error(`Graph sendMail failed (${res.status}): ${await res.text()}`);
  }
}
