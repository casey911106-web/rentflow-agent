import { Injectable, Logger } from '@nestjs/common';
import sharp from 'sharp';
import { FilesService } from '../files/files.service';

/**
 * Renders the hook-style overlay on top of a property photo for IG carousel
 * publishes. 4 variants rotate per publish so consecutive posts don't look
 * identical. English copy only — RentFlow's IG audience is Dubai expats.
 *
 * Variants:
 *   0 — LABEL    : bottom gradient + "AED X · Type · Area / Swipe →"
 *   1 — POV      : top fade + "POV: your new Type in Area" + spec line
 *   2 — MAGAZINE : huge centered price + AREA caps + SWIPE → footer
 *   3 — QUESTION : top fade + "Type in Area for AED X?" + "Let me show you →"
 *
 * Slide N (CTA) is the same overlay for every variant: "DM us for viewing /
 * Link in bio" — keeps the close consistent across rotations.
 */

const VARIANT_COUNT = 4;
const SAFE_FONT = "system-ui, -apple-system, 'Helvetica Neue', Arial, sans-serif";

export interface OverlayInput {
  priceAed: number;
  type: string; // raw property.type value
  area: string;
}

function humanType(t: string): string {
  return ({
    studio: 'Studio',
    one_bedroom: '1BR',
    two_bedroom: '2BR',
    three_bedroom: '3BR',
    villa: 'Villa',
    master_room: 'Master room',
    standard_room: 'Standard room',
    shared_room: 'Shared room',
    partition: 'Partition',
    bed_space: 'Bed space',
  } as Record<string, string>)[t] ?? '1BR';
}

/** Marker ownerEntityType for FileUploads created by the carousel renderer.
 *  The public file controller allowlists this type so IG can fetch the
 *  rendered slides via their public URL. */
export const CAROUSEL_SLIDE_OWNER_TYPE = 'CarouselSlide';

@Injectable()
export class CarouselRendererService {
  private readonly logger = new Logger(CarouselRendererService.name);

  constructor(private readonly files: FilesService) {}

  /** Total number of slide-1 hook variants. Callers do `(count % variantCount)`
   *  to pick the next variant for a property. */
  get variantCount(): number {
    return VARIANT_COUNT;
  }

  /** Render + store both the hook (slide 1) and CTA (slide N) overlays as
   *  FileUploads tagged with ownerEntityType=CarouselSlide. Returns the
   *  public URLs IG can fetch from. */
  async renderAndStoreSlides(opts: {
    companyId: string;
    uploadedById: string;
    postPackageId: string;
    variantIndex: number;
    hookPhoto: Buffer;
    ctaPhoto: Buffer;
    overlay: OverlayInput;
    publicBaseUrl: string;
  }): Promise<{ hookUrl: string; ctaUrl: string; variantIndex: number }> {
    const hookBuffer = await this.renderHookSlide(opts.variantIndex, opts.hookPhoto, opts.overlay);
    const ctaBuffer = await this.renderCtaSlide(opts.ctaPhoto);

    const [hookFile, ctaFile] = await Promise.all([
      this.files.save({
        companyId: opts.companyId,
        uploadedById: opts.uploadedById,
        ownerEntityType: CAROUSEL_SLIDE_OWNER_TYPE,
        ownerEntityId: opts.postPackageId,
        buffer: hookBuffer,
        mimeType: 'image/jpeg',
        originalName: `carousel-hook-v${opts.variantIndex}.jpg`,
      }),
      this.files.save({
        companyId: opts.companyId,
        uploadedById: opts.uploadedById,
        ownerEntityType: CAROUSEL_SLIDE_OWNER_TYPE,
        ownerEntityId: opts.postPackageId,
        buffer: ctaBuffer,
        mimeType: 'image/jpeg',
        originalName: `carousel-cta.jpg`,
      }),
    ]);

    return {
      hookUrl: `${opts.publicBaseUrl}/public/files/${hookFile.id}`,
      ctaUrl: `${opts.publicBaseUrl}/public/files/${ctaFile.id}`,
      variantIndex: ((opts.variantIndex % VARIANT_COUNT) + VARIANT_COUNT) % VARIANT_COUNT,
    };
  }

  /** Render the slide-1 hook overlay on top of `photo` (jpeg/png buffer)
   *  using variant index 0..N-1. Returns a JPEG buffer. */
  async renderHookSlide(
    variantIndex: number,
    photo: Buffer,
    input: OverlayInput,
  ): Promise<Buffer> {
    const meta = await sharp(photo).metadata();
    const w = meta.width ?? 1080;
    const h = meta.height ?? 1080;
    const v = ((variantIndex % VARIANT_COUNT) + VARIANT_COUNT) % VARIANT_COUNT;
    const svg = this.hookSvg(v, w, h, input);
    return sharp(photo)
      .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
      .jpeg({ quality: 92, mozjpeg: true })
      .toBuffer();
  }

