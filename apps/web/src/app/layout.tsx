import type { Metadata } from 'next';
import './globals.css';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: 'RentFlow Agent',
  description: 'Rental conversion operating system',
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
