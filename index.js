// index.js — Main bot entry point (Clean Layout, No Admin Panel)
const { Telegraf, Markup } = require("telegraf");
const { pool, initDb } = require("./db");
const texts = require("./texts");
const { sendMatchInvoice, confirmPayment, hasPurchased } = require("./payments");

if (!process.env.BOT_TOKEN) {
  console.error("Missing BOT_TOKEN environment variable");
  process.exit(1);
}

const bot = new Telegraf(process.env.BOT_TOKEN);

// Set the Menu button on the left of the text input box
bot.telegram.setMyCommands([
  { command: "start", description: "🏠 Main Menu" },
  { command: "matches", description: "⚽ Available Matches" },
  { command: "purchases", description: "🛒 My Purchases" },
]);

// Function to show the main welcome message
async function showMainMenu(ctx) {
  const from = ctx.from;
  // Save user to database
  await pool.query(
    `INSERT INTO users (telegram_id, username, first_name)
     VALUES ($1,$2,$3)
     ON CONFLICT (telegram_id) DO UPDATE SET username = EXCLUDED.username, first_name = EXCLUDED.first_name`,
    [from.id, from.username || null, from.first_name || null]
  );

  const msg = texts.welcome(from.first_name) + "\n\n" +
    `📢 **Channel**: [Join Here](${process.env.CHANNEL_LINK || "https://t.me/"})\n` +
    `💬 **Support**: [Contact Here](${process.env.SUPPORT_LINK || "https://t.me/"})`;

  await ctx.reply(msg, {
    parse_mode: "Markdown",
    ...Markup.inlineKeyboard([
      [Markup.button.callback("⚽ Available Matches", "menu_matches")],
      [Markup.button.callback("🛒 My Purchases", "menu_purchases")],
    ]),
  });
}

// ---------- Commands ----------
bot.start(showMainMenu);

bot.command("matches", async (ctx) => {
  const res = await pool.query("SELECT * FROM matches ORDER BY id DESC");
  if (res.rows.length === 0) return ctx.reply("No matches available right now.");

  for (const m of res.rows) {
    const msg = `⚽ **${m.league}**\n` +
      `🏠 ${m.home_team} vs ✈️ ${m.away_team}\n` +
      `📅 ${m.match_date} | 🕒 ${m.match_time}\n` +
      `💰 Price: ${m.price} ⭐`;

    await ctx.reply(msg, {
      parse_mode: "Markdown",
      ...Markup.inlineKeyboard([
        [Markup.button.callback(`👁 View Match`, `view_${m.id}`)],
      ]),
    });
  }
});

bot.command("purchases", async (ctx) => {
  const res = await pool.query(
    `SELECT m.* FROM orders o JOIN matches m ON m.id = o.match_id
     WHERE o.telegram_id = $1 AND o.status = 'paid'
     ORDER BY o.id DESC`,
    [ctx.from.id]
  );
  if (res.rows.length === 0) return ctx.reply("You have not purchased any matches yet.");

  for (const m of res.rows) {
    await ctx.reply(
      `✅ **${m.league}**\n${m.home_team} vs ${m.away_team}\n\n${m.protected_info}`,
      { parse_mode: "Markdown" }
    );
  }
});

// ---------- Callback handlers (Inline buttons) ----------
bot.action("menu_matches", async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.deleteMessage().catch(() => {});
  bot.command("matches", ctx).catch(() => {});
  // Trigger matches manually
  const res = await pool.query("SELECT * FROM matches ORDER BY id DESC");
  if (res.rows.length === 0) return ctx.reply("No matches available right now.");
  for (const m of res.rows) {
    await ctx.reply(`⚽ **${m.league}**\n🏠 ${m.home_team} vs ✈️ ${m.away_team}\n📅 ${m.match_date} | 🕒 ${m.match_time}\n💰 Price: ${m.price} ⭐`, {
      parse_mode: "Markdown",
      ...Markup.inlineKeyboard([[Markup.button.callback(`👁 View Match`, `view_${m.id}`)]]),
    });
  }
});

bot.action("menu_purchases", async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.deleteMessage().catch(() => {});
  bot.command("purchases", ctx).catch(() => {});
});

bot.action(/^view_(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const matchId = parseInt(ctx.match[1], 10);
  const res = await pool.query("SELECT * FROM matches WHERE id = $1", [matchId]);
  if (res.rows.length === 0) return ctx.reply("Match not found.");
  const m = res.rows[0];

  const owned = await hasPurchased(ctx.from.id, matchId);
  if (owned) {
    await ctx.reply(`✅ You already purchased this.\n\n${m.protected_info}`, { parse_mode: "Markdown" });
    return;
  }

  const msg = `⚽ **${m.league}**\n` +
    `🏠 ${m.home_team} vs ✈️ ${m.away_team}\n` +
    `📅 ${m.match_date} | 🕒 ${m.match_time}\n` +
    `💰 Price: ${m.price} ⭐\n\n` +
    `📝 **Basic Info:**\n${m.basic_info || "N/A"}\n\n` +
    `🔒 *Full information is locked.*`;

  await ctx.reply(msg, {
    parse_mode: "Markdown",
    ...Markup.inlineKeyboard([
      [Markup.button.callback(`💳 Pay ${m.price} ⭐ to Unlock`, `pay_${m.id}`)],
      [Markup.button.callback(`⬅️ Back to List`, `menu_matches`)],
    ]),
  });
});

bot.action(/^pay_(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const matchId = parseInt(ctx.match[1], 10);
  const res = await pool.query("SELECT * FROM matches WHERE id = $1", [matchId]);
  if (res.rows.length === 0) return ctx.reply("Match not found.");
  const m = res.rows[0];

  if (await hasPurchased(ctx.from.id, matchId)) {
    await ctx.reply(`✅ You already purchased this.\n\n${m.protected_info}`, { parse_mode: "Markdown" });
    return;
  }
  await sendMatchInvoice(ctx, m);
});

// ---------- Payment handlers ----------
bot.on("pre_checkout_query", async (ctx) => {
  await ctx.answerPreCheckoutQuery(true).catch((e) => console.error(e.message));
});

bot.on("successful_payment", async (ctx) => {
  try {
    const payment = ctx.message.successful_payment;
    const match = await confirmPayment(ctx, payment.invoice_payload, payment.telegram_payment_charge_id, ctx.from.id);

    await ctx.reply(`✅ Payment confirmed! Here is your protected match information:\n\n${match.protected_info}`, {
      parse_mode: "Markdown",
      ...Markup.inlineKeyboard([[Markup.button.callback("🏠 Main Menu", "menu_home")]]),
    });
  } catch (e) {
    console.error(e);
    await ctx.reply("⚠️ Payment received but we could not unlock the info. Please contact support.");
  }
});

bot.action("menu_home", async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.deleteMessage().catch(() => {});
  showMainMenu(ctx);
});

// ---------- Boot ----------
(async () => {
  try {
    await initDb();
    await bot.telegram.deleteWebhook({ drop_pending_updates: true }).catch(() => {});
    await bot.launch();
    console.log("Bot is running cleanly without admin panel.");
  } catch (e) {
    console.error("Startup error:", e);
    process.exit(1);
  }
})();

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
