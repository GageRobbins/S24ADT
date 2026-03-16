const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'secure24.db'));

// Enable WAL mode for better performance
db.pragma('journal_mode = WAL');

// ─── Create all tables ────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS realtors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE,
    phone TEXT,
    brokerage TEXT,
    address TEXT,
    city TEXT,
    state TEXT,
    zip TEXT,
    closing_date TEXT,
    source TEXT DEFAULT 'realestateapi',
    
    -- Outreach tracking
    email_sent INTEGER DEFAULT 0,
    email_sent_at TEXT,
    text_sent INTEGER DEFAULT 0,
    text_sent_at TEXT,
    followup_count INTEGER DEFAULT 0,
    last_contact_at TEXT,
    next_followup_at TEXT,
    
    -- Engagement tracking
    email_opens INTEGER DEFAULT 0,
    email_clicks INTEGER DEFAULT 0,
    text_opens INTEGER DEFAULT 0,
    engagement_score INTEGER DEFAULT 0,
    last_opened_at TEXT,
    
    -- Reply tracking
    replied INTEGER DEFAULT 0,
    replied_at TEXT,
    reply_text TEXT,
    reply_channel TEXT,
    
    -- Status
    status TEXT DEFAULT 'pending',
    -- pending, contacted, hot_lead, replied, partner, opted_out, inactive
    
    -- Partner tracking
    is_partner INTEGER DEFAULT 0,
    partner_since TEXT,
    total_referrals INTEGER DEFAULT 0,
    total_installs INTEGER DEFAULT 0,
    total_paid REAL DEFAULT 0,
    referral_code TEXT UNIQUE,
    
    -- Suppression
    opted_out INTEGER DEFAULT 0,
    opted_out_at TEXT,
    do_not_contact INTEGER DEFAULT 0,
    
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS inspectors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE,
    phone TEXT,
    company TEXT,
    city TEXT,
    state TEXT,
    zip TEXT,
    license_number TEXT,
    source TEXT DEFAULT 'state_board',
    
    -- Same outreach tracking as realtors
    email_sent INTEGER DEFAULT 0,
    email_sent_at TEXT,
    text_sent INTEGER DEFAULT 0,
    text_sent_at TEXT,
    followup_count INTEGER DEFAULT 0,
    last_contact_at TEXT,
    engagement_score INTEGER DEFAULT 0,
    email_opens INTEGER DEFAULT 0,
    email_clicks INTEGER DEFAULT 0,
    replied INTEGER DEFAULT 0,
    replied_at TEXT,
    reply_text TEXT,
    status TEXT DEFAULT 'pending',
    is_partner INTEGER DEFAULT 0,
    opted_out INTEGER DEFAULT 0,
    do_not_contact INTEGER DEFAULT 0,
    
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS referrals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    realtor_id INTEGER,
    inspector_id INTEGER,
    partner_type TEXT DEFAULT 'realtor',
    
    customer_name TEXT,
    customer_phone TEXT,
    customer_email TEXT,
    customer_address TEXT,
    
    status TEXT DEFAULT 'pending',
    -- pending, contacted, installed, paid, cancelled
    
    submitted_at TEXT DEFAULT (datetime('now')),
    installed_at TEXT,
    paid_at TEXT,
    payout_amount REAL DEFAULT 200,
    
    notes TEXT,
    FOREIGN KEY (realtor_id) REFERENCES realtors(id),
    FOREIGN KEY (inspector_id) REFERENCES inspectors(id)
  );

  CREATE TABLE IF NOT EXISTS email_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    contact_id INTEGER,
    contact_type TEXT DEFAULT 'realtor',
    sendgrid_message_id TEXT,
    subject TEXT,
    email_type TEXT,
    -- initial, followup_1, followup_2, followup_3, followup_4, followup_5, partner_welcome
    sent_at TEXT DEFAULT (datetime('now')),
    status TEXT DEFAULT 'sent'
  );

  CREATE TABLE IF NOT EXISTS text_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    contact_id INTEGER,
    contact_type TEXT DEFAULT 'realtor',
    twilio_sid TEXT,
    message TEXT,
    text_type TEXT,
    sent_at TEXT DEFAULT (datetime('now')),
    status TEXT DEFAULT 'sent'
  );

  CREATE TABLE IF NOT EXISTS suppression_list (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT,
    phone TEXT,
    reason TEXT,
    added_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS crm_import (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT,
    phone TEXT,
    name TEXT,
    last_lead_date TEXT,
    imported_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS stats_daily (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT UNIQUE,
    emails_sent INTEGER DEFAULT 0,
    texts_sent INTEGER DEFAULT 0,
    new_realtors INTEGER DEFAULT 0,
    new_inspectors INTEGER DEFAULT 0,
    replies INTEGER DEFAULT 0,
    new_partners INTEGER DEFAULT 0,
    new_referrals INTEGER DEFAULT 0
  );
`);

// ─── Helper to update today's stats ──────────────────────────────────────
db.updateDailyStats = (field, increment = 1) => {
  const today = new Date().toISOString().split('T')[0];
  db.prepare(`
    INSERT INTO stats_daily (date, ${field}) VALUES (?, ?)
    ON CONFLICT(date) DO UPDATE SET ${field} = ${field} + ?
  `).run(today, increment, increment);
};

module.exports = db;
