import express from "express";
import fs from "node:fs";
import httpolyglot from "httpolyglot";
import mediasoup from "mediasoup";
import { Server } from "socket.io";
import { config } from "./config.js";
import { createRoomStore } from "./roomStore.js";

const app = express();
const tlsOptions = {
  key: fs.readFileSync(config.server.tlsKeyPath, "utf8"),
  cert: fs.readFileSync(config.server.tlsCertPath, "utf8"),
};
const server = httpolyglot.createServer(tlsOptions, app);
const io = new Server(server, {
  cors: {
    origin: config.server.corsOrigins,
    methods: ["GET", "POST"],
  },
});
const connections = io.of("/mediasoup");
const store = createRoomStore();

const mediaCodecs = [
  {
    kind: "audio",
    mimeType: "audio/opus",
    clockRate: 48000,
    channels: 2,
  },
  {
    kind: "video",
    mimeType: "video/VP8",
    clockRate: 90000,
    parameters: {
      "x-google-start-bitrate": 1000,
    },
  },
];

const worker = await mediasoup.createWorker({
  rtcMinPort: config.mediasoup.rtcMinPort,
  rtcMaxPort: config.mediasoup.rtcMaxPort,
});

worker.on("died", () => {
  console.error("mediasoup worker died");
  setTimeout(() => process.exit(1), 2000);
});

const createWebRtcTransport = async (router) => {
  const transport = await router.createWebRtcTransport({
    listenIps: [
      {
        ip: config.mediasoup.listenIp,
        announcedIp: config.mediasoup.announcedIp,
      },
    ],
    enableUdp: true,
    enableTcp: true,
    preferUdp: true,
  });

  transport.on("dtlsstatechange", (state) => {
    if (state === "closed") transport.close();
  });

  return transport;
};

const getPeerOrReply = (socket, callback) => {
  const peerData = store.getPeer(socket.id);

  if (!peerData) {
    callback?.({ error: "Join a room before using media transports" });
  }

  return peerData;
};

