mdc.ripple.MDCRipple.attachTo(document.querySelector('.mdc-button'));

const configuration = {
  iceServers: [
    {
      urls: ['stun:stun1.l.google.com:19302', 'stun:stun2.l.google.com:19302'],
    },
  ],
  iceCandidatePoolSize: 10,
};

let localStream = null;
let remoteStream = null;

let roomRef = null;
let roomId = null;
let roomDialog = null;
let peerConnection = null;

async function openUserMedia() {
  localStream = await navigator.mediaDevices.getUserMedia({
    video: true,
    audio: true,
  });
  document.querySelector('#localVideo').srcObject = localStream;

  remoteStream = new MediaStream();
  document.querySelector('#remoteVideo').srcObject = remoteStream;

  console.log('Stream:', localStream);

  document.querySelector('#cameraBtn').disabled = true;
  document.querySelector('#joinBtn').disabled = false;
  document.querySelector('#createBtn').disabled = false;
  document.querySelector('#hangupBtn').disabled = false;
}

function registerPeerConnectionListeners() {
  peerConnection.addEventListener('icegatheringstatechange', () => {
    console.log(
      'Ice gathering state chagned:',
      peerConnection.iceGatheringState
    );
  });
  peerConnection.addEventListener('connectionstatechange', () => {
    console.log('Connection state changed:', peerConnection.connectionState);
  });
  peerConnection.addEventListener('signalingstatechange', () => {
    console.log('Signalings state changed:', peerConnection.signalingState);
  });
  peerConnection.addEventListener('iceconnectionstatechange', () => {
    console.log(
      'Ice connection state changed:',
      peerConnection.iceConnectionState
    );
  });
}

async function createRoom() {
  document.querySelector('#createBtn').disabled = true;
  document.querySelector('#joinBtn').disabled = true;
  const db = firebase.firestore();
  roomRef = await db.collection('rooms').doc();

  peerConnection = new RTCPeerConnection(configuration);

  registerPeerConnectionListeners();

  localStream.getTracks().forEach((track) => {
    peerConnection.addTrack(track, localStream);
  });

  const callerCandidatesCollection = roomRef.collection('callerCandidates');
  peerConnection.addEventListener('icecandidate', (event) => {
    if (!event.candidate) {
      console.log('Got final candidate!');
      return;
    }
    console.log('Got candidate: ', event.candidate);
    callerCandidatesCollection.add(event.candidate.toJSON());
  });

  const offer = await peerConnection.createOffer();
  await peerConnection.setLocalDescription(offer);
  console.log('Create offer: ', offer);

  const roomWithOffer = {
    offer: {
      type: offer.type,
      sdp: offer.sdp,
    },
  };
  await roomRef.set(roomWithOffer);
  roomId = roomRef.id;
  console.log(`New room created with SDP offer. Room ID: ${roomId}`);
  document.querySelector(
    '#currentRoom'
  ).innerText = `Current room is ${roomId} - Your are the caller!`;

  peerConnection.addEventListener('track', (event) => {
    const stream = event.streams[0];
    console.log('Got remote track: ', stream);
    if (stream) {
      stream.getTracks().forEach((track) => {
        console.log('Add a track to the remoteStream:', track);
        remoteStream.addTrack(track);
      });
      document.querySelector('#remoteVideo').srcObject = remoteStream;
    }
  });

  roomRef.onSnapshot(async (snapshot) => {
    const data = snapshot.data();
    if (!peerConnection.currentRemoteDescription && data && data.answer) {
      console.log('Got remote description: ', data.answer);
      const answer = new RTCSessionDescription(data.answer);
      await peerConnection.setRemoteDescription(answer);
    }
  });

  roomRef.collection('calleeCandidates').onSnapshot((snapshot) => {
    snapshot.docChanges().forEach(async (change) => {
      if (change.type === 'added') {
        let data = change.doc.data();
        console.log(`Got new remote ICE candidate: ${JSON.stringify(data)}`);
        await peerConnection.addIceCandidate(new RTCIceCandidate(data));
      }
    });
  });
}

