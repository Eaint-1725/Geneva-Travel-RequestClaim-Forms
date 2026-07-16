// Sends mail through Microsoft Graph (app-only, client-credentials flow) as the HR mailbox.
// No SMTP and no third-party email API -- the app registration + client secret carry the auth.

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
  });

  if (!res.ok) {
    throw new Error(`Graph token request failed (${res.status}): ${await res.text()}`);
  }

  const data = (await res.json()) as GraphTokenResponse;
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
  });

  if (!res.ok) {
    throw new Error(`Graph sendMail failed (${res.status}): ${await res.text()}`);
  }
}
