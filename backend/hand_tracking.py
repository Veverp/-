from pathlib import Path

import cv2
import mediapipe as mp


def load_model(): #Грузим распознование рук
    model_path = Path(__file__).with_name("hand_landmarker.task")
    model_data = model_path.read_bytes()
    base_options = mp.tasks.BaseOptions(model_asset_buffer=model_data)
    options = mp.tasks.vision.HandLandmarkerOptions(
        base_options=base_options,
        num_hands=2 #Ребят, как насчт того, что бы лобавить мультираспощнавание? тут вон количество рук регулруется)
    )

    model = mp.tasks.vision.HandLandmarker.create_from_options(options)
    return model


def get_hand_coordinates(frame, model):
    rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
    result = model.detect(image)

    hands = []

    #Номера рук: 0,1. НЕ ПУТАЙТЕ
    for hand_number in range(len(result.hand_landmarks)):
        landmarks = result.hand_landmarks[hand_number]
        side = result.handedness[hand_number][0].category_name

        points = []

        #Точек должно быть 21
        for point in landmarks:
            coordinates = {
                "x": point.x,
                "y": point.y,
                "z": point.z
            }
            points.append(coordinates)
        hand = {
            "side": side,
            "points": points
        }
        hands.append(hand)

    return {"hands": hands}
