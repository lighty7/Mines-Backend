import nodemailer, { type Transporter } from 'nodemailer'
import { env } from '../config/env'

export interface SendEmailOptions {
  to: string
  subject: string
  text?: string
  html?: string
}

export class EmailService {
  private transporter: Transporter | null = null

  constructor() {
    if (env.SMTP_USER && env.SMTP_PASS) {
      this.transporter = nodemailer.createTransport({
        host: env.SMTP_HOST,
        port: env.SMTP_PORT,
        secure: env.SMTP_SECURE,
        auth: {
          user: env.SMTP_USER,
          pass: env.SMTP_PASS,
        },
      })
    }
  }

  isConfigured(): boolean {
    return this.transporter !== null
  }

  async verifyConnection(): Promise<boolean> {
    if (!this.transporter) return false
    try {
      await this.transporter.verify()
      return true
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[EmailService] SMTP verification failed:', error)
      return false
    }
  }

  async sendMail(options: SendEmailOptions): Promise<boolean> {
    if (!this.transporter) {
      // eslint-disable-next-line no-console
      console.warn('[EmailService] SMTP not configured. Skipped sending email to:', options.to)
      return false
    }

    try {
      await this.transporter.sendMail({
        from: env.SMTP_FROM,
        to: options.to,
        subject: options.subject,
        text: options.text,
        html: options.html,
      })
      // eslint-disable-next-line no-console
      console.log(`[EmailService] Email successfully sent to ${options.to} (${options.subject})`)
      return true
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[EmailService] Failed to send email to:', options.to, error)
      return false
    }
  }

  async sendWelcomeEmail(to: string, username: string): Promise<boolean> {
    const subject = 'Welcome to Mines Game! 💎'
    const html = `
      <div style="background-color: #0F1115; color: #F5F7FA; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 32px; border-radius: 12px; max-width: 520px; margin: 0 auto; border: 1px solid #20242B;">
        <h2 style="color: #18C964; margin-top: 0;">Welcome, ${username}!</h2>
        <p style="color: #8B929D; font-size: 15px; line-height: 1.6;">
          Your Mines Game account has been successfully created. You are now ready to play server-authoritative Mines with real-time balance and provably fair mechanics.
        </p>
        <div style="background-color: #20242B; border-radius: 8px; padding: 16px; margin: 24px 0; border: 1px solid #30353D;">
          <p style="margin: 0; color: #55D6FF; font-weight: 600;">💎 Starting Balance: 1,000.00 mineCoin</p>
          <p style="margin: 6px 0 0 0; color: #8B929D; font-size: 13px;">Login anytime on Android or Web to pick up your session.</p>
        </div>
        <p style="color: #8B929D; font-size: 13px; margin-bottom: 0;">
          If you did not sign up for Mines Game, you can safely ignore this email.
        </p>
      </div>
    `
    const text = `Welcome, ${username}!\n\nYour Mines Game account has been created with 1,000 mineCoin. Enjoy playing!`
    return this.sendMail({ to, subject, html, text })
  }

  async sendOtpEmail(to: string, code: string, reason = 'account verification'): Promise<boolean> {
    const subject = `Your Mines Game Verification Code: ${code}`
    const html = `
      <div style="background-color: #0F1115; color: #F5F7FA; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 32px; border-radius: 12px; max-width: 520px; margin: 0 auto; border: 1px solid #20242B;">
        <h2 style="color: #18C964; margin-top: 0;">Verification Code</h2>
        <p style="color: #8B929D; font-size: 15px; line-height: 1.6;">
          Use the following One-Time Password (OTP) for your ${reason}:
        </p>
        <div style="background-color: #20242B; border-radius: 8px; padding: 20px; margin: 24px 0; text-align: center; border: 1px solid #18C964;">
          <span style="font-size: 32px; font-weight: 700; letter-spacing: 8px; color: #18C964; font-family: monospace;">${code}</span>
        </div>
        <p style="color: #8B929D; font-size: 13px;">
          This code expires in 10 minutes. Do not share this code with anyone.
        </p>
      </div>
    `
    const text = `Your Mines Game verification code for ${reason} is: ${code}. It expires in 10 minutes.`
    return this.sendMail({ to, subject, html, text })
  }
}

export const emailService = new EmailService()
