import Foundation

/// iOS production transport boundary.
///
/// Implement BLE with CoreBluetooth and local peer networking with
/// MultipeerConnectivity. Both transports carry the UTF-8 MeshFrame bytes
/// defined in shared/src/meshFrame.ts.
public protocol NativeMeshTransport {
    func start() async throws -> TransportState
    func stop()
    func send(peerID: String, frame: Data) async throws -> SendResult
    @discardableResult
    func onFrame(_ listener: @escaping (_ peerID: String, _ frame: Data) -> Void) -> AnyObject
}

public enum TransportKind: String {
    case bluetooth
    case multipeer
}

public enum TransportState {
    case ready
    case permissionNeeded
    case unavailable
}

public struct SendResult {
    public let peerID: String
    public let accepted: Bool
    public let transport: TransportKind
}

public enum NativeMeshRequirements {
    public static let bluetoothServiceUUID = "6E400001-B5A3-F393-E0A9-E50E24DCCA9E"
    public static let bluetoothTxUUID = "6E400002-B5A3-F393-E0A9-E50E24DCCA9E"
    public static let bluetoothRxUUID = "6E400003-B5A3-F393-E0A9-E50E24DCCA9E"
    public static let multipeerServiceType = "resqnet-mesh"
}
