const IS_DEV = window.location.port === '5500';
// REPLACE THIS URL with your Render backend URL after deployment
const REMOTE_BACKEND_URL = 'https://your-app-name.onrender.com';

const API_BASE_URL = IS_DEV ? 'http://localhost:3000' : REMOTE_BACKEND_URL;
const socket = io(API_BASE_URL);

// DOM Elements
const loginScreen = document.getElementById('login-screen');
const chatScreen = document.getElementById('chat-screen');
const qrCodeImg = document.getElementById('qr-code');
const loadingQr = document.getElementById('loading-qr');
const loginStatus = document.getElementById('login-status');
const chatList = document.getElementById('chat-list');
const chatMessages = document.getElementById('chat-messages');
const currentChatName = document.getElementById('current-chat-name');
const currentChatStatus = document.getElementById('current-chat-status');
const logoutBtn = document.getElementById('logout-btn');
const searchInput = document.getElementById('search-input');
const chatHeader = document.getElementById('chat-header');

let activeChat = null;
let allChats = [];

// Socket Events
socket.on('qr', (src) => {
    qrCodeImg.src = src;
    qrCodeImg.style.display = 'block';
    loadingQr.style.display = 'none';
    loginStatus.textContent = 'Scan QR code to login';
});

socket.on('ready', () => {
    loginScreen.classList.add('hidden');
    chatScreen.classList.remove('hidden');
    fetchChats();
});

socket.on('authenticated', () => {
    loginStatus.textContent = 'Authenticated! Loading...';
});

socket.on('auth_failure', (msg) => {
    loginStatus.textContent = `Authentication failed: ${msg}`;
    loadingQr.style.display = 'block';
    qrCodeImg.style.display = 'none';
});

socket.on('disconnected', (reason) => {
    console.log(`Disconnected: ${reason}`);

    // Show login screen again
    chatScreen.classList.add('hidden');
    loginScreen.classList.remove('hidden');

    // Reset UI state
    qrCodeImg.style.display = 'none';
    loadingQr.style.display = 'block';
    loginStatus.textContent = 'Disconnected. Waiting for new QR code...';

    // Clear chat data
    allChats = [];
    activeChat = null;
    chatList.innerHTML = '';
});

socket.on('message', (data) => {
    const { chatId, message } = data;

    // Update chat list
    updateChatListOnMessage(chatId, message);

    // If active chat, append message
    if (activeChat === chatId) {
        appendMessage(message);
        scrollToBottom();
    }
});

// Functions
async function fetchChats() {
    try {
        const res = await fetch(`${API_BASE_URL}/api/chats`);
        allChats = await res.json();
        renderChatList(allChats);
    } catch (error) {
        console.error('Error fetching chats:', error);
    }
}

function renderChatList(chats) {
    chatList.innerHTML = '';
    chats.forEach(chat => {
        const div = document.createElement('div');
        div.className = `chat-item ${activeChat === chat.chatId ? 'active' : ''}`;
        div.onclick = () => loadChat(chat.chatId, chat.chatName, chat.contactNumber, chat.isGroup);

        const lastMsg = chat.messages[chat.messages.length - 1] || {};
        const time = lastMsg.timestamp ? new Date(lastMsg.timestamp * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

        div.innerHTML = `
            <div class="avatar">${chat.chatName ? chat.chatName.charAt(0).toUpperCase() : '#'}</div>
            <div class="chat-details">
                <div style="display: flex; justify-content: space-between;">
                    <div class="chat-name">${chat.chatName || chat.contactNumber || chat.chatId}</div>
                    <div class="chat-meta">${time}</div>
                </div>
                <div class="last-message">${lastMsg.body || ''}</div>
            </div>
        `;
        chatList.appendChild(div);
    });
}

async function loadChat(chatId, chatName, contactNumber, isGroup) {
    activeChat = chatId;
    currentChatName.textContent = chatName || contactNumber || chatId;

    // For individual chats, show contact number; for groups show group info
    if (!isGroup && contactNumber) {
        currentChatStatus.textContent = `+${contactNumber}`;
    } else if (isGroup) {
        currentChatStatus.textContent = 'Group Chat';
    } else {
        currentChatStatus.textContent = chatId;
    }

    chatHeader.classList.remove('hidden');

    // Highlight active chat
    document.querySelectorAll('.chat-item').forEach(el => el.classList.remove('active'));
    // Re-render list to update active state (simple way)
    renderChatList(allChats);

    try {
        const res = await fetch(`${API_BASE_URL}/api/chats/${encodeURIComponent(chatId)}`);
        const chat = await res.json();
        renderMessages(chat.messages);

        // Mobile view handling
        if (window.innerWidth <= 768) {
            document.querySelector('.main-chat').classList.add('active');
        }
    } catch (error) {
        console.error('Error loading chat:', error);
    }
}

function renderMessages(messages) {
    chatMessages.innerHTML = '';
    messages.forEach(msg => appendMessage(msg));
    scrollToBottom();
}

function appendMessage(msg) {
    const div = document.createElement('div');
    div.className = `message ${msg.isMine ? 'outgoing' : 'incoming'}`;

    const time = new Date(msg.timestamp * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    div.innerHTML = `
        <div class="message-content">${msg.body}</div>
        <div class="message-time">${time}</div>
    `;
    chatMessages.appendChild(div);
}

function scrollToBottom() {
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function updateChatListOnMessage(chatId, message) {
    const chatIndex = allChats.findIndex(c => c.chatId === chatId);
    if (chatIndex > -1) {
        const chat = allChats[chatIndex];
        chat.messages.push(message);
        chat.lastUpdated = new Date();
        // Move to top
        allChats.splice(chatIndex, 1);
        allChats.unshift(chat);
    } else {
        // New chat (fetch or create placeholder)
        fetchChats(); // Easiest way to sync
        return;
    }
    renderChatList(allChats);
}

// Search
searchInput.addEventListener('input', (e) => {
    const term = e.target.value.toLowerCase();
    const filtered = allChats.filter(c =>
        (c.chatName && c.chatName.toLowerCase().includes(term)) ||
        (c.contactNumber && c.contactNumber.includes(term))
    );
    renderChatList(filtered);
});

// Logout
logoutBtn.addEventListener('click', async () => {
    if (confirm('Are you sure you want to logout?')) {
        try {
            await fetch(`${API_BASE_URL}/api/logout`, { method: 'POST' });
            location.reload();
        } catch (error) {
            console.error('Logout failed:', error);
        }
    }
});

// Mobile Back Button (if I add one later, logic goes here)
// For now, if user clicks back on browser, it might not work as expected in SPA without history API.
// But for this MVP, it's fine.
