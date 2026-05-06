import type { Metadata, Viewport } from 'next';
import './globals.css';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: 'RentFlow Agent',
  description: 'Rental conversion operating system',
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
