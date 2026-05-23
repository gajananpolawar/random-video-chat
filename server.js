 const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const path = require('path'); // क्लाउडवर अचूक फाईल पाथ मिळवण्यासाठी

const PORT = process.env.PORT || 3000;

let db;
let waitingPool = []; 
let onlineCount = 0; 

// SQLite डेटाबेस सुरू करणे आणि टेबल तयार करणे
(async () => {
    // Render/Railway वर फाईल पाथ सुरक्षित ठेवण्यासाठी path.join वापरला आहे
    db = await open({
        filename: path.join(__dirname, 'database.sqlite'),
        driver: sqlite3.Database
    });

    // बॅन झालेल्या युजर्सचे टेबल
    await db.exec(`
        CREATE TABLE IF NOT EXISTS banned_users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            identifier TEXT UNIQUE,
            banned_until INTEGER,
            reason TEXT
        )
    `);
    console.log("SQLite Database Connected & Table Ready! 💾");
})();

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.use(express.static('public'));

// मॅचिंग लॉजिक (FIXED: नवीन 'matchFilter' सिस्टीम नुसार बदलले आहे)
function matchUser(socket) {
    let matchFound = false;
    for (let i = 0; i < waitingPool.length; i++) {
        let potentialMatch = waitingPool[i];
        if (potentialMatch.id === socket.id) continue;

        const locationMatches = (socket.location === "Global" || potentialMatch.location === "Global" || socket.location === potentialMatch.location);
        
        // socket.matchFilter आणि potentialMatch.matchFilter चा वापर करून अचूक जेंडर मॅचिंग
        const socketWantsPotential = (socket.matchFilter === "all" || socket.matchFilter === potentialMatch.gender);
        const potentialWantsSocket = (potentialMatch.matchFilter === "all" || potentialMatch.matchFilter === socket.gender);

        if (locationMatches && socketWantsPotential && potentialWantsSocket) {
            waitingPool.splice(i, 1);
            matchFound = true;

            socket.emit('matched', { to: potentialMatch.id, room: potentialMatch.id, remoteUsername: potentialMatch.username, remoteLocation: potentialMatch.location });
            potentialMatch.emit('matched', { to: socket.id, room: potentialMatch.id, remoteUsername: socket.username, remoteLocation: socket.location });
            break;
        }
    }
    if (!matchFound) {
        if (!waitingPool.includes(socket)) waitingPool.push(socket);
        socket.emit('waiting', 'Searching for a stranger matching your target preferences...');
    }
}

function removeFromPool(id) {
    waitingPool = waitingPool.filter(user => user.id !== id);
}

io.on('connection', (socket) => {
    onlineCount++;
    io.emit('updateOnlineCount', onlineCount);

    socket.on('ready', async (data) => {
        // 🔒 लॉगिन करताना युजर बॅन आहे का ते डेटाबेसमध्ये चेक करा
        const identifier = data.username ? data.username.toLowerCase().trim() : "anonymous";
        
        try {
            const banRecord = await db.get('SELECT banned_until FROM banned_users WHERE identifier = ?', [identifier]);

            if (banRecord) {
                const currentTime = Date.now();
                if (currentTime < banRecord.banned_until) {
                    const timeLeft = Math.ceil((banRecord.banned_until - currentTime) / 60000);
                    socket.emit('banned', `तुम्हाला नियमांचे उल्लंघन केल्यामुळे बॅन केले आहे. कृपया ${timeLeft} मिनिटांनी प्रयत्न करा. 🚫`);
                    socket.disconnect();
                    return;
                } else {
                    // वेळ संपली असल्यास डेटाबेसमधून बॅन काढा
                    await db.run('DELETE FROM banned_users WHERE identifier = ?', [identifier]);
                }
            }
        } catch (err) {
            console.error("Database read error during login:", err);
        }

        socket.username = data.username || "Stranger";
        socket.gender = data.gender || "male";
        socket.matchFilter = data.matchFilter || "all"; // FIXED: कॅमेरा फिल्टर ऐवजी जेंडर मॅचिंगचा डेटा इथे घेतला
        socket.location = data.location || "Global";
        
        matchUser(socket);
    });

    // 🚨 REPORT & BAN LOGIC
    socket.on('reportUser', async (data) => {
        const targetSocket = io.sockets.sockets.get(data.targetId);
        if (targetSocket) {
            const identifier = targetSocket.username.toLowerCase().trim();
            const banDuration = parseInt(data.minutes) * 60 * 1000; 
            const bannedUntil = Date.now() + banDuration;

            try {
                // डेटाबेसमध्ये बॅन रेकॉर्ड सेव्ह करा
                await db.run(
                    'INSERT OR REPLACE INTO banned_users (identifier, banned_until, reason) VALUES (?, ?, ?)',
                    [identifier, bannedUntil, data.reason]
                );

                console.log(`❌ ${targetSocket.username} ला ${data.minutes} मिनिटांसाठी बॅन केले आहे! कारण: ${data.reason}`);

                // बॅन झालेल्या युजरला मेसेज पाठवून हाकलून द्या
                targetSocket.emit('banned', `तुम्हाला नियमांच्या उल्लंघनामुळे (Reported) ${data.minutes} मिनिटांसाठी बॅन करण्यात आले आहे! 🚫`);
                targetSocket.disconnect();
            } catch (err) {
                console.error("Database write error during report:", err);
            }
        }
    });

    socket.on('nextUser', (data) => {
        if (data.remoteUser) io.to(data.remoteUser).emit('strangerLeft');
        if (data.updatedFilter) socket.matchFilter = data.updatedFilter; // FIXED: matchFilter अपडेट केला
        removeFromPool(socket.id);
        matchUser(socket);
    });

    socket.on('signal', (data) => {
        if (data.chatMessage) {
            io.to(data.to).emit('signal', { from: socket.id, chatMessage: data.chatMessage });
        } else {
            io.to(data.to).emit('signal', { from: socket.id, signal: data.signal });
        }
    });

    socket.on('disconnect', () => {
        onlineCount--;
        if (onlineCount < 0) onlineCount = 0;
        io.emit('updateOnlineCount', onlineCount);
        removeFromPool(socket.id);
    });
});

// Server Listen
http.listen(PORT, () => {
    console.log(`Server running on port ${PORT} 🚀`);
});