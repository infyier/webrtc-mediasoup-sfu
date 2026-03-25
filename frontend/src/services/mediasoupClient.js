let localVideo 
let videoContainer 
let isProducing = false;
let hasStarted = false;
import { io } from "socket.io-client"
import * as mediasoupClient from "mediasoup-client"

let roomName
export const setRoomName = (roomId) => {
  roomName = roomId;
}

let socket

export const initSocket = () => {
  socket = io("https://localhost:3000/mediasoup", {
    secure: true,
    rejectUnauthorized: false
  });

  socket.off('connection-success');
  socket.off('new-producer');
  socket.off('producer-closed');

  socket.on('connection-success', ({ socketId }) => {
    console.log(socketId);
    //getLocalStream();
  });

  socket.on('new-producer', ({ producerId }) => {
    console.log("New producer arrived:", producerId);
    signalNewConsumerTransport(producerId);
  });

  socket.on('producer-closed', ({ remoteProducerId }) => {
    const elem = document.getElementById(`td-${remoteProducerId}`);
    if (elem) videoContainer.removeChild(elem);
  });
};

let device
let rtpCapabilities
let producerTransport
let consumerTransport
let audioProducer
let videoProducer
let consumer
let isProducer = false

let params = {
  encodings: [
    {
      rid: 'r0',
      maxBitrate: 100000,
      scalabilityMode: 'S1T3',
    },
    {
      rid: 'r1',
      maxBitrate: 300000,
      scalabilityMode: 'S1T3',
    },
    {
      rid: 'r2',
      maxBitrate: 900000,
      scalabilityMode: 'S1T3',
    },
  ],
  codecOptions: {
    videoGoogleStartBitrate: 1000
  }
}

let audioParams;
let videoParams = { ...params };
let consumingTransports = [];

const streamSuccess = (stream) => {

  localVideo.srcObject = stream

  audioParams = { track: stream.getAudioTracks()[0], ...audioParams }
  videoParams = { track: stream.getVideoTracks()[0], ...videoParams }

  joinRoom()
}

const joinRoom = () => {
  socket.emit('joinRoom', { roomName }, (data) => {
    console.log(`Router RTP Capabilities... ${data.rtpCapabilities}`)
    rtpCapabilities = data.rtpCapabilities

    createDevice()
  })
}

const getLocalStream = () => {
  navigator.mediaDevices.getUserMedia({
    audio: true,
    video: {
      width: {
        min: 640,
        max: 1920,
      },
      height: {
        min: 400,
        max: 1080,
      }
    }
  })
  .then(streamSuccess)
  .catch(error => {
    console.log(error.message)
  })
}

const createDevice = async () => {
  try {
    device = new mediasoupClient.Device()

    await device.load({
      routerRtpCapabilities: rtpCapabilities
    })

    console.log('Device RTP Capabilities', device.rtpCapabilities)

    createSendTransport()

  } catch (error) {
    console.log(error)
    if (error.name === 'UnsupportedError')
      console.warn('browser not supported')
  }
}

const createSendTransport = () => {

  socket.emit('createWebRtcTransport', { consumer: false }, ({ params }) => {

    if (params.error) {
      console.log(params.error)
      return
    }

    console.log(params)

    producerTransport = device.createSendTransport(params)

    producerTransport.on('connect', async ({ dtlsParameters }, callback, errback) => {
      try {

        await socket.emit('transport-connect', {
          dtlsParameters,
          transportId: producerTransport.id,  
        })

        callback()

      } catch (error) {
        errback(error)
      }
    })

    producerTransport.on('produce', async (parameters, callback, errback) => {
      console.log(parameters)

      try {

        await socket.emit('transport-produce', {
          kind: parameters.kind,
          rtpParameters: parameters.rtpParameters,
          transportId: producerTransport.id,
          appData: parameters.appData,
        }, ({ id, producersExist }) => {

          callback({ id })
          if (producersExist) getProducers()
        })
      } catch (error) {
        errback(error)
      }
    })
    createRecvTransport()
    connectSendTransport()
  })
}

const createRecvTransport = () => {
  socket.emit('createWebRtcTransport', { consumer: true }, ({ params }) => {

    if (params.error) {
      console.log(params.error)
      return
    }

    consumerTransport = device.createRecvTransport(params)

    consumerTransport.on('connect', async ({ dtlsParameters }, callback, errback) => {
      try {
        await socket.emit('transport-recv-connect', {
          dtlsParameters,
          transportId: consumerTransport.id
        })
        callback()
      } catch (error) {
        errback(error)
      }
    })
  })
}

const connectSendTransport = async () => {

  if (isProducing) return;
  isProducing = true;

  audioProducer = await producerTransport.produce(audioParams);
  videoProducer = await producerTransport.produce(videoParams);

  audioProducer.on('trackended', () => {
    console.log('audio track ended')
  })

  audioProducer.on('transportclose', () => {
    console.log('audio transport ended')
  })
  
  videoProducer.on('trackended', () => {
    console.log('video track ended')
  })

  videoProducer.on('transportclose', () => {
    console.log('video transport ended')
  })

}

const signalNewConsumerTransport = async (remoteProducerId) => {
  if (consumingTransports.includes(remoteProducerId)) return
  consumingTransports.push(remoteProducerId)

  connectRecvTransport(remoteProducerId)
}

const getProducers = () => {
  socket.emit('getProducers', producerIds => {
    console.log(producerIds)
    producerIds.forEach(signalNewConsumerTransport)
  })
}

const connectRecvTransport = async (remoteProducerId) => {
  console.log("Consuming:", remoteProducerId)
  while (!consumerTransport) {
    await new Promise(resolve => setTimeout(resolve, 50))
  }

  await socket.emit('consume', {
    rtpCapabilities: device.rtpCapabilities,
    remoteProducerId,
    transportId: consumerTransport.id
  }, async ({ params }) => {

    if (params.error) return

    const consumer = await consumerTransport.consume({
      id: params.id,
      producerId: params.producerId,
      kind: params.kind,
      rtpParameters: params.rtpParameters
    })
    if (document.getElementById(remoteProducerId)) {
      return;
    }
    const newElem = document.createElement('div');
    newElem.setAttribute('id', `td-${remoteProducerId}`)

    if (params.kind === 'audio') {
      newElem.innerHTML = `<audio id="${remoteProducerId}" autoplay></audio>`
    } else {
      newElem.innerHTML = `<video id="${remoteProducerId}" autoplay class="video"></video>`
    }

    videoContainer.appendChild(newElem)

    document.getElementById(remoteProducerId).srcObject =
      new MediaStream([consumer.track])

    socket.emit('consumer-resume', {
      serverConsumerId: params.serverConsumerId
    })
  })
}

export const startMeeting = (roomId, videoElement, containerElement) => {
  roomName = roomId;
  localVideo = videoElement;
  videoContainer = containerElement;

  if (hasStarted) return;
  hasStarted = true;

  initSocket();

  socket.once('connection-success', () => {
    getLocalStream();
  });
};