  /** Render the slide-N CTA overlay (same across all variants). */
  async renderCtaSlide(photo: Buffer): Promise<Buffer> {
    const meta = await sharp(photo).metadata();
    const w = meta.width ?? 1080;
    const h = meta.height ?? 1080;
    const svg = this.ctaSvg(w, h);
    return sharp(photo)
      .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
      .jpeg({ quality: 92, mozjpeg: true })
      .toBuffer();
  }

  // ------------------------------------------------------------------------
  // SVG builders — one per variant
  // ------------------------------------------------------------------------

  private hookSvg(variant: number, w: number, h: number, input: OverlayInput): string {
    switch (variant) {
      case 1:
        return this.povSvg(w, h, input);
      case 2:
        return this.magazineSvg(w, h, input);
      case 3:
        return this.questionSvg(w, h, input);
      case 0:
      default:
        return this.labelSvg(w, h, input);
    }
  }

  /** Variant 0 — LABEL: bottom gradient + facts + Swipe →. */
  private labelSvg(w: number, h: number, input: OverlayInput): string {
    const fontHook = Math.round(h * 0.052);
    const fontSub = Math.round(h * 0.028);
    const overlayHeight = Math.round(h * 0.28);
    const overlayTop = h - overlayHeight;
    const hookY = h - Math.round(h * 0.13);
    const subY = h - Math.round(h * 0.06);
    const facts = `AED ${input.priceAed.toLocaleString()} · ${humanType(input.type)} · ${input.area}`;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
      <defs>
        <linearGradient id="fade" x1="0" y1="${overlayTop}" x2="0" y2="${h}" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stop-color="rgba(0,0,0,0)"/>
          <stop offset="40%" stop-color="rgba(0,0,0,0.5)"/>
          <stop offset="100%" stop-color="rgba(0,0,0,0.88)"/>
        </linearGradient>
      </defs>
      <rect x="0" y="${overlayTop}" width="${w}" height="${overlayHeight}" fill="url(#fade)"/>
      <text x="50%" y="${hookY}" text-anchor="middle"
            font-family="${SAFE_FONT}" font-size="${fontHook}" font-weight="900"
            fill="white" letter-spacing="-0.5">${escapeXml(facts)}</text>
      <text x="50%" y="${subY}" text-anchor="middle"
            font-family="${SAFE_FONT}" font-size="${fontSub}" font-weight="500"
            fill="white" opacity="0.92">Swipe →</text>
    </svg>`;
  }

  /** Variant 1 — POV: top fade + POV title + spec subtitle. */
  private povSvg(w: number, h: number, input: OverlayInput): string {
    const fontTitle = Math.round(h * 0.055);
    const fontSpec = Math.round(h * 0.024);
    const hookY = Math.round(h * 0.10) + fontTitle;
    const specY = hookY + Math.round(fontTitle * 1.05);
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
      <defs>
        <linearGradient id="fade" x1="0" y1="0" x2="0" y2="${h * 0.35}" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stop-color="rgba(0,0,0,0.78)"/>
          <stop offset="100%" stop-color="rgba(0,0,0,0)"/>
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="${w}" height="${h * 0.35}" fill="url(#fade)"/>
      <text x="${Math.round(w * 0.06)}" y="${hookY}" text-anchor="start"
            font-family="${SAFE_FONT}" font-size="${fontTitle}" font-weight="900"
            fill="white" letter-spacing="-1.5">${escapeXml(`POV: your new ${humanType(input.type)} in ${input.area}`)}</text>
      <text x="${Math.round(w * 0.06)}" y="${specY}" text-anchor="start"
            font-family="${SAFE_FONT}" font-size="${fontSpec}" font-weight="400"
            fill="white" opacity="0.85">AED ${input.priceAed.toLocaleString()} / mo  ·  See slide 4</text>
    </svg>`;
  }

