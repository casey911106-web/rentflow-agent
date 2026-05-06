import { Injectable, Logger } from '@nestjs/common';
import type { SystemDoc, SystemDocCategory } from './system-docs.types';

/**
 * Runtime registry of system docs. Modules call `register(doc)` during init
 * (typically in onModuleInit or right inside the module file). The
 * controller exposes the collected docs to the dashboard.
 *
 * Tip for devs: when you change behavior, update the doc string in the same
 * commit. CI doesn't enforce this — code review does.
 */
@Injectable()
export class SystemDocsService {
  private readonly logger = new Logger(SystemDocsService.name);
  private readonly docs = new Map<string, SystemDoc>();

  register(doc: SystemDoc): void {
    if (this.docs.has(doc.id)) {
      this.logger.warn(`SystemDoc id "${doc.id}" registered twice — overwriting.`);
    }
    this.docs.set(doc.id, doc);
  }

  list(category?: SystemDocCategory): SystemDoc[] {
    const all = Array.from(this.docs.values());
    return (category ? all.filter((d) => d.category === category) : all).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  }

  byId(id: string): SystemDoc | undefined {
    return this.docs.get(id);
  }
}
