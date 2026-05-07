import { Module } from '@nestjs/common';
import { FilesModule } from '../files/files.module';
import { PublicController } from './public.controller';

@Module({
  imports: [FilesModule],
  controllers: [PublicController],
})
export class PublicModule {}
