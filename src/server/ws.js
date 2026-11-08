import crypto from 'node:crypto';
import {
  moveCharacter,
  travelToZone,
  restAtSanctuary,
  performCombatTurn,
  equipCharacterItem,
  useCharacterItem,
  buyFromShop,
  allocateCharacterTalent,
  toggleCharacterParty,
  acceptCharacterQuest,
  abandonCharacterQuest,
  completeCharacterQuest,
  postChatMessage,
} from '../game/world.js';

export const MAX_WS_BUFFER_SIZE = 1024 * 1024; // 1 MB stream buffer limit
const WS_MAGIC_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

export function encodeWsFrame(payload, opcode = 0x01) {
  let payloadBuf;
  if (Buffer.isBuffer(payload)) {
    payloadBuf = payload;
  } else if (typeof payload === 'string') {
    payloadBuf = Buffer.from(payload, 'utf8');
  } else {
    payloadBuf = Buffer.from(JSON.stringify(payload), 'utf8');
  }

  const len = payloadBuf.length;
  let header;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[0] = 0x80 | (opcode & 0x0f);
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | (opcode & 0x0f);
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | (opcode & 0x0f);
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }

  return Buffer.concat([header, payloadBuf]);
}

export function attachWebSocketServer(httpServer, world) {
  const clients = new Set();

  function sendJson(socket, obj) {
    if (socket.destroyed || !socket.writable) return;
    try {
      socket.write(encodeWsFrame(obj, 0x01));
    } catch {
      // ignore write errors on closing sockets
    }
  }

  function broadcast(eventObj) {
    const frame = encodeWsFrame(eventObj, 0x01);
    for (const client of clients) {
      if (!client.socket.destroyed && client.socket.writable) {
        try {
          client.socket.write(frame);
        } catch {
          // ignore
        }
      }
    }
  }

  world.broadcast = broadcast;

  function cleanupClient(client) {
    if (!clients.has(client)) return;
    clients.delete(client);
    if (client.characterId) {
      // Check if any other connected client still holds the same characterId
      let stillConnected = false;
      for (const other of clients) {
        if (other.characterId === client.characterId) {
          stillConnected = true;
          break;
        }
      }
      if (!stillConnected) {
        world.markCharacterOffline(client.characterId);
      }
    }
  }

  function handleMessage(client, rawText) {
    let msg;
    try {
      msg = JSON.parse(rawText);
    } catch {
      sendJson(client.socket, {
        type: 'ERROR',
        ok: false,
        status: 400,
        error: 'INVALID_JSON',
        code: 'ERR_INVALID_JSON',
        message: 'Malformed JSON in WebSocket message',
      });
      return;
    }

    if (!msg || typeof msg !== 'object' || Array.isArray(msg)) {
      sendJson(client.socket, {
        type: 'ERROR',
        ok: false,
        status: 400,
        error: 'INVALID_MESSAGE',
        code: 'ERR_INVALID_MESSAGE',
        message: 'WebSocket message payload must be a JSON object',
      });
      return;
    }

    const rawType = String(msg.type || '').trim();
    const typeLower = rawType.toLowerCase();
    const characterId = msg.characterId || client.characterId;

    try {
      if (typeLower === 'ping') {
        sendJson(client.socket, {
          type: 'pong',
          ok: true,
          echo: msg.echo,
          payload: msg.payload,
          timestamp: Date.now(),
        });
        return;
      }

      if (typeLower === 'auth' || typeLower === 'subscribe' || typeLower === 'sync') {
        if (characterId) {
          client.characterId = String(characterId);
          world.markCharacterOnline(client.characterId);
        }
        const snapshot = world.getWorldState(client.characterId);
        sendJson(client.socket, {
          type: 'world_snapshot',
          ...snapshot,
        });
        return;
      }

      if (typeLower === 'move') {
        if (characterId) {
          client.characterId = String(characterId);
          world.markCharacterOnline(client.characterId);
        }
        const res = moveCharacter(world, characterId, msg);
        sendJson(client.socket, {
          type: 'CHARACTER_UPDATE',
          ok: true,
          ...res,
        });
        return;
      }

      if (typeLower === 'zone_travel' || typeLower === 'zone' || typeLower === 'travel') {
        const res = travelToZone(world, characterId, msg.zoneId || msg.targetZoneId);
        sendJson(client.socket, {
          type: 'ZONE_CHANGED',
          ok: true,
          ...res,
        });
        return;
      }

      if (typeLower === 'rest') {
        const res = restAtSanctuary(world, characterId);
        sendJson(client.socket, {
          type: 'CHARACTER_UPDATE',
          ok: true,
          ...res,
        });
        return;
      }

      if (
        typeLower === 'attack' ||
        typeLower === 'skill' ||
        typeLower === 'flee' ||
        typeLower === 'potion' ||
        typeLower === 'combat_action'
      ) {
        const actionType = typeLower === 'combat_action' ? msg.actionType : typeLower;
        const res = performCombatTurn(world, characterId, {
          ...msg,
          actionType,
        });
        sendJson(client.socket, {
          type: 'COMBAT_RESULT',
          ok: true,
          ...res,
        });
        return;
      }

      if (typeLower === 'use_item') {
        const res = useCharacterItem(world, characterId, msg.itemId);
        sendJson(client.socket, {
          type: 'CHARACTER_UPDATE',
          ok: true,
          ...res,
        });
        return;
      }

      if (typeLower === 'equip' || typeLower === 'inventory_equip') {
        const res = equipCharacterItem(world, characterId, msg.itemId);
        sendJson(client.socket, {
          type: 'CHARACTER_UPDATE',
          ok: true,
          ...res,
        });
        return;
      }

      if (typeLower === 'shop_buy' || typeLower === 'buy') {
        const res = buyFromShop(world, characterId, msg.itemId, msg.quantity ?? 1);
        sendJson(client.socket, {
          type: 'CHARACTER_UPDATE',
          ok: true,
          ...res,
        });
        return;
      }

      if (typeLower === 'talent_allocate' || typeLower === 'allocate_talent') {
        const res = allocateCharacterTalent(world, characterId, msg.node || msg.talentId, msg.points ?? 1);
        sendJson(client.socket, {
          type: 'CHARACTER_UPDATE',
          ok: true,
          ...res,
        });
        return;
      }

      if (typeLower === 'party_toggle' || typeLower === 'toggle_party') {
        const res = toggleCharacterParty(world, characterId, msg.active);
        sendJson(client.socket, {
          type: 'PARTY_UPDATED',
          ok: true,
          ...res,
        });
        return;
      }

      if (typeLower === 'quest_accept') {
        const res = acceptCharacterQuest(world, characterId, msg.questId);
        sendJson(client.socket, {
          type: 'QUEST_UPDATED',
          ok: true,
          ...res,
        });
        return;
      }

      if (typeLower === 'quest_complete') {
        const res = completeCharacterQuest(world, characterId, msg.questId);
        sendJson(client.socket, {
          type: 'QUEST_UPDATED',
          ok: true,
          ...res,
        });
        return;
      }

      if (typeLower === 'quest_abandon') {
        const res = abandonCharacterQuest(world, characterId, msg.questId);
        sendJson(client.socket, {
          type: 'QUEST_UPDATED',
          ok: true,
          ...res,
        });
        return;
      }

      if (typeLower === 'chat') {
        postChatMessage(world, {
          characterId,
          sender: msg.sender,
          message: msg.message ?? msg.text,
          channel: msg.channel,
        });
        return;
      }

      sendJson(client.socket, {
        type: 'ERROR',
        ok: false,
        status: 400,
        error: 'UNKNOWN_MESSAGE_TYPE',
        code: 'ERR_UNKNOWN_MESSAGE_TYPE',
        message: `Unknown WebSocket message type: ${rawType}`,
      });
    } catch (err) {
      sendJson(client.socket, {
        type: 'ERROR',
        ok: false,
        status: err.status || 400,
        error: err.error || 'ACTION_FAILED',
        code: err.code || 'ERR_ACTION_FAILED',
        message: err.message || 'WebSocket action failed',
      });
    }
  }

  httpServer.on('upgrade', (req, socket, head) => {
    let parsedUrl;
    try {
      parsedUrl = new URL(req.url || '/', 'http://127.0.0.1');
    } catch {
      socket.write('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }

    if (parsedUrl.pathname !== '/ws') {
      socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }

    const wsKey = req.headers['sec-websocket-key'];
    if (!wsKey || typeof wsKey !== 'string' || !wsKey.trim()) {
      socket.write('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }

    const acceptKey = crypto
      .createHash('sha1')
      .update(wsKey.trim() + WS_MAGIC_GUID)
      .digest('base64');

    socket.write(
      [
        'HTTP/1.1 101 Switching Protocols',
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Accept: ${acceptKey}`,
        '\r\n',
      ].join('\r\n')
    );

    const initialCharId = parsedUrl.searchParams.get('characterId') || null;
    const client = {
      socket,
      characterId: initialCharId,
      rawBuffer: head && head.length > 0 ? Buffer.from(head) : Buffer.alloc(0),
    };
    clients.add(client);

    if (initialCharId) {
      world.markCharacterOnline(initialCharId);
    }

    sendJson(socket, {
      type: 'WELCOME',
      ok: true,
      tickCount: world.tickCount,
    });

    function processBuffer() {
      while (client.rawBuffer.length >= 2) {
        const b0 = client.rawBuffer[0];
        const b1 = client.rawBuffer[1];
        const opcode = b0 & 0x0f;
        const isMasked = (b1 & 0x80) !== 0;
        let payloadLen = b1 & 0x7f;
        let headerOffset = 2;

        if (payloadLen === 126) {
          if (client.rawBuffer.length < 4) return;
          payloadLen = client.rawBuffer.readUInt16BE(2);
          headerOffset = 4;
        } else if (payloadLen === 127) {
          if (client.rawBuffer.length < 10) return;
          const bigLen = client.rawBuffer.readBigUInt64BE(2);
          if (bigLen > BigInt(MAX_WS_BUFFER_SIZE)) {
            try {
              socket.write(encodeWsFrame(Buffer.alloc(0), 0x08));
            } catch {
              // ignore
            }
            cleanupClient(client);
            socket.destroy();
            return;
          }
          payloadLen = Number(bigLen);
          headerOffset = 10;
        }

        const maskLen = isMasked ? 4 : 0;
        const totalFrameLen = headerOffset + maskLen + payloadLen;

        if (totalFrameLen > MAX_WS_BUFFER_SIZE) {
          try {
            socket.write(encodeWsFrame(Buffer.alloc(0), 0x08));
          } catch {
            // ignore
          }
          cleanupClient(client);
          socket.destroy();
          return;
        }

        if (client.rawBuffer.length < totalFrameLen) {
          return;
        }

        const maskKey = isMasked
          ? client.rawBuffer.subarray(headerOffset, headerOffset + 4)
          : null;
        const payloadOffset = headerOffset + maskLen;
        const rawPayload = client.rawBuffer.subarray(
          payloadOffset,
          payloadOffset + payloadLen
        );
        const payload = Buffer.alloc(payloadLen);

        if (isMasked && maskKey) {
          for (let i = 0; i < payloadLen; i += 1) {
            payload[i] = rawPayload[i] ^ maskKey[i & 3];
          }
        } else {
          rawPayload.copy(payload);
        }

        client.rawBuffer = client.rawBuffer.subarray(totalFrameLen);

        if (opcode === 0x08) {
          // CLOSE frame
          try {
            socket.write(encodeWsFrame(payload, 0x08));
          } catch {
            // ignore
          }
          cleanupClient(client);
          socket.end();
          return;
        }

        if (opcode === 0x09) {
          // PING -> PONG with matching payload
          try {
            socket.write(encodeWsFrame(payload, 0x0a));
          } catch {
            // ignore
          }
          continue;
        }

        if (opcode === 0x0a) {
          // PONG -> ignore
          continue;
        }

        if (opcode === 0x01) {
          const text = payload.toString('utf8');
          handleMessage(client, text);
        }
      }
    }

    if (client.rawBuffer.length > 0) {
      processBuffer();
    }

    socket.on('data', (chunk) => {
      if (client.rawBuffer.length + chunk.length > MAX_WS_BUFFER_SIZE) {
        try {
          socket.write(encodeWsFrame(Buffer.alloc(0), 0x08));
        } catch {
          // ignore
        }
        cleanupClient(client);
        socket.destroy();
        return;
      }
      client.rawBuffer = Buffer.concat([client.rawBuffer, chunk]);
      processBuffer();
    });

    socket.on('close', () => {
      cleanupClient(client);
    });

    socket.on('end', () => {
      cleanupClient(client);
    });

    socket.on('error', () => {
      cleanupClient(client);
    });
  });

  return {
    clients,
    broadcast,
    closeAll() {
      for (const client of clients) {
        try {
          client.socket.destroy();
        } catch {
          // ignore
        }
      }
      clients.clear();
    },
  };
}
