import { inngest } from "@/lib/inngest/client";
import { sendNewsSummaryEmail, sendWelcomeEmail } from "@/lib/nodemailer";
import { getAllUsersForNewsEmail } from "@/lib/actions/user.actions";
import { getWatchlistSymbolsByEmail } from "@/lib/actions/watchlist.actions";
import { getNews } from "@/lib/actions/finnhub.actions";
import { getFormattedTodayDate } from "@/lib/utils";
import { connectToDatabase } from "@/database/mongoose";
import { UserAlert } from "@/database/models/alert.model";
import {
  getAverageDailyVolume,
  getCurrentDayVolume,
  getStockQuote,
} from "@/lib/actions/finnhub.actions";
import { sendPriceAlertEmail, sendVolumeAlertEmail } from "@/lib/nodemailer";

type UserForNewsEmail = { id: string; email: string; name: string };

const HTML_ENTITIES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (character) => HTML_ENTITIES[character] ?? character,
  );

const createNewsFallback = (articles: MarketNewsArticle[]) => {
  if (articles.length === 0) {
    return '<p class="mobile-text dark-text-secondary" style="color: #CCDADC;">No market stories were available today.</p>';
  }

  const stories = articles
    .map((article) => {
      const headline = escapeHtml(article.headline || "Market update");
      const summary = escapeHtml(article.summary || "");
      const link = article.url.startsWith("https://")
        ? `<p><a href="${escapeHtml(article.url)}" style="color: #FDD458;">Read article</a></p>`
        : "";

      return `<div style="background-color: #212328; padding: 20px; margin: 16px 0; border-radius: 8px;"><h4 style="color: #FFFFFF;">${headline}</h4><p style="color: #CCDADC;">${summary}</p>${link}</div>`;
    })
    .join("");

  return `<h3 style="color: #FDD458;">Latest market headlines</h3>${stories}`;
};

export const sendSignUpEmail = inngest.createFunction(
  { id: "sign-up-email", triggers: { event: "app/user.created" } },
  async ({ event, step }) => {
    await step.run("send-welcome-email", async () => {
      const {
        data: { email, name },
      } = event;

      return await sendWelcomeEmail({
        email,
        name,
        intro:
          "Thanks for joining MarketPilot. You now have the tools to track markets and make smarter moves.",
      });
    });

    return {
      success: true,
      message: "Welcome email sent successfully",
    };
  },
);

export const sendDailyNewsSummary = inngest.createFunction(
  {
    id: "daily-news-summary",
    triggers: [{ event: "app/send.daily.news" }, { cron: "0 12 * * *" }],
  },
  async ({ step }) => {
    // Step #1: Get all users for news delivery
    const users = await step.run("get-all-users", getAllUsersForNewsEmail);

    if (!users || users.length === 0)
      return { success: false, message: "No users found for news email" };

    // Step #2: For each user, get watchlist symbols -> fetch news (fallback to general)
    const results = await step.run("fetch-user-news", async () => {
      const perUser: Array<{
        user: UserForNewsEmail;
        articles: MarketNewsArticle[];
      }> = [];
      for (const user of users as UserForNewsEmail[]) {
        try {
          const symbols = await getWatchlistSymbolsByEmail(user.email);
          let articles = await getNews(symbols);
          // Enforce max 6 articles per user
          articles = (articles || []).slice(0, 6);
          // If still empty, fallback to general
          if (!articles || articles.length === 0) {
            articles = await getNews();
            articles = (articles || []).slice(0, 6);
          }
          perUser.push({ user, articles });
        } catch (e) {
          console.error("daily-news: error preparing user news", user.email, e);
          perUser.push({ user, articles: [] });
        }
      }
      return perUser;
    });

    const userNewsSummaries = results.map(({ user, articles }) => ({
      user,
      newsContent: createNewsFallback(articles),
    }));

    await Promise.all(
      userNewsSummaries.map(({ user, newsContent }) =>
        step.run(`send-news-email-${user.id}`, async () =>
          sendNewsSummaryEmail({
            email: user.email,
            date: getFormattedTodayDate(),
            newsContent,
          }),
        ),
      ),
    );

    return {
      success: true,
      message: "Daily news summary emails sent successfully",
    };
  },
);

const alertCooldownMs: Record<AlertFrequency, number> = {
  minute: 60_000,
  hour: 60 * 60_000,
  day: 24 * 60 * 60_000,
};

