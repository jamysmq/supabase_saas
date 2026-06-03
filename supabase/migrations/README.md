# Supabase Migrations

These migrations consolidate the loose SQL files currently kept in `supabase/`.

Important: this is an incremental migration set for the current project schema. It does not yet replace a full baseline dump of a brand-new database, because the earliest base schema was created before these loose SQL files existed.

Apply order:

1. `001_platform_core.sql`
2. `002_billing_and_payment_history.sql`
3. `003_appointments_and_service_revenue.sql`
4. `004_message_templates_and_whatsapp_appointments.sql`
5. `005_restaurant_and_plan5.sql`
6. `006_security_and_grants.sql`
7. `007_tenant_whatsapp_inbox.sql`
8. `008_assistente_jack_message_persona.sql`
9. `009_tenant_whatsapp_entry_links.sql`
10. `010_whatsapp_billing_signup_workflow.sql`
11. `011_appointment_service_staff_links.sql`
12. `012_whatsapp_appointment_service_staff_flow.sql`
13. `013_require_service_duration_minutes.sql`
14. `014_tenant_appointment_settings.sql`

Keep the original loose SQL files until these migrations are applied in a staging database and the resulting schema is compared with production.

Diagnostic-only SQL not included in the apply order:

- `supabase/tenant_plan_feature_trigger_diagnostic.sql`
