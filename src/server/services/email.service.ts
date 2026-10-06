import nodemailer, { type Transporter } from "nodemailer";
import { getSmtpSettings } from "./app-setting.service";
import type { SmtpSettings } from "@/server/validators/setting";

const APP_NAME = "Nexus";

let cachedTransporter: Transporter | null = null;
let cachedConfigKey: string | null = null;
let cachedDryRun = false;

function configKey(cfg: SmtpSettings | null): string {
  if (!cfg) return "__dryrun__";
  return [
    cfg.host,
    String(cfg.port),
    cfg.secure ? "s" : "",
    cfg.user ?? "",
    cfg.from,
  ].join("|");
}

async function resolveTransporter(): Promise<{
  transporter: Transporter | null;
  dryRun: boolean;
  from: string;
}> {
  const cfg = await getSmtpSettings();
  const key = configKey(cfg);
  if (cachedTransporter && cachedConfigKey === key && cachedDryRun === !cfg) {
    const from = cfg?.from ?? "noreply@nexus.local";
    return { transporter: cachedTransporter, dryRun: cachedDryRun, from };
  }
  if (cachedTransporter) {
    try {
      cachedTransporter.close();
    } catch {
      /* ignore */
    }
    cachedTransporter = null;
  }
  if (!cfg) {
    cachedTransporter = null;
    cachedConfigKey = key;
    cachedDryRun = true;
    return {
      transporter: null,
      dryRun: true,
      from: process.env.SMTP_FROM?.trim() || "noreply@nexus.local",
    };
  }
  const transporter = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: cfg.user && cfg.password ? { user: cfg.user, pass: cfg.password } : undefined,
    connectionTimeout: 15_000,
    socketTimeout: 30_000,
  });
  cachedTransporter = transporter;
  cachedConfigKey = key;
  cachedDryRun = false;
  return { transporter, dryRun: false, from: cfg.from };
}

export function resetEmailTransportCache(): void {
  if (cachedTransporter) {
    try {
      cachedTransporter.close();
    } catch {
      /* ignore */
    }
  }
  cachedTransporter = null;
  cachedConfigKey = null;
  cachedDryRun = false;
}

export async function verifySmtpConnection(): Promise<{ ok: boolean; error?: string }> {
  try {
    const { transporter, dryRun } = await resolveTransporter();
    if (dryRun || !transporter) {
      return { ok: false, error: "SMTP is niet geconfigureerd." };
    }
    await transporter.verify();
    return { ok: true };
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    return { ok: false, error: err };
  }
}

export interface SimUsageThresholdEmailItem {
  simId: string;
  simName?: string | null;
  iccid?: string | null;
  msisdn?: string | null;
  customerName?: string | null;
  dataUsedBytes: bigint;
  dataLimitBytes: bigint;
  thresholdPercent: number;
  detailUrl: string;
}

export interface SendSimUsageThresholdEmailInput {
  toEmail: string;
  toName: string;
  thresholdPercent: number;
  items: SimUsageThresholdEmailItem[];
  unsubscribeNote?: string;
}

function fmtBytes(bytes: bigint): string {
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  let value = Number(bytes);
  let u = 0;
  while (value >= 1024 && u < units.length - 1) {
    value /= 1024;
    u++;
  }
  return `${value.toFixed(value >= 10 || u === 0 ? 0 : 2)} ${units[u]}`;
}

function fmtPct(num: number): string {
  return `${num.toFixed(0)}%`;
}

function appBaseUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL?.trim() || "http://localhost:3000";
}

