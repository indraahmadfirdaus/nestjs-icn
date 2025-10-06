import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { DailySummaryService } from './summary/daily-summary.service';
import { AuthModule } from './auth/auth.module';
import { TasksModule } from './tasks/tasks.module';
import { AiModule } from './ai/ai.module';
import { EmailModule } from './email/email.module';
import { SupabaseModule } from './supabase/supabase.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // Load env from backend/.env or project root .env
      envFilePath: ['.env', '../.env'],
    }),
    ScheduleModule.forRoot(),
    SupabaseModule,
    AuthModule,
    TasksModule,
    AiModule,
    EmailModule,
    HealthModule,
  ],
  providers: [DailySummaryService],
})
export class AppModule {}