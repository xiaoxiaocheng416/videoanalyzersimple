import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import '@/styles/globals.css';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Video Analyzer Pro - AI-Powered Video Analysis',
  description: 'Analyze your videos with advanced AI technology powered by Google Gemini',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <div className="min-h-screen bg-gradient-to-b from-background to-muted/20">
          {children}
        </div>
      </body>
    </html>
  );
}