function buildUsageThresholdHtml(
  input: SendSimUsageThresholdEmailInput
): string {
  const base = appBaseUrl();
  const rows = input.items
    .map((it) => {
      const used = fmtBytes(it.dataUsedBytes);
      const limit = fmtBytes(it.dataLimitBytes);
      const actual =
        it.dataLimitBytes > 0n
          ? Math.round(
              (Number(it.dataUsedBytes) / Number(it.dataLimitBytes)) * 100
            )
          : 0;
      const label =
        it.simName?.trim() ||
        it.msisdn?.trim() ||
        (it.iccid ? it.iccid.slice(-8) : it.simId);
      const customer = it.customerName ? ` — ${it.customerName}` : "";
      const url = it.detailUrl.startsWith("http")
        ? it.detailUrl
        : `${base}${it.detailUrl}`;
      return `
        <tr>
          <td style="padding:10px 12px;border-bottom:1px solid #eee;">
            <a href="${url}" style="font-weight:600;color:#0b63d5;text-decoration:none;">${escapeHtml(label)}</a>${customer}
          </td>
          <td style="padding:10px 12px;border-bottom:1px solid #eee;">${used} / ${limit}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #eee;">${fmtPct(actual)}</td>
        </tr>`;
    })
    .join("");

  const unsubscribe =
    input.unsubscribeNote ||
    `U kunt deze notificaties beheren in uw profiel: <a href="${base}/profile" style="color:#0b63d5;">${base}/profile</a>`;

  return `
<!doctype html>
<html lang="nl">
<head>
<meta charset="utf-8"/>
<title>Datadrempel ${fmtPct(input.thresholdPercent)} bereikt</title>
<style>
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#111;background:#f6f7f9;margin:0;padding:24px;}
.card{background:#fff;border:1px solid #e6e7ea;border-radius:12px;max-width:640px;margin:0 auto;padding:24px;}
.h{font-size:20px;font-weight:700;margin:0 0 8px;}
.lead{color:#444;margin:0 0 20px;}
.badge{display:inline-block;background:#fef3c7;color:#92400e;font-size:12px;font-weight:600;padding:4px 10px;border-radius:999px;margin-right:8px;}
table{width:100%;border-collapse:collapse;margin-top:12px;}
th{background:#f3f4f6;padding:10px 12px;text-align:left;font-size:13px;color:#374151;border-bottom:1px solid #e5e7eb;}
footer{color:#6b7280;font-size:12px;margin-top:20px;padding-top:16px;border-top:1px solid #eee;}
</style>
</head>
<body>
  <div class="card">
    <div>
      <span class="badge">⚠️ Waarschuwing</span>
      <span style="color:#6b7280;font-size:13px;">${APP_NAME}</span>
    </div>
    <h1 class="h">Datadrempel ${fmtPct(input.thresholdPercent)} bereikt — ${input.items.length} SIM kaart${input.items.length === 1 ? "" : "en"}</h1>
    <p class="lead">
      Beste ${escapeHtml(input.toName)},<br/><br/>
      Er ${input.items.length === 1 ? "is 1 SIM-kaart" : `zijn ${input.items.length} SIM-kaarten`} in uw bereik die de drempel van ${fmtPct(input.thresholdPercent)} dataverbruik heeft bereikt.
    </p>
    <table>
      <thead>
        <tr>
          <th>SIM</th>
          <th>Verbruik / Limiet</th>
          <th>%</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>
    <footer>
      ${unsubscribe}
    </footer>
  </div>
</body>
</html>`;
}

function buildUsageThresholdText(input: SendSimUsageThresholdEmailInput): string {
  const base = appBaseUrl();
  const lines: string[] = [];
  lines.push(
    `${APP_NAME}: Datadrempel ${fmtPct(input.thresholdPercent)} bereikt`
  );
  lines.push("");
  lines.push(`Beste ${input.toName},`);
  lines.push("");
  lines.push(
    input.items.length === 1
      ? `Er is 1 SIM-kaart in uw bereik die de drempel van ${fmtPct(input.thresholdPercent)} dataverbruik heeft bereikt:`
      : `Er zijn ${input.items.length} SIM-kaarten in uw bereik die de drempel van ${fmtPct(input.thresholdPercent)} dataverbruik hebben bereikt:`
  );
  lines.push("");
  for (const it of input.items) {
    const used = fmtBytes(it.dataUsedBytes);
    const limit = fmtBytes(it.dataLimitBytes);
    const actual =
      it.dataLimitBytes > 0n
        ? Math.round(
            (Number(it.dataUsedBytes) / Number(it.dataLimitBytes)) * 100
          )
        : 0;
    const label =
      it.simName?.trim() ||
      it.msisdn?.trim() ||
      (it.iccid ? it.iccid.slice(-8) : it.simId);
    const url = it.detailUrl.startsWith("http")
      ? it.detailUrl
      : `${base}${it.detailUrl}`;
    lines.push(`- ${label}${it.customerName ? ` (${it.customerName})` : ""}: ${used} / ${limit} (${fmtPct(actual)})`);
    lines.push(`  ${url}`);
  }
  lines.push("");
  lines.push(
    `U kunt deze notificaties beheren in uw profiel: ${base}/profile`
  );
  return lines.join("\n");
}

