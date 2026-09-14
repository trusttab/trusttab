import Link from "next/link";

// Day-1 landing page: enough to explain the product and route people into the
// sign-up flow. Real copy, screenshots and the badge preview come later.
export default function Home() {
  return (
    <div className="space-y-12">
      <section className="space-y-5 pt-6">
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
          Show AI agents which of your forms they can trust.
        </h1>
        <p className="max-w-2xl text-lg text-zinc-600">
          AI agents are starting to fill out contact forms, book appointments and open support
          tickets on people&apos;s behalf. TrustTab lets you declare which of your forms are safe and
          correctly structured for an agent to use, verifies that claim automatically, and gives you
          a badge anyone can check against a public registry.
        </p>
        <div className="flex gap-3">
          <Link
            href="/signup"
            className="rounded-md bg-zinc-900 px-4 py-2 font-medium text-white hover:bg-zinc-700"
          >
            Get verified
          </Link>
          <Link
            href="/login"
            className="rounded-md border border-zinc-300 bg-white px-4 py-2 font-medium hover:bg-zinc-100"
          >
            Log in
          </Link>
        </div>
      </section>

      <section className="grid gap-6 sm:grid-cols-3">
        {[
          {
            title: "1. Prove you own the domain",
            body: "Add one meta tag to your homepage. No DNS changes.",
          },
          {
            title: "2. Declare your agent-safe forms",
            body: "Publish a signed manifest at /.well-known/agent-trust.json.",
          },
          {
            title: "3. Get checked, get a badge",
            body: "We confirm your forms match the manifest and scan for hidden prompt injection.",
          },
        ].map((step) => (
          <div key={step.title} className="rounded-lg border border-zinc-200 bg-white p-5">
            <h2 className="font-medium">{step.title}</h2>
            <p className="mt-2 text-sm text-zinc-600">{step.body}</p>
          </div>
        ))}
      </section>

      <p className="text-sm text-zinc-500">
        TrustTab isn&apos;t an agent-identity or payments protocol. It complements efforts like
        Visa&apos;s Trusted Agent Protocol and Google&apos;s AP2, which verify the <em>agent</em>. TrustTab
        verifies the <em>site</em>: that its forms are what they claim to be, with no hidden content
        trying to manipulate the agent filling them in.
      </p>
    </div>
  );
}
