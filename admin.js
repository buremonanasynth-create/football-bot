// admin.js — Admin-only panel: add/list/delete matches, view purchases, broadcast
const { Markup } = require("telegraf");
const { pool } = require("./db");

// In-memory state for the admin's "add match" conversation
const addState = new Map();

function isAdmin(ctx) {
  return String(ctx.from.id) === String(process.env.ADMIN_ID);
}

function adminKeyboard() {
  return Markup.keyboard([
    ["➕ Add Match", "📋 List Matches"],
    ["🗑 Delete Match", "🧾 View Purchases"],
    ["📢 Send Notification", "⬅️ Back to Main"],
  ]).resize();
}

async function showAdminPanel(ctx) {
  if (!isAdmin(ctx)) return;
  await ctx.reply("🔧 *Admin Panel*\nChoose an action:", {
    parse_mode: "Markdown",
    ...adminKeyboard(),
  });
}

// Entry point: called from index.js when admin presses the Admin button
async function handleAdminMessage(ctx) {
  if (!isAdmin(ctx)) return false;
  const text = ctx.message?.text;
  if (!text) return false;

  // If the admin is mid-way through adding a match, collect the next field
  if (addState.has(ctx.from.id)) {
    await collectAddField(ctx, text);
    return true;
  }

  if (text === "➕ Add Match") {
    addState.set(ctx.from.id, { step: 1 });
    await ctx.reply(
      "Step 1/8 — Send the *league name*:\n\n(Type /cancel to stop)",
      { parse_mode: "Markdown" }
    );
    return true;
  }

  if (text === "📋 List Matches") {
    const res = await pool.query("SELECT * FROM matches ORDER BY id DESC");
    if (res.rows.length === 0) {
      await ctx.reply("No matches in the database.");
      return true;
    }
    for (const m of res.rows) {
      await ctx.reply(
        `#${m.id} | ${m.league}\n${m.home_team} vs ${m.away_team}\n${m.match_date} ${m.match_time} | ${m.price} ⭐`
      );
    }
    return true;
  }

  if (text === "🗑 Delete Match") {
    await ctx.reply("Send the match ID you want to delete (e.g. 3):");
    addState.set(ctx.from.id, { step: "delete" });
    return true;
  }

  if (text === "🧾 View Purchases") {
    const res = await pool.query(
      `SELECT o.id, o.telegram_id, o.status, o.created_at, m.league, m.home_team, m.away_team
       FROM orders o JOIN matches m ON m.id = o.match_id
       ORDER BY o.id DESC LIMIT 50`
    );
    if (res.rows.length === 0) {
      await ctx.reply("No purchases yet.");
      return true;
    }
    const lines = res.rows.map(
      (r) =>
        `#${r.id} user ${r.telegram_id} — ${r.home_team} vs ${r.away_team} (${r.status})`
    );
    await ctx.reply(lines.join("\n"));
    return true;
  }

  if (text === "📢 Send Notification") {
    addState.set(ctx.from.id, { step: "notify" });
    await ctx.reply("Send the message you want to broadcast to all subscribers:");
    return true;
  }

  if (text === "⬅️ Back to Main") {
    return false; // let index.js show the main menu
  }

  return false;
}

async function collectAddField(ctx, text) {
  if (text === "/cancel") {
    addState.delete(ctx.from.id);
    await ctx.reply("Cancelled.", adminKeyboard());
    return;
  }

  const state = addState.get(ctx.from.id);

  if (state.step === "delete") {
    const id = parseInt(text, 10);
    if (!id) {
      await ctx.reply("Please send a valid numeric ID.");
      return;
    }
    await pool.query("DELETE FROM matches WHERE id = $1", [id]);
    addState.delete(ctx.from.id);
    await ctx.reply(`Match #${id} deleted.`, adminKeyboard());
    return;
  }

  if (state.step === "notify") {
    const users = await pool.query("SELECT telegram_id FROM users");
    let sent = 0;
    for (const u of users.rows) {
      try {
        await ctx.telegram.sendMessage(u.telegram_id, text);
        sent++;
      } catch (e) {
        // ignore blocked users
      }
    }
    addState.delete(ctx.from.id);
    await ctx.reply(`Notification sent to ${sent} users.`, adminKeyboard());
    return;
  }

  // Steps 1..8 for adding a match
  const prompts = {
    2: "Step 2/8 — Send the *home team*:",
    3: "Step 3/8 — Send the *away team*:",
    4: "Step 4/8 — Send the *match date* (e.g. 2025-12-01):",
    5: "Step 5/8 — Send the *match time* (e.g. 20:00):",
    6: "Step 6/8 — Send the *price in Telegram Stars* (e.g. 50):",
    7: "Step 7/8 — Send the *basic (public) information*:",
    8: "Step 8/8 — Send the *protected information* (revealed only after payment):",
  };

  state[`field${state.step}`] = text;
  state.step++;

  if (state.step <= 8) {
    await ctx.reply(prompts[state.step], { parse_mode: "Markdown" });
    return;
  }

  // All fields collected — insert into DB
  const price = parseInt(state.field6, 10);
  if (!price || price <= 0) {
    addState.delete(ctx.from.id);
    await ctx.reply("Invalid price. Cancelled.", adminKeyboard());
    return;
  }

  await pool.query(
    `INSERT INTO matches (league, home_team, away_team, match_date, match_time, price, basic_info, protected_info)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      state.field1,
      state.field2,
      state.field3,
      state.field4,
      state.field5,
      price,
      state.field7,
      state.field8,
    ]
  );

  addState.delete(ctx.from.id);
  await ctx.reply("✅ Match added successfully!", adminKeyboard());
}

module.exports = { showAdminPanel, handleAdminMessage, isAdmin, adminKeyboard };
