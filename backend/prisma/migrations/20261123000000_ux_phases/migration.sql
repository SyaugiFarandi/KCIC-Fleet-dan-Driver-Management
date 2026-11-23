-- UX phases 1-3: notification preferences and per-vehicle checklist templates
ALTER TABLE "User" ADD COLUMN "notificationPrefs" JSONB;
ALTER TABLE "Vehicle" ADD COLUMN "checklistTemplate" JSONB;
