/**
 * Envoi d'e-mails derrière une interface : Resend en production (adresse d'expédition à valider sur votre domaine),
 * un faux en test. Sans clé (RESEND_API_KEY) ni adresse d'expédition (MAIL_FROM), rien n'est envoyé.
 */
export interface MailMessage {
  to: string
  subject: string
  html: string
  text: string
}
export interface Mailer {
  send(message: MailMessage): Promise<void>
}

export class ResendMailer implements Mailer {
  constructor(
    private apiKey: string,
    private from: string,
  ) {}

  async send(m: MailMessage): Promise<void> {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
      signal: AbortSignal.timeout(20_000),
      body: JSON.stringify({ from: this.from, to: [m.to], subject: m.subject, html: m.html, text: m.text }),
    })
    if (!res.ok) throw new Error(`Resend ${res.status}`)
  }
}

export function mailerFromEnv(env: Record<string, string | undefined>): Mailer | null {
  return env.RESEND_API_KEY && env.MAIL_FROM ? new ResendMailer(env.RESEND_API_KEY, env.MAIL_FROM) : null
}
