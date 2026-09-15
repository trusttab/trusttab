import { redirect } from "next/navigation";

import { AuthForm } from "@/components/auth-form";
import { emailEnabled, getSession } from "@/lib/auth";
import { safeNextPath } from "@/lib/next-path";

export const metadata = { title: "Log in — TrustTab" };

export default async function LoginPage(props: PageProps<"/login">) {
  const next = safeNextPath((await props.searchParams).next);
  if (await getSession()) redirect(next);
  return <AuthForm mode="login" showForgotPassword={emailEnabled} next={next} />;
}
