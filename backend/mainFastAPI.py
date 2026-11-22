import asyncio

import cv2
import numpy as np
from fastapi import FastAPI, HTTPException, Request, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from starlette.concurrency import run_in_threadpool
from starlette.datastructures import UploadFile
from starlette.formparsers import MultiPartException, MultiPartParser

from hand_tracking import get_hand_coordinates, load_model
from rooms import create_room, rooms
from signaling import handle_connection


MAX_FILE_SIZE = 5 * 1024 * 1024
# Оставляем место для служебных заголовков multipart.
MAX_REQUEST_SIZE = MAX_FILE_SIZE + 64 * 1024


async def start_server():
    app.state.hand_model = await run_in_threadpool(load_model)
    app.state.hand_lock = asyncio.Lock()


async def stop_server():
    await run_in_threadpool(app.state.hand_model.close)
    rooms.clear()


# Обычные функции запуска и завершения, без дополнительных декораторов.
app = FastAPI(on_startup=[start_server], on_shutdown=[stop_server])
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173", "http://127.0.0.1:5173",
        "http://localhost:3000", "http://127.0.0.1:3000",
    ],
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)


@app.get("/hello")
def hello():
    return "It works!"


@app.post("/rooms")
async def new_room():
    return {"room_id": create_room()}


@app.get("/rooms/{room_id}")
async def room_info(room_id: str):
    if room_id not in rooms:
        raise HTTPException(status_code=404, detail="Комната не найдена")
    return {"exists": True, "participants": len(rooms[room_id])}


async def limited_image_stream(request):
    # Ограничиваем весь запрос, в том числе при отсутствии Content-Length.
    total = 0
    async for chunk in request.stream():
        total += len(chunk)
        if total > MAX_REQUEST_SIZE:
            raise HTTPException(status_code=413, detail="Изображение слишком большое")
        yield chunk


@app.post("/hands")
async def hands(request: Request):
    content_type = request.headers.get("content-type", "")
    if content_type.split(";")[0].strip().lower() != "multipart/form-data":
        raise HTTPException(status_code=415, detail="Ожидается multipart/form-data, поле file")

    parser = MultiPartParser(
        request.headers, limited_image_stream(request), max_files=1, max_fields=0,
    )
    # Multipart хранит изображение в памяти до установленного лимита запроса.
    parser.spool_max_size = MAX_REQUEST_SIZE
    try:
        form = await parser.parse()
    except MultiPartException as error:
        raise HTTPException(status_code=400, detail="Некорректный multipart-запрос") from error

    try:
        file = form.get("file")
        if not isinstance(file, UploadFile):
            raise HTTPException(status_code=400, detail="Нужно изображение в поле file")
        data = await file.read(MAX_FILE_SIZE + 1)
    finally:
        await form.close()

    if len(data) > MAX_FILE_SIZE:
        raise HTTPException(status_code=413, detail="Максимальный размер файла — 5 МБ")
    if not (data.startswith(b"\xff\xd8\xff") or data.startswith(b"\x89PNG\r\n\x1a\n")):
        raise HTTPException(status_code=415, detail="Поддерживаются только JPEG и PNG")

    # Один экземпляр модели обрабатывает запросы последовательно.
    async with app.state.hand_lock:
        return await run_in_threadpool(process_image, data)


def process_image(data):
    try:
        frame = cv2.imdecode(np.frombuffer(data, dtype=np.uint8), cv2.IMREAD_COLOR)
    except cv2.error as error:
        raise HTTPException(status_code=400, detail="Не удалось прочитать изображение") from error
    if frame is None:
        raise HTTPException(status_code=400, detail="Не удалось прочитать изображение")

    # Здесь остаются настоящие координаты. Будущая модель жестов подключится отдельно.
    return get_hand_coordinates(frame, app.state.hand_model)


@app.websocket("/ws/{room_id}")
async def room_socket(websocket: WebSocket, room_id: str, role: str = ""):
    await handle_connection(websocket, room_id, role)
