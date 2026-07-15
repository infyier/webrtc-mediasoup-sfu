import { io } from "socket.io-client";
import * as mediasoupClient from "mediasoup-client";

const signalingUrl =
  import.meta.env.VITE_SIGNALING_URL ?? "http://localhost:3000/mediasoup";

const videoProducerOptions = {
  encodings: [
    { rid: "r0", maxBitrate: 100000, scalabilityMode: "S1T3" },
    { rid: "r1", maxBitrate: 300000, scalabilityMode: "S1T3" },
    { rid: "r2", maxBitrate: 900000, scalabilityMode: "S1T3" },
  ],
  codecOptions: {
    videoGoogleStartBitrate: 1000,
  },
};

let roomName;
let socket;
let device;
let localStream;
let producerTransport;
let consumerTransport;
let audioProducer;
let videoProducer;
let localVideoEl;
let screenTrack;
let sessionId = 0;
let intentionalStop = false;
let onParticipantsChanged = () => {};
let onDisconnected = () => {};
let onNewMessage = () => {};

const remoteParticipants = new Map();
const remoteConsumers = new Map();
const consumingProducerIds = new Set();

const emitWithAck = (event, payload = {}) =>
  new Promise((resolve, reject) => {
    if (!socket?.connected) {
      reject(new Error("Signaling socket is not connected"));
      return;
    }

    socket.emit(event, payload, (response = {}) => {
      const error = response.error ?? response.params?.error;

      if (error) {
        reject(
          new Error(
            typeof error === "string" ? error : "Signaling request failed",
          ),
        );
        return;
      }

      resolve(response);
    });
  });

const publishParticipants = () => {
  onParticipantsChanged(
    [...remoteParticipants.values()].map((participant) => ({ ...participant })),
  );
};

const notifyDisconnected = () => {
  if (!intentionalStop) onDisconnected();
};

const updateParticipant = (peerId, updates) => {
  const participant = remoteParticipants.get(peerId) ?? {
    peerId,
    name: updates.name ?? "Anonymous",
    audioStream: null,
    videoStream: null,
    muted: false,
    cameraOff: false,
  };

  remoteParticipants.set(peerId, { ...participant, ...updates });
  publishParticipants();
};

const removeProducer = (producerId, peerId, kind) => {
  consumingProducerIds.delete(producerId);
  remoteConsumers.get(producerId)?.close();
  remoteConsumers.delete(producerId);

  const participant = remoteParticipants.get(peerId);
  if (!participant) return;

  const updates =
    kind === "audio"
      ? { audioStream: null, muted: false }
      : { videoStream: null, cameraOff: false };
  const nextParticipant = { ...participant, ...updates };

  if (!nextParticipant.audioStream && !nextParticipant.videoStream) {
    remoteParticipants.delete(peerId);
  } else {
    remoteParticipants.set(peerId, nextParticipant);
  }

  publishParticipants();
};

const configureSocket = () => {
  socket = io(signalingUrl, {
    secure: true,
    rejectUnauthorized: false,
  });

  socket.on("new-producer", (producer) => {
    consumeProducer(producer).catch((error) => {
      console.error("Failed to consume new producer:", error);
    });
  });

  socket.on("producer-closed", ({ remoteProducerId, peerId, kind }) => {
    removeProducer(remoteProducerId, peerId, kind);
  });

  socket.on("user-muted", ({ peerId, muted }) => {
    updateParticipant(peerId, { muted });
  });

  socket.on("user-camera", ({ peerId, cameraOff }) => {
    updateParticipant(peerId, { cameraOff });
  });

  socket.on("peer-left", ({ peerId }) => {
    // Clean up consumers for this peer
    remoteConsumers.forEach((consumer, producerId) => {
      if (consumer.appData?.peerId === peerId) remoteConsumers.delete(producerId);
    });
    remoteParticipants.delete(peerId);
    publishParticipants();
  });

  socket.on("new-message", (message) => {
    onNewMessage(message);
  });

  socket.on("disconnect", () => {
    notifyDisconnected();
  });
};

const waitForConnection = () =>
  new Promise((resolve, reject) => {
    if (socket.connected) {
      resolve();
      return;
    }

    const handleConnect = () => {
      socket.off("connect_error", handleError);
      resolve();
    };
    const handleError = (error) => {
      socket.off("connect", handleConnect);
      reject(error);
    };

    socket.once("connect", handleConnect);
    socket.once("connect_error", handleError);
  });

