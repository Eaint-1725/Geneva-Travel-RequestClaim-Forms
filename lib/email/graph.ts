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

// --- Multi-attachment send (Travel Claim) -----------------------------------------------
//
// sendGraphEmail above is untouched and stays the request's exact code path. Travel Claim
// needs to attach the claim Excel plus several uploaded documents, and Graph's one-shot
// sendMail only reliably takes attachments under ~3MB inline as base64 in the same request --
// anything larger needs its own upload session, which requires an existing message. So this
// creates a draft message, attaches each file (small ones in one call, large ones via a
// chunked upload session), then sends the draft. New exports only -- nothing above changes.

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";
const SIMPLE_ATTACHMENT_MAX_BYTES = 3 * 1024 * 1024; // Graph: attachments >= this need an upload session
const UPLOAD_CHUNK_BYTES = 4 * 1024 * 1024; // Graph recommends keeping each PUT chunk <= 4MB

export interface GraphEmailAttachmentBuffer {
  name: string;
  contentType: string;
  content: Buffer;
}

export interface SendGraphEmailWithAttachmentsParams {
  subject: string;
  bodyText: string;
  to: string;
  replyTo: string;
  attachments: GraphEmailAttachmentBuffer[];
}

async function createDraftMessage(
  accessToken: string,
  sender: string,
  params: Pick<SendGraphEmailWithAttachmentsParams, "subject" | "bodyText" | "to" | "replyTo">,
): Promise<string> {
  const res = await fetch(`${GRAPH_BASE}/users/${encodeURIComponent(sender)}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      subject: params.subject,
      body: { contentType: "Text", content: params.bodyText },
      toRecipients: [{ emailAddress: { address: params.to } }],
      replyTo: [{ emailAddress: { address: params.replyTo } }],
    }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  console.log(`[graph:createDraft] status=${res.status} ok=${res.ok}`);
  if (!res.ok) throw new Error(`Graph create draft failed (${res.status}): ${await res.text()}`);
  const data = (await res.json()) as { id: string };
  return data.id;
}

async function attachSmallFile(
  accessToken: string,
  sender: string,
  messageId: string,
  file: GraphEmailAttachmentBuffer,
): Promise<void> {
  const res = await fetch(
    `${GRAPH_BASE}/users/${encodeURIComponent(sender)}/messages/${encodeURIComponent(messageId)}/attachments`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        "@odata.type": "#microsoft.graph.fileAttachment",
        name: file.name,
        contentType: file.contentType,
        contentBytes: file.content.toString("base64"),
      }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    },
  );
  console.log(`[graph:attachSmall] name=${file.name} status=${res.status} ok=${res.ok}`);
  if (!res.ok) throw new Error(`Graph attach "${file.name}" failed (${res.status}): ${await res.text()}`);
}

async function attachLargeFile(
  accessToken: string,
  sender: string,
  messageId: string,
  file: GraphEmailAttachmentBuffer,
): Promise<void> {
  const sessionRes = await fetch(
    `${GRAPH_BASE}/users/${encodeURIComponent(sender)}/messages/${encodeURIComponent(messageId)}/attachments/createUploadSession`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        AttachmentItem: {
          attachmentType: "file",
          name: file.name,
          contentType: file.contentType,
          size: file.content.byteLength,
        },
      }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    },
  );
  console.log(`[graph:uploadSession] name=${file.name} status=${sessionRes.status} ok=${sessionRes.ok}`);
  if (!sessionRes.ok) {
    throw new Error(`Graph create upload session for "${file.name}" failed (${sessionRes.status}): ${await sessionRes.text()}`);
  }
  const { uploadUrl } = (await sessionRes.json()) as { uploadUrl: string };

  const total = file.content.byteLength;
  for (let start = 0; start < total; start += UPLOAD_CHUNK_BYTES) {
    const end = Math.min(start + UPLOAD_CHUNK_BYTES, total);
    const chunk = file.content.subarray(start, end);
    // Buffer is typed as Uint8Array<ArrayBufferLike>; BodyInit wants Uint8Array<ArrayBuffer>.
    // fetch accepts a plain ArrayBuffer directly, sidestepping the mismatch.
    const chunkBuffer = chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength) as ArrayBuffer;
    // uploadUrl is pre-authenticated (Graph docs: don't send an Authorization header here).
    const putRes = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Length": String(chunk.byteLength),
        "Content-Range": `bytes ${start}-${end - 1}/${total}`,
      },
      body: chunkBuffer,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!putRes.ok) {
      throw new Error(`Graph upload chunk for "${file.name}" (bytes ${start}-${end - 1}) failed (${putRes.status}): ${await putRes.text()}`);
    }
  }
}

async function sendDraftMessage(accessToken: string, sender: string, messageId: string): Promise<void> {
  const res = await fetch(
    `${GRAPH_BASE}/users/${encodeURIComponent(sender)}/messages/${encodeURIComponent(messageId)}/send`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    },
  );
  // Same discipline as sendGraphEmail: /send returns 202 with an empty body on success --
  // status is the only signal, never parse a body on this path.
  console.log(`[graph:send] status=${res.status} ok=${res.ok}`);
  if (!res.ok) throw new Error(`Graph send failed (${res.status}): ${await res.text()}`);
}

export async function sendGraphEmailWithAttachments(params: SendGraphEmailWithAttachmentsParams): Promise<void> {
  const sender = requireEnv("GRAPH_SENDER");
  const accessToken = await getGraphAccessToken();

  const messageId = await createDraftMessage(accessToken, sender, params);

  for (const file of params.attachments) {
    if (file.content.byteLength < SIMPLE_ATTACHMENT_MAX_BYTES) {
      await attachSmallFile(accessToken, sender, messageId, file);
    } else {
      await attachLargeFile(accessToken, sender, messageId, file);
    }
  }

  await sendDraftMessage(accessToken, sender, messageId);
}
