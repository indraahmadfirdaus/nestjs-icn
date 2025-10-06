import { Module, Global } from '@nestjs/common';
import { SupabaseService } from './index';

@Global()
@Module({
  providers: [SupabaseService],
  exports: [SupabaseService],
})
export class SupabaseModule {}