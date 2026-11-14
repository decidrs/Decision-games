/// <reference path="../pb_data/types.d.ts" />
// Append-only at the model layer: no request, superuser included, may change or delete
// an event or a consent record. Erasure gets its own audited path later (not in week 1).
onRecordUpdate((e) => {
  throw new BadRequestError("append-only: " + e.record.collection().name + " records cannot be changed");
}, "events", "consent_events");

onRecordDelete((e) => {
  throw new BadRequestError("append-only: " + e.record.collection().name + " records cannot be deleted");
}, "events", "consent_events");
