// texts.js — All bot text and button labels in Chinese
module.exports = {
  welcome: (name) =>
    `👋 欢迎, ${name}!\n\n浏览并购买足球赛事信息。\n请点击下方按钮开始。`,

  noMatches: "📭 目前没有可用的比赛，请稍后再来。",

  matchCard: (m) =>
    `⚽ *${m.league}*\n\n` +
    `🏠 主队: ${m.home_team}\n` +
    `✈️ 客队: ${m.away_team}\n` +
    `📅 日期: ${m.match_date}\n` +
    `🕒 时间: ${m.match_time}\n` +
    `💰 价格: ${m.price} ⭐\n\n` +
    `📝 基本信息:\n${m.basic_info || "暂无"}\n\n` +
    `🔒 完整信息已锁定，请付款解锁。`,

  lockedInfo: "🔒 此信息受保护，请完成付款后查看。",

  paymentSuccess: "✅ 支付成功！这是您的比赛信息：",

  alreadyPurchased: "✅ 您已经购买过此比赛。以下是您的信息：",

  noPurchases: "🛒 您还没有购买任何比赛。",

  supportMsg: "💬 如需帮助，请联系客服。",
};
