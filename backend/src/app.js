import express from 'express'
const app = express()

import https from 'httpolyglot'
import { Server } from 'socket.io'
import mediasoup from 'mediasoup'
import fs from 'fs'

const options = {
  key: fs.readFileSync('./certs/key.pem', 'utf-8'),
  cert: fs.readFileSync('./certs/cert.pem', 'utf-8')
}

const httpsServer = https.createServer(options, app)

httpsServer.listen(3000, () => {
  console.log('listening on port: 3000')
})

const io = new Server(httpsServer, {
  cors: {
    origin: "http://localhost:5173",
    methods: ["GET", "POST"]
  }
})

const connections = io.of('/mediasoup')

let worker
let rooms = {}
let peers = {}

const createWorker = async () => {
  worker = await mediasoup.createWorker({
    rtcMinPort: 20100,
    rtcMaxPort: 20200,
  })

  console.log(`worker pid ${worker.pid}`)

  worker.on('died', () => {
    console.error('mediasoup worker has died')
    setTimeout(() => process.exit(1), 2000)
  })
}

await createWorker()

const mediaCodecs = [
  {
    kind: 'audio',
    mimeType: 'audio/opus',
    clockRate: 48000,
    channels: 2,
  },
  {
    kind: 'video',
    mimeType: 'video/VP8',
    clockRate: 90000,
    parameters: {
      'x-google-start-bitrate': 1000,
    },
  },
]

