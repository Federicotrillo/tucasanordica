import nodemailer from "nodemailer";

const required = ["APP_URL", "MAILER_API_KEY", "SMTP_PASSWORD"];
for (const name of required) {
  if (!process.env[name]) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
}

const APP_URL = process.env.APP_URL.replace(/\/+$/, "");
const MAILER_API_KEY = process.env.MAILER_API_KEY;
const SMTP_PASSWORD = process.env.SMTP_PASSWORD;
const QUEUE_URL = `${APP_URL}/api/internal/email-queue`;

function scrub(value) {
  let safe = String(value ?? "Unknown error");
  for (const secret of [MAILER_API_KEY, SMTP_PASSWORD]) {
    if (secret) safe = safe.split(secret).join("[redacted]");
  }
  return safe
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, "Bearer [redacted]")
    .slice(0, 800);
}

async function queueRequest(method, body) {
  const response = await fetch(QUEUE_URL, {
    method,
    headers: {
      Authorization: `Bearer ${MAILER_API_KEY}`,
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`Queue API ${response.status}: ${scrub(raw)}`);
  }
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("Queue API returned invalid JSON");
  }
}

function extractMessages(payload) {
  if (Array.isArray(payload)) return payload;
  for (const key of ["messages", "emails", "items", "queue"]) {
    if (Array.isArray(payload?.[key])) return payload[key];
  }
  return [];
}

function messageValue(message, ...keys) {
  for (const key of keys) {
    if (message?.[key] !== undefined && message?.[key] !== null) return message[key];
  }
  return undefined;
}

const payload = await queueRequest("GET");
const messages = extractMessages(payload);

if (messages.length === 0) {
  console.log("No pending transactional emails.");
  process.exit(0);
}

const transporter = nodemailer.createTransport({
  host: "authsmtp.securemail.pro",
  port: 465,
  secure: true,
  auth: {
    user: "info@tucasanordica.es",
    pass: SMTP_PASSWORD,
  },
  connectionTimeout: 20000,
  greetingTimeout: 20000,
  socketTimeout: 30000,
});

await transporter.verify();
console.log(`SMTP connection verified. Processing ${messages.length} message(s).`);

let failures = 0;

for (const message of messages) {
  const id = messageValue(message, "id", "outboxId", "queueId");
  const recipient = messageValue(message, "recipient", "to");
  const subject = messageValue(message, "subject");
  const html = messageValue(message, "htmlBody", "html");
  const text = messageValue(message, "textBody", "text");

  if (!id || !recipient || !subject || (!html && !text)) {
    failures += 1;
    const errorMessage = "Queued message is missing required fields";
    if (id) {
      try {
        await queueRequest("POST", { id, status: "FAILED", errorMessage });
      } catch (reportError) {
        console.error(`Unable to report invalid queue item: ${scrub(reportError)}`);
      }
    }
    continue;
  }

  try {
    await transporter.sendMail({
      from: "Tu Casa Nórdica <info@tucasanordica.es>",
      replyTo: "info@tucasanordica.es",
      to: recipient,
      subject,
      text,
      html,
    });
    await queueRequest("POST", { id, status: "SENT" });
    console.log(`Email ${id} sent successfully.`);
  } catch (error) {
    failures += 1;
    const errorMessage = scrub(error);
    console.error(`Email ${id} failed: ${errorMessage}`);
    try {
      await queueRequest("POST", { id, status: "FAILED", errorMessage });
    } catch (reportError) {
      console.error(`Unable to report failure for ${id}: ${scrub(reportError)}`);
    }
  }
}

transporter.close();

if (failures > 0) {
  process.exitCode = 1;
}
