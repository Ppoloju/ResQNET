# External Notification Integrations

ResQNET now creates a delivery record for each notification channel:

- `SSE`: immediate in-app delivery for linked accounts.
- `SMS`: queued for family members with a phone number.
- `PUSH`: delivered to opted-in browser subscriptions using Web Push/VAPID; Android
  FCM remains a native-client integration.
- `EMERGENCY_SERVICE`: queued for critical medical or police-required events.

External channels are provider-agnostic. Configure HTTP webhook adapters with:

```env
SMS_WEBHOOK_URL=https://your-sms-adapter.example/send
PUSH_WEBHOOK_URL=https://your-push-adapter.example/send
EMERGENCY_SERVICE_WEBHOOK_URL=https://your-dispatch-adapter.example/dispatch
NOTIFICATION_WEBHOOK_TOKEN=replace-with-a-secret
```

For browser push, configure `WEB_PUSH_SUBJECT`, `WEB_PUSH_PUBLIC_KEY`, and
`WEB_PUSH_PRIVATE_KEY`. Users then opt in from Settings. The backend removes expired
subscriptions automatically when a provider returns HTTP 404 or 410.

Each webhook receives a JSON `POST` containing:

```json
{
  "channel": "SMS",
  "notificationId": "ntf_...",
  "emergencyId": "IQ-...",
  "recipient": { "name": "...", "phone": "...", "userId": "..." },
  "emergency": { "severity": "CRITICAL", "message": "...", "type": "SOS" }
}
```

The backend retries failed configured deliveries up to five times. Without a configured provider, external notifications remain visibly `PENDING`; ResQNET never reports SMS, push, or dispatch as delivered just because an emergency was created.

Delivery state and provider errors are available through `GET /api/notifications`. The existing `POST /api/notifications/:id/ack` endpoint remains the application-level acknowledgement for recipients.

Provider responsibilities:

- SMS adapter: integrate the chosen carrier or SMS gateway and validate phone numbers.
- Push adapter: map `userId` to platform push tokens and handle token expiry.
- Emergency-service adapter: authenticate with the agency system, apply dispatch policy, and return an auditable provider response.

This boundary keeps provider credentials out of the frontend and leaves the application usable in local/offline mode.