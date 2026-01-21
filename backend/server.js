require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const mongoose = require('mongoose');
const { Client, LocalAuth } = require('whatsapp-web.js');
const QRCode = require('qrcode');
const path = require('path');
const Chat = require('./models/Chat');
const cron = require('node-cron');
const { processLeads } = require('./services/leadService');

const cors = require('cors');
const app = express();
app.use(cors());

const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: ["http://localhost:5500", "http://127.0.0.1:5500"],
        methods: ["GET", "POST"]
    }
});

const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/whatsapp_qr';

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));

// MongoDB Connection
mongoose.connect(MONGO_URI)
    .then(() => console.log('✅ MongoDB connected'))
    .catch(err => console.error('❌ MongoDB connection error:', err));

// WhatsApp Client Management
let client = null;
let qrCodeData = null;

function createWhatsAppClient() {
    client = new Client({
        authStrategy: new LocalAuth(),
        puppeteer: {
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--disable-gpu'
            ]
        },
        authTimeoutMs: 60000,
        // Cache the web version to avoid reloading issues
        webVersionCache: {
            type: 'remote',
            remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html'
        }
    });

    client.on('qr', (qr) => {
        console.log('QR RECEIVED');
        QRCode.toDataURL(qr, (err, url) => {
            if (err) {
                console.error('Error generating QR code', err);
                return;
            }
            qrCodeData = url;
            io.emit('qr', url);
        });
    });

    client.on('ready', () => {
        console.log('✅ WhatsApp connected');
        qrCodeData = null;
        io.emit('ready');
    });

    client.on('authenticated', () => {
        console.log('AUTHENTICATED');
        io.emit('authenticated');
    });

    client.on('auth_failure', msg => {
        console.error('AUTHENTICATION FAILURE', msg);
        io.emit('auth_failure', msg);
    });

    client.on('disconnected', async (reason) => {
        console.log('Client was logged out', reason);
        io.emit('disconnected', reason);

        // Don't try to reinitialize here - it causes crashes
        // The logout endpoint will handle recreation
    });

    client.on('message_create', async msg => {
        try {
            const chat = await msg.getChat();

            // Extract chat ID (works for both groups and individuals)
            const chatId = chat.id._serialized;
            const chatIdWithoutSuffix = chatId.split('@')[0];

            // Determine if it's a group
            const isGroup = chat.isGroup;

            // For individual chats, extract the actual contact phone number
            let contactNumber = null;
            let actualToNumber = null;
            let actualFromNumber = null;

            if (!isGroup) {
                // Get contact information to find the REAL phone number
                // For @lid accounts, the chat ID is NOT the phone number - we need contact.number
                try {
                    if (msg.fromMe) {
                        // Get the recipient's real phone number
                        const toContact = await client.getContactById(msg.to);
                        // Use contact.number if available (for @lid), otherwise use chat ID
                        actualToNumber = toContact.number || msg.to.split('@')[0];
                        contactNumber = actualToNumber;

                        // My number is the sender
                        actualFromNumber = msg.from.split('@')[0];
                    } else {
                        // Get the sender's real phone number
                        const fromContact = await msg.getContact();
                        // Use contact.number if available (for @lid), otherwise use chat ID
                        actualFromNumber = fromContact.number || msg.from.split('@')[0];
                        contactNumber = actualFromNumber;

                        // My number is the recipient
                        actualToNumber = msg.to.split('@')[0];
                    }
                } catch (e) {
                    console.error('Error getting contact info:', e.message);
                    // Fallback to chat ID without suffix
                    actualFromNumber = msg.from.split('@')[0];
                    actualToNumber = msg.to.split('@')[0];
                    contactNumber = chatIdWithoutSuffix;
                }
            } else {
                // For group messages, just use the IDs
                actualFromNumber = msg.from.split('@')[0];
                actualToNumber = msg.to.split('@')[0];
            }

            // Get the chat name
            const chatName = chat.name || contactNumber || chatIdWithoutSuffix;

            const messageData = {
                from: actualFromNumber,
                to: actualToNumber,
                body: msg.body,
                timestamp: msg.timestamp,
                isMine: msg.fromMe
            };

            await Chat.findOneAndUpdate(
                { chatId: chatId },
                {
                    $set: {
                        chatName: chatName,
                        contactNumber: contactNumber,
                        isGroup: isGroup,
                        lastUpdated: new Date()
                    },
                    $push: { messages: messageData }
                },
                { upsert: true, new: true }
            );

            console.log(`📩 Message saved | Chat: ${chatName} (${contactNumber}) | From: ${actualFromNumber} → To: ${actualToNumber} | Body: ${msg.body.substring(0, 30)}...`);
            io.emit('message', { chatId: chatId, message: messageData });
        } catch (error) {
            console.error('Error saving message:', error);
        }
    });

    return client;
}

// Initialize the first client
createWhatsAppClient();

client.initialize();

// Socket.io connection
io.on('connection', (socket) => {
    console.log('New client connected');

    if (qrCodeData) {
        socket.emit('qr', qrCodeData);
    }

    // Check if client is already ready
    if (client.info) {
        socket.emit('ready');
    }

    socket.on('disconnect', () => {
        console.log('Client disconnected');
    });
});

// API Routes
app.post('/api/test-leads', async (req, res) => {
    try {
        await processLeads();
        res.json({ success: true, message: 'Lead extraction process triggered' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to trigger lead extraction' });
    }
});

app.get('/api/chats', async (req, res) => {
    try {
        const chats = await Chat.find().sort({ lastUpdated: -1 });
        res.json(chats);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch chats' });
    }
});

app.get('/api/chats/:chatId', async (req, res) => {
    try {
        const chat = await Chat.findOne({ chatId: req.params.chatId });
        if (!chat) {
            return res.status(404).json({ error: 'Chat not found' });
        }
        res.json(chat);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch chat' });
    }
});

app.post('/api/logout', async (req, res) => {
    try {
        console.log('Logout requested - destroying client...');

        // Logout from WhatsApp
        if (client && client.info) {
            await client.logout();
        }

        // Destroy the current client
        if (client) {
            await client.destroy();
        }

        // Clear QR code data
        qrCodeData = null;

        // Wait a bit for cleanup
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Create and initialize new client
        console.log('Creating new client...');
        createWhatsAppClient();
        client.initialize();

        res.json({ success: true });
    } catch (error) {
        console.error('Logout error:', error);

        // Even if logout fails, try to recreate the client
        try {
            if (client) {
                await client.destroy();
            }
            qrCodeData = null;
            await new Promise(resolve => setTimeout(resolve, 1000));
            createWhatsAppClient();
            client.initialize();
        } catch (recreateError) {
            console.error('Client recreation error:', recreateError);
        }

        res.status(500).json({ error: 'Logout completed with errors, but new session started' });
    }
});

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);

    // Schedule lead extraction every 45 minutes
    cron.schedule('*/45 * * * *', () => {
        console.log('⏰ Running scheduled lead extraction...');
        processLeads();
    });
});
