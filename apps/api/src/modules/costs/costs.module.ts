import { Module } from '@nestjs/common';
import { CostsController } from './costs.controller';
import { CostsScheduler } from './costs.scheduler';
import { CostsService } from './costs.service';

@Module({
  controllers: [CostsController],
  providers: [CostsService, CostsScheduler],
  exports: [CostsService],
})
export class CostsModule {}
