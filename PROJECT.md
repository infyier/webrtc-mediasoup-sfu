# mediasoup-react — Project Documentation

A multi-room video conferencing app built with **React**, **Socket.IO**, and **mediasoup**.  
Each browser publishes audio/video to a mediasoup SFU and consumes all other participants in the same room.

---

## Table of Contents

1. [Problem Statement](#1-problem-statement)
2. [Tech Stack](#2-tech-stack)
3. [Project Structure](#3-project-structure)
4. [Architecture Overview](#4-architecture-overview)
5. [Communication Channels](#5-communication-channels)
6. [Request Flow](#6-request-flow)
7. [Configuration Reference](#7-configuration-reference)
8. [Local Setup](#8-local-setup)
9. [Key Files to Study](#9-key-files-to-study)
10. [Testing & Verification](#10-testing--verification)
11. [Deployment Notes](#11-deployment-notes)

---

## 1. Problem Statement

Standard peer-to-peer WebRTC (full mesh) does not scale — every participant must upload one stream per remote peer, and CPU/bandwidth grow quadratically with room size.

This project solves that by placing a **Selective Forwarding Unit (SFU)** in the middle:

- Each browser **uploads once** to the server.
- The server **forwards** each stream to the other participants.
- Upload bandwidth stays constant regardless of room size.

---

## 2. Tech Stack

| Layer | Technology |
|---|---|
| Frontend framework | React 19 + Vite 7 |
| Frontend routing | React Router DOM v7 |
| Client-side WebRTC | `mediasoup-client` v3 |
| Client signaling | `socket.io-client` v4 |
| Backend runtime | Node.js (ESM, `"type": "module"`) |
| Backend HTTP | Express v5 + `httpolyglot` (HTTP/HTTPS on same port) |
| Backend signaling | Socket.IO v4 |
| SFU media server | `mediasoup` v3 |
| TLS | Self-signed via OpenSSL (local), or external certs (production) |

---

## 3. Project Structure

```
mediasoup-react/
├── README.md
├── PROJECT.md                      ← this file
│
├── backend/
│   ├── src/
│   │   ├── app.js                  ← Entry point: HTTPS server, Socket.IO, mediasoup worker setup
│   │   ├── config.js               ← All env-var driven configuration
│   │   └── roomStore.js            ← In-memory state: rooms, peers, producers, consumers
│   ├── test/                       ← Backend unit tests (Node built-in test runner)
│   ├── certs/                      ← TLS key + cert (gitignored)
│   └── .env.example                ← Documented backend environment variables
│
└── frontend/
    ├── index.html                  ← Vite HTML shell
    ├── src/
    │   ├── main.jsx                ← React entry point, router setup
    │   ├── App.jsx                 ← Root component + route declarations
    │   ├── App.css                 ← Global styles
    │   ├── pages/
    │   │   ├── LandingPage.jsx     ← Room code entry UI
    │   │   ├── Meeting.jsx         ← Live meeting page, renders video tiles
    │   │   └── Disconnected.jsx    ← Shown on socket disconnect
    │   └── services/
    │       └── mediasoupClient.js  ← All signaling + WebRTC lifecycle logic
    ├── vite.config.js
    └── .env.example                ← Documented frontend environment variables
```

---

## 4. Architecture Overview

```
┌──────────────────────────────────────────────────────┐
│                    Browser (React)                    │
│                                                       │
│  LandingPage ──► Meeting.jsx                          │
│                      │                               │
│             mediasoupClient.js                        │
│            ┌──────────┴──────────┐                   │
│        Socket.IO              WebRTC                  │
│        (signaling)          (RTP/UDP)                 │
└────────────┼───────────────────┼────────────────────┘
             │                   │
             ▼                   ▼
┌──────────────────────────────────────────────────────┐
│                  Node.js Backend                      │
│                                                       │
│   app.js  ──► Socket.IO handlers                     │
│                    │                                  │
│              roomStore.js                             │
│         (rooms / peers / producers / consumers)       │
│                    │                                  │
│           mediasoup Worker                            │
│           ├── Router (per room)                       │
│           ├── WebRtcTransport (send + recv per peer)  │
│           ├── Producer  (one per track published)     │
│           └── Consumer  (one per remote track)        │
└──────────────────────────────────────────────────────┘
```

> Room state is **in-memory only**. Restarting the backend terminates all active meetings.

---

## 5. Communication Channels

Two completely separate channels run in parallel once a meeting starts:

| Channel | Protocol | Carries |
|---|---|---|
| **Signaling** | Socket.IO over HTTPS/WSS | Negotiation events (RTP capabilities, transport params, ICE candidates, producer/consumer IDs) |
| **Media** | WebRTC (DTLS + SRTP over UDP/TCP) | Actual audio and video packets — never touches Socket.IO |

---

## 6. Request Flow

The complete sequence from opening the page until two users can see each other:

```
Browser A                        Server                         Browser B
   │                               │                               │
   │── open http://localhost:5173 ─►│                               │
   │   (LandingPage: enter room)    │                               │
   │                               │                               │
   │── socket.emit('join-room') ───►│                               │
   │◄── routerRtpCapabilities ──────│                               │
   │                               │                               │
   │── loadDevice(capabilities) (local only)                       │
   │                               │                               │
   │── createSendTransport ────────►│                               │
   │◄── transportParams ────────────│                               │
   │── transport.connect() ────────►│ (ICE + DTLS handshake)        │
   │── transport.produce(track) ───►│                               │
   │◄── producerId ─────────────────│                               │
   │                               │                               │
   │                               │◄── join-room ─────────────────│
   │                               │──► routerRtpCapabilities ─────►│
   │                               │◄── createSendTransport ────────│
   │                               │──► transportParams ────────────►│
   │                               │◄── transport.produce() ────────│
   │                               │──► producerId ─────────────────►│
   │                               │                               │
   │◄── new-producer event ─────────│──► new-producer event ─────────│
   │                               │                               │
   │── createRecvTransport ────────►│◄── createRecvTransport ────────│
   │◄── transportParams ────────────│──► transportParams ────────────►│
   │── consume(producerId) ────────►│◄── consume(producerId) ────────│
   │◄── consumerParams ─────────────│──► consumerParams ─────────────►│
   │                               │                               │
   │  RTP flows: A ◄──── SFU ────► B  (video visible on both sides)│
```

---

## 7. Configuration Reference

### Backend (`backend/.env`)

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | Signaling server port |
| `CORS_ORIGINS` | `http://localhost:5173` | Comma-separated allowed frontend origins |
| `TLS_KEY_PATH` | `./certs/key.pem` | Path to TLS private key |
| `TLS_CERT_PATH` | `./certs/cert.pem` | Path to TLS certificate |
| `RTC_MIN_PORT` | `20100` | Lower bound of mediasoup UDP port range |
| `RTC_MAX_PORT` | `20200` | Upper bound of mediasoup UDP port range |
| `MEDIASOUP_LISTEN_IP` | `0.0.0.0` | Local IP the SFU binds to |
| `MEDIASOUP_ANNOUNCED_IP` | `127.0.0.1` | IP browsers use to reach the SFU (must be public on remote deployments) |

### Frontend (`frontend/.env`)

| Variable | Default | Description |
|---|---|---|
| `VITE_SIGNALING_URL` | `https://localhost:3000` | Socket.IO signaling server URL |

---

## 8. Local Setup

### Step 1 — Generate TLS certificates (first time only)

```sh
cd backend
mkdir -p certs
openssl req -x509 -newkey rsa:2048 -nodes \
  -keyout certs/key.pem \
  -out certs/cert.pem \
  -days 365 \
  -subj "/CN=localhost"
```

### Step 2 — Start the backend

```sh
cd backend
npm install
npm run dev       # nodemon watches for file changes
```

### Step 3 — Start the frontend

```sh
cd frontend
npm install
npm run dev       # Vite dev server at http://localhost:5173
```

### Step 4 — Test it

Open **two browser tabs** at `http://localhost:5173`, enter the same room code in both — audio and video should appear on both sides.

> **Note**: Browsers will warn about the self-signed certificate.  
> Accept it (usually via "Advanced → Proceed") on first visit.

---

## 9. Key Files to Study

Read these in order to understand the full system:

| # | File | What to learn |
|---|---|---|
| 1 | `backend/src/roomStore.js` | Data model — how rooms, peers, producers, and consumers are stored and cleaned up |
| 2 | `backend/src/app.js` | All Socket.IO event handlers; mediasoup worker and router creation |
| 3 | `backend/src/config.js` | How env vars map to runtime config |
| 4 | `frontend/src/services/mediasoupClient.js` | Browser-side signaling + WebRTC lifecycle (the client mirror of `app.js`) |
| 5 | `frontend/src/pages/Meeting.jsx` | How React drives the media lifecycle and renders video tiles |
| 6 | `frontend/src/pages/LandingPage.jsx` | Entry UX — room creation and join flow |

---

## 10. Testing & Verification

```sh
# Backend — unit tests (room isolation, media resource cleanup)
cd backend
npm test

# Backend — syntax check the entry point
npm run check

# Frontend — ESLint
cd ../frontend
npm run lint

# Frontend — production build (validates bundling)
npm run build
```

> **Browser-level WebRTC** (camera/mic access, ICE negotiation, autoplay policy) still requires a  
> **two-browser manual test** — these cannot be covered by unit tests.

---

## 11. Deployment Notes

For any remote (non-localhost) deployment:

1. Set `MEDIASOUP_ANNOUNCED_IP` to a **reachable public or private IP** address.
2. **Open firewall ports**:
   - Signaling port (default `3000`) — **TCP**
   - Full RTC port range (`RTC_MIN_PORT` – `RTC_MAX_PORT`) — **UDP**
3. Set `CORS_ORIGINS` to the deployed frontend origin (e.g., `https://your-app.com`).
4. Set `VITE_SIGNALING_URL` in `frontend/.env` to the deployed backend URL.
5. Use a **trusted TLS certificate** (e.g., Let's Encrypt) — browsers block camera/mic access on non-secure origins.
