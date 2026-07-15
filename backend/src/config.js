import path from 'node:path'

const numberFromEnv = (name, fallback) => {
  const value = Number(process.env[name] ?? fallback)

  if (!Number.isFinite(value)) {
    throw new Error(`${name} must be a number`)
  }

  return value
}

export const config = {
  server: {
    port: numberFromEnv('PORT', 3000),
    corsOrigins: (
      process.env.CORS_ORIGINS
      ?? process.env.CORS_ORIGIN
      ?? 'http://localhost:5173,http://127.0.0.1:5173'
    )
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
    tlsKeyPath: path.resolve(process.env.TLS_KEY_PATH ?? './certs/key.pem'),
    tlsCertPath: path.resolve(process.env.TLS_CERT_PATH ?? './certs/cert.pem'),
  },
  mediasoup: {
    rtcMinPort: numberFromEnv('RTC_MIN_PORT', 20100),
    rtcMaxPort: numberFromEnv('RTC_MAX_PORT', 20200),
    listenIp: process.env.MEDIASOUP_LISTEN_IP ?? '0.0.0.0',
    announcedIp: process.env.MEDIASOUP_ANNOUNCED_IP ?? '127.0.0.1',
  },
}
