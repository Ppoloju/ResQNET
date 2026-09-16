// IQOO core domain types (§10, §12, §20)
// Shared by backend, frontend, and the mesh simulator.

export type Priority = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

export type Severity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export type PacketType =
  | 'SOS'
  | 'QUICK_HELP'
  | 'RESOLUTION'
  | 'DISASTER_BROADCAST'
  | 'CHECK_IN'
  | 'ACK'
  | 'HEARTBEAT';

export type EmergencyCategory =
  | 'ACCIDENT'
  | 'FIRE'
  | 'MEDICAL'
  | 'PERSONAL_SAFETY'
  | 'MISSING_PERSON'
  | 'NATURAL_DISASTER'
  | 'VEHICLE'
  | 'CROWD'
  | 'UNKNOWN';

export type LocationState =
  | 'GPS_AVAILABLE'
  | 'NETWORK_LOCATION_AVAILABLE'
  | 'LAST_KNOWN_LOCATION'
  | 'LOCATION_UNAVAILABLE';

/** Privacy tiers for emergency profile visibility (§7). Default PRIVATE. */
export type ProfileVisibility = 'PRIVATE' | 'FAMILY' | 'RESPONDERS' | 'NEARBY_HELPERS';

export interface GeoLocation {
  latitude: number;
  longitude: number;
  /** GPS accuracy in meters; required whenever locationState is not UNAVAILABLE. */
  accuracyMeters: number | null;
  state: LocationState;
}

export interface EmergencyPacket {
  /** Unique packet id: msg_<random> — NOT the emergency id (one emergency → many packets). */
  id: string;
  /** Emergency id: IQ-XXXXXXXX */
  emergencyId: string;
  senderId: string;
  senderPublicId: string;
  type: PacketType;
  priority: Priority;
  timestamp: number;
  location: GeoLocation;
  battery: number | null;
  message: string;
  hopCount: number;
  ttl: number;              // seconds
  profileRef?: string;      // opaque reference; medical payload never embedded by default
  requiresMedicalHelp: boolean;
  requiresPoliceHelp: boolean;
  /** Extra context from local AI classification (§15/§17) — advisory only. */
  ai?: {
    category: EmergencyCategory;
    severity: Severity;
    confidence: number;
    recommendedAction: string;
  };
  /** Hex HMAC-SHA256 over canonical serialization. */
  signature: string;
}
