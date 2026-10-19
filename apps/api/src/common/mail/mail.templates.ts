export interface MailContent {
  subject: string;
  html: string;
  text: string;
}

export interface DailyModerationReport {
  date: string;
  newReports: number;
  resolvedReports: number;
  bannedUsers: number;
  suspendedUsers: number;
  pendingReports: number;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function layout(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="fr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
  </head>
  <body style="margin:0;padding:0;background:#f4f4f7;font-family:Arial,Helvetica,sans-serif;color:#1f2937;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f7;padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:8px;padding:32px;">
            <tr>
              <td style="font-size:24px;font-weight:bold;color:#4f46e5;padding-bottom:16px;">OFM</td>
            </tr>
            <tr>
              <td style="font-size:15px;line-height:1.6;">${body}</td>
            </tr>
            <tr>
              <td style="font-size:12px;color:#6b7280;padding-top:24px;border-top:1px solid #e5e7eb;">
                Cet e-mail vous a été envoyé automatiquement par la plateforme OFM. Merci de ne pas y répondre.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function button(url: string, label: string): string {
  const safeUrl = escapeHtml(url);
  return `<p style="text-align:center;margin:24px 0;">
  <a href="${safeUrl}" style="display:inline-block;background:#4f46e5;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:6px;font-weight:bold;">${escapeHtml(label)}</a>
</p>
<p style="font-size:13px;color:#6b7280;">Si le bouton ne fonctionne pas, copiez ce lien dans votre navigateur :<br /><a href="${safeUrl}" style="color:#4f46e5;word-break:break-all;">${safeUrl}</a></p>`;
}

export function verificationEmailTemplate(
  username: string,
  url: string,
  expiresInHours: number,
): MailContent {
  const subject = 'Confirmez votre adresse e-mail';
  const html = layout(
    subject,
    `<p>Bonjour ${escapeHtml(username)},</p>
<p>Merci de vous être inscrit sur OFM ! Pour activer votre compte, veuillez confirmer votre adresse e-mail.</p>
${button(url, 'Confirmer mon adresse e-mail')}
<p>Ce lien expire dans ${expiresInHours} heures. Si vous n'êtes pas à l'origine de cette inscription, ignorez simplement cet e-mail.</p>`,
  );
  const text = `Bonjour ${username},

Merci de vous être inscrit sur OFM ! Pour confirmer votre adresse e-mail, ouvrez ce lien :
${url}

Ce lien expire dans ${expiresInHours} heures. Si vous n'êtes pas à l'origine de cette inscription, ignorez cet e-mail.`;
  return { subject, html, text };
}

export function passwordResetEmailTemplate(
  username: string,
  url: string,
  expiresInMinutes: number,
): MailContent {
  const subject = 'Réinitialisation de votre mot de passe';
  const html = layout(
    subject,
    `<p>Bonjour ${escapeHtml(username)},</p>
<p>Nous avons reçu une demande de réinitialisation du mot de passe de votre compte OFM.</p>
${button(url, 'Réinitialiser mon mot de passe')}
<p>Ce lien expire dans ${expiresInMinutes} minutes. Si vous n'avez pas fait cette demande, ignorez cet e-mail : votre mot de passe restera inchangé.</p>`,
  );
  const text = `Bonjour ${username},

Nous avons reçu une demande de réinitialisation du mot de passe de votre compte OFM.
Pour choisir un nouveau mot de passe, ouvrez ce lien :
${url}

Ce lien expire dans ${expiresInMinutes} minutes. Si vous n'avez pas fait cette demande, ignorez cet e-mail.`;
  return { subject, html, text };
}

export function passwordChangedEmailTemplate(username: string, loginUrl: string): MailContent {
  const subject = 'Votre mot de passe a été modifié';
  const html = layout(
    subject,
    `<p>Bonjour ${escapeHtml(username)},</p>
<p>Le mot de passe de votre compte OFM vient d'être modifié. Toutes vos sessions actives ont été déconnectées.</p>
${button(loginUrl, 'Se connecter')}
<p>Si vous n'êtes pas à l'origine de ce changement, réinitialisez immédiatement votre mot de passe et contactez notre support.</p>`,
  );
  const text = `Bonjour ${username},

Le mot de passe de votre compte OFM vient d'être modifié. Toutes vos sessions actives ont été déconnectées.
Connexion : ${loginUrl}

Si vous n'êtes pas à l'origine de ce changement, réinitialisez immédiatement votre mot de passe et contactez notre support.`;
  return { subject, html, text };
}

export function dailyModerationReportTemplate(
  report: DailyModerationReport,
  dashboardUrl: string,
): MailContent {
  const subject = `Rapport de modération quotidien – ${report.date}`;
  const rows: Array<[string, number]> = [
    ['Nouveaux signalements', report.newReports],
    ['Signalements traités', report.resolvedReports],
    ['Signalements en attente', report.pendingReports],
    ['Utilisateurs bannis', report.bannedUsers],
    ['Utilisateurs suspendus', report.suspendedUsers],
  ];
  const tableRows = rows
    .map(
      ([label, value]) =>
        `<tr><td style="padding:8px;border-bottom:1px solid #e5e7eb;">${escapeHtml(label)}</td><td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:right;font-weight:bold;">${value}</td></tr>`,
    )
    .join('');
  const html = layout(
    subject,
    `<p>Bonjour,</p>
<p>Voici le récapitulatif de l'activité de modération du ${escapeHtml(report.date)} :</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:16px 0;">${tableRows}</table>
${button(dashboardUrl, 'Ouvrir la modération')}`,
  );
  const text = `Rapport de modération du ${report.date}

${rows.map(([label, value]) => `- ${label} : ${value}`).join('\n')}

Modération : ${dashboardUrl}`;
  return { subject, html, text };
}