const createSendTransport = async () => {
  const { params } = await emitWithAck("createWebRtcTransport", {
    consumer: false,
  });
  producerTransport = device.createSendTransport(params);

  producerTransport.on("connect", ({ dtlsParameters }, callback, errback) => {
    emitWithAck("transport-connect", {
      dtlsParameters,
      transportId: producerTransport.id,
    })
      .then(callback)
      .catch(errback);
  });

  producerTransport.on("produce", (parameters, callback, errback) => {
    emitWithAck("transport-produce", {
      kind: parameters.kind,
      rtpParameters: parameters.rtpParameters,
      transportId: producerTransport.id,
      appData: parameters.appData,
    })
      .then(({ id }) => callback({ id }))
      .catch(errback);
  });

  producerTransport.on("connectionstatechange", (state) => {
    if (state === "failed" || state === "disconnected") notifyDisconnected();
  });
};

const createRecvTransport = async () => {
  const { params } = await emitWithAck("createWebRtcTransport", {
    consumer: true,
  });
  consumerTransport = device.createRecvTransport(params);

  consumerTransport.on("connect", ({ dtlsParameters }, callback, errback) => {
    emitWithAck("transport-recv-connect", {
      dtlsParameters,
      transportId: consumerTransport.id,
    })
      .then(callback)
      .catch(errback);
  });

  consumerTransport.on("connectionstatechange", (state) => {
    if (state === "failed" || state === "disconnected") notifyDisconnected();
  });
};

const consumeProducer = async ({
  id,
  producerId = id,
  peerId,
  name,
  kind,
  cameraOff = false,
  muted = false,
}) => {
  if (!consumerTransport || consumingProducerIds.has(producerId)) return;

  consumingProducerIds.add(producerId);

  try {
    const { params } = await emitWithAck("consume", {
      rtpCapabilities: device.rtpCapabilities,
      remoteProducerId: producerId,
      transportId: consumerTransport.id,
    });
    const consumer = await consumerTransport.consume({
      id: params.id,
      producerId: params.producerId,
      kind: params.kind,
      rtpParameters: params.rtpParameters,
    });
    const resolvedPeerId = params.peerId ?? peerId;
    const resolvedName = params.name ?? name;
    const resolvedKind = params.kind ?? kind;

    remoteConsumers.set(producerId, consumer);
    consumer.appData = { peerId: resolvedPeerId };
    const participantUpdates = {
      name: resolvedName,
      [`${resolvedKind}Stream`]: new MediaStream([consumer.track]),
    };

    if (resolvedKind === "audio") {
      participantUpdates.muted = params.muted ?? muted;
    } else {
      participantUpdates.cameraOff = params.cameraOff ?? cameraOff;
      participantUpdates.videoProducerId = producerId;
    }

    updateParticipant(resolvedPeerId, participantUpdates);

    await emitWithAck("consumer-resume", {
      serverConsumerId: params.serverConsumerId,
    });
  } catch (error) {
    consumingProducerIds.delete(producerId);
    throw error;
  }
};

const produceLocalTracks = async () => {
  const audioTrack = localStream.getAudioTracks()[0];
  const videoTrack = localStream.getVideoTracks()[0];

  if (audioTrack) {
    audioProducer = await producerTransport.produce({ track: audioTrack });
  }

  if (videoTrack) {
    videoProducer = await producerTransport.produce({
      track: videoTrack,
      ...videoProducerOptions,
    });
  }
};

const loadExistingProducers = async () => {
  const producers = await emitWithAck("getProducers");
  await Promise.all(producers.map(consumeProducer));
};

export const startMeeting = async ({
  roomId,
  name,
  localVideoElement,
  onParticipants,
  onDisconnect,
  onMessage,
}) => {
  stopMeeting();

  const activeSession = ++sessionId;
  roomName = roomId;
  intentionalStop = false;
  onParticipantsChanged = onParticipants ?? (() => {});
  onDisconnected = onDisconnect ?? (() => {});
  onNewMessage = onMessage ?? (() => {});
  configureSocket();

  try {
    await waitForConnection();
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: {
        width: { min: 640, max: 1920 },
        height: { min: 400, max: 1080 },
      },
    });

    if (activeSession !== sessionId) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }

    localStream = stream;
    localVideoEl = localVideoElement;
    localVideoElement.srcObject = localStream;
    const { rtpCapabilities } = await emitWithAck("joinRoom", {
      roomName,
      name,
    });
    device = new mediasoupClient.Device();
    await device.load({ routerRtpCapabilities: rtpCapabilities });
    await Promise.all([createSendTransport(), createRecvTransport()]);
    await produceLocalTracks();
    await loadExistingProducers();
  } catch (error) {
    if (activeSession === sessionId) {
      console.error("Failed to start meeting:", error);
      onDisconnected(error);
    }
  }
};

