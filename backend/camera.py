import cv2
import numpy as np

from hand_tracking import get_hand_coordinates, load_model


def draw_points(image, coordinates):
    height, width = image.shape[:2]

    for hand in coordinates["hands"]:
        point_number = 0

        for point in hand["points"]:
            # Переводим координаты из долей кадра в пиксели.
            x = int(point["x"] * width)
            y = int(point["y"] * height)

            cv2.circle(image, (x, y), 4, (0, 255, 0), -1)
            cv2.putText(
                image, str(point_number), (x + 6, y - 6),
                cv2.FONT_HERSHEY_SIMPLEX, 0.4, (0, 255, 0), 1
            )
            point_number += 1

        # Подписываем сторону руки возле запястья.
        wrist = hand["points"][0]
        x = int(wrist["x"] * width)
        y = int(wrist["y"] * height)
        cv2.putText(
            image, hand["side"], (x + 6, y + 20),
            cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2
        )


model = load_model()
camera = cv2.VideoCapture(0)

print("Enter-снимок,Q-Стоп")

try:
    if not camera.isOpened():
        print("Камера недоступна.")

    while camera.isOpened():
        success, frame = camera.read()
        if not success:
            print("Не удалось прочитать кадр.")
            break

        coordinates = get_hand_coordinates(frame, model)
        draw_points(frame, coordinates)
        cv2.imshow("Cam", frame)

        key = cv2.waitKey(1) & 0xFF

        if key in (ord("q"), 27) or cv2.getWindowProperty("Cam", cv2.WND_PROP_VISIBLE) < 1:
            break

        if key == ord("p"):
            print(coordinates)

        # Enter открывает снимок точек текущего кадра на чёрном фоне.
        if key in (10, 13):
            points_image = np.zeros_like(frame)
            draw_points(points_image, coordinates)

            if len(coordinates["hands"]) == 0:
                cv2.putText(
                    points_image, "No hands detected", (20, 40),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.8, (255, 255, 255), 2
                )

            cv2.imshow("Hand points", points_image)
finally:
    camera.release()
    cv2.destroyAllWindows()
    model.close()
