import { Module } from '@nestjs/common';
import { BonusPoolModule } from '../bonus-pool/bonus-pool.module';
import { DealsController } from './deals.controller';
import { DealsService } from './deals.service';

@Module({
  imports: [BonusPoolModule],
  controllers: [DealsController],
  providers: [DealsService],
  exports: [DealsService],
})
export class DealsModule {}
