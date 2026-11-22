# Координаты рук из кадра OpenCV

Загрузи модель один раз. Затем передавай каждый кадр, полученный из
`camera.read()`, в функцию обработки.

```python
from hand_tracking import get_hand_coordinates, load_model

model = load_model()
coordinates = get_hand_coordinates(frame, model)
print(coordinates)
```

Результат — словарь с ключом `hands`. Для каждой найденной руки в списке
есть `side` (Left или Right) и `points` (21 словарь с x, y, z).
Координаты x и y выражены в долях ширины и высоты кадра, z — глубина
относительно запястья. Если рук нет, результат — `{"hands": []}`.
По окончании обработки вызови `model.close()`.

## Проверка в IDLE

Из папки backend в PowerShell:

```powershell
python -m venv .venv-hands
.\.venv-hands\Scripts\python.exe -m pip install -r requirements-hands.txt
.\.venv-hands\Scripts\python.exe -m idlelib camera.py
```

В редакторе IDLE нажми F5. В окне камеры P печатает словарь, Q и Esc
закрывают окно. Если потребуется другая камера, измени индекс в
`cv2.VideoCapture(0)` в camera.py.

Модель `hand_landmarker.task` должна лежать рядом с hand_tracking.py.
Если файла нет, скачай его в backend.

```powershell
Invoke-WebRequest 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task' -OutFile hand_landmarker.task
```

