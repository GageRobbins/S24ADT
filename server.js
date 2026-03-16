require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const path = require('path');
const db = require('./database');
const { fetchNewClosings, importFromCSV, importCRMSuppression } = require('./services/realtorService');
const { sendPendingBatch, handleInboundReply, handleEngagementEvent } = require('./services/emailService');
const { sendTextBatch, handleInboundText } = require('./services/textService');
const { sendDailySummary } = require('./services/notificationService');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Serve frontend
app.use(express.static(path.join(__dirname, '../frontend/dist')));

// ─────────────────────────────────────────────────────────────────────────
// DASHBOARD STATS
// ─────────────────────────────────────────────────────────────────────────
app.get('/api/stats', (req, res) => {
  const overview = db.prepare(`
    SELECT
      COUNT(*) as total_realtors,
      SUM(CASE WHEN email_sent = 1 THEN 1 ELSE 0 END) as emails_sent,
      SUM(CASE WHEN text_sent = 1 THEN 1 ELSE 0 END) as texts_sent,
      SUM(CASE WHEN replied = 1 THEN 1 ELSE 0 END) as total_replies,
      SUM(CASE WHEN status = 'hot_lead' THEN 1 ELSE 0 END) as hot_leads,
      SUM(CASE WHEN is_partner = 1 THEN 1 ELSE 0 END) as total_partners,
      SUM(CASE WHEN opted_out = 1 THEN 1 ELSE 0 END) as opted_out
    FROM realtors
  `).get();

  const inspectorStats = db.prepare(`
    SELECT
      COUNT(*) as total_inspectors,
      SUM(CASE WHEN is_partner = 1 THEN 1 ELSE 0 END) as inspector_partners
    FROM inspectors
  `).get();

  const referralStats = db.prepare(`
    SELECT
      COUNT(*) as total_referrals,
      SUM(CASE WHEN status = 'installed' THEN 1 ELSE 0 END) as total_installs,
      SUM(CASE WHEN status = 'paid' THEN 1 ELSE 0 END) as paid_referrals,
      SUM(CASE WHEN status = 'paid' THEN payout_amount ELSE 0 END) as total_paid
    FROM referrals
  `).get();

  const todayStats = db.prepare(`
    SELECT * FROM stats_daily WHERE date = date('now')
  `).get() || {};

  const weekStats = db.prepare(`
    SELECT 
      SUM(emails_sent) as week_emails,
      SUM(texts_sent) as week_texts,
      SUM(replies) as week_replies,
      SUM(new_partners) as week_partners
    FROM stats_daily 
    WHERE date >= date('now', '-7 days')
  `).get();

  res.json({ overview, inspectorStats, referralStats, todayStats, weekStats });
});

// ─────────────────────────────────────────────────────────────────────────
// REALTORS
// ─────────────────────────────────────────────────────────────────────────
app.get('/api/realtors', (req, res) => {
  const { status, state, page = 1, limit = 50, search } = req.query;
  const offset = (page - 1) * limit;
  let query = 'SELECT * FROM realtors WHERE 1=1';
  const params = [];

  if (status) { query += ' AND status = ?'; params.push(status); }
  if (state) { query += ' AND state = ?'; params.push(state); }
  if (search) { query += ' AND (name LIKE ? OR email LIKE ? OR brokerage LIKE ?)'; params.push(`%${search}%`, `%${search}%`, `%${search}%`); }

  query += ' ORDER BY engagement_score DESC, created_at DESC LIMIT ? OFFSET ?';
  params.push(Number(limit), Number(offset));

  const realtors = db.prepare(query).all(...params);
  const total = db.prepare('SELECT COUNT(*) as count FROM realtors').get().count;
  res.json({ realtors, total, page: Number(page), limit: Number(limit) });
});

