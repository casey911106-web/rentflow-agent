import { Module } from '@nestjs/common';
import { PlacementsModule } from '../placements/placements.module';
import { BonusPoolController } from './bonus-pool.controller';
import { BonusPoolService } from './bonus-pool.service';

@Module({
  imports: [PlacementsModule],
  controllers: [BonusPoolController],
  providers: [BonusPoolService],
  exports: [BonusPoolService],
})
export class BonusPoolModule {}
