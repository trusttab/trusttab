import { redirect } from "next/navigation";

import { AuthForm } from "@/components/auth-form";
import { getSession } from "@/lib/auth";

export const metadata = { title: "Sign up — TrustTab" };

export default async function SignupPage() {
  if (await getSession()) redirect("/dashboard");
  return <AuthForm mode="signup" />;
}
