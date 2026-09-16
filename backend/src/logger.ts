import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  base: { svc: 'iqoo-backend' },
  redact: {
    paths: [
      'password', '*.password', 'req.headers.authorization',
      'secret', '*.secret', 'token', '*.token',
      'medical_conditions', 'allergies', 'medications',
      'emergency_notes', 'profile.medical_conditions', 'profile.allergies', 'profile.medications',
      'emergency_profile_snapshot.medical_conditions',
      'emergency_profile_snapshot.allergies',
      'emergency_profile_snapshot.medications',
    ],
    censor: '[REDACTED]',
  },
});
