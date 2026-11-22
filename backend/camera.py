
import cv2

#ТЕСТОВАЯ КАМЕРА PYTHON
def open_camera(camera_index=0):

    camera = cv2.VideoCapture(camera_index)

    if not camera.isOpened():
        print("Ошибка: камера недоступна.")
        return

    print("Камера запущена. Выход - Q")

    try:
        while True:
            success, frame = camera.read()
            if not success:
                print("Ошибка при считывании кадра.")
                break
            cv2.imshow("Cam", frame)
            if cv2.waitKey(1) & 0xFF == ord("q"):
                break
    finally:
        camera.release()
        cv2.destroyAllWindows()
        print("Камера закрыта.")

open_camera()