connections.on('connection', async (socket) => {
  console.log(socket.id)

  socket.emit('connection-success', {
    socketId: socket.id,
  })

  socket.on('disconnect', () => {
    console.log('Disconnected:', socket.id)
    const { roomName } = peers[socket.id] || {}
    const room = rooms[roomName]

    if (!room) return

    const peer = room.peers[socket.id]

    if (peer) {
      peer.consumers.forEach(c => c.close())
      peer.producers.forEach(p => p.producer.close())
      peer.transports.forEach(t => t.close())

      delete room.peers[socket.id]
    }

    console.log("Remaining peers:", Object.keys(room.peers).length)

    if (Object.keys(room.peers).length === 0) {
      room.router.close()
      delete rooms[roomName]
    }

    delete peers[socket.id]
  })

  socket.on('joinRoom', async ({ roomName }, callback) => {
    const router = await createRoom(roomName)

    rooms[roomName].peers[socket.id] = {
      socket,
      transports: new Map(),
      producers: new Map(),
      consumers: new Map()
    }

    peers[socket.id] = { roomName }

    console.log("Total peers in room:", Object.keys(rooms[roomName].peers).length)

    callback({ rtpCapabilities: router.rtpCapabilities })
  })

  const createRoom = async (roomName) => {
    if (rooms[roomName]) {
      return rooms[roomName].router
    }

    const router = await worker.createRouter({ mediaCodecs })

    rooms[roomName] = {
      router,
      peers: {}
    }

    return router
  }

  socket.on('createWebRtcTransport', async ({ consumer }, callback) => {
    const { roomName } = peers[socket.id]
    const router = rooms[roomName].router

    const transport = await createWebRtcTransport(router)

    addTransport(transport, roomName, socket.id, consumer)

    callback({
      params: {
        id: transport.id,
        iceParameters: transport.iceParameters,
        iceCandidates: transport.iceCandidates,
        dtlsParameters: transport.dtlsParameters,
      }
    })
  })

  const addTransport = (transport, roomName, socketId, consumer) => {
    const peer = rooms[roomName].peers[socketId]
    transport.appData = { consumer }
    peer.transports.set(transport.id, transport)
  }

  const getTransport = (roomName, socketId, isConsumer = false) => {
    const peer = rooms[roomName].peers[socketId]

    for (const transport of peer.transports.values()) {
      if (transport.appData?.consumer === isConsumer) {
        return transport
      }
    }
  }

  socket.on('transport-connect', ({ dtlsParameters, transportId }) => {
    const { roomName } = peers[socket.id]
    const peer = rooms[roomName].peers[socket.id]
    const transport = peer.transports.get(transportId)

    if(!transport) {
      console.error('Transport not found for socket:', socket.id)
      return
    }

    transport.connect({ dtlsParameters })
  })

  socket.on('transport-produce', async ({ kind, rtpParameters, transportId }, callback) => {
    const peerData = peers[socket.id]

    if (!peerData) {
      console.log("peer not found, joinRoom not called yet")
      return
    }

    const { roomName } = peerData
    const peer = rooms[roomName].peers[socket.id]

    const transport = peer.transports.get(transportId)

    if (!transport) {
      console.log("Transport not found for produce")
      return
    }

    const producer = await transport.produce({
      kind,
      rtpParameters,
    })

    addProducer(producer, roomName, socket.id)
    informConsumers(roomName, socket.id, producer.id)

    producer.on('transportclose', () => producer.close())

    const room = rooms[roomName]

    const producersExist = Object.values(room.peers).some(peer =>
      peer.producers.size > 0 && peer !== room.peers[socket.id]
    )

    callback({
      id: producer.id,
      producersExist
    })
  })

  const addProducer = (producer, roomName, socketId) => {
    const peer = rooms[roomName].peers[socketId]
    peer.producers.set(producer.id, {
      producer,
      cameraOff: false,
      muted: false
    });
  }

  const informConsumers = (roomName, socketId, producerId) => {
    const room = rooms[roomName]

    for (const peerId in room.peers) {
      if (peerId !== socketId) {
        room.peers[peerId].socket.emit('new-producer', {
          producerId
        })
      }
    }
  }

  socket.on('transport-recv-connect', async ({ dtlsParameters, transportId }) => {
    const { roomName } = peers[socket.id]
    const peer = rooms[roomName].peers[socket.id]
    const transport = peer.transports.get(transportId)
    //const transport = getTransport(roomName, socket.id, true)

    if(!transport) {
      console.error('Transport not found for socket:', socket.id)
      return
    }

    await transport.connect({ dtlsParameters })
  })

  socket.on('consume', async ({ rtpCapabilities, remoteProducerId, transportId }, callback) => {
    try {
      const peerData = peers[socket.id]
      if (!peerData) return
      const { roomName } = peerData

      const router = rooms[roomName].router
      const peer = rooms[roomName].peers[socket.id]
      const transport = peer.transports.get(transportId)

      if (!transport) {
        console.log("Transport not found for consume")
        return
      }

      if (!router.canConsume({ producerId: remoteProducerId, rtpCapabilities })) {
        return
      }

      const consumer = await transport.consume({
        producerId: remoteProducerId,
        rtpCapabilities,
        paused: true,
      })

      addConsumer(consumer, roomName, socket.id)

      consumer.on('producerclose', () => {
        socket.emit('producer-closed', { remoteProducerId })

        consumer.close()

        const peer = rooms[roomName].peers[socket.id]
        peer.consumers.delete(consumer.id)
      })

      callback({
        params: {
          id: consumer.id,
          producerId: remoteProducerId,
          kind: consumer.kind,
          rtpParameters: consumer.rtpParameters,
          serverConsumerId: consumer.id,
        }
      })

    } catch (error) {
      console.log(error.message)
      callback({ params: { error } })
    }
  })

  const addConsumer = (consumer, roomName, socketId) => {
    const peer = rooms[roomName].peers[socketId]
    peer.consumers.set(consumer.id, consumer)
  }

  socket.on('consumer-resume', async ({ serverConsumerId }) => {
    const { roomName } = peers[socket.id]
    const peer = rooms[roomName].peers[socket.id]

    const consumer = peer.consumers.get(serverConsumerId)
    await consumer.resume()
  })

  socket.on('getProducers', (callback) => {
    const { roomName } = peers[socket.id]
    const room = rooms[roomName]

    let producerList = []

    for (const peerId in room.peers) {
      if (peerId !== socket.id) {
        const peer = room.peers[peerId]

        peer.producers.forEach(producer => {
          producerList.push({
            id: producer.producer.id,
            cameraOff: producer.cameraOff || false
          });
        })
      }
    }

    callback(producerList)
  })

  socket.on("producer-pause", async ({ producerId }) => {
  const { roomName } = peers[socket.id]
  const peer = rooms[roomName].peers[socket.id]

  const producerData = peer.producers.get(producerId)

  if (producerData) {
    await producerData.producer.pause()   
    console.log("Producer paused:", producerId)
  }
  })

  socket.on("producer-resume", async ({ producerId }) => {
  const { roomName } = peers[socket.id]
  const peer = rooms[roomName].peers[socket.id]

  const producerData = peer.producers.get(producerId)

  if (producerData) {
    await producerData.producer.resume()  
    console.log("Producer resumed:", producerId)
  }
  })

  socket.on("user-muted", ({ producerId, muted }) => {
  const { roomName } = peers[socket.id]

  socket.broadcast.emit("user-muted", {
    producerId,
    muted
  })
})

  socket.on("user-camera", ({ producerId, cameraOff }) => {
  const { roomName } = peers[socket.id];
  const peer = rooms[roomName].peers[socket.id];

  const producerData = peer.producers.get(producerId);
  if (producerData) {
    producerData.cameraOff = cameraOff;
  }

  socket.broadcast.emit("user-camera", {
    producerId,
    cameraOff
  });
  });

})

const createWebRtcTransport = async (router) => {
  const transport = await router.createWebRtcTransport({
    listenIps: [{ ip: '0.0.0.0', announcedIp: '127.0.0.1' }],
    enableUdp: true,
    enableTcp: true,
    preferUdp: true,
  })

  transport.on('dtlsstatechange', (state) => {
    if (state === 'closed') transport.close()
  })

  return transport
}