connections.on("connection", (socket) => {
  socket.emit("connection-success", { socketId: socket.id });

  socket.on("disconnect", () => {
    const peerData = store.getPeer(socket.id);
    if (peerData) socket.to(peerData.roomName).emit("peer-left", { peerId: socket.id });
    store.removePeer(socket.id);
  });

  socket.on("joinRoom", async ({ roomName, name }, callback) => {
    try {
      if (typeof roomName !== "string" || !roomName.trim()) {
        callback({ error: "A room name is required" });
        return;
      }

      const userName =
        typeof name === "string" && name.trim() ? name.trim() : "Anonymous";
      const previousRoomName = store.getPeer(socket.id)?.roomName;
      if (previousRoomName) socket.leave(previousRoomName);
      store.removePeer(socket.id);
      const room = await store.ensureRoom(roomName, () =>
        worker.createRouter({ mediaCodecs }),
      );
      store.addPeer(roomName, socket, userName);
      socket.join(roomName);

      callback({ rtpCapabilities: room.router.rtpCapabilities });
    } catch (error) {
      callback({ error: error.message });
    }
  });

  socket.on("createWebRtcTransport", async ({ consumer }, callback) => {
    try {
      const peerData = getPeerOrReply(socket, callback);
      if (!peerData) return;

      const transport = await createWebRtcTransport(peerData.room.router);
      transport.appData = { consumer: Boolean(consumer) };
      peerData.peer.transports.set(transport.id, transport);

      callback({
        params: {
          id: transport.id,
          iceParameters: transport.iceParameters,
          iceCandidates: transport.iceCandidates,
          dtlsParameters: transport.dtlsParameters,
        },
      });
    } catch (error) {
      callback({ params: { error: error.message } });
    }
  });

  socket.on(
    "transport-connect",
    async ({ dtlsParameters, transportId }, callback) => {
      try {
        const peerData = getPeerOrReply(socket, callback);
        const transport = peerData?.peer.transports.get(transportId);

        if (!transport || transport.appData.consumer) {
          callback?.({ error: "Send transport not found" });
          return;
        }

        await transport.connect({ dtlsParameters });
        callback?.({});
      } catch (error) {
        callback?.({ error: error.message });
      }
    },
  );

  socket.on(
    "transport-produce",
    async ({ kind, rtpParameters, transportId }, callback) => {
      try {
        const peerData = getPeerOrReply(socket, callback);
        const transport = peerData?.peer.transports.get(transportId);

        if (!transport || transport.appData.consumer) {
          callback({ error: "Send transport not found" });
          return;
        }

        const producer = await transport.produce({ kind, rtpParameters });
        const producerData = {
          producer,
          peerId: socket.id,
          name: peerData.peer.name,
          kind: producer.kind,
          cameraOff: false,
          muted: false,
        };
        peerData.peer.producers.set(producer.id, producerData);
        producer.on("transportclose", () => producer.close());

        socket.to(peerData.roomName).emit("new-producer", {
          producerId: producer.id,
          peerId: socket.id,
          name: peerData.peer.name,
          kind: producer.kind,
          cameraOff: false,
          muted: false,
        });

        const producersExist = [...peerData.room.peers.entries()].some(
          ([peerId, peer]) => peerId !== socket.id && peer.producers.size > 0,
        );

        callback({ id: producer.id, producersExist });
      } catch (error) {
        callback({ error: error.message });
      }
    },
  );

  socket.on(
    "transport-recv-connect",
    async ({ dtlsParameters, transportId }, callback) => {
      try {
        const peerData = getPeerOrReply(socket, callback);
        const transport = peerData?.peer.transports.get(transportId);

        if (!transport || !transport.appData.consumer) {
          callback?.({ error: "Receive transport not found" });
          return;
        }

        await transport.connect({ dtlsParameters });
        callback?.({});
      } catch (error) {
        callback?.({ error: error.message });
      }
    },
  );

  socket.on(
    "consume",
    async ({ rtpCapabilities, remoteProducerId, transportId }, callback) => {
      try {
        const peerData = getPeerOrReply(socket, callback);
        if (!peerData) return;

        const producerMatch = store.findProducer(
          peerData.room,
          remoteProducerId,
        );
        const transport = peerData.peer.transports.get(transportId);

        if (!producerMatch || producerMatch.peerId === socket.id) {
          callback({ params: { error: "Producer not found in this room" } });
          return;
        }

        if (!transport || !transport.appData.consumer) {
          callback({ params: { error: "Receive transport not found" } });
          return;
        }

        if (
          !peerData.room.router.canConsume({
            producerId: remoteProducerId,
            rtpCapabilities,
          })
        ) {
          callback({ params: { error: "Cannot consume this producer" } });
          return;
        }

        const consumer = await transport.consume({
          producerId: remoteProducerId,
          rtpCapabilities,
          paused: true,
        });
        peerData.peer.consumers.set(consumer.id, consumer);

        consumer.on("producerclose", () => {
          socket.emit("producer-closed", {
            remoteProducerId,
            peerId: producerMatch.peerId,
            kind: consumer.kind,
          });
          consumer.close();
          store.getPeer(socket.id)?.peer.consumers.delete(consumer.id);
        });

        callback({
          params: {
            id: consumer.id,
            producerId: remoteProducerId,
            peerId: producerMatch.peerId,
            name: producerMatch.peer.name,
            kind: consumer.kind,
            rtpParameters: consumer.rtpParameters,
            serverConsumerId: consumer.id,
            cameraOff: producerMatch.producerData.cameraOff,
            muted: producerMatch.producerData.muted,
          },
        });
      } catch (error) {
        callback({ params: { error: error.message } });
      }
    },
  );

  socket.on("consumer-resume", async ({ serverConsumerId }, callback) => {
    try {
      const consumer = store
        .getPeer(socket.id)
        ?.peer.consumers.get(serverConsumerId);

      if (!consumer) {
        callback?.({ error: "Consumer not found" });
        return;
      }

      await consumer.resume();
      callback?.({});
    } catch (error) {
      callback?.({ error: error.message });
    }
  });

  socket.on("getProducers", (_payload, callback) => {
    if (typeof callback !== "function") return;

    const peerData = getPeerOrReply(socket, callback);
    if (!peerData) return;

    const producers = [];

    for (const [peerId, peer] of peerData.room.peers) {
      if (peerId === socket.id) continue;

      for (const producerData of peer.producers.values()) {
        producers.push({
          id: producerData.producer.id,
          peerId,
          name: peer.name,
          kind: producerData.kind,
          cameraOff: producerData.cameraOff,
          muted: producerData.muted,
        });
      }
    }

    callback(producers);
  });

  const setProducerPaused = async (producerId, paused, callback) => {
    try {
      const producerData = store
        .getPeer(socket.id)
        ?.peer.producers.get(producerId);

      if (!producerData) {
        callback?.({ error: "Producer not found" });
        return;
      }

      if (paused) {
        await producerData.producer.pause();
      } else {
        await producerData.producer.resume();
      }
      callback?.({});
    } catch (error) {
      callback?.({ error: error.message });
    }
  };

  socket.on("producer-pause", ({ producerId }, callback) => {
    setProducerPaused(producerId, true, callback);
  });

  socket.on("producer-resume", ({ producerId }, callback) => {
    setProducerPaused(producerId, false, callback);
  });

  socket.on("user-muted", ({ producerId, muted }) => {
    const peerData = store.getPeer(socket.id);
    const producerData = peerData?.peer.producers.get(producerId);

    if (!peerData || !producerData || producerData.kind !== "audio") return;

    producerData.muted = Boolean(muted);
    socket.to(peerData.roomName).emit("user-muted", {
      peerId: socket.id,
      producerId,
      muted: producerData.muted,
    });
  });

  socket.on("user-camera", ({ producerId, cameraOff }) => {
    const peerData = store.getPeer(socket.id);
    const producerData = peerData?.peer.producers.get(producerId);

    if (!peerData || !producerData || producerData.kind !== "video") return;

    producerData.cameraOff = Boolean(cameraOff);
    socket.to(peerData.roomName).emit("user-camera", {
      peerId: socket.id,
      producerId,
      cameraOff: producerData.cameraOff,
    });
  });

  socket.on("set-preferred-layers", async ({ consumerId, spatialLayer }, callback) => {
    try {
      const consumer = store.getPeer(socket.id)?.peer.consumers.get(consumerId);
      if (!consumer) { callback?.({ error: "Consumer not found" }); return; }
      if (![0, 1, 2].includes(spatialLayer)) { callback?.({ error: "Invalid spatialLayer" }); return; }
      await consumer.setPreferredLayers({ spatialLayer, temporalLayer: 2 });
      callback?.({});
    } catch (error) {
      callback?.({ error: error.message });
    }
  });

  socket.on("send-message", ({ text }, callback) => {
    try {
      const peerData = getPeerOrReply(socket, callback);
      if (!peerData) return;

      const message = {
        id: `${socket.id}-${Date.now()}`,
        senderId: socket.id,
        name: peerData.peer.name,
        text,
        timestamp: Date.now(),
      };

      socket.to(peerData.roomName).emit("new-message", message);
      callback?.({ message });
    } catch (error) {
      callback?.({ error: error.message });
    }
  });
});

server.listen(config.server.port, () => {
  console.log(`Server listening on port ${config.server.port}`);
  console.log(`mediasoup worker pid ${worker.pid}`);
});