export const stopMeeting = () => {
  intentionalStop = true;
  sessionId += 1;

  remoteConsumers.forEach((consumer) => consumer.close());
  remoteConsumers.clear();
  consumingProducerIds.clear();
  remoteParticipants.clear();
  publishParticipants();

  screenTrack?.stop();
  screenTrack = undefined;
  localVideoEl = undefined;
  audioProducer?.close();
  videoProducer?.close();
  producerTransport?.close();
  consumerTransport?.close();
  localStream?.getTracks().forEach((track) => track.stop());
  socket?.removeAllListeners();
  socket?.disconnect();

  socket = undefined;
  device = undefined;
  localStream = undefined;
  producerTransport = undefined;
  consumerTransport = undefined;
  audioProducer = undefined;
  videoProducer = undefined;
  roomName = undefined;
};

export const toggleMute = async () => {
  if (!audioProducer) return false;

  const muted = !audioProducer.paused;

  if (muted) {
    audioProducer.pause();
    await emitWithAck("producer-pause", { producerId: audioProducer.id });
  } else {
    audioProducer.resume();
    await emitWithAck("producer-resume", { producerId: audioProducer.id });
  }

  socket.emit("user-muted", { producerId: audioProducer.id, muted });
  return muted;
};

export const toggleCamera = async () => {
  if (!videoProducer) return false;

  const cameraOff = !videoProducer.paused;

  if (cameraOff) {
    videoProducer.pause();
    await emitWithAck("producer-pause", { producerId: videoProducer.id });
  } else {
    videoProducer.resume();
    await emitWithAck("producer-resume", { producerId: videoProducer.id });
  }

  socket.emit("user-camera", { producerId: videoProducer.id, cameraOff });
  return cameraOff;
};

export const startScreenShare = async (onStop) => {
  if (!videoProducer) return false;
  const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
  screenTrack = stream.getVideoTracks()[0];
  await videoProducer.replaceTrack({ track: screenTrack });
  if (localVideoEl) localVideoEl.srcObject = stream;
  screenTrack.onended = async () => {
    await stopScreenShare();
    onStop?.();
  };
  return true;
};

export const stopScreenShare = async () => {
  if (!videoProducer) return false;

  // Kill the screen track first
  if (screenTrack) {
    screenTrack.onended = null;
    screenTrack.stop();
    screenTrack = undefined;
  }

  // Original camera track may be dead — re-acquire if needed
  let cameraTrack = localStream?.getVideoTracks()[0];
  if (!cameraTrack || cameraTrack.readyState === "ended") {
    const newStream = await navigator.mediaDevices.getUserMedia({
      video: { width: { min: 640, max: 1920 }, height: { min: 400, max: 1080 } },
    });
    cameraTrack = newStream.getVideoTracks()[0];
    // Update localStream so it holds the live track
    if (localStream) {
      localStream.getVideoTracks().forEach((t) => localStream.removeTrack(t));
      localStream.addTrack(cameraTrack);
    }
  }

  await videoProducer.replaceTrack({ track: cameraTrack });
  if (localVideoEl) localVideoEl.srcObject = localStream;
  return false;
};

let lastBytesSent = 0;
let lastStatsTime = 0;

export const getNetworkStats = async () => {
  if (!producerTransport) return null;
  const statsReport = await producerTransport.getStats();
  const now = Date.now();
  let bitrate = 0;
  let packetLoss = 0;

  for (const stat of statsReport.values()) {
    if (stat.type === "outbound-rtp" && stat.kind === "video") {
      const elapsed = (now - lastStatsTime) / 1000;
      if (lastStatsTime && elapsed > 0) {
        bitrate = Math.round(((stat.bytesSent - lastBytesSent) * 8) / elapsed / 1000);
      }
      lastBytesSent = stat.bytesSent;
    }
    if (stat.type === "remote-inbound-rtp" && stat.kind === "video") {
      packetLoss = Math.round((stat.fractionLost ?? 0) * 100);
    }
  }

  lastStatsTime = now;
  return { bitrate, packetLoss };
};

export const setPreferredLayers = async (producerId, spatialLayer) => {
  const consumer = remoteConsumers.get(producerId);
  if (!consumer) return;
  await emitWithAck("set-preferred-layers", {
    consumerId: consumer.id,
    spatialLayer,
  });
};

export const sendMessage = async (text) => {
  const { message } = await emitWithAck("send-message", { text });
  return message;
};

export const getSocketId = () => socket?.id;
