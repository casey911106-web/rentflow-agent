import { Module, OnModuleInit } from '@nestjs/common';
import { SystemDocsController } from './system-docs.controller';
import { SystemDocsService } from './system-docs.service';
import { BUILT_IN_DOCS } from './built-in-docs';

@Module({
  controllers: [SystemDocsController],
  providers: [SystemDocsService],
  exports: [SystemDocsService],
})
export class SystemDocsModule implements OnModuleInit {
  constructor(private readonly docs: SystemDocsService) {}

  onModuleInit() {
    for (const doc of BUILT_IN_DOCS) {
      this.docs.register(doc);
    }
  }
}
