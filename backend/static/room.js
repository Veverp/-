// Комната, переписка и WebRTC работают отдельно от будущего ИИ-перевода.
const status = document.querySelector('#status');
const actions = document.querySelector('#actions');
const inside = document.querySelector('#inside');
const roomInput = document.querySelector('#room');
const roleInput = document.querySelector('#role');
const createButton = document.querySelector('#create');
const joinButton = document.querySelector('#join');
const mediaButton = document.querySelector('#media');
const cameraButton = document.querySelector('#camera');
const microphoneButton = document.querySelector('#microphone');
const localVideo = document.querySelector('#local-video');
const remoteVideo = document.querySelector('#remote-video');
const mediaStatus = document.querySelector('#media-status');
const remoteStatus = document.querySelector('#remote-status');

let socket = null;
let heartbeat = null;
let reconnectTimer = null;
let retryCount = 0;
let currentRoom = null;
let currentRole = null;
let leaving = false;
let peerPresent = false;
let localStream = null;
let peerState = null;
let signalQueue = Promise.resolve();

const invitation = new URLSearchParams(location.search);
if (invitation.get('room')) {
    roomInput.value = invitation.get('room');
    roleInput.value = invitation.get('role') === 'sign' ? 'sign' : 'speech';
}

function busy(value) {
    createButton.disabled = value;
    joinButton.disabled = value;
    roleInput.disabled = value;
}

function addMessage(author, text) {
    document.querySelector('#empty-chat').hidden = true;
    const item = document.createElement('li');
    item.textContent = author + ': ' + text;
    const messages = document.querySelector('#messages');
    messages.append(item);
    messages.scrollTop = messages.scrollHeight;
}

function send(data) {
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;
    socket.send(JSON.stringify(data));
    return true;
}

function closePeer() {
    if (peerState) peerState.connection.close();
    peerState = null;
    remoteVideo.srcObject = null;
}

function stopMedia() {
    if (localStream) {
        for (const track of localStream.getTracks()) track.stop();
    }
    localStream = null;
    localVideo.srcObject = null;
    mediaButton.hidden = false;
    mediaButton.disabled = false;
    cameraButton.hidden = true;
    microphoneButton.hidden = true;
    document.querySelector('#local-status').textContent = 'Камера и микрофон выключены.';
}

function showFailure(text) {
    clearTimeout(reconnectTimer);
    clearInterval(heartbeat);
    closePeer();
    stopMedia();
    busy(false);
    actions.hidden = false;
    inside.hidden = true;
    status.textContent = text;
}

function reconnect(reason) {
    if (leaving) return;
    if (retryCount >= 10) {
        showFailure('Связь потеряна. ' + reason + ' Подключитесь снова или создайте комнату.');
        return;
    }
    retryCount += 1;
    busy(true);
    status.textContent = 'Связь прервалась. Восстанавливаем подключение…';
    reconnectTimer = setTimeout(function () {
        enter(currentRoom, currentRole, true).catch(function () {
            reconnect(reason);
        });
    }, 5000);
}

// Настройка WebRTC следует схеме согласования встречных offer.
function getPeer() {
    if (peerState) return peerState;
    const connection = new RTCPeerConnection({
        iceServers: [{urls: 'stun:stun.l.google.com:19302'}]
    });
    const state = {
        connection: connection,
        makingOffer: false,
        ignoreOffer: false,
        settingRemoteAnswer: false,
        candidates: []
    };
    peerState = state;

    connection.onicecandidate = function (event) {
        if (peerState === state && event.candidate) {
            send({type: 'ice_candidate', data: event.candidate.toJSON()});
        }
    };
    connection.ontrack = function (event) {
        if (peerState !== state) return;
        remoteVideo.srcObject = event.streams[0];
        remoteStatus.textContent = 'Получаем медиа собеседника.';
        remoteVideo.play().catch(function () {
            remoteStatus.textContent = 'Нажмите воспроизведение на видео, чтобы включить звук.';
        });
    };
    connection.onconnectionstatechange = function () {
        if (peerState !== state) return;
        if (connection.connectionState === 'connected') {
            mediaStatus.textContent = 'Медиасоединение установлено.';
        }
        if (connection.connectionState === 'disconnected') {
            mediaStatus.textContent = 'Медиасвязь прервалась. Ожидаем восстановления…';
        }
        if (connection.connectionState === 'failed') {
            mediaStatus.textContent = 'Видеосвязь не установилась. Для некоторых сетей нужен TURN-сервер. Переписка продолжает работать.';
        }
    };
    connection.onnegotiationneeded = async function () {
        if (!peerPresent || peerState !== state) return;
        try {
            state.makingOffer = true;
            await connection.setLocalDescription();
            if (peerState === state) {
                send({type: connection.localDescription.type, data: connection.localDescription.toJSON()});
            }
        } catch (error) {
            if (peerState === state) mediaStatus.textContent = 'Не удалось согласовать видеосвязь.';
        } finally {
            state.makingOffer = false;
        }
    };
    if (localStream) {
        for (const track of localStream.getTracks()) connection.addTrack(track, localStream);
    }
    return state;
}

