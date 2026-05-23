 // ====================================================================
// 1. SESSION MANAGEMENT & DATA INITIALIZATION
// ====================================================================
const userSessionData = sessionStorage.getItem('chatUser');
if (!userSessionData) {
    window.location.href = '/login.html';
}
const myData = JSON.parse(userSessionData);

const socket = io();
const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');
const statusDiv = document.getElementById('status');

const chatBox = document.getElementById('chatBox');
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');
const nextBtn = document.getElementById('nextBtn');
const muteMicBtn = document.getElementById('muteMicBtn');
const videoCamBtn = document.getElementById('videoCamBtn');
const settingsBtn = document.getElementById('settingsBtn');
const fullScreenBtn = document.getElementById('fullScreenBtn');
const reportBtn = document.getElementById('reportBtn');

const localNameDisplay = document.getElementById('localName');
const remoteNameDisplay = document.getElementById('remoteName');

// Report Modal DOM Elements
const reportModal = document.getElementById('reportModal');
const closeReportBtn = document.getElementById('closeReportBtn');
const submitReportBtn = document.getElementById('submitReportBtn');
const reportReason = document.getElementById('reportReason');
const banTime = document.getElementById('banTime');

let localStream;
let peerConnection;
let remoteUser = null;
let isMuted = false;
let isVideoOff = false;
let fallbackTimer = null; 

// Dynamic tracking filter initialized from user settings
let currentFilter = myData.filter; 

const config = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
    ]
};

// ====================================================================
// 2. FREE TRANSLATION LOCAL DICTIONARY MAPPING SYSTEM
// ====================================================================
const translationDictionary = {
    "hello! 👋": { mr: "नमस्कार! 👋", hi: "नमस्ते! 👋", en: "Hello! 👋" },
    "hello": { mr: "नमस्कार", hi: "नमस्ते", en: "Hello" },
    "how are you?": { mr: "तुम्ही कसे आहात?", hi: "आप कैसे हैं?", en: "How are you?" },
    "how are you": { mr: "तुम्ही कसे आहात?", hi: "आप कैसे हैं?", en: "How are you?" },
    "where are you from?": { mr: "तुम्ही कुठून आहात?", hi: "आप कहाँ से हैं?", en: "Where are you from?" },
    "where from?": { mr: "कुठून आहात?", hi: "कहाँ से हो?", en: "Where are you from?" },
    "nice to meet you!": { mr: "तुम्हाला भेटून आनंद झाला!", hi: "आपसे मिलकर खुशी हुई!", en: "Nice to meet you!" },
    "nice to meet you": { mr: "तुम्हाला भेटून आनंद झाला!", hi: "आपसे मिलकर खुशी हुई!", en: "Nice to meet you!" },
    "bye": { mr: "बाय / पुन्हा भेटू", hi: "अलविदा / फिर मिलेंगे", en: "Bye" },
    "i am fine": { mr: "मी ठीक आहे", hi: "मैं ठीक हूँ", en: "I am fine" },
    "what is your name?": { mr: "तुमचे नाव काय आहे?", hi: "आपका नाम काय आहे?", en: "What is your name?" }
};

function translateMessage(text, targetLang) {
    if (targetLang === 'en') return text; 

    const cleanText = text.toLowerCase().trim();
    if (translationDictionary[cleanText] && translationDictionary[cleanText][targetLang]) {
        return translationDictionary[cleanText][targetLang];
    }
    return text; 
}

// ====================================================================
// 3. MEDIA DEVICE ACCESS & CONNECTIVITY SETUP
// ====================================================================
async function startVideo() {
    try {
        console.log("Requesting camera and microphone access...");
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        
        if (localVideo) {
            localVideo.srcObject = localStream;
            console.log("Local camera stream successfully attached to localVideo element.");
        }
        
        statusDiv.innerText = `Searching for ${currentFilter}...`;
        localNameDisplay.innerText = `${myData.username} (You)`;
        
        startSearch();
    } catch (error) {
        console.error("Camera access error:", error);
        statusDiv.innerText = "Camera denied! (Text chat only)";
        localNameDisplay.innerText = `${myData.username} (You)`;
        startSearch();
    }
}

function startSearch() {
    socket.emit('ready', { 
        username: myData.username,
        gender: myData.gender,
        filter: currentFilter,
        location: myData.location
    }); 
    
    startFallbackTimer();
}

function startFallbackTimer() {
    clearTimeout(fallbackTimer);
    
    if (currentFilter !== 'all') {
        fallbackTimer = setTimeout(() => {
            console.log("Preferred gender not available. Switching to fallback (Everyone)...");
            statusDiv.innerText = "Preferred target not found. Matching with anyone available...";
            
            currentFilter = 'all'; 
            socket.emit('nextUser', { remoteUser: null, updatedFilter: 'all' });
        }, 8000); 
    }
}