export const checkStockAlerts = inngest.createFunction(
  {
    id: "check-stock-alerts",
    triggers: { cron: "* * * * *" },
    concurrency: { limit: 1 },
  },
  async ({ step }) => {
    const alerts = await step.run("load-active-alerts", async () => {
      await connectToDatabase();
      const documents = await UserAlert.find({ isActive: true }).lean();
      return documents.map((alert) => ({
        id: String(alert._id),
        userId: alert.userId,
        symbol: alert.symbol,
        company: alert.company,
        kind: alert.kind,
        condition: alert.condition,
        threshold: alert.threshold,
        frequency: alert.frequency,
        lastTriggeredAt: alert.lastTriggeredAt?.toISOString() ?? null,
      }));
    });

    if (alerts.length === 0) return { success: true, checked: 0, notified: 0 };

    const symbols = [...new Set(alerts.map((alert) => alert.symbol))];
    const volumeSymbols = new Set(
      alerts
        .filter((alert) => alert.kind === "volume")
        .map((alert) => alert.symbol),
    );
    const marketData = await step.run("load-alert-market-data", async () => {
      const entries = await Promise.all(
        symbols.map(async (symbol) => {
          const [quote, averageVolume, currentVolume] = await Promise.all([
            getStockQuote(symbol).catch(() => null),
            volumeSymbols.has(symbol)
              ? getAverageDailyVolume(symbol).catch(() => undefined)
              : Promise.resolve(undefined),
            volumeSymbols.has(symbol)
              ? getCurrentDayVolume(symbol).catch(() => undefined)
              : Promise.resolve(undefined),
          ]);
          const volumePercent =
            averageVolume && currentVolume != null
              ? (currentVolume / averageVolume) * 100
              : undefined;
          return [
            symbol,
            { ...(quote ?? {}), averageVolume, currentVolume, volumePercent },
          ] as const;
        }),
      );
      return Object.fromEntries(entries);
    });

    const mongoose = await connectToDatabase();
    const db = mongoose.connection.db;
    if (!db) throw new Error("MongoDB connection not found");

    let notified = 0;
    for (const alert of alerts) {
      const data = marketData[alert.symbol];
      const currentValue =
        alert.kind === "price" ? data?.currentPrice : data?.volumePercent;
      if (currentValue == null || !Number.isFinite(currentValue)) continue;

      const crossed =
        alert.condition === "greater"
          ? currentValue >= alert.threshold
          : currentValue <= alert.threshold;
      if (!crossed) continue;

      const now = Date.now();
      if (
        alert.lastTriggeredAt &&
        now - new Date(alert.lastTriggeredAt).getTime() <
          alertCooldownMs[alert.frequency]
      ) {
        continue;
      }

      const user = await db.collection("user").findOne<{
        email?: string;
      }>({ id: alert.userId }, { projection: { email: 1 } });
      if (!user?.email) {
        console.error(
          "Skipping stock alert because its user has no email",
          alert.id,
        );
        continue;
      }

      const delivered = await step.run(
        `send-stock-alert-${alert.id}-${Math.floor(now / 60_000)}`,
        async () => {
          if (alert.kind === "price") {
            if (data.currentPrice == null) return false;
            await sendPriceAlertEmail({
              email: user.email!,
              symbol: alert.symbol,
              company: alert.company,
              condition: alert.condition,
              threshold: alert.threshold,
              currentPrice: data.currentPrice,
            });
          } else {
            if (
              data.currentVolume == null ||
              !data.averageVolume ||
              data.currentPrice == null
            )
              return false;
            await sendVolumeAlertEmail({
              email: user.email!,
              symbol: alert.symbol,
              company: alert.company,
              condition: alert.condition,
              threshold: alert.threshold,
              currentVolume: data.currentVolume,
              averageVolume: data.averageVolume,
              currentPrice: data.currentPrice,
              changePercent: data.changePercent ?? 0,
            });
          }

          await UserAlert.updateOne(
            { _id: alert.id },
            {
              $set: {
                lastTriggeredAt: new Date(),
                lastTriggeredValue: currentValue,
              },
            },
          );
          return true;
        },
      );
      if (delivered) notified++;
    }

    return { success: true, checked: alerts.length, notified };
  },
);