// ─── Hot leads ────────────────────────────────────────────────────────────
app.get('/api/hot-leads', (req, res) => {
  const leads = db.prepare(`
    SELECT * FROM realtors 
    WHERE engagement_score >= 3
    AND replied = 0
    AND opted_out = 0
    AND is_partner = 0
    ORDER BY engagement_score DESC, last_opened_at DESC
    LIMIT 100
  `).all();
  res.json(leads);
});

// ─── Replies ──────────────────────────────────────────────────────────────
app.get('/api/replies', (req, res) => {
  const realtorReplies = db.prepare(`
    SELECT *, 'realtor' as contact_type FROM realtors 
    WHERE replied = 1 ORDER BY replied_at DESC
  `).all();
  
  const inspectorReplies = db.prepare(`
    SELECT *, 'inspector' as contact_type FROM inspectors 
    WHERE replied = 1 ORDER BY replied_at DESC
  `).all();

  const all = [...realtorReplies, ...inspectorReplies]
    .sort((a, b) => new Date(b.replied_at) - new Date(a.replied_at));

  res.json(all);
});

// ─── Mark as partner ──────────────────────────────────────────────────────
app.post('/api/realtors/:id/partner', (req, res) => {
  const { id } = req.params;
  const referralCode = `S24-${id}-${Date.now().toString(36).toUpperCase()}`;
  
  db.prepare(`
    UPDATE realtors SET 
      is_partner = 1,
      partner_since = datetime('now'),
      status = 'partner',
      referral_code = ?,
      updated_at = datetime('now')
    WHERE id = ?
  `).run(referralCode, id);

  db.updateDailyStats('new_partners');
  const realtor = db.prepare('SELECT * FROM realtors WHERE id = ?').get(id);
  res.json({ success: true, realtor, referralCode });
});

// ─── Mark as not interested ───────────────────────────────────────────────
app.post('/api/realtors/:id/close', (req, res) => {
  db.prepare(`UPDATE realtors SET status = 'inactive', do_not_contact = 1, updated_at = datetime('now') WHERE id = ?`).run(req.params.id);
  res.json({ success: true });
});

// ─────────────────────────────────────────────────────────────────────────
// INSPECTORS
// ─────────────────────────────────────────────────────────────────────────
app.get('/api/inspectors', (req, res) => {
  const { status, state, page = 1, limit = 50 } = req.query;
  const offset = (page - 1) * limit;
  let query = 'SELECT * FROM inspectors WHERE 1=1';
  const params = [];
  if (status) { query += ' AND status = ?'; params.push(status); }
  if (state) { query += ' AND state = ?'; params.push(state); }
  query += ' ORDER BY engagement_score DESC, created_at DESC LIMIT ? OFFSET ?';
  params.push(Number(limit), Number(offset));
  const inspectors = db.prepare(query).all(...params);
  res.json(inspectors);
});

app.post('/api/inspectors/:id/partner', (req, res) => {
  const referralCode = `S24I-${req.params.id}-${Date.now().toString(36).toUpperCase()}`;
  db.prepare(`
    UPDATE inspectors SET is_partner = 1, partner_since = datetime('now'), 
    status = 'partner', updated_at = datetime('now') WHERE id = ?
  `).run(req.params.id);
  db.updateDailyStats('new_partners');
  res.json({ success: true, referralCode });
});

// ─────────────────────────────────────────────────────────────────────────
// REFERRALS
// ─────────────────────────────────────────────────────────────────────────
app.get('/api/referrals', (req, res) => {
  const referrals = db.prepare(`
    SELECT r.*, 
      re.name as partner_name, re.brokerage as partner_brokerage
    FROM referrals r
    LEFT JOIN realtors re ON r.realtor_id = re.id
    ORDER BY r.submitted_at DESC
    LIMIT 200
  `).all();
  res.json(referrals);
});

