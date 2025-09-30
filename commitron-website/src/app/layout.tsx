import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'Commitron - AI-Powered Git Commit Assistant',
  description: 'Intelligently analyze your code changes and generate clear, concise, and context-aware commit messages using Google\'s Gemini AI.',
  keywords: ['git', 'commit', 'ai', 'gemini', 'cli', 'typescript', 'automation', 'commitron'],
  authors: [{ name: 'Sojan Varghese', url: 'https://github.com/sojanvarghese' }],
  creator: 'Sojan Varghese',
  publisher: 'Commitron',
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: 'https://commitron.dev',
    title: 'Commitron - AI-Powered Git Commit Assistant',
    description: 'Intelligently analyze your code changes and generate clear, concise, and context-aware commit messages using Google\'s Gemini AI.',
    siteName: 'Commitron',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Commitron - AI-Powered Git Commit Assistant',
    description: 'Intelligently analyze your code changes and generate clear, concise, and context-aware commit messages using Google\'s Gemini AI.',
    creator: '@sojanvarghese',
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
  verification: {
    google: 'your-google-verification-code',
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className="scroll-smooth">
      <body className={`${inter.className} antialiased`}>
        {children}
      </body>
    </html>
  )
}
