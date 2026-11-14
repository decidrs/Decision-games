# decision-games: doctrine

Games by the studio (name held in config; currently Tin Meteor), starting with Outlier (The Daily Call).
Strateriq Ltd is the company and data controller. British English.

## Separation (Daniel's standing rule, 11 Nov 2026)
Completely separate from Decidrs, the Baseline and the Platform so any of them can be split out or sold:
own repo, own accounts, own consent ledger, own data store and backups. Never read, write or copy code
from decidrs/platform or any Decidrs/Platform database. Any later link to a Decidrs account is a
player-initiated export, never a shared table or login.

## Scientific laws
1. Events are truth; scores are derived and rebuild from events.
2. Anything that shapes meaning is versioned on the record (item, scoring, serving, consent wording).
3. One scoring implementation: packages/scoring-core, used by app, batch and validator.
4. No learned component in scoring. No special-category data. No free text in games 1 to 4.
5. Deviation protocol: flag and wait; never silently change the spec, formulas or items.
6. No Baseline content in any game (honesty firewall).

## Names
Studio and game names come from config, never hard-coded: clearance is pending.

## Hosting (pre-live)
MVP Lab pattern: Next.js + TypeScript app and a dedicated PocketBase (pinned 0.39.7), migrations in the
repo, deployed by Coolify to *.lab.dewolf.co. Lab gotchas GC-1 to GC-22 in Notion "MVP Lab
Infrastructure Baseline" are standing rules. No real player data until consent text, privacy notice and
this repo's own scheduled, restore-tested backup are in place.
Ruled 14 Nov 2026: the MVP Lab is for tests and demos only; anything strategic, including real player
data, goes on the OVH box, in the games' own database instance with its own backup.

## Spec
"The Daily Call: scoring spec v0.1 and week 1 plan" (Claude Doc), scoring version dc-1.
