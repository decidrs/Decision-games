import { redirect } from "next/navigation";
import { SpineError } from "@games/spine";
import { spine } from "../../lib/spine";
import { signIn } from "../../lib/session";

async function signUp(formData: FormData) {
  "use server";
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const declared18Plus = formData.get("age") === "yes";
  const inviteCode = String(formData.get("invite") ?? "").trim() || undefined;
  try {
    const s = await spine();
    await s.signUp({ email, password, declared18Plus, inviteCode, surface: "web" });
    await signIn(email, password);
  } catch (e) {
    const code = e instanceof SpineError ? e.code : "signup_failed";
    redirect(`/signup?error=${code}`);
  }
  redirect("/consent");
}

const MESSAGES: Record<string, string> = {
  age_declaration_required: "You need to confirm you are 18 or over to play.",
  invite_code_unknown: "That invite code is not recognised.",
  signup_failed: "That did not work. The email may already be in use, or the password is too short (8 characters or more).",
};

export default function SignUp({ searchParams }: { searchParams: { error?: string } }) {
  const err = searchParams.error ? MESSAGES[searchParams.error] ?? MESSAGES.signup_failed : null;
  return (
    <main>
      <h2>Create an account</h2>
      {err && <p style={{ color: "#a33" }}>{err}</p>}
      <form action={signUp} style={{ display: "grid", gap: 12 }}>
        <label>Email <input name="email" type="email" required autoComplete="email" /></label>
        <label>Password <input name="password" type="password" required minLength={8} autoComplete="new-password" /></label>
        <label>Invite code (if a host gave you one) <input name="invite" /></label>
        <label><input type="checkbox" name="age" value="yes" required /> I am 18 or over</label>
        <button type="submit">Create account</button>
      </form>
      <p style={{ fontSize: 12, color: "#667" }}>We store your email and a random player id. No names.</p>
    </main>
  );
}
