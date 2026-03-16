const sgMail = require('@sendgrid/mail');
const db = require('../database');
const { generateRealtorEmail, generateInspectorEmail, getPartnerWelcomeEmail } = require('./claudeService');
const notificationService = require('./notificationService');
require('dotenv').config();

const MAX_FOLLOWUPS = parseInt(process.env.MAX_FOLLOWUPS || '5');
const DAILY_LIMIT = parseInt(process.env.DAILY_EMAIL_LIMIT || '1000');

// ─── Send a single email ──────────────────────────────────────────────────
async function sendEmail({ to, subject, body, contactId, contactType, emailType }) {
  if (!process.env.SENDGRID_API_KEY || process.env.SENDGRID_API_KEY === 'your_sendgrid_api_key_here') {
    console.log(`[SendGrid] No API key - would send to ${to}: ${subject}`);
    return { success: true, mock: true };
  }

  sgMail.setApiKey(process.env.SENDGRID_API_KEY);

  const htmlBody = body
    .replace(/\n/g, '<br>')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

  try {
    const [response] = await sgMail.send({
      to,
      from: {
        email: process.env.FROM_EMAIL || 'partnerships@secure24partners.com',
        name: process.env.FROM_NAME || 'Gage Robbins'
      },
      subject,
      text: body,
      html: `
        <div style="font-family: Georgia, serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #333;">
          ${htmlBody}
          <br><br>
          <div style="border-top: 1px solid #eee; padding-top: 15px; margin-top: 20px; font-size: 12px; color: #888;">
            Secure24 ADT — Authorized ADT Dealer<br>
            <a href="mailto:${process.env.FROM_EMAIL}?subject=UNSUBSCRIBE" style="color: #888;">Unsubscribe</a>
          </div>
        </div>
      `,
      trackingSettings: {
        clickTracking: { enable: true },
        openTracking: { enable: true }
      },
      customArgs: {
        contact_id: String(contactId),
        contact_type: contactType,
        email_type: emailType
      }
    });

    // Log to database
    db.prepare(`
      INSERT INTO email_log (contact_id, contact_type, sendgrid_message_id, subject, email_type)
      VALUES (?, ?, ?, ?, ?)
    `).run(contactId, contactType, response.headers['x-message-id'] || '', subject, emailType);

    db.updateDailyStats('emails_sent');
    return { success: true, messageId: response.headers['x-message-id'] };

  } catch (err) {
    console.error('[SendGrid] Send failed:', err.message);
    return { success: false, error: err.message };
  }
}

// ─── Process pending email batch ──────────────────────────────────────────
async function sendPendingBatch(limit = DAILY_LIMIT) {
  let sent = 0;

  // Get realtors that need initial email
  const pendingRealtors = db.prepare(`
    SELECT * FROM realtors 
    WHERE email_sent = 0 
    AND opted_out = 0 
    AND do_not_contact = 0
    AND email IS NOT NULL
    AND followup_count < ?
    ORDER BY created_at DESC
    LIMIT ?
  `).all(MAX_FOLLOWUPS, Math.floor(limit * 0.7));

  for (const realtor of pendingRealtors) {
    try {
      const emailType = realtor.followup_count === 0 ? 'initial' : `followup_${realtor.followup_count}`;
      const { subject, body } = await generateRealtorEmail(realtor, emailType);

      const result = await sendEmail({
        to: realtor.email,
        subject,
        body,
        contactId: realtor.id,
        contactType: 'realtor',
        emailType
      });

      if (result.success) {
        db.prepare(`
          UPDATE realtors SET 
            email_sent = 1, 
            email_sent_at = datetime('now'),
            followup_count = followup_count + 1,
            last_contact_at = datetime('now'),
            next_followup_at = datetime('now', '+3 days'),
            status = CASE WHEN status = 'pending' THEN 'contacted' ELSE status END,
            updated_at = datetime('now')
          WHERE id = ?
        `).run(realtor.id);
        sent++;
      }

      // Small delay to avoid rate limits
      await sleep(100);
    } catch (err) {
      console.error(`[Email] Failed for realtor ${realtor.id}:`, err.message);
    }
  }

  // Get inspectors that need initial email
  const pendingInspectors = db.prepare(`
    SELECT * FROM inspectors 
    WHERE email_sent = 0 
    AND opted_out = 0 
    AND email IS NOT NULL
    AND followup_count < ?
    ORDER BY created_at DESC
    LIMIT ?
  `).all(MAX_FOLLOWUPS, Math.floor(limit * 0.3));

  for (const inspector of pendingInspectors) {
    try {
      const emailType = inspector.followup_count === 0 ? 'initial' : `followup_${inspector.followup_count}`;
      const { subject, body } = await generateInspectorEmail(inspector, emailType);

      const result = await sendEmail({
        to: inspector.email,
        subject,
        body,
        contactId: inspector.id,
        contactType: 'inspector',
        emailType
      });

      if (result.success) {
        db.prepare(`
          UPDATE inspectors SET 
            email_sent = 1,
            email_sent_at = datetime('now'),
            followup_count = followup_count + 1,
            last_contact_at = datetime('now'),
            status = 'contacted',
            updated_at = datetime('now')
          WHERE id = ?
        `).run(inspector.id);
        sent++;
      }

      await sleep(100);
    } catch (err) {
      console.error(`[Email] Failed for inspector ${inspector.id}:`, err.message);
    }
  }

  // Process follow-ups due today
  const followupsDue = db.prepare(`
    SELECT * FROM realtors
    WHERE email_sent = 1
    AND opted_out = 0
    AND replied = 0
    AND followup_count < ?
    AND next_followup_at <= datetime('now')
    AND email IS NOT NULL
    LIMIT ?
  `).all(MAX_FOLLOWUPS, 200);

  for (const realtor of followupsDue) {
    try {
      const emailType = `followup_${realtor.followup_count}`;
      const { subject, body } = await generateRealtorEmail(realtor, emailType);

      const result = await sendEmail({
        to: realtor.email,
        subject,
        body,
        contactId: realtor.id,
        contactType: 'realtor',
        emailType
      });

      if (result.success) {
        const isLastFollowup = realtor.followup_count + 1 >= MAX_FOLLOWUPS;
        db.prepare(`
          UPDATE realtors SET 
            followup_count = followup_count + 1,
            last_contact_at = datetime('now'),
            next_followup_at = datetime('now', '+4 days'),
            status = CASE WHEN ? THEN 'inactive' ELSE status END,
            updated_at = datetime('now')
          WHERE id = ?
        `).run(isLastFollowup ? 1 : 0, realtor.id);
        sent++;
      }

      await sleep(100);
    } catch (err) {
      console.error(`[Email] Follow-up failed for realtor ${realtor.id}:`, err.message);
    }
  }

  console.log(`[Email] Batch complete. Sent: ${sent}`);
  return sent;
}

