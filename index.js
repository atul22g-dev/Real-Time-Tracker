const express = require('express');
const http = require('http');
const path = require('path');
const socketio = require('socket.io');

const app = express();
const port = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const io = socketio(server);

const connectedUsers = new Map();

io.on('connection', (socket) => {
    console.log(`🔌 User connected: ${socket.id}`);
    connectedUsers.set(socket.id, {});
    io.emit('usersCount', connectedUsers.size);

    // Send existing users to the newly connected client
    const existingUsers = [];
    for (const [id, data] of connectedUsers) {
        if (id !== socket.id && data.latitude && data.longitude) {
            existingUsers.push({
                id,
                latitude: data.latitude,
                longitude: data.longitude,
                username: data.username || 'Anonymous'
            });
        }
    }
    if (existingUsers.length > 0) {
        socket.emit('initialLocations', existingUsers);
        setTimeout(() => {
            for (const u of existingUsers) {
                if (!connectedUsers.has(u.id)) {
                    socket.emit('userDisconnected', u.id);
                }
            }
        }, 2000);
    } else {
        socket.emit('initialLocations', []);
    }

    socket.on('setUsername', (username) => {
        const existing = connectedUsers.get(socket.id) || {};
        existing.username = username;
        connectedUsers.set(socket.id, existing);
        console.log(`👤 ${username} (${socket.id.slice(0, 5)}...) joined`);
        // Notify others a user joined
        socket.broadcast.emit('userJoined', { id: socket.id, username });
        // Re-broadcast location if already sent, so others see the name
        if (existing.latitude && existing.longitude) {
            socket.broadcast.emit('receiveLocation', {
                id: socket.id,
                latitude: existing.latitude,
                longitude: existing.longitude,
                username: username
            });
        }
    });

    socket.on('sendLocation', (data) => {
        const existing = connectedUsers.get(socket.id) || {};
        const updated = { ...existing, latitude: data.latitude, longitude: data.longitude };
        connectedUsers.set(socket.id, updated);
        socket.broadcast.emit('receiveLocation', {
            id: socket.id,
            latitude: data.latitude,
            longitude: data.longitude,
            username: updated.username || 'Anonymous'
        });
        io.emit('usersCount', connectedUsers.size);
    });

    socket.on('disconnect', () => {
        const user = connectedUsers.get(socket.id);
        const name = user?.username || 'Anonymous';
        console.log(`❌ ${name} disconnected`);
        connectedUsers.delete(socket.id);
        io.emit('userDisconnected', socket.id);
        io.emit('userLeft', { id: socket.id, username: name });
        io.emit('usersCount', connectedUsers.size);
    });
});

app.get('/', (req, res) => {
    res.render('index');
});

server.listen(port, () => {
    console.log(`🚀 Server is running on http://localhost:${port}`);
});
