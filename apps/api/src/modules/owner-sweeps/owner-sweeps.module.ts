import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from '../../prisma/prisma.module';
import { PropertyDetailsModule } from '../property-details/property-details.module';
import { OwnerSweepsController } from './owner-sweeps.controller';
import { OwnerSweepsScheduler } from './owner-sweeps.scheduler';
import { OwnerSweepsService } from './owner-sweeps.service';

@Module({
  imports: [PrismaModule, PropertyDetailsModule, ScheduleModule.forRoot()],
  controllers: [OwnerSweepsController],
  providers: [OwnerSweepsService, OwnerSweepsScheduler],
  exports: [OwnerSweepsService],
})
export class OwnerSweepsModule {}
