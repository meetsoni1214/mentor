import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Providers } from './providers';
import { brand } from '../brand/brand';
import '../brand/tokens.css';
import './globals.css';

export const metadata: Metadata = {
  title: brand.name,
  applicationName: brand.name,
  description: brand.description,
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
