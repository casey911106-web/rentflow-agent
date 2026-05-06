import { BadRequestException, Injectable } from '@nestjs/common';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import * as mime from 'mime-types';
import { PrismaService } from '../../prisma/prisma.service';

const ALLOWED_IMAGE = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'];
const ALLOWED_VIDEO = ['video/mp4', 'video/quicktime'];
const ALLOWED_DOC = ['application/pdf'];

const MAX_IMAGE = 10 * 1024 * 1024;       // 10 MB
const MAX_VIDEO = 50 * 1024 * 1024;       // 50 MB
const MAX_DOC   = 10 * 1024 * 1024;       // 10 MB

export interface SaveOptions {
  companyId: string;
  uploadedById: string;
  ownerEntityType: string;       // "Property" | "PropertyIssue" | ...
  ownerEntityId: string;
  buffer: Buffer;
  mimeType: string;
  originalName?: string;
}

@Injectable()
export class FilesService {
  /** Root upload directory. Configurable via env so we can swap to a mounted volume. */
  private readonly root =
    process.env.LOCAL_UPLOAD_DIR ?? path.join(process.cwd(), 'uploads');

  constructor(private readonly prisma: PrismaService) {}

  /** Save a buffer to the local filesystem and register a FileUpload row. */
  async save(opts: SaveOptions) {
    this.assertAllowed(opts.mimeType, opts.buffer.length);

    const ext = mime.extension(opts.mimeType) || 'bin';
    const id = randomUUID();
    const relativeKey = `${opts.companyId}/${opts.ownerEntityType}/${opts.ownerEntityId}/${id}.${ext}`;
    const absolutePath = path.join(this.root, relativeKey);

    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, opts.buffer);

    return this.prisma.fileUpload.create({
      data: {
        companyId: opts.companyId,
        uploadedById: opts.uploadedById,
        bucket: 'local',
        s3Key: relativeKey,
        mimeType: opts.mimeType,
        sizeBytes: opts.buffer.length,
        originalName: opts.originalName,
        ownerEntityType: opts.ownerEntityType,
        ownerEntityId: opts.ownerEntityId,
      },
    });
  }

  /**
   * Read a stored file. Used by the auth-protected file streaming endpoint.
   * Returns a buffer + the FileUpload record (so caller can set Content-Type).
   */
  async read(companyId: string, fileId: string) {
    const file = await this.prisma.fileUpload.findFirst({
      where: { id: fileId, companyId },
    });
    if (!file) {
      throw new BadRequestException('File not found');
    }
    const absolutePath = path.join(this.root, file.s3Key);
    const buffer = await fs.readFile(absolutePath);
    return { file, buffer };
  }

  private assertAllowed(mimeType: string, sizeBytes: number) {
    if (ALLOWED_IMAGE.includes(mimeType) && sizeBytes <= MAX_IMAGE) return;
    if (ALLOWED_VIDEO.includes(mimeType) && sizeBytes <= MAX_VIDEO) return;
    if (ALLOWED_DOC.includes(mimeType) && sizeBytes <= MAX_DOC) return;
    throw new BadRequestException(
      `Unsupported file: ${mimeType} (${sizeBytes} bytes). Allowed: jpeg/png/webp/heic ≤10MB, mp4/mov ≤50MB, pdf ≤10MB.`,
    );
  }
}