async function handleSignal(data) {
    if (!peerPresent) return;
    const state = getPeer();
    const connection = state.connection;
    if (data.type === 'ice_candidate') {
        if (state.ignoreOffer) return;
        if (!connection.remoteDescription) {
            state.candidates.push(data.data);
        } else {
            await connection.addIceCandidate(data.data);
        }
        return;
    }

    const readyForOffer = !state.makingOffer && (
        connection.signalingState === 'stable' || state.settingRemoteAnswer
    );
    const collision = data.type === 'offer' && !readyForOffer;
    // При одновременных предложениях роль speech уступает роли sign.
    state.ignoreOffer = currentRole === 'sign' && collision;
    if (state.ignoreOffer) {
        state.candidates = [];
        return;
    }
    state.settingRemoteAnswer = data.type === 'answer';
    try {
        await connection.setRemoteDescription(data.data);
    } finally {
        state.settingRemoteAnswer = false;
    }
    if (peerState !== state) return;
    for (const candidate of state.candidates) await connection.addIceCandidate(candidate);
    state.candidates = [];
    if (data.type === 'offer') {
        await connection.setLocalDescription();
        send({type: 'answer', data: connection.localDescription.toJSON()});
    }
}

async function enter(room, role, restoring = false) {
    const response = await fetch('/rooms/' + encodeURIComponent(room));
    if (response.status === 404) {
        showFailure('Комната завершена. Создайте новую и отправьте другу новое приглашение.');
        return;
    }
    if (!response.ok) throw new Error('Не удалось проверить комнату.');
    const info = await response.json();
    if (info.participants >= 2) throw new Error('Оба места заняты. Закройте лишнюю вкладку комнаты.');

    currentRoom = room;
    currentRole = role;
    leaving = false;
    status.textContent = restoring ? 'Восстанавливаем связь…' : 'Подключаемся…';
    const protocol = location.protocol === 'https:' ? 'wss://' : 'ws://';
    const currentSocket = new WebSocket(
        protocol + location.host + '/ws/' + encodeURIComponent(room) + '?role=' + role
    );
    socket = currentSocket;
    let joined = false;
    let lastReply = Date.now();

    currentSocket.onmessage = function (event) {
        if (socket !== currentSocket) return;
        const data = JSON.parse(event.data);
        lastReply = Date.now();
        if (data.type === 'joined') {
            joined = true;
            retryCount = 0;
            busy(false);
            actions.hidden = true;
            inside.hidden = false;
            document.querySelector('#room-name').textContent = room;
            const invite = new URL(location.origin);
            invite.searchParams.set('room', room);
            invite.searchParams.set('role', role === 'sign' ? 'speech' : 'sign');
            document.querySelector('#invite').value = invite.toString();
            peerPresent = data.participants === 2;
            status.textContent = peerPresent ? 'Вы оба в комнате.' : 'Вы в комнате. Ожидаем друга…';
            remoteStatus.textContent = peerPresent ? 'Собеседник подключён. Ожидаем включения медиа.' : 'Ожидаем собеседника.';
            if (peerPresent) getPeer();
            clearInterval(heartbeat);
            heartbeat = setInterval(function () {
                if (Date.now() - lastReply > 45000) {
                    currentSocket.close(4000, 'Нет ответа сервера');
                } else if (currentSocket.readyState === WebSocket.OPEN) {
                    currentSocket.send(JSON.stringify({type: 'ping'}));
                }
            }, 15000);
        }
        if (data.type === 'peer_joined') {
            peerPresent = true;
            closePeer();
            signalQueue = Promise.resolve();
            getPeer();
            status.textContent = 'Друг подключился.';
            remoteStatus.textContent = 'Собеседник подключён. Ожидаем включения медиа.';
        }
        if (data.type === 'peer_left') {
            peerPresent = false;
            closePeer();
            status.textContent = 'Друг вышел. Ожидаем подключения…';
            remoteStatus.textContent = 'Собеседник отключился.';
        }
        if (data.type === 'text') addMessage('Друг', data.text);
        if (data.type === 'error') status.textContent = data.message;
        if (['offer', 'answer', 'ice_candidate'].includes(data.type)) {
            signalQueue = signalQueue.then(function () {
                if (socket === currentSocket) return handleSignal(data);
            }).catch(function () {
                mediaStatus.textContent = 'Не удалось согласовать видеосвязь. Можно продолжить переписку.';
            });
        }
    };
    currentSocket.onclose = function (event) {
        if (socket !== currentSocket || leaving) return;
        clearInterval(heartbeat);
        closePeer();
        peerPresent = false;
        remoteStatus.textContent = 'Соединение прервано.';
        const reason = event.reason || ('Код соединения ' + event.code + '.');
        if (joined || restoring) reconnect(reason);
        else showFailure('Вход не выполнен. Возможно, выбранный режим уже занят. ' + reason);
    };
    currentSocket.onerror = function () {
        if (socket === currentSocket) status.textContent = 'Проверяем связь с сервером…';
    };
}

