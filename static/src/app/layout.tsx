import type { Metadata } from "next";
import { Inter } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Strange Capital - Investment & Trading Education",
  description: "We aim to be the best investment firm ever conceived. Learn winning investment and trading strategies with our hands-on training courses.",
  keywords: "investment, trading, education, stock market, wealth generation, trading strategies",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <nav className="bg-white shadow-sm">
          <div className="container mx-auto px-4 py-4">
            <div className="flex justify-between items-center">
              <Link href="/" legacyBehavior>
                <a className="text-2xl font-bold text-blue-900">Strange Capital</a>
              </Link>
              <div className="hidden md:flex space-x-8">
                <Link href="/" legacyBehavior>
                  <a className="hover:text-blue-600 transition-colors">Home</a>
                </Link>
                <Link href="#services" legacyBehavior>
                  <a className="hover:text-blue-600 transition-colors">What we do</a>
                </Link>
                <Link href="#education" legacyBehavior>
                  <a className="hover:text-blue-600 transition-colors">Education</a>
                </Link>
                <Link href="#contact" legacyBehavior>
                  <a className="hover:text-blue-600 transition-colors">Contact</a>
                </Link>
              </div>
            </div>
          </div>
        </nav>
        {children}
      </body>
    </html>
  );
}
