export const createRoomStore = () => {
  const rooms = new Map();
  const peerRooms = new Map();

  const getRoom = (roomName) => rooms.get(roomName);

  const getPeer = (socketId) => {
    const roomName = peerRooms.get(socketId);
    const room = rooms.get(roomName);
    const peer = room?.peers.get(socketId);

    return room && peer ? { roomName, room, peer } : undefined;
  };

  const ensureRoom = async (roomName, createRouter) => {
    let room = rooms.get(roomName);

    if (!room) {
      room = {
        router: await createRouter(),
        peers: new Map(),
      };
      rooms.set(roomName, room);
    }

    return room;
  };

  const addPeer = (roomName, socket, name) => {
    const room = rooms.get(roomName);

    if (!room) {
      throw new Error(`Room ${roomName} does not exist`);
    }

    room.peers.set(socket.id, {
      socket,
      name,
      transports: new Map(),
      producers: new Map(),
      consumers: new Map(),
    });
    peerRooms.set(socket.id, roomName);

    return room.peers.get(socket.id);
  };

  const removePeer = (socketId) => {
    const peerData = getPeer(socketId);

    if (!peerData) return;

    const { roomName, room, peer } = peerData;

    peer.consumers.forEach((consumer) => consumer.close());
    peer.producers.forEach(({ producer }) => producer.close());
    peer.transports.forEach((transport) => transport.close());
    room.peers.delete(socketId);
    peerRooms.delete(socketId);

    if (room.peers.size === 0) {
      room.router.close();
      rooms.delete(roomName);
    }
  };

  const findProducer = (room, producerId) => {
    for (const [peerId, peer] of room.peers) {
      const producerData = peer.producers.get(producerId);

      if (producerData) {
        return { peerId, peer, producerData };
      }
    }

    return undefined;
  };

  return {
    rooms,
    getRoom,
    getPeer,
    ensureRoom,
    addPeer,
    removePeer,
    findProducer,
  };
};
