const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const bcrypt = require('bcryptjs');
const Datastore = require('nedb-promises');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Initialize persistent storage file
const db = Datastore.create({ filename: 'nexus_data.db', autoload: true });

app.use(express.static(__dirname));

// Primary privilege identity setting
const SUPER_ADMIN_USERNAME = "Shravan"; 

io.on('connection', (socket) => {
    let sessionUser = null;

    // Direct Login / Registration execution block
    socket.on('auth user', async (data) => {
        try {
            const { email, password, username } = data;
            const existingUser = await db.findOne({ email: email.toLowerCase() });

            if (existingUser) {
                if (existingUser.isBanned) {
                    return socket.emit('auth error', 'Your profile is currently restricted from access.');
                }
                const match = await bcrypt.compare(password, existingUser.password);
                if (!match) {
                    return socket.emit('auth error', 'Invalid credentials.');
                }
                sessionUser = existingUser;
            } else {
                if (!username) {
                    return socket.emit('auth error', 'Username field is mandatory to create a profile.');
                }
                const nameTaken = await db.findOne({ username: username.trim() });
                if (nameTaken) {
                    return socket.emit('auth error', 'This profile username is already in use.');
                }

                const hashPassword = await bcrypt.hash(password, 10);
                const checkPrivilege = username.trim() === SUPER_ADMIN_USERNAME;

                const newUser = {
                    email: email.toLowerCase(),
                    password: hashPassword,
                    username: username.trim(),
                    isAdmin: checkPrivilege,
                    isBanned: false
                };

                sessionUser = await db.insert(newUser);
            }

            socket.emit('auth success', {
                username: sessionUser.username,
                email: sessionUser.email,
                isAdmin: sessionUser.isAdmin
            });
            console.log(`User session online: ${sessionUser.username}`);
        } catch (err) {
            socket.emit('auth error', 'Database structural error encountered.');
        }
    });

    socket.on('chat message', (data) => {
        if (!sessionUser || sessionUser.isBanned) return;
        io.emit('chat message', { user: sessionUser.username, text: data.text });
    });

    // Pinned Admin control validation engine
    socket.on('admin command', async (data) => {
        if (!sessionUser || !sessionUser.isAdmin) return socket.emit('admin response', 'Action prohibited.');
        const { target, action } = data;

        const targetAccount = await db.findOne({ username: target });
        if (!targetAccount) return socket.emit('admin response', 'Target user configuration does not exist.');
        if (targetAccount.username === SUPER_ADMIN_USERNAME) return socket.emit('admin response', 'Cannot execute modifiers against root authority.');

        if (action === 'ban') {
            await db.update({ _id: targetAccount._id }, { $set: { isBanned: true } });
            socket.emit('admin response', `Successfully restricted: ${target}`);
        } else if (action === 'unban') {
            await db.update({ _id: targetAccount._id }, { $set: { isBanned: false } });
            socket.emit('admin response', `Reversed restriction flags for: ${target}`);
        } else if (action === 'makeadmin') {
            await db.update({ _id: targetAccount._id }, { $set: { isAdmin: true } });
            socket.emit('admin response', `Granted privileges to profile: ${target}`);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server executing successfully on port ${PORT}`));