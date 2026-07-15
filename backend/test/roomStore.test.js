import assert from 'node:assert/strict'
import test from 'node:test'
import { createRoomStore } from '../src/roomStore.js'

const closable = () => ({
  closed: false,
  close() {
    this.closed = true
  },
})

test('keeps peer and producer lookup isolated by room', async () => {
  const store = createRoomStore()
  const routerA = closable()
  const routerB = closable()

  await store.ensureRoom('room-a', async () => routerA)
  await store.ensureRoom('room-b', async () => routerB)
  const peerA = store.addPeer('room-a', { id: 'peer-a' })
  const peerB = store.addPeer('room-b', { id: 'peer-b' })
  peerA.producers.set('producer-a', { producer: closable() })
  peerB.producers.set('producer-b', { producer: closable() })

  assert.equal(store.findProducer(store.getRoom('room-a'), 'producer-b'), undefined)
  assert.equal(store.findProducer(store.getRoom('room-b'), 'producer-a'), undefined)
  assert.equal(store.findProducer(store.getRoom('room-a'), 'producer-a').peerId, 'peer-a')
})

test('removing the final peer closes media resources and the router', async () => {
  const store = createRoomStore()
  const router = closable()
  const transport = closable()
  const producer = closable()
  const consumer = closable()

  await store.ensureRoom('room-a', async () => router)
  const peer = store.addPeer('room-a', { id: 'peer-a' })
  peer.transports.set('transport', transport)
  peer.producers.set('producer', { producer })
  peer.consumers.set('consumer', consumer)

  store.removePeer('peer-a')

  assert.equal(transport.closed, true)
  assert.equal(producer.closed, true)
  assert.equal(consumer.closed, true)
  assert.equal(router.closed, true)
  assert.equal(store.getRoom('room-a'), undefined)
  assert.equal(store.getPeer('peer-a'), undefined)
})

test('a room stays open while another peer remains', async () => {
  const store = createRoomStore()
  const router = closable()

  await store.ensureRoom('room-a', async () => router)
  store.addPeer('room-a', { id: 'peer-a' })
  store.addPeer('room-a', { id: 'peer-b' })

  store.removePeer('peer-a')

  assert.equal(router.closed, false)
  assert.equal(store.getRoom('room-a').peers.size, 1)
})
