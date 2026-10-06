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

export interface SmtpUserFacingError {
  summary: string;
  details?: string;
  hint?: string;
  category:
    | "microsoft_365_smtp_auth_disabled"
    | "microsoft_365_legacy_tls"
    | "gmail_app_password_required"
    | "gmail_less_secure_blocked"
    | "auth_credentials_wrong"
    | "connection_refused_or_timeout"
    | "ssl_mismatch"
    | "sender_address_rejected"
    | "recipient_rejected"
    | "dns_host_contains_port"
    | "dns_unknown_host"
    | "transip_spf_unverifiable"
    | "transip_internal_server_error"
    | "rate_limit_throttled"
    | "mailbox_full_quota"
    | "content_spam_rejected"
    | "generic";
}

const HOST_SUGGESTIONS: Array<{ pattern: RegExp; suggestion: string; note?: string }> = [
  {
    pattern: /(^|\.|\/)vps\.transip\.email$/i,
    suggestion: "smtp.transip.email",
    note: "Transip's SMTP-host is doorgaans smtp.transip.email (of mail.transip.email).",
  },
  {
    pattern: /(^|\.|\/)pop\.transip\.email$/i,
    suggestion: "smtp.transip.email",
    note: "POP is voor inkomende post; voor versturen (uitgaand) gebruik je smtp.transip.email.",
  },
  {
    pattern: /(^|\.|\/)imap\.transip\.email$/i,
    suggestion: "smtp.transip.email",
    note: "IMAP is voor inkomende post; voor versturen (uitgaand) gebruik je smtp.transip.email.",
  },
  {
    pattern: /(^|\.|\/)outlook\.office365\.com$/i,
    suggestion: "smtp.office365.com",
    note: "Microsoft 365 gebruikt smtp.office365.com als SMTP-host (STARTTLS, poort 587).",
  },
  {
    pattern: /office365\.nl$|office365\.com$/i,
    suggestion: "smtp.office365.com",
    note: "Gebruik het juiste uitgaand adres voor Microsoft 365: smtp.office365.com (poort 587).",
  },
  {
    pattern: /smtp\.live\.com$/i,
    suggestion: "smtp.office365.com",
    note: "smtp.live.com is verouderd; moderne Microsoft/Exchange tenants gebruiken smtp.office365.com.",
  },
];

export function suggestSmtpHost(rawHost: string | undefined | null): {
  suggestion?: string;
  note?: string;
  detectedPortInHost?: number;
  cleanedHost?: string;
} {
  const h = (rawHost ?? "").trim();
  if (!h) return {};
  const withPort = /^([^:/\s]+):(\d{1,5})(?:\/.*)?$/.exec(h);
  const cleaned = withPort ? withPort[1] : h;
  const detectedPortInHost = withPort ? Number(withPort[2]) : undefined;
  for (const rule of HOST_SUGGESTIONS) {
    if (rule.pattern.test(cleaned)) {
      return {
        suggestion: rule.suggestion,
        note: rule.note,
        detectedPortInHost,
        cleanedHost: cleaned,
      };
    }
  }
  if (detectedPortInHost) {
    return { detectedPortInHost, cleanedHost: cleaned };
  }
  return { cleanedHost: cleaned };
}

