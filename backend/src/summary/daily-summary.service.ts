import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { SupabaseService } from '../supabase';
import { TasksService } from '../tasks/tasks.service';

@Injectable()
export class DailySummaryService {
  private readonly logger = new Logger(DailySummaryService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly schedulerRegistry: SchedulerRegistry,
    private readonly supabaseService: SupabaseService,
    private readonly tasksService: TasksService,
  ) {
    this.setupCron();
  }

  private setupCron() {
    const cronTime = this.configService.get<string>('DAILY_SUMMARY_CRON') || '0 7 * * *'; // 07:00 UTC
    const timeZone = this.configService.get<string>('DAILY_SUMMARY_TZ') || 'UTC';

    const job = new CronJob(cronTime, async () => {
      try {
        await this.run();
      } catch (err: any) {
        this.logger.error(`Daily summary job failed: ${err?.message || err}`);
      }
    }, null, false, timeZone);

    this.schedulerRegistry.addCronJob('daily-summary', job);
    job.start();
    this.logger.log(`Daily summary cron scheduled: "${cronTime}" TZ=${timeZone}`);
  }

  async run() {
    const supabase = this.supabaseService.getAdminClient();
    const { data: users, error: usersError } = await supabase
      .from('users')
      .select('id,email');
    if (usersError) {
      throw new Error(`Failed to fetch users: ${usersError.message}`);
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (const user of users || []) {
      try {
        const summary = await this.tasksService.getTasksSummary(user.id);

        const emailBody = `
          <h2>Your Daily Task Summary</h2>
          
          <h3>📝 New Tasks Today: ${summary.newTasks.length}</h3>
          <ul>
            ${summary.newTasks.map((task: any) => `<li>${task.title}</li>`).join('') || '<li>No new tasks</li>'}
          </ul>
          
          <h3>✅ Completed Tasks: ${summary.completedTasks.length}</h3>
          <ul>
            ${summary.completedTasks.map((task: any) => `<li>${task.title}</li>`).join('') || '<li>No completed tasks</li>'}
          </ul>
          
          <h3>⚠️ Overdue Tasks: ${summary.overdueTasks.length}</h3>
          <ul>
            ${summary.overdueTasks.map((task: any) => `<li>${task.title} - Due: ${new Date(task.due_date).toLocaleDateString()}</li>`).join('') || '<li>No overdue tasks</li>'}
          </ul>
          
          <p>Keep up the great work!</p>
        `;

        await supabase.from('email_logs').insert({
          to_email: user.email,
          subject: 'Daily Task Summary',
          body: emailBody,
          status: 'mock',
          sent_at: new Date().toISOString(),
        });

        this.logger.log(`Daily summary logged to email_logs for ${user.email}`);
      } catch (userErr: any) {
        this.logger.warn(`Error processing user ${user?.id}: ${userErr?.message || userErr}`);
      }
    }

    return { success: true, count: users?.length || 0 };
  }
}