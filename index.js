// index.js — Main bot entry point
const { Telegraf, Markup } = require("telegraf");
const { pool, initDb } = require("./db");
const texts = require("./texts");
const { sendMatchInvoice, confirmPayment, hasPurchased } = require("./payments");
const { showAdminPanel, handleAdminMessage, isAdmin, adminKeyboard } = require("./admin");

if (!process.env.BOT_TOKEN) {
  console.error("Missing BOT_TOKEN environment variable");
  process.exit(1);
}

const bot = new Telegraf(process.env.BOT_TOKEN);

// ---------- Helpers ----------
function mainKeyboard(ctx) {
  const rows = [
    [texts.buttons.matches],
    [texts.buttons.purchases],
    [texts.buttons.channel, texts.buttons.support],
  ];
  if (isAdmin(ctx)) rows.push([texts.buttons.admin]);
  return Markup.keyboard(rows).resize();
}

async function ensureUser(ctx) {
  const from = ctx.from;
  await pool.query(
    `INSERT INTO users (telegram_id, username, first_name)
     VALUES ($1,$2,$3)
     ON CONFLICT (telegram_id) DO UPDATE SET username = EXCLUDED.username, first_name = EXCLUDED.first_name`,
    [from.id, from.username || null, from.first_name || null]
  );
}

// ---------- Commands ----------
bot.start(async (ctx) => {
  await ensureUser(ctx);
  await ctx.reply(texts.welcome(ctx.from.first_name), mainKeyboard(ctx));
});

bot.command("admin", async (ctx) => {
  if (!isAdmin(ctx)) return ctx.reply("⛔ Not authorized.");
  await showAdminPanel(ctx);
});

// ---------- Payment handlers ----------
bot.on("pre_checkout_query", async (ctx) => {
  // Always approve the pre-checkout so Telegram proceeds
  try {
    await ctx.answerPreCheckoutQuery(true);
  } catch (e) {
    console.error("pre_checkout answer failed:", e.message);
  }
});

bot.on("successful_payment", async (ctx) => {
  try {
    const payment = ctx.message.successful_payment;
    const chargeId = payment.telegram_payment_charge_id;
    const payload = payment.invoice_payload;
    const match = await confirmPayment(ctx, payload, chargeId, ctx.from.id);

    await ctx.reply(texts.paymentSuccess);
    await ctx.reply(match.protected_info || texts.lockedInfo, {
      parse_mode: "Markdown",
    });
    await ctx.reply("Use the menu below:", mainKeyboard(ctx));
  } catch (e) {
    console.error("successful_payment error:", e);
    await ctx.reply("⚠️ Payment received but we could not unlock the info. Please contact support.");
  }
});

// ---------- Callback buttons (View Match / Pay) ----------
bot.action(/^view_(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const matchId = parseInt(ctx.match[1], 10);
  const res = await pool.query("SELECT * FROM matches WHERE id = $1", [matchId]);
  if (res.rows.length === 0) return ctx.reply("Match not found.");
  const m = res.rows[0];

  const owned = await hasPurchased(ctx.from.id, matchId);
  if (owned) {
    await ctx.reply(texts.alreadyPurchased);
    await ctx.reply(m.protected_info || texts.lockedInfo, { parse_mode: "Markdown" });
    return;
  }

  await ctx.reply(texts.matchCard(m), {
    parse_mode: "Markdown",
    ...Markup.inlineKeyboard([
      [Markup.button.callback(`💳 Pay ${m.price} ⭐ to Unlock`, `pay_${m.id}`)],
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
    await ctx.reply(texts.alreadyPurchased);
    await ctx.reply(m.protected_info || texts.lockedInfo, { parse_mode: "Markdown" });
    return;
  }

  await sendMatchInvoice(ctx, m);
});

// ---------- Text buttons ----------
bot.on("text", async (ctx, next) => {
  await ensureUser(ctx);
  const text = ctx.message.text;

  // Let the admin conversation handler take priority
  if (isAdmin(ctx)) {
    const handled = await handleAdminMessage(ctx);
    if (handled) return;
  }

  if (text === texts.buttons.matches) {
    const res = await pool.query("SELECT * FROM matches ORDER BY id DESC");
    if (res.rows.length === 0) return ctx.reply(texts.noMatches);

    for (const m of res.rows) {
      await ctx.reply(
        `⚽ *${m.league}*\n🏠 ${m.home_team} vs ✈️ ${m.away_team}\n📅 ${m.match_date} 🕒 ${m.match_time}\n💰 ${m.price} ⭐`,
        {
          parse_mode: "Markdown",
          ...Markup.inlineKeyboard([
            [Markup.button.callback("👁 View Match", `view_${m.id}`)],
          ]),
        }
      );
    }
    return;
  }

  if (text === texts.buttons.purchases) {
    const res = await pool.query(
      `SELECT m.* FROM orders o JOIN matches m ON m.id = o.match_id
       WHERE o.telegram_id = $1 AND o.status = 'paid'
       ORDER BY o.id DESC`,
      [ctx.from.id]
    );
    if (res.rows.length === 0) return ctx.reply(texts.noPurchases);

    for (const m of res.rows) {
      await ctx.reply(
        `✅ *${m.league}*\n${m.home_team} vs ${m.away_team}\n\n${m.protected_info || texts.lockedInfo}`,
        {
          parse_mode: "Markdown",
          ...Markup.inlineKeyboard([
            [Markup.button.callback("👁 View Again", `view_${m.id}`)],
          ]),
        }
      );
    }
    return;
  }

  if (text === texts.buttons.channel) {
    const link = process.env.CHANNEL_LINK || "https://t.me/";
    return ctx.reply(`📢 Join our channel: ${link}`);
  }

  if (text === texts.buttons.support) {
    const link = process.env.SUPPORT_LINK || "https://t.me/";
    return ctx.reply(`💬 Contact support: ${link}`);
  }

  if (text === texts.buttons.admin && isAdmin(ctx)) {
    await showAdminPanel(ctx);
    return;
  }

  return next();
});

// ---------- Boot ----------
(async () => {
  try {
    await initDb();
    await bot.telegram.deleteWebhook({ drop_pending_updates: false }).catch(() => {});
    await bot.launch();
    console.log("Bot is running (long polling).");
  } catch (e) {
    console.error("Startup error:", e);
    process.exit(1);
  }
})();

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