createButton.onclick = async function () {
    clearTimeout(reconnectTimer);
    retryCount = 0;
    busy(true);
    try {
        const response = await fetch('/rooms', {method: 'POST'});
        if (!response.ok) throw new Error('Не удалось создать комнату.');
        const data = await response.json();
        roomInput.value = data.room_id;
        document.querySelector('#messages').replaceChildren();
        document.querySelector('#empty-chat').hidden = false;
        await enter(data.room_id, roleInput.value);
    } catch (error) {
        showFailure(error.message);
    }
};

joinButton.onclick = async function () {
    clearTimeout(reconnectTimer);
    retryCount = 0;
    busy(true);
    try {
        let room = roomInput.value.trim();
        if (room.includes('://')) {
            const invite = new URL(room);
            room = invite.searchParams.get('room');
            const role = invite.searchParams.get('role');
            if (role === 'sign' || role === 'speech') roleInput.value = role;
        }
        if (!room) throw new Error('Вставьте приглашение друга.');
        document.querySelector('#messages').replaceChildren();
        document.querySelector('#empty-chat').hidden = false;
        await enter(room, roleInput.value);
    } catch (error) {
        showFailure(error.message);
    }
};

document.querySelector('#leave').onclick = function () {
    leaving = true;
    clearTimeout(reconnectTimer);
    clearInterval(heartbeat);
    if (socket) socket.close(1000, 'Выход из комнаты');
    socket = null;
    peerPresent = false;
    showFailure('Вы вышли из комнаты.');
};

document.querySelector('#copy').onclick = async function () {
    const input = document.querySelector('#invite');
    try {
        await navigator.clipboard.writeText(input.value);
        document.querySelector('#copy-status').textContent = 'Ссылка скопирована. Отправьте её другу.';
    } catch (error) {
        input.focus();
        input.select();
        document.querySelector('#copy-status').textContent = 'Ссылка выделена. Нажмите Ctrl+C.';
    }
};

mediaButton.onclick = async function () {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        mediaStatus.textContent = 'Для камеры откройте сайт по HTTPS или на localhost.';
        return;
    }
    mediaButton.disabled = true;
    mediaStatus.textContent = 'Разрешите браузеру использовать камеру и микрофон.';
    try {
        const stream = await navigator.mediaDevices.getUserMedia({audio: true, video: true});
        if (leaving || inside.hidden) {
            for (const track of stream.getTracks()) track.stop();
            return;
        }
        localStream = stream;
        localVideo.srcObject = stream;
        mediaButton.hidden = true;
        cameraButton.hidden = false;
        microphoneButton.hidden = false;
        cameraButton.textContent = 'Выключить камеру';
        microphoneButton.textContent = 'Выключить микрофон';
        document.querySelector('#local-status').textContent = 'Камера и микрофон включены.';
        mediaStatus.textContent = peerPresent ? 'Устанавливаем медиасоединение…' : 'Медиа включены. Ожидаем друга.';
        if (peerPresent) {
            if (peerState) {
                for (const track of stream.getTracks()) peerState.connection.addTrack(track, stream);
            } else {
                getPeer();
            }
        }
    } catch (error) {
        mediaStatus.textContent = error.name === 'NotAllowedError'
            ? 'Доступ к камере или микрофону отклонён. Разрешение можно изменить в настройках сайта.'
            : 'Камера или микрофон недоступны. Проверьте подключение и другие приложения.';
    } finally {
        mediaButton.disabled = false;
    }
};

cameraButton.onclick = function () {
    if (!localStream) return;
    for (const track of localStream.getVideoTracks()) {
        track.enabled = !track.enabled;
        cameraButton.textContent = track.enabled ? 'Выключить камеру' : 'Включить камеру';
    }
};

microphoneButton.onclick = function () {
    if (!localStream) return;
    for (const track of localStream.getAudioTracks()) {
        track.enabled = !track.enabled;
        microphoneButton.textContent = track.enabled ? 'Выключить микрофон' : 'Включить микрофон';
    }
};

document.querySelector('#chat').onsubmit = function (event) {
    event.preventDefault();
    const input = document.querySelector('#text');
    const text = input.value.trim();
    if (!text) return;
    if (!send({type: 'text', text: text})) {
        status.textContent = 'Восстанавливаем связь. Отправьте сообщение после подключения.';
        return;
    }
    addMessage('Вы', text);
    input.value = '';
};

window.addEventListener('pagehide', function () {
    leaving = true;
    clearTimeout(reconnectTimer);
    clearInterval(heartbeat);
    closePeer();
    stopMedia();
    if (socket) socket.close(1000, 'Страница закрыта');
});