app.post('/api/referrals', (req, res) => {
  const { realtor_id, inspector_id, partner_type, customer_name, customer_phone, customer_email, customer_address } = req.body;
  const result = db.prepare(`
    INSERT INTO referrals (realtor_id, inspector_id, partner_type, customer_name, customer_phone, customer_email, customer_address)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(realtor_id || null, inspector_id || null, partner_type || 'realtor', customer_name, customer_phone, customer_email, customer_address);
  
  db.updateDailyStats('new_referrals');
  res.json({ success: true, id: result.lastInsertRowid });
});

app.patch('/api/referrals/:id/status', (req, res) => {
  const { status } = req.body;
  const updates = { status };
  if (status === 'installed') updates.installed_at = new Date().toISOString();
  if (status === 'paid') updates.paid_at = new Date().toISOString();
  
  db.prepare(`
    UPDATE referrals SET status = ?, 
    installed_at = CASE WHEN ? = 'installed' THEN datetime('now') ELSE installed_at END,
    paid_at = CASE WHEN ? = 'paid' THEN datetime('now') ELSE paid_at END
    WHERE id = ?
  `).run(status, status, status, req.params.id);
  res.json({ success: true });
});

// ─────────────────────────────────────────────────────────────────────────
// CAMPAIGN CONTROLS
// ─────────────────────────────────────────────────────────────────────────
app.post('/api/campaign/fetch', async (req, res) => {
  try {
    const { states, days_back = 7 } = req.body;
    const count = await fetchNewClosings({ states, days_back });
    res.json({ success: true, new_contacts: count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/campaign/send-emails', async (req, res) => {
  try {
    const { limit = 500 } = req.body;
    const count = await sendPendingBatch(limit);
    res.json({ success: true, sent: count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/campaign/send-texts', async (req, res) => {
  try {
    const { limit = 200 } = req.body;
    const count = await sendTextBatch(limit);
    res.json({ success: true, sent: count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Settings / Active states ─────────────────────────────────────────────
app.get('/api/settings', (req, res) => {
  res.json({
    active_states: (process.env.ACTIVE_STATES || 'TX,FL').split(','),
    daily_email_limit: parseInt(process.env.DAILY_EMAIL_LIMIT || '1000'),
    daily_text_limit: parseInt(process.env.DAILY_TEXT_LIMIT || '500'),
    max_followups: parseInt(process.env.MAX_FOLLOWUPS || '5'),
    apis_configured: {
      sendgrid: !!process.env.SENDGRID_API_KEY && process.env.SENDGRID_API_KEY !== 'your_sendgrid_api_key_here',
      twilio: !!process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_ACCOUNT_SID !== 'your_twilio_account_sid_here',
      realestateapi: !!process.env.REALESTATEAPI_KEY && process.env.REALESTATEAPI_KEY !== 'your_realestateapi_key_here',
      anthropic: !!process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_API_KEY !== 'your_anthropic_api_key_here'
    }
  });
});

// ─── CSV Import ────────────────────────────────────────────────────────────
app.post('/api/import/contacts', (req, res) => {
  const { contacts, type } = req.body;
  const count = importFromCSV(contacts, type);
  res.json({ success: true, imported: count });
});

app.post('/api/import/crm-suppression', (req, res) => {
  const { contacts } = req.body;
  const count = importCRMSuppression(contacts);
  res.json({ success: true, imported: count });
});

// ─────────────────────────────────────────────────────────────────────────
// WEBHOOKS
// ─────────────────────────────────────────────────────────────────────────

// SendGrid inbound email reply
app.post('/api/webhook/email-reply', async (req, res) => {
  try {
    const { from, subject, text } = req.body;
    await handleInboundReply({ from, subject, text });
    res.status(200).send('OK');
  } catch (err) {
    console.error('[Webhook] Email reply error:', err.message);
    res.status(200).send('OK');
  }
});

// SendGrid engagement events (opens, clicks, unsubscribes)
app.post('/api/webhook/email-events', (req, res) => {
  try {
    const events = Array.isArray(req.body) ? req.body : [req.body];
    for (const event of events) {
      handleEngagementEvent(event);
    }
    res.status(200).send('OK');
  } catch (err) {
    console.error('[Webhook] Email events error:', err.message);
    res.status(200).send('OK');
  }
});

// Twilio inbound text reply
app.post('/api/webhook/text-reply', async (req, res) => {
  try {
    const twiml = await handleInboundText(req);
    res.type('text/xml').send(twiml);
  } catch (err) {
    console.error('[Webhook] Text reply error:', err.message);
    res.type('text/xml').send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
  }
});

// ─── Partner referral submission (for realtors to submit leads) ───────────
app.get('/partner/:code', (req, res) => {
  const realtor = db.prepare('SELECT * FROM realtors WHERE referral_code = ?').get(req.params.code);
  if (!realtor) return res.status(404).send('Partner link not found');
  res.sendFile(path.join(__dirname, '../frontend/dist/partner.html'));
});

app.post('/api/partner/submit', (req, res) => {
  const { referral_code, customer_name, customer_phone, customer_email, customer_address } = req.body;
  const realtor = db.prepare('SELECT * FROM realtors WHERE referral_code = ?').get(referral_code);
  if (!realtor) return res.status(404).json({ error: 'Invalid referral code' });

  const result = db.prepare(`
    INSERT INTO referrals (realtor_id, partner_type, customer_name, customer_phone, customer_email, customer_address)
    VALUES (?, 'realtor', ?, ?, ?, ?)
  `).run(realtor.id, customer_name, customer_phone, customer_email, customer_address);

  db.prepare('UPDATE realtors SET total_referrals = total_referrals + 1 WHERE id = ?').run(realtor.id);
  db.updateDailyStats('new_referrals');

  res.json({ success: true, message: 'Referral submitted! We\'ll be in touch with your client shortly.' });
});

// ─────────────────────────────────────────────────────────────────────────
// AUTOMATED CRON JOBS
// ─────────────────────────────────────────────────────────────────────────

// Every morning at 7am — fetch new closings
cron.schedule('0 7 * * *', async () => {
  console.log('[CRON] Fetching new closings...');
  await fetchNewClosings();
});

// Every morning at 8am — send email batch
cron.schedule('0 8 * * *', async () => {
  console.log('[CRON] Sending email batch...');
  await sendPendingBatch();
});

// Every afternoon at 12pm — send text batch
cron.schedule('0 12 * * *', async () => {
  console.log('[CRON] Sending text batch...');
  await sendTextBatch();
});

// Every evening at 6pm — second email sweep (follow-ups)
cron.schedule('0 18 * * *', async () => {
  console.log('[CRON] Evening follow-up sweep...');
  await sendPendingBatch(500);
});

// Every morning at 7:30am — daily summary to Gage
cron.schedule('30 7 * * *', async () => {
  const stats = db.prepare(`
    SELECT * FROM stats_daily WHERE date = date('now', '-1 day')
  `).get() || {};
  
  const totals = db.prepare(`
    SELECT 
      SUM(CASE WHEN is_partner = 1 THEN 1 ELSE 0 END) as total_partners,
      SUM(total_referrals) as total_referrals
    FROM realtors
  `).get();

  const hotLeads = db.prepare(`
    SELECT COUNT(*) as count FROM realtors WHERE engagement_score >= 3 AND replied = 0 AND is_partner = 0
  `).get();

  await sendDailySummary({ ...stats, ...totals, hot_leads: hotLeads.count });
});

// ─────────────────────────────────────────────────────────────────────────
// START SERVER
// ─────────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`
  ╔═══════════════════════════════════════════╗
  ║     SECURE24 ADT OUTREACH SYSTEM          ║
  ║     Running on port ${PORT}                  ║
  ║                                           ║
  ║     Dashboard: http://localhost:${PORT}      ║
  ╚═══════════════════════════════════════════╝
  `);
});

module.exports = app;
