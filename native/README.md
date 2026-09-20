# ResQNET Native Mesh Layer

This directory defines the production transport boundary for Android and iOS.
The browser PWA cannot run background BLE advertising/scanning or Wi-Fi Direct,
so these clients own discovery, persistence, forwarding, and lifecycle services.

## Shared protocol

Native transports exchange UTF-8 JSON frames defined in `shared/src/meshFrame.ts`:

- BLE service: `6e400001-b5a3-f393-e0a9-e50e24dcca9e`
- BLE TX characteristic: `6e400002-b5a3-f393-e0a9-e50e24dcca9e`
- BLE RX characteristic: `6e400003-b5a3-f393-e0a9-e50e24dcca9e`
- Frame protocol: `RESQNET/1`, packet or ACK frame
- Maximum frame size: 48,000 UTF-8 bytes
- Every received packet must pass schema, TTL, hop, timestamp, and signature validation before forwarding.

## Android

The Android client must provide:

- Foreground service for active relay operation
- `BluetoothLeAdvertiser` service advertisement
- `BluetoothLeScanner` peer discovery with rotating anonymous device IDs
- GATT server/client packet exchange with MTU-aware frame fragmentation
- Wi-Fi Direct discovery and TCP socket transport
- Persistent encrypted outbox and dedupe cache
- Battery-aware forwarding and boot restart for active SOS

See `android/NativeMeshTransport.kt` for the platform interface.

## iOS

The iOS client must provide:

- `CoreBluetooth` peripheral/central transport
- `MultipeerConnectivity` transport for local peer networking
- Background execution within Apple platform limits
- Persistent encrypted outbox and dedupe cache
- Battery-aware forwarding and active-SOS restoration

See `ios/NativeMeshTransport.swift` for the platform interface.

These source files are protocol-aligned interfaces and require native project
build settings, permissions, signing, and real-device validation. They are not
claimed as a browser implementation.
