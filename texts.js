// texts.js — All bot text and button labels in one place
module.exports = {
  welcome: (name) =>
    `👋 Welcome, ${name}!\n\nBrowse and purchase football match information.\nUse the buttons below to get started.`,

  buttons: {
    matches: "⚽ Available Matches",
    purchases: "🛒 My Purchases",
    channel: "📢 Join Our Channel",
    support: "💬 Contact Support",
    admin: "🔧 Admin Panel",
  },

  noMatches: "📭 No matches are available right now. Please check back later.",

  matchCard: (m) =>
    `⚽ *${m.league}*\n\n` +
    `🏠 Home: ${m.home_team}\n` +
    `✈️ Away: ${m.away_team}\n` +
    `📅 Date: ${m.match_date}\n` +
    `🕒 Time: ${m.match_time}\n` +
    `💰 Price: ${m.price} ⭐\n\n` +
    `📝 Basic Info:\n${m.basic_info || "N/A"}\n\n` +
    `🔒 Full information is locked. Pay to unlock.`,

  lockedInfo: "🔒 This information is protected. Complete payment to reveal it.",

  paymentSuccess: "✅ Payment confirmed! Here is your match information:",

  alreadyPurchased: "✅ You already purchased this match. Here is your information:",

  noPurchases: "🛒 You have not purchased any matches yet.",

  supportMsg: "💬 For help, contact our support account.",
};
