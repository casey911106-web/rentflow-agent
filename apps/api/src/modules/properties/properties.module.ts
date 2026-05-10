import { Module } from '@nestjs/common';
import { PropertiesController } from './properties.controller';
import { PropertiesService } from './properties.service';
import { FilesModule } from '../files/files.module';
import { PostingModule } from '../posting/posting.module';

@Module({
  imports: [FilesModule, PostingModule],
  controllers: [PropertiesController],
  providers: [PropertiesService],
  exports: [PropertiesService],
})
export class PropertiesModule {}
