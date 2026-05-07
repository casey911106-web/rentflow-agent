import type { Metadata, Viewport } from 'next';
import './globals.css';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: 'RentFlow Agent',
  description: 'Rental conversion operating system — short, monthly and bed-space rentals in Dubai.',
  icons: {
    icon: '/favicon.png',
    apple: '/brand/logo-mark.png',
  },
  openGraph: {
    title: 'RentFlow Agent',
    description: 'Available rentals in Dubai — Marina, JBR, Palm and more.',
    images: ['/brand/logo-mark.png'],
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    images: ['/brand/logo-mark.png'],
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  themeColor: '#082B5F',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-offwhite font-sans text-near-black antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
