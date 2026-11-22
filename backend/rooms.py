import secrets


# Комната содержит участников по ролям: sign и speech.
rooms = {}


def create_room():
    room_id = secrets.token_urlsafe(9)
    while room_id in rooms:
        room_id = secrets.token_urlsafe(9)

    rooms[room_id] = {}
    return room_id


def add_participant(room_id, role, participant):
    # Проверка и добавление выполняются без await, поэтому место сразу занято.
    if room_id not in rooms:
        return "Комната не найдена"
    if role not in ("sign", "speech"):
        return "Допустимые роли: sign, speech"

    room = rooms[room_id]
    if len(room) >= 2:
        return "В комнате уже два участника"
    if role in room:
        return "Эта роль уже занята"

    room[role] = participant
    return None


def remove_participant(room_id, role, participant):
    room = rooms.get(room_id)
    if room is None or room.get(role) is not participant:
        return

    del room[role]
    if len(room) == 0:
        del rooms[room_id]


def get_peer(room_id, role):
    room = rooms.get(room_id, {})
    for peer_role in room:
        if peer_role != role:
            return room[peer_role]
    return None
