import { redirect } from "next/navigation";
import { config } from "../../lib/config";
import { currentPlayer } from "../../lib/session";
import { spine } from "../../lib/spine";

export const dynamic = "force-dynamic";

async function setConsent(formData: FormData) {
  "use server";
  const player = await currentPlayer();
  if (!player) redirect("/signin");
  const s = await spine();
  if (formData.get("choice") === "grant") await s.grantResearchConsent(player.id, config.researchConsentWordingVersion, "web");
  else await s.withdrawResearchConsent(player.id, config.researchConsentWordingVersion, "web");
  redirect("/");
}

export default async function Consent() {
  const player = await currentPlayer();
  if (!player) redirect("/signin");
  const state = await (await spine()).consentState(player.id);
  return (
    <main>
      <h2>Research consent</h2>
      <p style={{ background: "#fff3cd", padding: 8, fontSize: 13 }}>DRAFT wording ({config.researchConsentWordingVersion}). Final text comes in week 2.</p>
      <p>Playing is free with or without this. If you agree, Strateriq Ltd may use your anonymised game decisions for research. You can withdraw at any time, and all your records are then removed from research use.</p>
      <p>Current choice: <strong>{state.research ? "I agree" : "I do not agree"}</strong></p>
      <form action={setConsent} style={{ display: "flex", gap: 12 }}>
        <button name="choice" value="grant" type="submit" disabled={state.research}>I agree</button>
        <button name="choice" value="withdraw" type="submit" disabled={!state.research && state.seq === 0}>{state.seq === 0 ? "No thanks" : "Withdraw"}</button>
      </form>
    </main>
  );
}