  /** Variant 2 — MAGAZINE: huge centered price + AREA in caps + SWIPE → footer. */
  private magazineSvg(w: number, h: number, input: OverlayInput): string {
    const fontMega = Math.round(h * 0.13);
    const fontSub = Math.round(h * 0.028);
    const fontTag = Math.round(h * 0.022);
    const centerY = Math.round(h * 0.46);
    const tagY = Math.round(h * 0.94);
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
      <defs>
        <linearGradient id="ovr" x1="0" y1="${h * 0.25}" x2="0" y2="${h * 0.75}" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stop-color="rgba(0,0,0,0)"/>
          <stop offset="50%" stop-color="rgba(0,0,0,0.55)"/>
          <stop offset="100%" stop-color="rgba(0,0,0,0)"/>
        </linearGradient>
      </defs>
      <rect x="0" y="${h * 0.25}" width="${w}" height="${h * 0.5}" fill="url(#ovr)"/>
      <text x="50%" y="${centerY}" text-anchor="middle"
            font-family="${SAFE_FONT}" font-size="${fontMega}" font-weight="900"
            fill="white" letter-spacing="-4">AED ${input.priceAed.toLocaleString()}</text>
      <text x="50%" y="${centerY + Math.round(fontMega * 0.7)}" text-anchor="middle"
            font-family="${SAFE_FONT}" font-size="${fontSub}" font-weight="500"
            fill="white" opacity="0.88" letter-spacing="2">${escapeXml(input.area.toUpperCase())}</text>
      <text x="50%" y="${tagY}" text-anchor="middle"
            font-family="${SAFE_FONT}" font-size="${fontTag}" font-weight="600"
            fill="white" opacity="0.7" letter-spacing="3">SWIPE →</text>
    </svg>`;
  }

  /** Variant 3 — QUESTION: provocative title at top + curiosity-gap CTA. */
  private questionSvg(w: number, h: number, input: OverlayInput): string {
    const fontHook = Math.round(h * 0.075);
    const fontSub = Math.round(h * 0.026);
    const lineH = Math.round(fontHook * 1.05);
    const block1 = Math.round(h * 0.10) + fontHook;
    const block2 = block1 + lineH;
    const ctaY = Math.round(h * 0.93);
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
      <defs>
        <linearGradient id="topfade" x1="0" y1="0" x2="0" y2="${h * 0.5}" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stop-color="rgba(0,0,0,0.82)"/>
          <stop offset="100%" stop-color="rgba(0,0,0,0)"/>
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="${w}" height="${h * 0.5}" fill="url(#topfade)"/>
      <text x="${Math.round(w * 0.06)}" y="${block1}" text-anchor="start"
            font-family="${SAFE_FONT}" font-size="${fontHook}" font-weight="900"
            fill="white" letter-spacing="-1.5">${escapeXml(`${humanType(input.type)} in ${input.area}`)}</text>
      <text x="${Math.round(w * 0.06)}" y="${block2}" text-anchor="start"
            font-family="${SAFE_FONT}" font-size="${fontHook}" font-weight="900"
            fill="white" letter-spacing="-1.5">for AED ${input.priceAed.toLocaleString()}?</text>
      <text x="${Math.round(w * 0.06)}" y="${ctaY}" text-anchor="start"
            font-family="${SAFE_FONT}" font-size="${fontSub}" font-weight="600"
            fill="white" opacity="0.92">Let me show you →</text>
    </svg>`;
  }

  /** Slide N (last) CTA — same across all variants for consistency. */
  private ctaSvg(w: number, h: number): string {
    const fontMain = Math.round(h * 0.06);
    const fontSub = Math.round(h * 0.028);
    const overlayHeight = Math.round(h * 0.32);
    const overlayTop = h - overlayHeight;
    const mainY = h - Math.round(h * 0.14);
    const subY = h - Math.round(h * 0.06);
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
      <defs>
        <linearGradient id="cta" x1="0" y1="${overlayTop}" x2="0" y2="${h}" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stop-color="rgba(0,0,0,0)"/>
          <stop offset="40%" stop-color="rgba(0,0,0,0.55)"/>
          <stop offset="100%" stop-color="rgba(0,0,0,0.9)"/>
        </linearGradient>
      </defs>
      <rect x="0" y="${overlayTop}" width="${w}" height="${overlayHeight}" fill="url(#cta)"/>
      <text x="50%" y="${mainY}" text-anchor="middle"
            font-family="${SAFE_FONT}" font-size="${fontMain}" font-weight="900"
            fill="white" letter-spacing="-0.5">DM us for viewing</text>
      <text x="50%" y="${subY}" text-anchor="middle"
            font-family="${SAFE_FONT}" font-size="${fontSub}" font-weight="500"
            fill="white" opacity="0.92" letter-spacing="2">LINK IN BIO</text>
    </svg>`;
  }
}

/** Strip the 5 XML metacharacters from user-provided strings before
 *  embedding them in SVG text nodes — otherwise rsvg refuses to parse. */
function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
