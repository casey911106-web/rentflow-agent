import Link from 'next/link';
import { notFound } from 'next/navigation';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
const WA_NUMBER = process.env.NEXT_PUBLIC_WHATSAPP_NUMBER ?? '971585063316';

interface PropertyDetail {
  id: string;
  code: string;
  name: string;
  area: string | null;
  addressLine: string | null;
  type: string;
  priceAed: string | null;
  description: string | null;
  occupancyMax: number | null;
  latitude: number | null;
  longitude: number | null;
  availabilityConfirmedAt: string | null;
  media: Array<{ file: { id: string; mimeType: string }; caption: string | null }>;
  availabilityBlocks: Array<{ startsAt: string; endsAt: string }>;
}

function MediaTile({
  mediaUrl,
  mimeType,
  alt,
  className,
}: {
  mediaUrl: string;
  mimeType: string;
  alt: string;
  className?: string;
}) {
  if (mimeType.startsWith('video/')) {
    return (
      // eslint-disable-next-line jsx-a11y/media-has-caption
      <video
        src={mediaUrl}
        className={className}
        controls
        preload="metadata"
        playsInline
      />
    );
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={mediaUrl} alt={alt} className={className} />;
}

const TYPE_LABEL: Record<string, string> = {
  studio: 'Studio',
  one_bedroom: '1 Bedroom',
  two_bedroom: '2 Bedroom',
  three_bedroom: '3 Bedroom',
  villa: 'Villa',
  master_room: 'Master room',
  shared_room: 'Shared room',
};

async function fetchProperty(code: string): Promise<PropertyDetail | null> {
  const res = await fetch(`${API_BASE}/public/properties/${code}`, { cache: 'no-store' });
  if (!res.ok) return null;
  return res.json();
}

export default async function PropertyPublicPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const property = await fetchProperty(code);
  if (!property) notFound();

  const waMessage = encodeURIComponent(
    `Hi! I'm interested in ${property.code} — ${property.name}. Is it available?`,
  );

  return (
    <div className="min-h-screen bg-offwhite">
      <header className="bg-navy-deep text-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4 md:px-8">
          <Link href="/" className="flex items-center gap-2 text-sm text-slate-300 hover:text-white">
            ← Back to all rentals
          </Link>
          <Link href="/login" className="text-xs text-slate-300 hover:text-white">Operator login</Link>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-6 md:px-8">
        {/* Title */}
        <div className="mb-4">
          <div className="mb-2 flex items-center gap-2">
            <span className="rounded-full bg-teal/10 px-2 py-0.5 text-xs font-semibold text-teal">
              {TYPE_LABEL[property.type] ?? property.type}
            </span>
            <span className="font-mono text-xs text-gray-medium">{property.code}</span>
          </div>
          <h1 className="text-2xl font-bold text-navy-deep md:text-3xl">{property.name}</h1>
          <p className="mt-1 text-sm text-gray-medium">
            {property.area ?? '—'}{property.addressLine ? ` · ${property.addressLine}` : ''}
          </p>
        </div>

        {/* Photo gallery — first image preferred as hero, with mixed image+video tiles */}
        {property.media.length > 0 ? (() => {
          const heroIdx = property.media.findIndex((m) => m.file.mimeType.startsWith('image/'));
          const hero = heroIdx >= 0 ? property.media[heroIdx] : property.media[0];
          const rest = property.media.filter((_, i) => i !== heroIdx).slice(0, 4);
          return (
            <div className="mb-6 grid grid-cols-1 gap-2 md:grid-cols-4">
              {hero ? (
                <div className="md:col-span-2 md:row-span-2">
                  <MediaTile
                    mediaUrl={`${API_BASE}/public/files/${hero.file.id}`}
                    mimeType={hero.file.mimeType}
                    alt={hero.caption ?? property.name}
                    className="h-full w-full rounded-md object-cover"
                  />
                </div>
              ) : null}
              {rest.map((m, i) => (
                <MediaTile
                  key={i}
                  mediaUrl={`${API_BASE}/public/files/${m.file.id}`}
                  mimeType={m.file.mimeType}
                  alt={m.caption ?? ''}
                  className="aspect-square w-full rounded-md object-cover"
                />
              ))}
            </div>
          );
        })() : null}

        {property.media.length > 5 ? (
          <details className="mb-6 rounded-md bg-white p-4 shadow-card">
            <summary className="cursor-pointer text-sm font-semibold text-teal">
              See all {property.media.length} items
            </summary>
            <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-3">
              {property.media.slice(5).map((m, i) => (
                <MediaTile
                  key={i}
                  mediaUrl={`${API_BASE}/public/files/${m.file.id}`}
                  mimeType={m.file.mimeType}
                  alt={m.caption ?? ''}
                  className="aspect-square w-full rounded-md object-cover"
                />
              ))}
            </div>
          </details>
        ) : null}

        {/* Two columns: details + sticky contact */}
        <div className="grid gap-6 md:grid-cols-3">
          <div className="md:col-span-2">
            <div className="mb-4 rounded-md bg-white p-4 shadow-card">
              <p className="text-2xl font-bold text-navy-deep">
                {property.priceAed ? `AED ${Number(property.priceAed).toLocaleString()}` : '—'}
                <span className="text-sm font-normal text-gray-medium">/month</span>
              </p>
              {property.occupancyMax ? (
                <p className="mt-1 text-sm text-gray-medium">Sleeps up to {property.occupancyMax} guests</p>
              ) : null}
              {property.availabilityConfirmedAt ? (
                <p className="mt-2 text-xs text-gray-medium">
                  Availability last updated{' '}
                  {new Date(property.availabilityConfirmedAt).toLocaleDateString()}
                </p>
              ) : null}
            </div>

            {property.description ? (
              <div className="mb-4 rounded-md bg-white p-4 shadow-card">
                <h2 className="mb-2 font-semibold text-navy-deep">About this place</h2>
                <p className="whitespace-pre-line text-sm text-gray-dark">{property.description}</p>
              </div>
            ) : null}

            {property.availabilityBlocks.length > 0 ? (
              <div className="mb-4 rounded-md bg-white p-4 shadow-card">
                <h2 className="mb-2 font-semibold text-navy-deep">Booked dates</h2>
                <ul className="space-y-1 text-sm text-gray-dark">
                  {property.availabilityBlocks.map((b, i) => (
                    <li key={i}>
                      {new Date(b.startsAt).toLocaleDateString()} — {new Date(b.endsAt).toLocaleDateString()}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {property.latitude && property.longitude ? (
              <a
                href={`https://www.google.com/maps?q=${property.latitude},${property.longitude}`}
                target="_blank"
                rel="noopener"
                className="inline-block text-sm font-semibold text-teal hover:underline"
              >
                Open in Google Maps →
              </a>
            ) : null}
          </div>

          {/* Contact card */}
          <aside className="md:sticky md:top-4 md:h-fit">
            <div className="rounded-md bg-white p-5 shadow-card">
              <p className="mb-3 text-sm font-semibold text-navy-deep">Interested?</p>
              <p className="mb-4 text-xs text-gray-medium">
                Send us a WhatsApp and we&apos;ll confirm availability + arrange a viewing.
              </p>
              <a
                href={`https://wa.me/${WA_NUMBER}?text=${waMessage}`}
                target="_blank"
                rel="noopener"
                className="block w-full rounded-md bg-[#25D366] px-4 py-3 text-center text-sm font-bold text-white hover:bg-[#1ea957]"
              >
                Message on WhatsApp
              </a>
              <a
                href={`tel:+${WA_NUMBER}`}
                className="mt-2 block w-full rounded-md border border-teal px-4 py-3 text-center text-sm font-semibold text-teal hover:bg-teal/5"
              >
                Call us
              </a>
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}
