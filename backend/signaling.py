import asyncio
import json

from fastapi import WebSocketDisconnect

from rooms import add_participant, get_peer, remove_participant, rooms


async def send_message(participant, message):
    # Два обработчика могут отправлять сообщения одному клиенту
    async with participant["send_lock"]:
        try:
            await participant["socket"].send_json(message)
            return True
        except (WebSocketDisconnect, OSError, RuntimeError):
            return False


async def handle_connection(websocket, room_id, role):
    participant = {"socket": websocket, "send_lock": asyncio.Lock()}
    error = add_participant(room_id, role, participant)
    if error:
        # Отказ до accept превращается в отказ WebSocket handshake (HTTP 403)
        await websocket.close(code=1008, reason=error)
        return

    joined = False
    try:
        # Блокировка удерживает сообщения собеседника до завершения входа
        async with participant["send_lock"]:
            await websocket.accept()
            await websocket.send_json({
                "type": "joined", "room_id": room_id, "role": role,
                "participants": len(rooms[room_id]),
            })
        joined = True
        peer = get_peer(room_id, role)
        if peer is not None:
            await send_message(peer, {"type": "peer_joined", "role": role})

        while True:
            event = await websocket.receive()
            if event["type"] == "websocket.disconnect":
                break

            raw_message = event.get("text")
            if raw_message is None:
                await send_message(participant, {
                    "type": "error", "message": "Отправьте JSON текстовым сообщением",
                })
                continue

            try:
                message = json.loads(raw_message)
            except ValueError:
                await send_message(participant, {
                    "type": "error", "message": "Некорректный JSON",
                })
                continue

            if not isinstance(message, dict):
                await send_message(participant, {
                    "type": "error", "message": "Сообщение должно быть объектом JSON",
                })
                continue

            message_type = message.get("type")
            if message_type == "text" and isinstance(message.get("text"), str):
                outgoing = {"type": "text", "text": message["text"]}
            elif message_type in ("offer", "answer", "ice_candidate") and isinstance(message.get("data"), dict):
                # Содержимое WebRTC data передаём как есть.
                outgoing = {"type": message_type, "data": message["data"]}
            else:
                await send_message(participant, {
                    "type": "error", "message": "Неизвестный type или неверные поля сообщения",
                })
                continue

            peer = get_peer(room_id, role)
            if peer is None or not await send_message(peer, outgoing):
                await send_message(participant, {
                    "type": "error", "message": "Собеседник недоступен",
                })
    except (WebSocketDisconnect, OSError):
        pass
    finally:
        # Освобождаем роль даже при ошибке или отмене обработчика.
        remove_participant(room_id, role, participant)
        peer = get_peer(room_id, role)
        if joined and peer is not None:
            await send_message(peer, {"type": "peer_left", "role": role})
