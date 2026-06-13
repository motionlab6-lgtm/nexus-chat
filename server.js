const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const bcrypt = require('bcryptjs');
const Datastore = require('nedb-promises');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Initialize a lightweight local database file
const db = Datastore.create({ filename: 'nexus_data.db', autoload: true });

app.use(express.static(__dirname));

// Shravan is now officially configured as the root administrator
const SUPER_ADMIN_USERNAME = "Shravan"; 

io.on('connection', (socket) => {
    let sessionUser = null;

    // Handles user authentication (Login/Registration combo)
    socket.on('auth user', async (data) => {
        try {
            const { email, password, username } = data;
            const existingUser = await db.findOne({ email: email.toLowerCase() });

            if (existingUser) {
                // User exists, attempt Login validation
                if (existingUser.isBanned) {
                    return socket.emit('auth error', 'Your account has been banned from Nexus.');
                }
                const passwordMatch = await bcrypt.compare(password, existingUser.password);
                if (!passwordMatch) {
                    return socket.emit('auth error', 'Invalid email or password identity.');
                }
                sessionUser = existingUser;
            } else {
                // Registration routine
                if (!username) {
                    return socket.emit('auth error', 'Account not found. Please provide a display name to register.');
                }
                const takenName = await db.findOne({ username: username.trim() });
                if (takenName) {
                    return socket.emit('auth error', 'This username is already taken.');
                }

                const hashedPassword = await bcrypt.hash(password, 10);
                const isSystemAdmin = username.trim() === SUPER_ADMIN_USERNAME;

                const newUser = {
                    email: email.toLowerCase(),
                    password: hashedPassword,
                    username: username.trim(),
                    isAdmin: isSystemAdmin,
                    isBanned: false
                };

                sessionUser = await db.insert(newUser);
            }

            socket.join('global-lounge');
            socket.emit('auth success', {
                username: sessionUser.username,
                email: sessionUser.email,
                isAdmin: sessionUser.isAdmin
            });
            console.log(`${sessionUser.username} connected to Nexus.`);
        } catch (err) {
            socket.emit('auth error', 'Internal Database Authentication Fault.');
        }
    });

    // Profile updates from inside Settings panel
    socket.on('update profile', async (newName) => {
        if (!sessionUser) return;
        const cleanName = newName.trim();
        if(!cleanName) return socket.emit('profile error', 'Name cannot be blank.');

        const taken = await db.findOne({ username: cleanName });
        if (taken && taken._id !== sessionUser._id) {
            return socket.emit('profile error', 'Username already taken.');
        }

        await db.update({ _id: sessionUser._id }, { $set: { username: cleanName } });
        sessionUser.username = cleanName;
        socket.emit('profile updated', cleanName);
    });

    socket.on('chat message', (data) => {
        if (!sessionUser || sessionUser.isBanned) return;
        io.to('global-lounge').emit('chat message', { user: sessionUser.username, text: data.text });
    });

    // ================= ADMIN MODULE COMMAND EXECUTION =================
    socket.on('admin command', async (data) => {
        if (!sessionUser || !sessionUser.isAdmin) return socket.emit('admin response', 'Unauthorized access.');
        const { target, action } = data;

        const targetUser = await db.findOne({ username: target });
        if (!targetUser) return socket.emit('admin response', 'Target user profile not found.');
        if (targetUser.username === SUPER_ADMIN_USERNAME) return socket.emit('admin response', 'Cannot modify root Super Admin.');

        if (action === 'ban') {
            await db.update({ _id: targetUser._id }, { $set: { isBanned: true } });
            socket.emit('admin response', `Successfully banned user: ${target}`);
        } else if (action === 'unban') {
            await db.update({ _id: targetUser._id }, { $set: { isBanned: false } });
            socket.emit('admin response', `Successfully unbanned user: ${target}`);
        } else if (action === 'makeadmin') {
            await db.update({ _id: targetUser._id }, { $set: { isAdmin: true } });
            socket.emit('admin response', `${target} has been promoted to Administrator.`);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Nexus engine operating on port ${PORT}`));