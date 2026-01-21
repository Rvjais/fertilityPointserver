const { OpenAI } = require('openai');
const axios = require('axios');
const Chat = require('../models/Chat');

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Extracts lead information from chat history using ChatGPT
 * @param {Array} messages - Array of message objects
 * @returns {Object|null} - Extracted lead data or null if no lead found
 */
async function extractLeadFromChat(messages, contactNumber) {
    if (!messages || messages.length === 0) return null;

    const chatHistory = messages.map(m => `${m.isMine ? 'Bot' : 'User'}: ${m.body}`).join('\n');

    const prompt = `
You are an expert lead extraction assistant for Fertility Point, a fertility clinic.
Your task is to analyze the following WhatsApp chat history and extract lead information.

Fields to extract:
1. Name: The user's full name.
2. Phone-Number: The user's phone number (use ${contactNumber} if not explicitly mentioned in chat).
3. Appointment Hospital branch: One of "Upper Hill, Nairobi", "Parklands, Nairobi", or "United Mall, Kisumu".
4. Appointment date: The preferred date for the appointment (YYYY-MM-DD format if possible).

Chat History:
${chatHistory}

Return the data in JSON format only. If a field is not found, use null.
Example:
{
  "name": "John Doe",
  "phoneNumber": "254712345678",
  "hospitalBranch": "Upper Hill, Nairobi",
  "appointmentDate": "2026-03-12"
}
`;

    try {
        const response = await openai.chat.completions.create({
            model: "gpt-3.5-turbo", // or gpt-4o for better accuracy
            messages: [{ role: "user", content: prompt }],
            response_format: { type: "json_object" },
        });

        const leadData = JSON.parse(response.choices[0].message.content);

        // Only consider it a lead if at least name or appointment date is found
        if (leadData.name || leadData.appointmentDate || leadData.hospitalBranch) {
            return leadData;
        }
        return null;
    } catch (error) {
        console.error('Error extracting lead with OpenAI:', error.message);
        return null;
    }
}

/**
 * Sends lead data to Google Apps Script
 * @param {Object} leadData - The extracted lead data
 */
async function sendToGoogleSheets(leadData) {
    const scriptUrl = process.env.GOOGLE_SCRIPT_URL;
    if (!scriptUrl) {
        console.error('GOOGLE_SCRIPT_URL not set in .env');
        return;
    }

    try {
        const response = await axios.post(scriptUrl, leadData);
        console.log('✅ Lead sent to Google Sheets:', response.data);
    } catch (error) {
        console.error('❌ Error sending lead to Google Sheets:', error.message);
    }
}

/**
 * Main function to process all recent chats and extract leads
 */
async function processLeads() {
    console.log('🚀 Starting lead extraction process...');

    try {
        // Find chats updated in the last 50 minutes (to have some overlap with 45min cron)
        const fortyFiveMinutesAgo = new Date(Date.now() - 50 * 60 * 1000);
        const activeChats = await Chat.find({ lastUpdated: { $gte: fortyFiveMinutesAgo } });

        console.log(`Found ${activeChats.length} active chats to process.`);

        for (const chat of activeChats) {
            console.log(`Processing chat: ${chat.chatName} (${chat.chatId})`);

            const leadData = await extractLeadFromChat(chat.messages, chat.contactNumber);

            if (leadData) {
                // Ensure phone number is set
                if (!leadData.phoneNumber) leadData.phoneNumber = chat.contactNumber;

                console.log('Extracted Lead:', leadData);
                await sendToGoogleSheets(leadData);
            } else {
                console.log('No lead info extracted for this chat.');
            }
        }

        console.log('✅ Lead extraction process completed.');
    } catch (error) {
        console.error('Error in processLeads:', error);
    }
}

module.exports = { processLeads };
