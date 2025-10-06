import { Controller, Get } from '@nestjs/common';
import { SupabaseService } from '../supabase';

@Controller('health')
export class HealthController {
  constructor(private supabaseService: SupabaseService) {}

  @Get('supabase')
  async supabaseHealth() {
    const supabase = this.supabaseService.getAdminClient();
    const mode = this.supabaseService.isMock() ? 'mock' : 'real';
    try {
      const { error } = await supabase.from('tasks').select('id').limit(1);
      if (error) {
        return { status: 'error', mode, error: error.message };
      }
      return { status: 'ok', mode };
    } catch (e: any) {
      return { status: 'error', mode, error: e?.message || 'Unknown error' };
    }
  }
}