# Mediasoup React

A small multi-room video meeting application built with React, Socket.IO, and
mediasoup. Each browser publishes audio and video to a mediasoup SFU and
consumes the other participants in the same room.

## Structure

- `frontend/`: React 19 and Vite client
- `backend/`: HTTPS Socket.IO signaling server and mediasoup worker
- `backend/src/roomStore.js`: room, peer, producer, consumer, and cleanup state
- `frontend/src/services/mediasoupClient.js`: browser media and signaling lifecycle

Room state is currently held in memory. Restarting the backend ends every
active meeting.

## Local Setup

Requirements:

- A supported Node.js release
- A browser with camera and microphone access
- Local TLS files at `backend/certs/key.pem` and `backend/certs/cert.pem`

If you need local self-signed TLS files, generate them before starting the
backend:

```sh
cd backend
mkdir -p certs
openssl req -x509 -newkey rsa:2048 -nodes \
  -keyout certs/key.pem \
  -out certs/cert.pem \
  -days 365 \
  -subj "/CN=localhost"
```

Install and start the backend:

```powershell
cd backend
npm install
npm run dev
```

In another terminal, install and start the frontend:

```powershell
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173`. Two browser windows using the same room code
should exchange audio and video.

## Configuration

Backend variables are documented in `backend/.env.example`:

- `PORT`: signaling server port
- `CORS_ORIGINS`: comma-separated allowed frontend origins
- `TLS_KEY_PATH` and `TLS_CERT_PATH`: local TLS files
- `RTC_MIN_PORT` and `RTC_MAX_PORT`: mediasoup UDP/TCP port range
- `MEDIASOUP_LISTEN_IP`: local bind address
- `MEDIASOUP_ANNOUNCED_IP`: address browsers use to reach the SFU

Provide backend values through the shell, process manager, container, or
hosting platform environment. The application uses the localhost defaults
shown in the example when variables are absent.

Frontend variables are documented in `frontend/.env.example`:

- `VITE_SIGNALING_URL`: Socket.IO mediasoup namespace URL

Vite loads frontend values from `frontend/.env` when that file is present.

For remote deployment, `MEDIASOUP_ANNOUNCED_IP` must be a reachable public or
private network address. Expose the signaling port and the full mediasoup RTC
port range through the firewall. Set `CORS_ORIGINS` and
`VITE_SIGNALING_URL` to the deployed frontend and backend addresses.

## Verification

```powershell
cd backend
npm test
npm run check

cd ../frontend
npm run lint
npm run build
```

The backend tests cover room isolation and deterministic media-resource
cleanup. Browser-level WebRTC behavior still requires a two-browser manual or
end-to-end test because camera, microphone, ICE, and autoplay policies are
browser controlled.
