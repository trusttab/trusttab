/**
 * AI Check, Addition 4: frequently spoofed brands, for the domain-lookalike
 * check. This is the only place brands are defined; append entries to extend.
 *
 * Like the widget signatures and the C2PA trust lists, this list goes stale:
 * brands change domains and new ones get targeted. It is flagged in CLAUDE.md
 * as needing periodic review.
 *
 * - `domains`: the brand's real domains. A page on one of these is the brand
 *   itself, so nothing is ever reported for it.
 * - `token`: the distinctive part of the name, used to spot the brand's name
 *   inside someone else's domain (`paypal-secure.com`,
 *   `paypal.com.security-check.net`).
 * - `commonWord: true` marks names that are ordinary words (apple, target,
 *   chase). For those, only near-miss spellings of the real domain count;
 *   the name appearing in another domain does not, because
 *   "apple-pie-recipes.com" is not a spoof.
 */

export type Brand = {
  name: string;
  domains: string[];
  token: string;
  commonWord?: boolean;
};

export const SPOOFED_BRANDS: Brand[] = [
  // Payments and crypto
  { name: "PayPal", domains: ["paypal.com"], token: "paypal" },
  { name: "Stripe", domains: ["stripe.com"], token: "stripe", commonWord: true },
  { name: "Venmo", domains: ["venmo.com"], token: "venmo" },
  { name: "Cash App", domains: ["cash.app"], token: "cashapp" },
  { name: "Zelle", domains: ["zellepay.com"], token: "zelle" },
  { name: "Western Union", domains: ["westernunion.com"], token: "westernunion" },
  { name: "Coinbase", domains: ["coinbase.com"], token: "coinbase" },
  { name: "Binance", domains: ["binance.com"], token: "binance" },
  { name: "Kraken", domains: ["kraken.com"], token: "kraken", commonWord: true },
  { name: "MetaMask", domains: ["metamask.io"], token: "metamask" },
  { name: "Ledger", domains: ["ledger.com"], token: "ledger", commonWord: true },
  { name: "Trezor", domains: ["trezor.io"], token: "trezor" },

  // Banks and cards
  { name: "Chase", domains: ["chase.com"], token: "chase", commonWord: true },
  { name: "Bank of America", domains: ["bankofamerica.com"], token: "bankofamerica" },
  { name: "Wells Fargo", domains: ["wellsfargo.com"], token: "wellsfargo" },
  { name: "Citibank", domains: ["citi.com", "citibank.com"], token: "citibank" },
  { name: "Capital One", domains: ["capitalone.com"], token: "capitalone" },
  { name: "American Express", domains: ["americanexpress.com", "amex.com"], token: "americanexpress" },
  { name: "HSBC", domains: ["hsbc.com", "hsbc.co.uk"], token: "hsbc" },
  { name: "Barclays", domains: ["barclays.co.uk", "barclays.com"], token: "barclays" },
  { name: "Santander", domains: ["santander.com", "santander.co.uk"], token: "santander" },
  { name: "Lloyds Bank", domains: ["lloydsbank.com"], token: "lloydsbank" },
  { name: "Monzo", domains: ["monzo.com"], token: "monzo" },
  { name: "Revolut", domains: ["revolut.com"], token: "revolut" },
  { name: "USAA", domains: ["usaa.com"], token: "usaa" },
  { name: "Visa", domains: ["visa.com"], token: "visa", commonWord: true },
  { name: "Mastercard", domains: ["mastercard.com"], token: "mastercard" },

  // Big tech and accounts
  { name: "Apple", domains: ["apple.com", "icloud.com"], token: "apple", commonWord: true },
  { name: "Microsoft", domains: ["microsoft.com", "live.com", "office.com", "outlook.com"], token: "microsoft" },
  { name: "Google", domains: ["google.com", "gmail.com"], token: "google" },
  { name: "Amazon", domains: ["amazon.com", "amazon.co.uk", "amazon.de"], token: "amazon" },
  { name: "Meta", domains: ["meta.com"], token: "meta", commonWord: true },
  { name: "Facebook", domains: ["facebook.com"], token: "facebook" },
  { name: "Instagram", domains: ["instagram.com"], token: "instagram" },
  { name: "WhatsApp", domains: ["whatsapp.com"], token: "whatsapp" },
  { name: "LinkedIn", domains: ["linkedin.com"], token: "linkedin" },
  { name: "X (Twitter)", domains: ["x.com", "twitter.com"], token: "twitter" },
  { name: "TikTok", domains: ["tiktok.com"], token: "tiktok" },
  { name: "Netflix", domains: ["netflix.com"], token: "netflix" },
  { name: "Spotify", domains: ["spotify.com"], token: "spotify" },
  { name: "Disney+", domains: ["disneyplus.com"], token: "disneyplus" },
  { name: "Steam", domains: ["steampowered.com", "steamcommunity.com"], token: "steam", commonWord: true },
  { name: "Roblox", domains: ["roblox.com"], token: "roblox" },
  { name: "Discord", domains: ["discord.com", "discord.gg"], token: "discord" },
  { name: "Dropbox", domains: ["dropbox.com"], token: "dropbox" },
  { name: "DocuSign", domains: ["docusign.com", "docusign.net"], token: "docusign" },
  { name: "Adobe", domains: ["adobe.com"], token: "adobe" },
  { name: "Norton", domains: ["norton.com"], token: "norton", commonWord: true },
  { name: "McAfee", domains: ["mcafee.com"], token: "mcafee" },

  // Shopping and delivery
  { name: "eBay", domains: ["ebay.com", "ebay.co.uk"], token: "ebay" },
  { name: "Walmart", domains: ["walmart.com"], token: "walmart" },
  { name: "Target", domains: ["target.com"], token: "target", commonWord: true },
  { name: "Costco", domains: ["costco.com"], token: "costco" },
  { name: "DHL", domains: ["dhl.com"], token: "dhl" },
  { name: "FedEx", domains: ["fedex.com"], token: "fedex" },
  { name: "UPS", domains: ["ups.com"], token: "ups", commonWord: true },
  { name: "USPS", domains: ["usps.com"], token: "usps" },
  { name: "Royal Mail", domains: ["royalmail.com"], token: "royalmail" },
  { name: "Evri", domains: ["evri.com"], token: "evri" },

  // Government and tax
  { name: "IRS", domains: ["irs.gov"], token: "irs" },
  { name: "HMRC", domains: ["hmrc.gov.uk", "gov.uk"], token: "hmrc" },
  { name: "Social Security Administration", domains: ["ssa.gov"], token: "ssa" },
];
