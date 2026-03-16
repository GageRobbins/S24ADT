const twilio = require('twilio');
const db = require('../database');
const { generateRealtorText } = require('./claudeService');
const notificationService = require('./notificationService');
require('dotenv').config();

const DAILY_TEXT_LIMIT = parseInt(process.env.DAILY_TEXT_LIMIT || '500');

function getClient() {
  if (!process.env.TWILIO_ACCOUNT_SID || process.env.TWILIO_ACCOUNT_SID === 'your_twilio_account_sid_here') {
    return null;
  }
  return twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
}

// ─── Send a single text ───────────────────────────────────────────────────
async function sendText({ to, message, contactId, contactType, textType }) {
  const client = getClient();

  if (!client) {
    console.log(`[Twilio] No credentials - would text ${to}: ${message.substring(0, 50)}...`);
    return { success: true, mock: true };
  }

  // Clean phone number
  const cleanPhone = to.replace(/\D/g, '');
  const formattedPhone = cleanPhone.startsWith('1') ? `+${cleanPhone}` : `+1${cleanPhone}`;

  try {
    const msg = await client.messages.create({
      body: message,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: formattedPhone
    });

    // Log to database
    db.prepare(`
      INSERT INTO text_log (contact_id, contact_type, twilio_sid, message, text_type)
      VALUES (?, ?, ?, ?, ?)
    `).run(contactId, contactType, msg.sid, message, textType);

    db.updateDailyStats('texts_sent');
    return { success: true, sid: msg.sid };

  } catch (err) {
    console.error('[Twilio] Send failed:', err.message);
    return { success: false, error: err.message };
  }
}

// ─── Process pending text batch ───────────────────────────────────────────
async function sendTextBatch(limit = DAILY_TEXT_LIMIT) {
  let sent = 0;

  // Text realtors who got an email 3+ days ago but haven't replied
  const pendingTexts = db.prepare(`
    SELECT * FROM realtors
    WHERE email_sent = 1
    AND text_sent = 0
    AND opted_out = 0
    AND replied = 0
    AND phone IS NOT NULL
    AND email_sent_at <= datetime('now', '-3 days')
    AND followup_count < ?
    ORDER BY engagement_score DESC, email_opens DESC
    LIMIT ?
  `).all(parseInt(process.env.MAX_FOLLOWUPS || '5'), limit);

  for (const realtor of pendingTexts) {
    try {
      // Respect time zones - only text 8am-7pm local time
      const hour = getLocalHour(realtor.state);
      if (hour < 8 || hour > 19) continue;

      const message = await generateRealtorText(realtor, 'followup');
      const result = await sendText({
        to: realtor.phone,
        message,
        contactId: realtor.id,
        contactType: 'realtor',
        textType: 'followup_1'
      });

      if (result.success) {
        db.prepare(`
          UPDATE realtors SET 
            text_sent = 1,
            text_sent_at = datetime('now'),
            engagement_score = engagement_score + 1,
            last_contact_at = datetime('now'),
            updated_at = datetime('now')
          WHERE id = ?
        `).run(realtor.id);
        sent++;
      }

      await sleep(200);
    } catch (err) {
      console.error(`[Text] Failed for realtor ${realtor.id}:`, err.message);
    }
  }

  console.log(`[Text] Batch complete. Sent: ${sent}`);
  return sent;
}

// ─── Handle inbound text reply from Twilio webhook ────────────────────────
async function handleInboundText(req) {
  const { From, Body } = req.body;
  const cleanPhone = From.replace(/\D/g, '').replace(/^1/, '');
  const bodyLower = Body.toLowerCase().trim();

  // Handle STOP opt-out
  if (bodyLower === 'stop' || bodyLower === 'unsubscribe') {
    const realtor = db.prepare("SELECT * FROM realtors WHERE replace(replace(replace(phone, '-', ''), '(', ''), ')', '') LIKE ?").get(`%${cleanPhone}%`);
    if (realtor) {
      db.prepare(`UPDATE realtors SET opted_out = 1, opted_out_at = datetime('now'), status = 'opted_out' WHERE id = ?`).run(realtor.id);
      db.prepare('INSERT OR IGNORE INTO suppression_list (phone, reason) VALUES (?, ?)').run(From, 'STOP');
    }
    return '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';
  }

  // Find the contact
  let contact = db.prepare(`
    SELECT * FROM realtors 
    WHERE replace(replace(replace(replace(phone, '-', ''), '(', ''), ')', ''), ' ', '') LIKE ?
  `).get(`%${cleanPhone}%`);
  let contactType = 'realtor';

  if (!contact) {
    contact = db.prepare(`
      SELECT * FROM inspectors 
      WHERE replace(replace(replace(replace(phone, '-', ''), '(', ''), ')', ''), ' ', '') LIKE ?
    `).get(`%${cleanPhone}%`);
    contactType = 'inspector';
  }

  if (contact) {
    const table = contactType === 'inspector' ? 'inspectors' : 'realtors';
    db.prepare(`
      UPDATE ${table} SET 
        replied = 1,
        replied_at = datetime('now'),
        reply_text = ?,
        reply_channel = 'text',
        status = 'replied',
        engagement_score = engagement_score + 5,
        updated_at = datetime('now')
      WHERE id = ?
    `).run(Body, contact.id);

    db.updateDailyStats('replies');

    // Notify Gage immediately
    await notificationService.notifyReply({
      contact,
      contactType,
      channel: 'text',
      replyText: Body
    });
  }

  return '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';
}

// ─── Get approximate local hour for a US state ───────────────────────────
function getLocalHour(state) {
  const now = new Date();
  const utcHour = now.getUTCHours();
  
  const timezones = {
    // Eastern
    FL: -5, GA: -5, NC: -5, SC: -5, VA: -5, WV: -5, MD: -5, DE: -5, 
    NJ: -5, NY: -5, CT: -5, RI: -5, MA: -5, VT: -5, NH: -5, ME: -5,
    PA: -5, OH: -5, MI: -5, IN: -5,
    // Central  
    TX: -6, OK: -6, KS: -6, NE: -6, SD: -6, ND: -6, MN: -6, IA: -6,
    MO: -6, WI: -6, IL: -6, MS: -6, AL: -6, TN: -6, KY: -6, AR: -6, LA: -6,
    // Mountain
    CO: -7, WY: -7, MT: -7, ID: -7, UT: -7, AZ: -7, NM: -7,
    // Pacific
    CA: -8, NV: -8, OR: -8, WA: -8
  };

  const offset = timezones[state?.toUpperCase()] || -6;
  // Adjust for DST (approximate)
  const dst = isDST(now) ? 1 : 0;
  return (utcHour + offset + dst + 24) % 24;
}

function isDST(date) {
  const jan = new Date(date.getFullYear(), 0, 1).getTimezoneOffset();
  const jul = new Date(date.getFullYear(), 6, 1).getTimezoneOffset();
  return Math.max(jan, jul) !== date.getTimezoneOffset();
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = { sendText, sendTextBatch, handleInboundText };
