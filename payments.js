// payments.js — Telegram Stars (XTR) invoice creation and payment validation
const { pool } = require("./db");

// Create and send a Telegram Stars invoice for a match
async function sendMatchInvoice(ctx, match) {
  const title = `Match Info: ${match.home_team} vs ${match.away_team}`;
  const description = `${match.league} | ${match.match_date} ${match.match_time}`;

  await ctx.replyWithInvoice(
    title,
    description,
    `match_${match.id}`,
    "XTR", // Telegram Stars currency
    [{ label: "Match Information", amount: match.price }]
  );
}

// Validate a successful payment and record it.
// Returns the match row if the purchase is valid.
async function confirmPayment(ctx, payload, chargeId, telegramId) {
  // payload format: match_<id>
  if (!payload || !payload.startsWith("match_")) {
    throw new Error("Invalid payment payload");
  }
  const matchId = parseInt(payload.split("_")[1], 10);
  if (!matchId) throw new Error("Invalid match id");

  // Fetch match
  const matchRes = await pool.query("SELECT * FROM matches WHERE id = $1", [matchId]);
  if (matchRes.rows.length === 0) throw new Error("Match not found");
  const match = matchRes.rows[0];

  // Prevent duplicate payment processing using the unique charge id
  const existing = await pool.query(
    "SELECT id, status FROM orders WHERE telegram_payment_charge_id = $1",
    [chargeId]
  );
  if (existing.rows.length > 0) {
    console.log("Payment already processed:", chargeId);
    return match;
  }

  // Check if user already owns this match (without a charge id)
  const owned = await pool.query(
    "SELECT id FROM orders WHERE telegram_id = $1 AND match_id = $2",
    [telegramId, matchId]
  );
  if (owned.rows.length > 0) {
    // Update the existing row to record the charge
    await pool.query(
      "UPDATE orders SET status = 'paid', telegram_payment_charge_id = $1 WHERE id = $2",
      [chargeId, owned.rows[0].id]
    );
    return match;
  }

  // Insert a new paid order
  await pool.query(
    `INSERT INTO orders (telegram_id, match_id, status, telegram_payment_charge_id)
     VALUES ($1, $2, 'paid', $3)
     ON CONFLICT (telegram_id, match_id) DO UPDATE
       SET status = 'paid', telegram_payment_charge_id = EXCLUDED.telegram_payment_charge_id`,
    [telegramId, matchId, chargeId]
  );

  return match;
}

// Check if a user already purchased a match
async function hasPurchased(telegramId, matchId) {
  const res = await pool.query(
    "SELECT id FROM orders WHERE telegram_id = $1 AND match_id = $2 AND status = 'paid'",
    [telegramId, matchId]
  );
  return res.rows.length > 0;
}

module.exports = { sendMatchInvoice, confirmPayment, hasPurchased };
