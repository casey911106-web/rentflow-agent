import Link from 'next/link';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
const WA_NUMBER = process.env.NEXT_PUBLIC_WHATSAPP_NUMBER ?? '971585063316';

interface PublicProperty {
  id: string;
  code: string;
  name: string;
  area: string | null;
  type: string;
  priceAed: string | null;
  occupancyMax: number | null;
  availabilityConfirmedAt: string | null;
  media: Array<{ file: { id: string; mimeType: string } }>;
}

const TYPE_LABEL: Record<string, string> = {
  studio: 'Studio',
  one_bedroom: '1BR',
  two_bedroom: '2BR',
  three_bedroom: '3BR',
  villa: 'Villa',
  master_room: 'Master room',
  shared_room: 'Shared room',
  bed_space: 'Bed space',
  partition: 'Partition',
  other: 'Other',
};

async function fetchProperties(searchParams: Record<string, string | undefined>): Promise<PublicProperty[]> {
  const url = new URL(`${API_BASE}/public/properties`);
  for (const [k, v] of Object.entries(searchParams)) {
    if (v) url.searchParams.set(k, v);
  }
  const res = await fetch(url.toString(), { cache: 'no-store' });
  if (!res.ok) return [];
  return res.json();
}

async function fetchAreas(): Promise<string[]> {
  const all = await fetchProperties({});
  const areas = Array.from(new Set(all.map((p) => p.area).filter(Boolean) as string[])).sort();
  return areas;
}

export default async function MarketplacePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const [properties, areas] = await Promise.all([fetchProperties(sp), fetchAreas()]);

  const activeFilter = (k: string) => sp[k] ?? '';

  return (
    <div className="min-h-screen bg-offwhite">
      <header className="bg-navy-deep text-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 md:px-8">
          <div>
            <p className="text-lg font-bold">RentFlow Agent</p>
            <p className="text-xs text-slate-300">Available rentals in Dubai</p>
          </div>
          <Link href="/login" className="text-xs text-slate-300 hover:text-white">
            Operator login →
          </Link>
        </div>
      </header>

      {/* Filters */}
      <form
        method="GET"
        className="mx-auto max-w-7xl px-4 py-4 md:px-8"
      >
        <div className="grid grid-cols-2 gap-2 rounded-lg bg-white p-4 shadow-card md:grid-cols-6">
          <input
            type="text"
            name="q"
            placeholder="Search…"
            defaultValue={activeFilter('q')}
            className="col-span-2 rounded-md border border-gray-light px-3 py-2 text-sm md:col-span-2"
          />
          <select
            name="area"
            defaultValue={activeFilter('area')}
            className="rounded-md border border-gray-light px-3 py-2 text-sm"
          >
            <option value="">All areas</option>
            {areas.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
          <select
            name="type"
            defaultValue={activeFilter('type')}
            className="rounded-md border border-gray-light px-3 py-2 text-sm"
          >
            <option value="">Any type</option>
            <option value="studio">Studio</option>
            <option value="one_bedroom">1 Bedroom</option>
            <option value="two_bedroom">2 Bedroom</option>
            <option value="three_bedroom">3 Bedroom</option>
            <option value="villa">Villa</option>
            <option value="master_room">Master room</option>
            <option value="shared_room">Shared room</option>
          </select>
          <input
            type="number"
            name="minPrice"
            placeholder="Min AED"
            defaultValue={activeFilter('minPrice')}
            className="rounded-md border border-gray-light px-3 py-2 text-sm"
          />
          <input
            type="number"
            name="maxPrice"
            placeholder="Max AED"
            defaultValue={activeFilter('maxPrice')}
            className="rounded-md border border-gray-light px-3 py-2 text-sm"
          />
          <label className="col-span-2 flex items-center gap-2 text-sm md:col-span-1">
            <input
              type="checkbox"
              name="availableNow"
              value="true"
              defaultChecked={activeFilter('availableNow') === 'true'}
              className="h-4 w-4"
            />
            Available now
          </label>
          <select
            name="sort"
            defaultValue={activeFilter('sort')}
            className="rounded-md border border-gray-light px-3 py-2 text-sm"
          >
            <option value="">Recently updated</option>
            <option value="price_asc">Price ↑</option>
            <option value="price_desc">Price ↓</option>
            <option value="newest">Newest</option>
          </select>
          <button
            type="submit"
            className="col-span-2 rounded-md bg-teal px-4 py-2 text-sm font-semibold text-white hover:bg-[#008C8A] md:col-span-1"
          >
            Apply
          </button>
        </div>

        {Object.values(sp).some(Boolean) ? (
          <div className="mt-2">
            <Link href="/" className="text-xs font-semibold text-teal hover:underline">
              Clear filters
            </Link>
          </div>
        ) : null}
      </form>

      {/* Results */}
      <main className="mx-auto max-w-7xl px-4 pb-12 md:px-8">
        <p className="mb-4 text-sm text-gray-medium">{properties.length} property(ies)</p>
        {properties.length === 0 ? (
          <div className="rounded-lg bg-white p-12 text-center shadow-card">
            <p className="text-lg font-semibold text-navy-deep">No properties match these filters.</p>
            <p className="mt-2 text-sm text-gray-medium">Try adjusting your search.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {properties.map((p) => (
              <PropertyCard key={p.id} property={p} />
            ))}
          </div>
        )}
      </main>

      <footer className="border-t border-gray-light bg-white py-6 text-center text-xs text-gray-medium">
        <p>WhatsApp us anytime: <a href={`https://wa.me/${WA_NUMBER}`} className="text-teal hover:underline">+{WA_NUMBER.replace(/(\d{3})(\d{2})(\d{3})(\d+)/, '$1 $2 $3 $4')}</a></p>
      </footer>
    </div>
  );
}

function PropertyCard({ property }: { property: PublicProperty }) {
  const photo = property.media[0]?.file;
  return (
    <Link
      href={`/p/${property.code}`}
      className="group overflow-hidden rounded-lg bg-white shadow-card transition-shadow hover:shadow-lg"
    >
      <div className="aspect-[4/3] w-full overflow-hidden bg-offwhite">
        {photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`${API_BASE}/public/files/${photo.id}`}
            alt={property.name}
            className="h-full w-full object-cover transition-transform group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-gray-medium">No photo</div>
        )}
      </div>
      <div className="p-3">
        <div className="mb-1 flex items-center justify-between">
          <span className="rounded-full bg-teal/10 px-2 py-0.5 text-xs font-semibold text-teal">
            {TYPE_LABEL[property.type] ?? property.type}
          </span>
          <span className="font-mono text-xs text-gray-medium">{property.code}</span>
        </div>
        <p className="line-clamp-2 text-sm font-semibold text-navy-deep">{property.name}</p>
        <p className="mt-1 text-xs text-gray-medium">{property.area ?? '—'}</p>
        <div className="mt-2 flex items-end justify-between">
          <p className="text-base font-bold text-navy-deep">
            {property.priceAed ? `AED ${Number(property.priceAed).toLocaleString()}` : '—'}
            <span className="text-xs font-normal text-gray-medium">/month</span>
          </p>
          {property.occupancyMax ? (
            <p className="text-xs text-gray-medium">Up to {property.occupancyMax} guests</p>
          ) : null}
        </div>
      </div>
    </Link>
  );
}