function resetConnection() {
    if (peerConnection) {
        peerConnection.ontrack = null;
        peerConnection.onicecandidate = null;
        peerConnection.close();
        peerConnection = null;
    }
    remoteVideo.srcObject = null;
    remoteNameDisplay.innerText = "Stranger (Remote)";
    messageInput.disabled = true;
    sendBtn.disabled = true;
    clearTimeout(fallbackTimer);
}

// ====================================================================
// 4. CHAT STRANGER SWITCHING (NEXT DISPATCH) & ROOM EVENTS
// ====================================================================
nextBtn.addEventListener('click', () => {
    nextBtn.disabled = true;
    nextBtn.innerText = "Searching... 🔍";
    
    const oldRemoteUser = remoteUser;
    resetConnection();
    remoteUser = null;
    
    currentFilter = myData.filter; 
    
    socket.emit('nextUser', { remoteUser: oldRemoteUser }); 
    chatBox.innerHTML = `<div style="color: #ff9800; text-align: center; font-weight: bold;">Skipping... Looking for ${currentFilter}.</div>`;
    
    startFallbackTimer();

    setTimeout(() => {
        nextBtn.disabled = false;
        nextBtn.innerText = "Next Stranger ➡️";
    }, 2000);
});

socket.on('strangerLeft', () => {
    resetConnection();
    remoteUser = null;
    chatBox.innerHTML = `<div style="color: #dc3545; text-align: center; font-weight: bold;">Stranger left. Re-matching...</div>`;
    statusDiv.innerText = "Finding a new match...";
    
    currentFilter = myData.filter; 
    socket.emit('nextUser', { remoteUser: null });
    startFallbackTimer();
});

socket.on('matched', async (data) => {
    clearTimeout(fallbackTimer); 
    statusDiv.innerText = "Connected!";
    remoteUser = data.to;
    
    const strangerName = `${data.remoteUsername} 📍[${data.remoteLocation}]`;
    remoteNameDisplay.innerText = strangerName;
    
    messageInput.disabled = false;
    sendBtn.disabled = false;
    messageInput.value = '';
    messageInput.focus();
    chatBox.innerHTML = `<div style="color: #28a745; text-align: center; font-weight: bold; margin-bottom: 10px;">Connected with ${strangerName}! 👋</div>`;

    initPeerConnection();

    if (data.room === socket.id) {
        try {
            const offer = await peerConnection.createOffer();
            await peerConnection.setLocalDescription(offer);
            socket.emit('signal', { to: remoteUser, signal: offer });
        } catch (e) {
            console.error(e);
        }
    }
});

socket.on('waiting', (msg) => {
    statusDiv.innerText = msg;
    resetConnection();
    startFallbackTimer(); 
});

// ====================================================================
// 5. WEBRTC SIGNALING CORE ENGINE
// ====================================================================
function initPeerConnection() {
    if (peerConnection) return;
    peerConnection = new RTCPeerConnection(config);

    if (localStream) {
        localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));
    }

    peerConnection.ontrack = (event) => {
        if (remoteVideo.srcObject !== event.streams[0]) {
            remoteVideo.srcObject = event.streams[0];
        }
    };

    peerConnection.onicecandidate = (event) => {
        if (event.candidate && remoteUser) {
            socket.emit('signal', { to: remoteUser, signal: event.candidate });
        }
    };
}

socket.on('signal', async (data) => {
    if (data.chatMessage) {
        appendMessage(data.chatMessage, 'stranger');
        return;
    }

    if (!peerConnection && data.from) {
        remoteUser = data.from;
        initPeerConnection();
    }

    try {
        if (data.signal.type === 'offer') {
            await peerConnection.setRemoteDescription(new RTCSessionDescription(data.signal));
            const answer = await peerConnection.createAnswer();
            await peerConnection.setLocalDescription(answer);
            socket.emit('signal', { to: data.from, signal: answer });
        } 
        else if (data.signal.type === 'answer') {
            await peerConnection.setRemoteDescription(new RTCSessionDescription(data.signal));
        } 
        else if (data.signal.candidate) {
            await peerConnection.addIceCandidate(new RTCIceCandidate(data.signal));
        }
    } catch (e) {
        console.error(e);
    }
});

// ====================================================================
// 6. MULTIMEDIA CONTROLS & FULLSCREEN
// ====================================================================
muteMicBtn.addEventListener('click', () => {
    if (localStream) {
        isMuted = !isMuted;
        localStream.getAudioTracks().forEach(track => track.enabled = !isMuted);
        muteMicBtn.innerText = isMuted ? "Unmute Mic 🎙️" : "Mute Mic 🎤";
        muteMicBtn.classList.toggle('active', isMuted);
    }
});

videoCamBtn.addEventListener('click', () => {
    if (localStream) {
        isVideoOff = !isVideoOff;
        localStream.getVideoTracks().forEach(track => track.enabled = !isVideoOff);
        videoCamBtn.innerText = isVideoOff ? "Start Video 📹" : "Stop Video 📷";
        videoCamBtn.classList.toggle('active', isVideoOff);
    }
});

