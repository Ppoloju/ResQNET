package com.resqnet.mesh

/**
 * Android production transport boundary.
 *
 * Implement with BluetoothLeAdvertiser/BluetoothLeScanner and a foreground
 * service. Wi-Fi Direct uses WifiP2pManager and a TCP socket carrying the same
 * MeshFrame bytes. The app must persist the outbox and dedupe packet ids.
 */
interface NativeMeshTransport {
    suspend fun start(): TransportState
    suspend fun stop()
    suspend fun send(peerId: String, frame: ByteArray): SendResult
    fun onFrame(listener: (peerId: String, frame: ByteArray) -> Unit): Closeable
}

interface Closeable {
    fun close()
}

data class SendResult(
    val peerId: String,
    val accepted: Boolean,
    val transport: TransportKind,
)

enum class TransportKind { BLE, WIFI_DIRECT }

enum class TransportState { READY, PERMISSION_NEEDED, UNAVAILABLE }

/** Required Android permissions/features for the host application. */
object NativeMeshRequirements {
    val permissions = listOf(
        "android.permission.BLUETOOTH_SCAN",
        "android.permission.BLUETOOTH_CONNECT",
        "android.permission.BLUETOOTH_ADVERTISE",
        "android.permission.ACCESS_FINE_LOCATION",
        "android.permission.NEARBY_WIFI_DEVICES",
        "android.permission.FOREGROUND_SERVICE_CONNECTED_DEVICE",
    )
}
