import { redirect } from "next/navigation";
import { signIn } from "../../lib/session";

async function doSignIn(formData: FormData) {
  "use server";
  try {
    await signIn(String(formData.get("email") ?? ""), String(formData.get("password") ?? ""));
  } catch {
    redirect("/signin?error=1");
  }
  redirect("/");
}

export default function SignIn({ searchParams }: { searchParams: { error?: string } }) {
  return (
    <main>
      <h2>Sign in</h2>
      {searchParams.error && <p style={{ color: "#a33" }}>Email or password not recognised.</p>}
      <form action={doSignIn} style={{ display: "grid", gap: 12 }}>
        <label>Email <input name="email" type="email" required /></label>
        <label>Password <input name="password" type="password" required /></label>
        <button type="submit">Sign in</button>
      </form>
    </main>
  );
}