function escapeHtml(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export interface EmailSendResult {
  dryRun: boolean;
  accepted: string[];
  rejected: string[];
  messageId?: string;
  error?: string;
}

export async function sendSimUsageThresholdEmail(
  input: SendSimUsageThresholdEmailInput
): Promise<EmailSendResult> {
  const subject =
    input.items.length === 1
      ? `⚠️ SIM datadrempel ${fmtPct(input.thresholdPercent)} bereikt`
      : `⚠️ ${input.items.length} SIM's — datadrempel ${fmtPct(input.thresholdPercent)} bereikt`;
  const html = buildUsageThresholdHtml(input);
  const text = buildUsageThresholdText(input);
  const { transporter, dryRun, from } = await resolveTransporter();

  if (dryRun || !transporter) {
    return {
      dryRun: true,
      accepted: [],
      rejected: [],
      messageId: undefined,
      error:
        "SMTP is niet geconfigureerd — e-mail niet verzonden (dry-run). Pas SMTP-instellingen aan in Systeem → Instellingen → Notificaties.",
    };
  }

  try {
    const info = await transporter.sendMail({
      from: `${APP_NAME} <${from}>`,
      to: input.toEmail,
      subject,
      text,
      html,
    });
    return {
      dryRun: false,
      accepted: (info.accepted as string[]) || [],
      rejected: (info.rejected as string[]) || [],
      messageId: String(info.messageId ?? ""),
    };
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    return {
      dryRun: false,
      accepted: [],
      rejected: [input.toEmail],
      error: err,
    };
  }
}

export async function sendTestEmail(toEmail: string): Promise<EmailSendResult> {
  const subject = `${APP_NAME}: Test e-mail`;
  const base = appBaseUrl();
  const html = `
<!doctype html><html lang="nl"><head><meta charset="utf-8"/><title>Test e-mail</title></head>
<body style="font-family:sans-serif;padding:24px;">
  <div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e6e7ea;border-radius:12px;padding:24px;">
    <h2 style="margin:0 0 12px;">Test e-mail werkt ✅</h2>
    <p style="color:#444;">Als u deze e-mail ontvangt is de SMTP-configuratie van ${APP_NAME} correct geconfigureerd.</p>
    <p style="color:#6b7280;font-size:13px;">${base}</p>
  </div>
</body></html>`;
  const text = `${subject}\n\nAls u deze e-mail ontvangt is de SMTP-configuratie van ${APP_NAME} correct.\n${base}`;

  const { transporter, dryRun, from } = await resolveTransporter();
  if (dryRun || !transporter) {
    return {
      dryRun: true,
      accepted: [],
      rejected: [],
      error:
        "SMTP is niet geconfigureerd — test e-mail niet verzonden. Stel SMTP-instellingen in.",
    };
  }
  try {
    const info = await transporter.sendMail({
      from: `${APP_NAME} <${from}>`,
      to: toEmail,
      subject,
      text,
      html,
    });
    return {
      dryRun: false,
      accepted: (info.accepted as string[]) || [],
      rejected: (info.rejected as string[]) || [],
      messageId: String(info.messageId ?? ""),
    };
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    return {
      dryRun: false,
      accepted: [],
      rejected: [toEmail],
      error: err,
    };
  }
}
