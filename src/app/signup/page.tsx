import { redirect } from "next/navigation";

import { AuthForm } from "@/components/auth-form";
import { getSession } from "@/lib/auth";
import { safeNextPath } from "@/lib/next-path";

export const metadata = { title: "Sign up — TrustTab" };

export default async function SignupPage(props: PageProps<"/signup">) {
  const next = safeNextPath((await props.searchParams).next);
  if (await getSession()) redirect(next);
  return <AuthForm mode="signup" next={next} />;
}
