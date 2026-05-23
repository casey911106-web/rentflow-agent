/**
 * Attribution helpers shared by API + web. The same logic that the inbound
 * router uses to extract source_code / post_code is also used by the web app
 * to preview a post package's prefilled WhatsApp text.
 */

export interface ParsedAttribution {
  propertyCode?: string;
  postCode?: string;
  /**
   * PostPlacement.trackingSlug stamped onto the marketplace link from owned
   * channel posts (Telegram, IG, FB pages). When present, it identifies the
   * exact piece of content that produced the lead.
   */
  placementSlug?: string;
}

// Property codes are minted as `RF-<id>` (see migrations/seed). Guests paste
// the code in countless shapes ("interested in RF-46GP5", "Property RF-46GP5",
// "code: RF-46GP5"), so match the standalone token instead of demanding a
// "Property " prefix.
const PROPERTY_REGEX = /\bRF-[A-Z0-9]+\b/i;
// Post codes follow the same `POST-<id>` shape on tracking links.
const POST_REGEX = /\bPOST-[A-Z0-9]+\b/i;
// `[ref:ABCD1234]` — short alphanumeric placement slug (8 chars usually).
const PLACEMENT_REGEX = /\[ref:(?<slug>[A-Z0-9]{4,16})\]/i;

export function parseAttribution(text: string): ParsedAttribution {
  const property = text.match(PROPERTY_REGEX)?.[0];
  const post = text.match(POST_REGEX)?.[0];
  const slug = text.match(PLACEMENT_REGEX)?.groups?.['slug'];
  return {
    propertyCode: property ? property.toUpperCase() : undefined,
    postCode: post ? post.toUpperCase() : undefined,
    placementSlug: slug ? slug.toUpperCase() : undefined,
  };
}

export interface BuildPrefilledTextInput {
  propertyCode: string;
  postCode: string;
}

export function buildPrefilledText(input: BuildPrefilledTextInput): string {
  return `Hi, I am interested in Property ${input.propertyCode} from Post ${input.postCode}`;
}

export interface BuildClickToChatInput extends BuildPrefilledTextInput {
  waMeBaseUrl: string;
}

export function buildClickToChatUrl(input: BuildClickToChatInput): string {
  const text = buildPrefilledText(input);
  return `${input.waMeBaseUrl}?text=${encodeURIComponent(text)}`;
}