settingsBtn.addEventListener('click', () => {
    alert(`Preferences:\nName: ${myData.username}\nGender: ${myData.gender}\nLooking For: ${currentFilter}\nRegion: ${myData.location}`);
});

fullScreenBtn.addEventListener('click', () => {
    if (!remoteVideo.srcObject) {
        alert("No video stream available to display in full screen.");
        return;
    }
    if (remoteVideo.requestFullscreen) { remoteVideo.requestFullscreen(); } 
    else if (remoteVideo.webkitRequestFullscreen) { remoteVideo.webkitRequestFullscreen(); } 
    else if (remoteVideo.msRequestFullscreen) { remoteVideo.msRequestFullscreen(); }
});

// ====================================================================
// 7. TEXT MESSAGING & LIVE TRANSLATION RENDERING
// ====================================================================
function sendMessage() {
    const text = messageInput.value.trim();
    if (text && remoteUser) {
        socket.emit('signal', { to: remoteUser, chatMessage: text });
        appendMessage(text, 'me');
        messageInput.value = '';
    }
}

function appendMessage(text, sender) {
    const msgDiv = document.createElement('div');
    msgDiv.classList.add('message', sender);
    
    if (sender === 'stranger') {
        const selectedLang = document.getElementById('chatLang').value;
        const translatedText = translateMessage(text, selectedLang);
        
        if (translatedText !== text) {
            msgDiv.innerHTML = `${translatedText} <br><small style="opacity:0.5; font-size:11px; display:block; margin-top:4px;">Original: ${text}</small>`;
        } else {
            msgDiv.innerText = text;
        }
    } else {
        msgDiv.innerText = text;
    }
    
    chatBox.appendChild(msgDiv);
    chatBox.scrollTop = chatBox.scrollHeight;
}

sendBtn.addEventListener('click', sendMessage);
messageInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendMessage();
});

document.querySelectorAll('.suggest-btn').forEach(button => {
    button.addEventListener('click', () => {
        if (!messageInput.disabled && remoteUser) {
            const msg = button.getAttribute('data-msg');
            socket.emit('signal', { to: remoteUser, chatMessage: msg });
            appendMessage(msg, 'me');
        } else {
            alert("Please wait until you are connected to a stranger!");
        }
    });
});

// ====================================================================
// 8. REPORT ABUSE & DATABASE BAN LOGIC
// ====================================================================
reportBtn.addEventListener('click', () => {
    if (!remoteUser) {
        alert("You are not connected to anyone right now!");
        return;
    }
    reportModal.style.display = 'flex';
});

closeReportBtn.addEventListener('click', () => {
    reportModal.style.display = 'none';
});

submitReportBtn.addEventListener('click', () => {
    if (remoteUser) {
        socket.emit('reportUser', {
            targetId: remoteUser,
            reason: reportReason.value,
            minutes: banTime.value
        });

        alert("Report submitted successfully. The user has been banned! Searching for a new match...");
        reportModal.style.display = 'none';
        nextBtn.click();
    }
});

socket.on('banned', (msg) => {
    alert(msg);
    window.location.href = '/login.html';
});

// ====================================================================
// 9. AR FACE FILTERS LOGIC (INTEGRATED)
// ====================================================================
document.querySelectorAll('.filter-item-btn').forEach(button => {
    button.addEventListener('click', () => {
        // Remove active styling rule states across standard slider nodes
        document.querySelectorAll('.filter-item-btn').forEach(btn => btn.classList.remove('active'));
        
        // Append active configuration to explicitly chosen node selection
        button.classList.add('active');
        
        const filterType = button.getAttribute('data-filter');
        applyVideoFilter(filterType);
    });
});

function applyVideoFilter(filter) {
    if (!localVideo) return;

    // High performance localized visual style manipulation matrices
    switch (filter) {
        case 'none':
            localVideo.style.filter = 'none';
            break;
        case 'glasses':
            localVideo.style.filter = 'contrast(1.2) brightness(0.9) hue-rotate(45deg)';
            break;
        case 'hat':
            localVideo.style.filter = 'sepia(0.6) contrast(1.1) brightness(1.1)';
            break;
        case 'mustache':
            localVideo.style.filter = 'grayscale(1) contrast(1.3)';
            break;
        case 'clown':
            localVideo.style.filter = 'saturate(2.5) contrast(1.1)';
            break;
        case 'cat':
            localVideo.style.filter = 'brightness(1.2) saturate(1.2) sepia(0.15)';
            break;
        case 'devil':
            localVideo.style.filter = 'hue-rotate(180deg) saturate(2) contrast(1.4)';
            break;
        default:
            localVideo.style.filter = 'none';
    }
    
    console.log(`AR Filter Applied: ${filter}`);
}

// Trigger initialization safely when layout content loads
window.addEventListener('DOMContentLoaded', startVideo);