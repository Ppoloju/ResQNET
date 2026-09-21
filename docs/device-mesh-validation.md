# ResQNET Device-to-Device Mesh Validation

This document explains how to verify that the ResQNET device-to-device mesh is actually working. Passing automated tests is necessary, but it is not enough to prove that Bluetooth works between real devices.

## What Is Currently Implemented

The browser implementation supports a foreground mesh path:

- Chrome or Edge Web Bluetooth
- Manual pairing with nearby ResQNET peers
- Multiple paired foreground peers
- Signed packet frames
- Duplicate detection and packet relay
- Backend gateway ingestion
- Offline outbox and later synchronization
- Backend signature verification and idempotent persistence

The browser cannot reliably advertise, scan, or relay while backgrounded. Android and iOS native transport files are interfaces and protocol references, not complete native applications.

## Automated Verification

Run these commands from the repository root:

```powershell
npm test
npm run typecheck
npm run build
```

The backend tests can be run with one worker when the machine is under load:

```powershell
npm run test -w backend -- --run --pool=threads --minWorkers=1 --maxWorkers=1
```

The tests should cover:

- Mesh forwarding and gateway delivery
- Duplicate suppression
- ACKs and retries
- TTL and hop limits
- Battery-aware relay rules
- Offline sync and idempotency
- Signed mesh ingestion
- Tampered packet rejection
- React SOS and outbox behavior

Automated tests do not prove that two physical phones can communicate over Bluetooth.

## Local Backend Smoke Test

Start the backend and confirm the health endpoint:

```powershell
Invoke-WebRequest http://localhost:4000/api/healthz -UseBasicParsing
```

Expected result:

```json
{"ok":true}
```

The backend must be reachable from the phones. For LAN testing, use the computer's LAN IP instead of `localhost`.

## Two-Phone Foreground Test

### Preparation

1. Run the backend on a computer connected to the same Wi-Fi network as both phones.
2. Serve the frontend over HTTPS for deployed testing. Local development may use the LAN Vite URL where supported.
3. Open the app in Chrome on two Android phones.
4. Register or sign in on both phones.
5. Allow location and Bluetooth permissions.
6. Open the Network or Settings page on both phones.
7. Pair each phone with the other through the Bluetooth control.
8. Confirm that both devices show Bluetooth as `READY`.

### Direct Device-to-Device Test

1. Keep Phone A connected to the backend.
2. Keep Phone B connected to the backend.
3. Trigger an SOS on Phone A.
4. Observe Phone B without refreshing the page.
5. Confirm that Phone B receives the packet and records a relay event.
6. Confirm that the emergency appears in the live emergency feed and map.
7. Confirm that the backend records the emergency only once.

A successful test must show all of these:

- Phone A creates a packet with a unique packet ID.
- Phone B receives the same packet ID.
- Phone B does not create a duplicate emergency.
- The packet is accepted by the backend only after signature verification.
- The backend emits the event through SSE.
- Responder or family notifications are created as configured.

## Offline Relay Test

1. Pair Phone A and Phone B.
2. Disconnect Phone A from Wi-Fi or mobile data.
3. Leave Phone B connected to the backend.
4. Trigger an SOS on Phone A.
5. Confirm that Phone A shows the SOS as queued locally.
6. Confirm that Phone B receives the packet over Bluetooth.
7. Confirm that Phone B forwards the signed packet to the backend.
8. Check that the emergency appears in the backend and live feed.
9. Reconnect Phone A to the network.
10. Confirm that the local outbox synchronizes without creating a second emergency.

## Three-Device Relay Test

For a real multi-hop test, use three physical devices: A, B, and C.

1. Pair A with B.
2. Pair B with C.
3. Do not pair A directly with C.
4. Disconnect A from the backend.
5. Trigger an SOS on A.
6. Confirm that B receives and relays the packet.
7. Confirm that C receives the packet from B.
8. Confirm that C or another gateway-connected device submits it to the backend.
9. Verify that the packet ID is unchanged across every hop.
10. Verify that only one emergency row is created.

If A can only reach B and B cannot forward to C, the device mesh is not functioning as a multi-hop mesh.

## Backend Verification

After a successful test, inspect the backend database or responder feed.

Verify:

- One row exists in `emergency_events` for the emergency ID.
- The corresponding signed packet exists in `emergency_messages`.
- The packet signature is valid for the origin device.
- Replaying the same packet does not create another emergency.
- Modifying the message, location, sender, or packet ID causes rejection.
- `received_via` identifies the mesh path or gateway path.
- SSE clients receive the emergency without a page refresh.

The mesh ingest endpoint is:

```text
POST /api/emergencies/mesh/ingest
```

It requires an authenticated receiving device and a signed packet envelope:

```json
{
  "packet": {
    "id": "msg_example",
    "emergencyId": "RQ-ABCDEFGH",
    "senderId": "device-origin",
    "senderPublicId": "RQ_NODE_AB12",
    "type": "SOS",
    "priority": "CRITICAL",
    "timestamp": 0,
    "location": {
      "latitude": 17.4,
      "longitude": 78.5,
      "accuracyMeters": 20,
      "state": "GPS_AVAILABLE"
    },
    "battery": 80,
    "message": "Emergency",
    "hopCount": 0,
    "ttl": 3600,
    "requiresMedicalHelp": true,
    "requiresPoliceHelp": true,
    "signature": "..."
  }
}
```

## Failure Diagnosis

### Bluetooth is unavailable

- Check that the browser is Chrome or Edge.
- Check that the device supports Bluetooth Low Energy.
- Check that the page is served from HTTPS or an allowed local development origin.
- Revoke and re-grant Bluetooth permissions.
- Confirm that the peer exposes the ResQNET service UUID.

### Packet is received but not relayed

- Confirm the receiving device is still in the foreground.
- Confirm that the receiving device has another peer paired.
- Check the Network page for transport status.
- Check the browser console for `PACKET_RECEIVED_RADIO` and `PACKET_RELAYED` events.
- Confirm that the packet ID is not already in the local dedupe cache.

### Backend rejects the packet

- Confirm the sender device is registered in the backend.
- Confirm the packet was not modified during relay.
- Confirm the device secret used to sign the packet matches the backend device record.
- Check packet timestamp, TTL, location, and hop validation.
- Check the backend logs for signature or validation errors.

### Duplicate emergency appears

- Check whether the packet ID changed between hops.
- Check whether the emergency ID changed between hops.
- Confirm the backend database has the expected uniqueness constraints.
- Confirm the receiving device persists its dedupe cache.

## Production Acceptance Criteria

Do not claim that the production mesh works until all of the following pass on physical devices:

- Direct BLE delivery between two devices
- A to B to C multi-hop delivery
- App backgrounding and screen-lock behavior
- Internet loss during SOS creation
- Backend recovery and outbox synchronization
- Device restart with a queued SOS
- Duplicate and replay rejection
- Battery-threshold relay behavior
- Gateway persistence exactly once
- Live responder and family notifications
- Android permission and lifecycle testing
- iOS CoreBluetooth and MultipeerConnectivity testing

## Honest Deployment Boundary

The deployed web app can provide a foreground browser mesh when the browser, permissions, peer pairing, and network conditions support it. A production emergency mesh requires completed Android and iOS native apps with background BLE discovery, persistent encrypted outboxes, packet forwarding, lifecycle handling, and real-device validation.