export function formatSmtpErrorForUser(
  rawError: string | undefined | null,
  ctx?: { host?: string; from?: string; to?: string }
): SmtpUserFacingError {
  const raw = (rawError ?? "").trim();
  const lowered = raw.toLowerCase();
  const rawHost = ctx?.host ?? "";
  const host = rawHost.toLowerCase();
  const isMicrosoft =
    /outlook\.com|office365|exchange|smtp\.office365|outlook\.office365/.test(
      host
    ) || /outlook\.com|office365|EURP|AS4P|NAMPRD|outlook\.office365/.test(lowered);
  const isGmail =
    /smtp\.gmail\.com/.test(host) || /gmail\.com|google smtp|gsmtp/.test(lowered);
  const suggestions = suggestSmtpHost(rawHost);

  if (
    isMicrosoft &&
    (/smtpclientauthentication is disabled/.test(lowered) ||
      /5\.7\.139/.test(raw) ||
      /smtp_auth_disabled/.test(lowered))
  ) {
    return {
      category: "microsoft_365_smtp_auth_disabled",
      summary:
        "Microsoft 365 staat wachtwoord-login (SMTP AUTH) op tenant-niveau standaard uit.",
      details:
        "Exchange Online blokkeert standaard SmtpClientAuthentication voor alle postvakken. Dit is een Microsoft 365-beveiligingsinstelling, geen fout in Nexus.",
      hint:
        "Oplossing (kies er één):\n" +
        "1. [Voorkeur] Schakel SMTP AUTH in voor alleen het specifieke verzendpostvak via Exchange Admin Center → Recipients → Mailbox → [kies postvak] → Manage email apps → vink 'Authenticated SMTP' aan. Wacht vervolgens 15-30 minuten.\n" +
        "2. [Volledige tenant] Gebruik PowerShell: Set-TransportConfig -SmtpClientAuthenticationDisabled $false.\n" +
        "3. [Modern/Aanbevolen] Stap over op SMTP via OAuth2 (inplannen voor latere Nexus-release) of gebruik een externe SMTP-dienst (SendGrid, Mailgun, Postmark, etc.)",
    };
  }

  if (
    isMicrosoft &&
    (/legacy tls|starttls is not supported|tls|ssl/.test(lowered) &&
      /5\.7\./.test(raw))
  ) {
    return {
      category: "microsoft_365_legacy_tls",
      summary: "Microsoft 365 weigert de verbinding wegens TLS/SSL instellingen.",
      details:
        "Exchange Online vereist STARTTLS op poort 587 (geen impliciete SSL op poort 465).",
      hint:
        "Stel in Systeem → Instellingen → Notificaties in:\n" +
        "  SMTP-host: smtp.office365.com\n" +
        "  Poort: 587\n" +
        "  SSL/TLS vink: UIT (STARTTLS is vereist)\n" +
        "  Gebruiker: het volledige e-mailadres van het verzendpostvak.",
    };
  }

  if (
    isGmail &&
    (/application-specific password|app password|less secure app|allow less secure/.test(
      lowered
    ) ||
      /535 5\.7\..*invalid/.test(raw) ||
      /username and password not accepted/.test(lowered))
  ) {
    return {
      category: "gmail_app_password_required",
      summary:
        "Gmail vereist een 'App Password' wanneer 2-Staps Verificatie (2FA) aan staat.",
      details:
        "Gmail blokkeert standaard directe wachtwoord-login van externe apps wanneer 2FA is ingeschakeld.",
      hint:
        "Stappen:\n" +
        "1. Zorg dat 2-Staps Verificatie aanstaat voor het Gmail-account.\n" +
        "2. Ga naar myaccount.google.com → Beveiliging → App-wachtwoorden.\n" +
        "3. Maak een nieuw app-wachtwoord (kies 'Andere' en geef het een naam zoals 'Nexus SMTP').\n" +
        "4. Kopieer dat 16-cijferige wachtwoord (zonder spaties) naar het veld 'Wachtwoord' in de SMTP-instellingen van Nexus.\n" +
        "5. Gebruik poort 587 met STARTTLS (SSL/TLS vink UIT).",
    };
  }

  if (
    isGmail &&
    (/534 5\.7\.14/.test(raw) || /please log in with your web browser/.test(lowered))
  ) {
    return {
      category: "gmail_less_secure_blocked",
      summary: "Gmail blokkeert deze SMTP-login als 'onveilige app'.",
      details:
        "Google beschouwt inloggen via basale SMTP-auth als onveilig. Activeer App Password (zie hint) of schakel 2FA in.",
      hint:
        "1. Activeer 2-Staps Verificatie op het Gmail-account.\n" +
        "2. Genereer daarna een App Password en gebruik dat in plaats van het normale wachtwoord.",
    };
  }

  if (
    /authentication failed|invalid credentials|login failed|535 5\.7\.[0-9]/.test(
      lowered
    ) &&
    /username|password|credential/.test(lowered)
  ) {
    return {
      category: "auth_credentials_wrong",
      summary: "SMTP authenticatie mislukt: gebruikersnaam of wachtwoord onjuist.",
      details: `Server antwoordde: ${raw}`,
      hint:
        "Controleer in Systeem → Instellingen → Notificaties:\n" +
        "• Gebruikersnaam (vaak het volledige e-mailadres)\n" +
        "• Wachtwoord\n" +
        "• Of het postvak bestaat en niet is vergrendeld.",
    };
  }

  if (
    suggestions.detectedPortInHost &&
    (lowered.includes("ebadname") ||
      lowered.includes("enotfound") ||
      lowered.includes("querya") ||
      lowered.includes("dns") ||
      lowered.includes("getaddrinfo") ||
      lowered.includes("host not found"))
  ) {
    const extra = suggestions.suggestion
      ? `\nLet op: de hostnaam zelf lijkt ook niet juist. Wilt u in plaats van '${rawHost}' misschien '${suggestions.suggestion}' gebruiken?${
          suggestions.note ? `\n(${suggestions.note})` : ""
        }`
      : "";
    return {
      category: "dns_host_contains_port",
      summary:
        "Het hostveld bevat een poort (host:poort notatie), waardoor DNS de naam niet kan oplossen.",
      details: `Server/DNS antwoordde: ${raw}`,
      hint:
        `Correctie:\n` +
        `• Vul in het veld 'SMTP-host' alleen de hostnaam in: '${suggestions.cleanedHost || "hostnaam"}'\n` +
        `• Vul in het aparte veld 'SMTP-poort' het getal in: ${suggestions.detectedPortInHost} (vrijwel altijd 587 of 465)\n` +
        `• Sla de instellingen opnieuw op en probeer de test daarna nogmaals.${extra}`,
    };
  }

  if (
    /ebadname|enotfound|getaddrinfo|querya|host not found|nxdomain|nodata/.test(
      lowered
    )
  ) {
    const suggestionHint = suggestions.suggestion
      ? `\nHostnaam suggestie:\n` +
        `  In plaats van '${rawHost}' wilt u misschien '${suggestions.suggestion}' proberen.${
          suggestions.note ? `\n  ${suggestions.note}` : ""
        }`
      : "";
    return {
      category: "dns_unknown_host",
      summary: "SMTP-hostnaam is niet vindbaar in DNS (onbekende host).",
      details: `DNS antwoordde: ${raw}`,
      hint:
        `Controleer / corrigeer:\n` +
        `• Het veld 'SMTP-host' (geen poort, geen https://, geen paden). Veelvoorkomende juiste waarden:\n` +
        `    Microsoft 365: smtp.office365.com (poort 587)\n` +
        `    Gmail:       smtp.gmail.com     (poort 587)\n` +
        `    Transip:     smtp.transip.email (poort 587)\n` +
        `• Of de Nexus-server internettoegang heeft (firewall, DNS-resolver).${suggestionHint}`,
    };
  }

  if (
    /connection refused|econnrefused|etimedout|no route|connect timed out/.test(
      lowered
    )
  ) {
    return {
      category: "connection_refused_or_timeout",
      summary: "Kan geen verbinding maken met de SMTP-server (time-out of geweigerd).",
      details: `Server antwoordde: ${raw || "(geen detail)"}`,
      hint:
        "Controleer:\n" +
        "• SMTP-host en poort (veel voorkomend: 587 voor STARTTLS, 465 voor SSL)\n" +
        "• Firewall op de Nexus-server (uitgaand TCP toegestaan op de gekozen poort)\n" +
        "• Of de SMTP-dienst bereikbaar is buiten Nexus (bijv. met openssl s_client -connect host:poort -starttls smtp).",
    };
  }

  if (
    /ssl|tls|handshake|certificate|unknown protocol|secure|1399|1408/.test(
      lowered
    ) &&
    /error|fail|could not/.test(lowered)
  ) {
    return {
      category: "ssl_mismatch",
      summary: "Verbinding mislukt: SSL/TLS-instelling of poort klopt niet.",
      details: `Server antwoordde: ${raw}`,
      hint:
        "Probeer de inverse instelling van 'SSL/TLS (poort 465)':\n" +
        "• Poort 587 → vink 'SSL/TLS' UIT (STARTTLS)\n" +
        "• Poort 465 → vink 'SSL/Tls' AAN (impliciete SSL)",
    };
  }

  if (
    /421 4\.7\.0.*spf records.*could not be verified/.test(lowered) ||
    (/transip/.test(host) && /spf.*could not be verified/.test(lowered))
  ) {
    const fromMatch = /SPF records for ([a-z0-9.-]+) could not/i.exec(raw);
    const domain = fromMatch ? fromMatch[1] : ctx?.from || "het afzender-domein";
    return {
      category: "transip_spf_unverifiable",
      summary:
        "Transip's SMTP-weigerde de verbinding omdat hij de SPF-records van het afzender-domein niet kon verifiëren.",
      details: `Server antwoordde: ${raw}`,
      hint:
        `Let op: dit is (tijdelijk) probleem BINNEN Transip mailplatform, niet per se in jouw SPF-configuratie. Transip doet een uitgaande DNS-SPF-check die soms faalt op hun eigen DNS.\n` +
        `Direct te controleren:\n` +
        `1. Controleer of de SPF-record van domein '${domain}' valide is: kijk in de DNS naar een TXT-record die begint met 'v=spf1'. Minimaal aanbevolen:\n` +
        `     v=spf1 include:spf.transip.email -all   (volgt de aanbeveling van Transip zelf)\n` +
        `2. Als de SPF al correct staat: wacht 5-15 minuten en probeer de test opnieuw. Dit is vaak een tijdelijke DNS-storing bij Transip.\n` +
        `3. Soms helpt het om het From-adres te wijzigen naar een adres op hetzelfde domein als de SMTP (bv. noreply@${domain}).\n` +
        `4. Als het probleem aanhoudt: gebruik een hoger retry-tempo (wacht 30 sec) of overweeg externe diensten zoals SendGrid, Mailgun of Postmark.\n` +
        `Zie ook: https://www.transip.nl/knowledgebase/350-welke-spf-record-gebruik-ik-voor-het-versturen-van-mail-eigen-domein/`,
    };
  }

  if (
    /transip/.test(host) &&
    (/421 4\.7\.0/.test(raw) || /an internal server error/.test(lowered))
  ) {
    return {
      category: "transip_internal_server_error",
      summary:
        "Transip's SMTP-server gaf een interne fout terug (421). Dit is doorgaans een tijdelijk probleem op hun platform.",
      details: `Server antwoordde: ${raw}`,
      hint:
        `Dit is bijna nooit een fout in Nexus of jouw instellingen. Stappen:\n` +
        `1. Wacht 5-10 minuten en probeer opnieuw (meestal is het een piek of tijdelijke DNS-storing bij Transip).\n` +
        `2. Controleer de Transip statuspagina: https://www.transipstatus.nl of Transip Twitter/X.\n` +
        `3. Controleer of de From-headers overeenkomen: Gebruikersnaam en 'Afzender e-mail' zijn bij voorkeur identiek.\n` +
        `4. Bij aanhoudende problemen: open een ticket bij Transip met de error-ID zoals ${
          /\([A-Za-z0-9]+\)\s*$/.exec(raw)?.[0] || "(geen ID in dit antwoord)"
        }.`,
    };
  }

  if (
    /too many emails|rate limit|daily limit|message rate|4\.7\.1.*too many|450.*rate|451.*rate|452.*insufficient|550.*rate|too many messages/.test(
      lowered
    )
  ) {
    return {
      category: "rate_limit_throttled",
      summary: "SMTP-server weigert de verbinding wegens rate-limiting (teveel berichten).",
      details: `Server antwoordde: ${raw}`,
      hint:
        `Dit is een anti-spam-maatregel. Oplossingen:\n` +
        `1. Wacht enige tijd en probeer opnieuw (vaak per uur/dag limiet).\n` +
        `2. Verifieer of Nexus niet onterecht continu testberichten verstuurt.\n` +
        `3. Overleg met je e-mailprovider of de limiet verhoogd kan worden.`,
    };
  }

  if (
    /mailbox full|quota exceeded|over quota|storage quota|disk quota|insufficient system storage|552/.test(
      lowered
    )
  ) {
    return {
      category: "mailbox_full_quota",
      summary:
        "De mailbox van de ontvanger (of verzender) is vol of heeft zijn quota bereikt.",
      details: `Server antwoordde: ${raw}`,
      hint:
        `Controleer:\n` +
        `• De ontvangende mailbox: is deze vol?\n` +
        `• Ook de VERZENDENDE mailbox (transip postvak) — veel SMTP-diensten blokkeren verzending ook als jouw outbox vol staat.`,
    };
  }

  if (
    /spam|spamhaus|zen\.spamhaus|barracuda|uribl|surbl|content rejected|550.*content|message rejected as spam|554 5\.7\.1/.test(
      lowered
    )
  ) {
    return {
      category: "content_spam_rejected",
      summary:
        "De inhoud van het bericht of jouw IP/domein wordt als spam beschouwd.",
      details: `Server antwoordde: ${raw}`,
      hint:
        `Mogelijke oorzaken:\n` +
        `1. Jouw verzendende IP of domein staat op een zwarte lijst (check op https://mxtoolbox.com/blacklists.aspx).\n` +
        `2. SPF/DKIM/DMARC-records voor het From-domein ontbreken of staan verkeerd.\n` +
        `3. De onderwerpregel of inhoud bevat woorden die spamfilters triggeren.`,
    };
  }

  if (
    /from.*address not accepted|sender not allowed|550 5\.7\.1.*from/.test(
      lowered
    ) ||
    /550.*spf|550.*dkim|envelope from/.test(lowered)
  ) {
    return {
      category: "sender_address_rejected",
      summary:
        "De afzender ('From'-adres) wordt niet geaccepteerd door de SMTP-server.",
      details: `Server antwoordde: ${raw}`,
      hint:
        "Controleer:\n" +
        "• Het 'Afzender e-mail' veld (moet hetzelfde domein hebben als SMTP, of expliciet toegestaan)\n" +
        "• SPF/DKIM/Sender-ID records in de DNS van het afzender-domein.\n" +
        "Gebruikersnaam en From-adres zijn vaak hetzelfde adres.",
    };
  }

  if (
    /550 5\.1\.[0-9]|recipient not found|mailbox unavailable|user unknown/.test(
      lowered
    )
  ) {
    return {
      category: "recipient_rejected",
      summary: "Het ontvangstadres wordt geweigerd door de SMTP-server.",
      details: `Server antwoordde: ${raw}`,
      hint:
        "Controleer of het e-mailadres van de ontvanger juist is en bestaat. Zit er een tikfout in?",
    };
  }

  if (raw) {
    return {
      category: "generic",
      summary: "SMTP-server weigert de verbinding.",
      details: `Server antwoordde: ${raw}`,
      hint:
        "Controleer host, poort, SSL/TLS vink, gebruikersnaam en wachtwoord. Overleg zonodig met uw e-mailprovider.",
    };
  }

  return {
    category: "generic",
    summary: "SMTP-server weigert de verbinding (onbekend antwoord).",
    hint:
      "Controleer host, poort, SSL/TLS vink, gebruikersnaam en wachtwoord.",
  };
}

export function renderSmtpErrorPlain(
  info: SmtpUserFacingError
): string {
  const parts: string[] = [info.summary];
  if (info.details) parts.push(info.details);
  if (info.hint) parts.push(`Hoe op te lossen:\n${info.hint}`);
  return parts.join("\n\n");
}
