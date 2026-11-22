import cv2
import numpy as np
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from mainFastAPI import app


# Модель используется настоящая. Тестовый чёрный кадр должен дать пустой список.
with TestClient(app) as client:
    assert client.get("/hello").json() == "It works!"
    room_id = client.post("/rooms").json()["room_id"]
    assert client.get(f"/rooms/{room_id}").json()["participants"] == 0

    with client.websocket_connect(f"/ws/{room_id}?role=sign") as first:
        assert first.receive_json()["type"] == "joined"
        first.send_json({"type": "ping"})
        assert first.receive_json() == {"type": "pong"}

        with client.websocket_connect(f"/ws/{room_id}?role=speech") as second:
            assert second.receive_json()["participants"] == 2
            assert first.receive_json()["type"] == "peer_joined"

            # Третий участник не должен подключиться.
            try:
                with client.websocket_connect(f"/ws/{room_id}?role=sign"):
                    raise AssertionError("В комнату вошёл третий участник")
            except WebSocketDisconnect as error:
                assert error.code == 1008

            first.send_json({"type": "text", "text": "Привет!"})
            assert second.receive_json() == {"type": "text", "text": "Привет!"}

            offer = {"type": "offer", "data": {"type": "offer", "sdp": "test"}}
            first.send_json(offer)
            assert second.receive_json() == offer

        assert first.receive_json()["type"] == "peer_left"
        assert client.get(f"/rooms/{room_id}").json()["participants"] == 1

    assert client.get(f"/rooms/{room_id}").status_code == 404

    frame = np.zeros((240, 320, 3), dtype=np.uint8)
    success, image = cv2.imencode(".png", frame)
    assert success
    response = client.post("/hands", files={"file": ("blank.png", image.tobytes(), "image/png")})
    assert response.status_code == 200
    assert response.json() == {"hands": []}

    response = client.post("/hands", files={"file": ("bad.png", b"\x89PNG\r\n\x1a\nbad")})
    assert response.status_code == 400

    response = client.post("/hands", files={"file": ("large.png", bytes(5 * 1024 * 1024 + 1))})
    assert response.status_code == 413

print("OK: комнаты, WebSocket, ограничения входа, отключения, MediaPipe и загрузки")
