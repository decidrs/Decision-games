import Link from "next/link";
import { currentPlayer } from "../lib/session";
import { spine } from "../lib/spine";

export const dynamic = "force-dynamic";

export default async function Home() {
  const player = await currentPlayer();
  if (!player) {
    return (
      <main>
        <p>A daily game about reading the crowd.</p>
        <p><Link href="/signup">Create an account</Link> · <Link href="/signin">Sign in</Link></p>
      </main>
    );
  }
  const s = await spine();
  const consent = await s.consentState(player.id);
  const events = await s.eventsFor(player.id);
  return (
    <main>
      <p>Signed in as <code>{player.playerRef}</code>.</p>
      <p>Research consent: <strong>{consent.research ? "given" : "not given"}</strong> · <Link href="/consent">Change</Link></p>
      <h3>Your events</h3>
      <ol style={{ fontSize: 13 }}>
        {events.map((e) => (
          <li key={e.id}><code>{e.type}</code> · {e.created} · research {e.consentResearch ? "yes" : "no"}</li>
        ))}
      </ol>
      <form action="/signin/out" method="post"><button type="submit">Sign out</button></form>
    </main>
  );
}
