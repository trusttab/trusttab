import { redirect } from "next/navigation";

import { AuthForm } from "@/components/auth-form";
import { emailEnabled, getSession } from "@/lib/auth";

export const metadata = { title: "Log in — TrustTab" };

export default async function LoginPage() {
  if (await getSession()) redirect("/dashboard");
  return <AuthForm mode="login" showForgotPassword={emailEnabled} />;
}
