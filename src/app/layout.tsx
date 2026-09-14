import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";

import { SignOutButton } from "@/components/sign-out-button";
import { getSession } from "@/lib/auth";

import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "TrustTab — verified agent-ready forms",
  description:
    "TrustTab verifies which of your site's forms are safe and correctly structured for AI agents to act on, and issues a badge anyone can check.",
  // Dogfooding: set AGENTTRUST_VERIFY_TOKEN to have this deployment publish
  // its own verification tag, so a TrustTab instance can claim its own domain.
  other: process.env.AGENTTRUST_VERIFY_TOKEN
    ? { "agenttrust-verify": process.env.AGENTTRUST_VERIFY_TOKEN }
    : undefined,
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const session = await getSession();

  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col font-sans">
        <header className="border-b border-zinc-200 bg-white">
          <nav className="mx-auto flex max-w-4xl items-center justify-between px-4 py-3">
            <Link href="/" className="font-semibold tracking-tight">
              TrustTab
            </Link>
            <div className="flex items-center gap-4 text-sm">
              {session ? (
                <>
                  <Link href="/dashboard" className="hover:underline">
                    Dashboard
                  </Link>
                  <span className="hidden text-zinc-500 sm:inline">{session.user.email}</span>
                  <SignOutButton />
                </>
              ) : (
                <>
                  <Link href="/login" className="hover:underline">
                    Log in
                  </Link>
                  <Link
                    href="/signup"
                    className="rounded-md bg-zinc-900 px-3 py-1.5 text-white hover:bg-zinc-700"
                  >
                    Get verified
                  </Link>
                </>
              )}
            </div>
          </nav>
        </header>
        <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-10">{children}</main>
        <footer className="border-t border-zinc-200 py-6 text-center text-xs text-zinc-500">
          TrustTab is open source under the MIT license.
        </footer>
      </body>
    </html>
  );
}
