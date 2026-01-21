const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
    from: { type: String, required: true },
    to: { type: String, required: true }, // Recipient's number
    body: { type: String, required: true },
    timestamp: { type: Number, required: true },
    isMine: { type: Boolean, default: false }
});

const chatSchema = new mongoose.Schema({
    chatId: { type: String, required: true, unique: true, index: true }, // Chat ID (can be group or individual)
    chatName: { type: String },
    contactNumber: { type: String }, // Actual contact phone number (null for groups)
    isGroup: { type: Boolean, default: false },
    messages: [messageSchema],
    lastUpdated: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Chat', chatSchema);