async function joinRoomById(roomId) {
  const db = firebase.firestore();
  roomRef = db.collection('rooms').doc(`${roomId}`);
  const roomSnapshot = await roomRef.get();
  console.log('Got room: ', roomSnapshot.exists);

  if (!roomSnapshot.exists) {
    return;
  }

  console.log('Create PeerConnection with configuration: ', configuration);
  peerConnection = new RTCPeerConnection(configuration);
  registerPeerConnectionListeners();

  localStream.getTracks().forEach((track) => {
    peerConnection.addTrack(track, localStream);
  });

  let calleeCandidatesCollection = roomRef.collection('calleeCandidates');
  peerConnection.addEventListener('icecandidate', (event) => {
    if (!event.candidate) {
      console.log('Got final candiate');
      return;
    }
    console.log('Got candidate: ', event.candidate);
    calleeCandidatesCollection.add(event.candidate.toJSON());
  });

  peerConnection.addEventListener('track', (event) => {
    const stream = event.streams[0];
    console.log('Got remote track: ', stream);
    if (!stream) return;
    stream.getTracks().forEach((track) => {
      console.log('Add a track to the remoteStream: ', track);
      remoteStream.addTrack(track);
    });
    document.querySelector('#remoteVideo').srcObject = remoteStream;
  });

  const offer = roomSnapshot.data().offer;
  console.log('Got offer: ', offer);
  await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
  const answer = await peerConnection.createAnswer();
  console.log('Create answer', answer);
  await peerConnection.setLocalDescription(answer);

  const roomWithAnswer = {
    answer: {
      type: answer.type,
      sdp: answer.sdp,
    },
  };
  await roomRef.update(roomWithAnswer);

  roomRef.collection('callerCandidates').onSnapshot(async (snapshot) => {
    snapshot.docChanges().forEach(async (change) => {
      if (change.type === 'added') {
        const data = change.doc.data();
        console.log(`Got new remote ICE candidate: ${JSON.stringify(data)}`);
        peerConnection.addIceCandidate(new RTCIceCandidate(data));
      }
    });
  });
}

function joinRoom() {
  document.querySelector('#createBtn').disabled = true;
  document.querySelector('#joinBtn').disabled = true;

  document.querySelector('#confirmJoinBtn').addEventListener(
    'click',
    async () => {
      roomId = document.querySelector('#room-id').value;
      console.log('Join room: ', roomId);
      document.querySelector(
        '#currentRoom'
      ).innerText = `Current room is ${roomId} - You are the callee!`;
      await joinRoomById(roomId);
    },
    { once: true }
  );
  roomDialog.open();
}

async function hangUp() {
  const tracks = document.querySelector('#localVideo').srcObject.getTracks();
  tracks.forEach((track) => {
    track.stop();
  });
  if (remoteStream) {
    remoteStream.getTracks().forEach((track) => {
      track.stop();
    });
  }

  if (peerConnection) {
    peerConnection.close();
  }

  document.querySelector('#localVideo').srcObject = null;
  document.querySelector('#remoteVideo').srcObject = null;
  document.querySelector('#cameraBtn').disabled = false;
  document.querySelector('#joinBtn').disabled = true;
  document.querySelector('#createBtn').disabled = true;
  document.querySelector('#hangupBtn').disabled = true;
  document.querySelector('#currentRoom').innerText = '';

  if (roomId) {
    const db = firebase.firestore();
    const roomRef = db.collection('rooms').doc(roomId);
    const calleeCandidates = await roomRef.collection('calleeCandidates').get();
    calleeCandidates.forEach(async (candidate) => {
      await candidate.ref.delete();
    });
    const callerCandidates = await roomRef.collection('callerCandidates').get();
    callerCandidates.forEach(async (candidate) => {
      await candidate.ref.delete();
    });
    await roomRef.delete();
  }

  document.location.reload(true);
}

function init() {
  document.querySelector('#cameraBtn').addEventListener('click', openUserMedia);
  document.querySelector('#createBtn').addEventListener('click', createRoom);
  document.querySelector('#joinBtn').addEventListener('click', joinRoom);
  document.querySelector('#hangupBtn').addEventListener('click', hangUp);
  roomDialog = new mdc.dialog.MDCDialog(document.querySelector('#room-dialog'));
}

init();
