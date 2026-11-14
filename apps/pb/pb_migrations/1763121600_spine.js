/// <reference path="../pb_data/types.d.ts" />
// Shared spine, week 1: crews, player accounts, research consent ledger, append-only event store.
// Separation rule: this database belongs to the games alone. Never shared with Decidrs, Baseline or Platform.
migrate((app) => {
  // Crews: host groups that players join through an invite code. Server-managed only.
  const crews = new Collection({
    type: "base",
    name: "crews",
    listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { name: "code", type: "text", required: true, min: 4, max: 32, pattern: "^[A-Z0-9-]+$" },
      { name: "label", type: "text", required: true, max: 80 },
      { name: "created", type: "autodate", onCreate: true, onUpdate: false },
    ],
    indexes: ["CREATE UNIQUE INDEX idx_crews_code ON crews (code)"],
  });
  app.save(crews);

  // Players: the default auth collection, locked down. Self-registration is OFF (GC-6):
  // accounts are created only by the app server after the age declaration.
  const users = app.findCollectionByNameOrId("users");
  users.listRule = "id = @request.auth.id";
  users.viewRule = "id = @request.auth.id";
  users.createRule = null;
  users.updateRule = null;
  users.deleteRule = null;
  users.fields.add(new TextField({ name: "player_ref", required: true, min: 12, max: 32 }));
  users.fields.add(new RelationField({ name: "crew", collectionId: crews.id, maxSelect: 1, cascadeDelete: false }));
  users.addIndex("idx_users_player_ref", true, "player_ref", "");
  // No names collected: drop the template's name and avatar fields if present.
  for (const f of ["name", "avatar"]) { if (users.fields.getByName(f)) users.fields.removeByName(f); }
  app.save(users);

  // Consent ledger: append-only, wording-versioned. The single source of consent truth for the games.
  const consent = new Collection({
    type: "base",
    name: "consent_events",
    listRule: "player = @request.auth.id", viewRule: "player = @request.auth.id",
    createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { name: "player", type: "relation", required: true, collectionId: users.id, maxSelect: 1, cascadeDelete: false },
      { name: "action", type: "select", required: true, maxSelect: 1, values: ["grant", "withdraw"] },
      { name: "purpose", type: "select", required: true, maxSelect: 1, values: ["research"] },
      { name: "wording_version", type: "text", required: true, max: 64 },
      { name: "surface", type: "select", required: true, maxSelect: 1, values: ["web", "ios", "android"] },
      { name: "seq", type: "number", required: true, onlyInt: true, min: 1 },
      { name: "created", type: "autodate", onCreate: true, onUpdate: false },
    ],
    indexes: ["CREATE UNIQUE INDEX idx_consent_player_seq ON consent_events (player, seq)"],
  });
  app.save(consent);

  // Event store: append-only. Events are truth; every score is derived from them.
  const events = new Collection({
    type: "base",
    name: "events",
    listRule: "player = @request.auth.id", viewRule: "player = @request.auth.id",
    createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { name: "player", type: "relation", required: true, collectionId: users.id, maxSelect: 1, cascadeDelete: false },
      { name: "type", type: "text", required: true, max: 64, pattern: "^[a-z][a-z0-9_.]*$" },
      { name: "payload", type: "json", maxSize: 20000 },
      { name: "game", type: "text", max: 32 },
      { name: "item_version", type: "text", max: 64 },
      { name: "scoring_version", type: "text", max: 32 },
      { name: "serving_version", type: "text", max: 64 },
      { name: "surface", type: "select", required: true, maxSelect: 1, values: ["web", "ios", "android", "server"] },
      { name: "consent_research", type: "bool" },
      { name: "consent_wording_version", type: "text", max: 64 },
      { name: "client_ts", type: "text", max: 40 },
      { name: "created", type: "autodate", onCreate: true, onUpdate: false },
    ],
    indexes: ["CREATE INDEX idx_events_player_created ON events (player, created)", "CREATE INDEX idx_events_type ON events (type)"],
  });
  app.save(events);
}, (app) => {
  for (const n of ["events", "consent_events", "crews"]) {
    try { app.delete(app.findCollectionByNameOrId(n)); } catch (_) {}
  }
});
