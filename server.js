const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(__dirname));

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    // Listens for a user joining a specific room
    socket.on('join room', (roomName) => {
        socket.join(roomName); // Joins the Socket.io room channel
        console.log(`User ${socket.id} joined room: ${roomName}`);
    });

    // Listens for a message and sends it ONLY to that specific room
    socket.on('chat message', (data) => {
        io.to(data.room).emit('chat message', data);
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
    });
});

const PORT = 3000;
server.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});