import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { SupabaseService } from '../supabase';

@Injectable()
export class EmailService {
  private transporter: nodemailer.Transporter;
  private useMock: boolean;

  constructor(
    private configService: ConfigService,
    private supabaseService: SupabaseService,
  ) {
    const smtpHost = this.configService.get<string>('SMTP_HOST');
    const smtpUser = this.configService.get<string>('SMTP_USER');

    // Use mock if SMTP credentials are not configured
    this.useMock = !smtpHost || !smtpUser;

    if (!this.useMock) {
      this.transporter = nodemailer.createTransport({
        host: smtpHost,
        port: this.configService.get<number>('SMTP_PORT') || 587,
        secure: false,
        auth: {
          user: smtpUser,
          pass: this.configService.get<string>('SMTP_PASS'),
        },
        // Prevent long hangs if SMTP is slow/unreachable
        connectionTimeout: this.configService.get<number>('SMTP_CONNECTION_TIMEOUT') || 10000,
        greetingTimeout: this.configService.get<number>('SMTP_GREETING_TIMEOUT') || 10000,
        socketTimeout: this.configService.get<number>('SMTP_SOCKET_TIMEOUT') || 10000,
      });
    }
  }

  async sendTaskCreatedNotification(
    userEmail: string,
    taskTitle: string,
    taskDescription: string,
  ) {
    const emailData = {
      to_email: userEmail,
      subject: 'New Task Created',
      body: `
        <h2>New Task Created</h2>
        <p><strong>Title:</strong> ${taskTitle}</p>
        <p><strong>Description:</strong> ${taskDescription || 'No description'}</p>
        <p>This is an automated notification from Task Board.</p>
      `,
    };

    if (this.useMock) {
      await this.logEmail(emailData);
      console.log('📧 Mock Email Sent:', emailData);
    } else {
      try {
        await this.transporter.sendMail({
          from: this.configService.get<string>('EMAIL_FROM'),
          to: emailData.to_email,
          subject: emailData.subject,
          html: emailData.body,
        });
        await this.logEmail({ ...emailData, status: 'sent' });
        console.log('✅ Email sent to:', userEmail);
      } catch (error) {
        console.error('❌ Email sending failed:', error);
        await this.logEmail({ ...emailData, status: 'failed', error: error.message });
      }
    }
  }

  async sendDailySummary(
    userEmail: string,
    summary: {
      newTasks: any[];
      completedTasks: any[];
      overdueTasks: any[];
    },
  ) {
    const emailData = {
      to_email: userEmail,
      subject: 'Daily Task Summary',
      body: `
        <h2>Your Daily Task Summary</h2>
        
        <h3>📝 New Tasks Today: ${summary.newTasks.length}</h3>
        <ul>
          ${summary.newTasks.map((task) => `<li>${task.title}</li>`).join('') || '<li>No new tasks</li>'}
        </ul>
        
        <h3>✅ Completed Tasks: ${summary.completedTasks.length}</h3>
        <ul>
          ${summary.completedTasks.map((task) => `<li>${task.title}</li>`).join('') || '<li>No completed tasks</li>'}
        </ul>
        
        <h3>⚠️ Overdue Tasks: ${summary.overdueTasks.length}</h3>
        <ul>
          ${summary.overdueTasks.map((task) => `<li>${task.title} - Due: ${new Date(task.due_date).toLocaleDateString()}</li>`).join('') || '<li>No overdue tasks</li>'}
        </ul>
        
        <p>Keep up the great work!</p>
      `,
    };

    if (this.useMock) {
      await this.logEmail(emailData);
      console.log('📧 Mock Daily Summary Sent:', emailData);
    } else {
      try {
        await this.transporter.sendMail({
          from: this.configService.get<string>('EMAIL_FROM'),
          to: emailData.to_email,
          subject: emailData.subject,
          html: emailData.body,
        });
        await this.logEmail({ ...emailData, status: 'sent' });
        console.log('✅ Daily summary sent to:', userEmail);
      } catch (error) {
        console.error('❌ Email sending failed:', error);
        await this.logEmail({ ...emailData, status: 'failed', error: error.message });
      }
    }
  }

  private async logEmail(emailData: any) {
    try {
      const supabase = this.supabaseService.getAdminClient();
      await supabase.from('email_logs').insert({
        to_email: emailData.to_email,
        subject: emailData.subject,
        body: emailData.body,
        status: emailData.status || 'mock',
        error: emailData.error || null,
        sent_at: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Failed to log email:', error);
    }
  }
}