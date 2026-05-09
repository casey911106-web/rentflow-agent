import Link from 'next/link';

const TESTFLIGHT_URL =
  process.env.NEXT_PUBLIC_TESTFLIGHT_URL ?? 'https://testflight.apple.com/join/REPLACE_ME';
const ANDROID_APK_URL =
  process.env.NEXT_PUBLIC_ANDROID_APK_URL ?? 'https://expo.dev/artifacts/eas/bLHnPAi2eYMGhAmTRYyFzh.apk';

const APP_VERSION = '1.0.0';

export const metadata = {
  title: 'Download RentFlow Agent',
  description: 'Get the RentFlow Agent app for iOS or Android.',
};

export default function DownloadPage() {
  return (
    <div className="min-h-screen bg-offwhite">
      <header className="bg-white shadow-sm">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3 md:px-8">
          <Link href="/" className="flex items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/logo-mark.png" alt="" className="h-9 w-9" />
            <span className="text-sm font-semibold text-navy-deep">RentFlow Agent</span>
          </Link>
          <Link href="/login" className="text-xs text-gray-medium hover:text-navy-deep">
            Operator login
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-8 md:px-8 md:py-12">
        <div className="mb-6 text-center">
          <h1 className="text-3xl font-bold text-navy-deep md:text-4xl">
            Download the field-agent app
          </h1>
          <p className="mt-2 text-sm text-gray-medium">
            Manage viewings, log placements, and stay in sync with the team. Version {APP_VERSION}.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {/* iOS */}
          <div className="rounded-md border border-gray-light bg-white p-6 shadow-card">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-black text-white">
                <svg viewBox="0 0 24 24" className="h-6 w-6" fill="currentColor">
                  <path d="M17.05 20.28c-.98.95-2.05.86-3.08.4-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.4C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.53 4.08zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
                </svg>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-medium">iOS</p>
                <p className="text-base font-bold text-navy-deep">iPhone / iPad</p>
              </div>
            </div>

            <p className="mb-4 text-xs text-gray-dark">
              Distributed via TestFlight. You will install the TestFlight app first, then RentFlow.
            </p>

            <a
              href={TESTFLIGHT_URL}
              target="_blank"
              rel="noopener"
              className="block w-full rounded-md bg-black px-4 py-3 text-center text-sm font-bold text-white hover:bg-gray-900"
            >
              Open TestFlight invite ↗
            </a>

            <details className="mt-4 text-xs text-gray-dark">
              <summary className="cursor-pointer font-semibold text-gray-dark">
                How to install
              </summary>
              <ol className="mt-2 list-decimal space-y-1 pl-4 text-gray-medium">
                <li>Tap the button above on your iPhone.</li>
                <li>It opens TestFlight (install if you don&apos;t have it).</li>
                <li>Tap &quot;Accept&quot; → then &quot;Install&quot;.</li>
                <li>Open RentFlow Agent and log in.</li>
              </ol>
            </details>
          </div>

          {/* Android */}
          <div className="rounded-md border border-gray-light bg-white p-6 shadow-card">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#3DDC84] text-white">
                <svg viewBox="0 0 24 24" className="h-6 w-6" fill="currentColor">
                  <path d="M17.523 15.341a1.04 1.04 0 100-2.08 1.04 1.04 0 000 2.08m-11.046 0a1.04 1.04 0 110-2.08 1.04 1.04 0 010 2.08m11.421-6.063l2.078-3.598a.432.432 0 00-.748-.432l-2.105 3.645c-1.61-.735-3.418-1.144-5.323-1.144-1.905 0-3.713.41-5.323 1.144L4.372 5.248a.432.432 0 00-.748.432l2.078 3.598C2.137 11.272.196 14.715 0 18.766h24c-.196-4.05-2.137-7.494-6.102-9.488" />
                </svg>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-medium">Android</p>
                <p className="text-base font-bold text-navy-deep">APK direct install</p>
              </div>
            </div>

            <p className="mb-4 text-xs text-gray-dark">
              Direct APK install. You may need to allow &quot;Install from unknown sources&quot; the first time.
            </p>

            <a
              href={ANDROID_APK_URL}
              target="_blank"
              rel="noopener"
              className="block w-full rounded-md bg-[#3DDC84] px-4 py-3 text-center text-sm font-bold text-white hover:bg-[#2db66e]"
            >
              Download APK ↗
            </a>

            <details className="mt-4 text-xs text-gray-dark">
              <summary className="cursor-pointer font-semibold text-gray-dark">
                How to install
              </summary>
              <ol className="mt-2 list-decimal space-y-1 pl-4 text-gray-medium">
                <li>Tap the button above on your Android phone.</li>
                <li>Open the downloaded file from notifications or your Downloads folder.</li>
                <li>If asked, allow &quot;Install from unknown sources&quot; for your browser.</li>
                <li>Tap &quot;Install&quot; → open RentFlow Agent and log in.</li>
              </ol>
            </details>
          </div>
        </div>

        <div className="mt-8 rounded-md bg-white p-5 text-xs text-gray-medium shadow-card">
          <p className="font-semibold text-navy-deep">Need help?</p>
          <p className="mt-1">
            WhatsApp us at{' '}
            <a href="https://wa.me/971585063316" className="font-semibold text-teal hover:underline">
              +971 58 506 3316
            </a>{' '}
            and we&apos;ll walk you through.
          </p>
        </div>
      </main>
    </div>
  );
}