// ─── Send partner welcome email ───────────────────────────────────────────
async function sendPartnerWelcome(contact, referralCode, contactType = 'realtor') {
  const { subject, body } = getPartnerWelcomeEmail(contact, referralCode);
  return sendEmail({
    to: contact.email,
    subject,
    body,
    contactId: contact.id,
    contactType,
    emailType: 'partner_welcome'
  });
}

// ─── Handle inbound reply webhook from SendGrid ───────────────────────────
async function handleInboundReply({ from, subject, text }) {
  const emailMatch = from.match(/<(.+?)>/) || [null, from];
  const replyEmail = emailMatch[1].toLowerCase().trim();

  // Check realtors
  let contact = db.prepare('SELECT * FROM realtors WHERE LOWER(email) = ?').get(replyEmail);
  let contactType = 'realtor';

  if (!contact) {
    contact = db.prepare('SELECT * FROM inspectors WHERE LOWER(email) = ?').get(replyEmail);
    contactType = 'inspector';
  }

  if (contact) {
    const table = contactType === 'inspector' ? 'inspectors' : 'realtors';
    db.prepare(`
      UPDATE ${table} SET 
        replied = 1, 
        replied_at = datetime('now'),
        reply_text = ?,
        reply_channel = 'email',
        status = 'replied',
        updated_at = datetime('now')
      WHERE id = ?
    `).run(text, contact.id);

    db.updateDailyStats('replies');

    // Notify Gage immediately
    await notificationService.notifyReply({
      contact,
      contactType,
      channel: 'email',
      replyText: text,
      subject
    });
  }

  return contact;
}

// ─── Handle engagement events from SendGrid ───────────────────────────────
function handleEngagementEvent(event) {
  const { contact_id, contact_type, event: eventType } = event;
  if (!contact_id) return;

  const table = contact_type === 'inspector' ? 'inspectors' : 'realtors';

  if (eventType === 'open') {
    db.prepare(`
      UPDATE ${table} SET 
        email_opens = email_opens + 1,
        engagement_score = engagement_score + 1,
        last_opened_at = datetime('now'),
        status = CASE WHEN status = 'contacted' AND email_opens >= 3 THEN 'hot_lead' ELSE status END,
        updated_at = datetime('now')
      WHERE id = ?
    `).run(contact_id);
  } else if (eventType === 'click') {
    db.prepare(`
      UPDATE ${table} SET 
        email_clicks = email_clicks + 1,
        engagement_score = engagement_score + 10,
        status = 'hot_lead',
        updated_at = datetime('now')
      WHERE id = ?
    `).run(contact_id);
  } else if (eventType === 'unsubscribe' || eventType === 'spamreport') {
    db.prepare(`
      UPDATE ${table} SET 
        opted_out = 1,
        opted_out_at = datetime('now'),
        status = 'opted_out',
        updated_at = datetime('now')
      WHERE id = ?
    `).run(contact_id);

    // Add to suppression list
    const contact = db.prepare(`SELECT email, phone FROM ${table} WHERE id = ?`).get(contact_id);
    if (contact) {
      db.prepare('INSERT OR IGNORE INTO suppression_list (email, phone, reason) VALUES (?, ?, ?)').run(
        contact.email, contact.phone, eventType
      );
    }
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = { sendEmail, sendPendingBatch, sendPartnerWelcome, handleInboundReply, handleEngagementEvent };
